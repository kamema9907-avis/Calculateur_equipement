// ============================================================================
//  app.js — etat, filtres, vues.
//  Vue 3 est charge en global par le CDN ; on le lit sur window.
//
//  Note de performance : `prix` et `histo` ne sont PAS reactifs. Ils portent
//  jusqu'a 7 000 objets x 8 lieux x 5 qualites ; les rendre reactifs en
//  profondeur ferait installer a Vue des dizaines de milliers de proxies a
//  chaque chargement. Un compteur de version sert de declencheur explicite,
//  comme dans le calculateur Cuisine & Potions.
// ============================================================================

import * as C from './catalogue.js';
import * as V from './villes.js';
import * as M from './moteur.js';
import * as Mk from './marche.js';
import * as D from './debouches.js';
import * as Inv from './inventaire.js';
import * as Sol from './solveur.js';
import * as Art from './artefacts.js';

const { createApp, reactive, ref, computed, watch, onMounted } = window.Vue;

const CLE_REGLAGES = 'albion.eq.reglages';

// Etat lourd, hors du systeme de reactivite (voir en-tete).
let prix = {};
let histo = {};
let donnees = { recipes: [], names: {}, artefacts: {}, economy: {}, byId: {} };

// Partage avec le composant recursif de l'arbre de cout.
const partage = {};

// ---------------------------------------------------------------------------
//  Composant : un noeud de l'arbre de cout.
//  Recursif — un ingredient fabrique montre ses propres ingredients.
// ---------------------------------------------------------------------------
const ArbreNoeud = {
  name: 'ArbreNoeud',
  props: { ligne: Object, recette: String, profondeur: { type: Number, default: 0 } },
  setup(props) {
    const ouvert = ref(false);
    const produit = computed(() => props.ligne.retenue === 'raffiner' || props.ligne.retenue === 'fabriquer');
    const enfants = computed(() => {
      if (!ouvert.value || !produit.value) return [];
      const r = donnees.byId[props.ligne.id];
      return r ? partage.decomposer(r).lignes : [];
    });
    return {
      ouvert, produit, enfants,
      nom: partage.nom, fmtM: C.fmtM, fmtPct: C.fmtPct,
      libelleVoie: m => ({ acheter: 'Acheter', raffiner: 'Raffiner', fabriquer: 'Fabriquer' }[m] || m),
      choisir: (m) => partage.choisirVoie(props.recette, props.ligne.id, m),
      // Un ecart de moins de 5 % entre les deux meilleures voies merite d'etre
      // signale : le choix bascule au moindre mouvement de prix.
      serre: computed(() => props.ligne.ecartSuivante != null && props.ligne.ecartSuivante < 0.05),
    };
  },
  template: `
    <div class="noeud" :style="{marginLeft: profondeur ? '4px' : '0'}">
      <div class="noeud-tete">
        <span v-if="produit" style="cursor:pointer;color:var(--muted)" @click="ouvert=!ouvert">
          {{ ouvert ? '▾' : '▸' }}
        </span>
        <span v-else style="width:9px"></span>
        <span>{{ nom(ligne.id) }}</span>
        <span class="q">×{{ ligne.quantity }}<template v-if="!ligne.exclu"> → {{ ligne.qteReelle.toFixed(1) }}</template></span>
        <span v-if="ligne.exclu" class="q" title="Les artefacts ne sont pas rendus par le retour de ressources">(non rendu)</span>
        <span class="c">{{ fmtM(ligne.coutU) }}</span>
      </div>
      <div class="noeud-tete" style="padding-top:0">
        <span v-for="v in ligne.voies" :key="v.methode"
              class="via" :class="{on: v.methode===ligne.retenue, forcee: ligne.forcee && v.methode===ligne.retenue}"
              @click="choisir(v.methode)"
              :title="(v.where || '') + ' — clic pour forcer cette voie'">
          {{ libelleVoie(v.methode) }} {{ fmtM(v.cost) }}<template v-if="v.where"> · {{ v.where }}</template>
        </span>
        <span v-if="serre" class="marge-serree">écart {{ fmtPct(ligne.ecartSuivante) }} avec la suivante</span>
      </div>
      <div v-if="ouvert">
        <arbre-noeud v-for="e in enfants" :key="e.id" :ligne="e" :recette="ligne.id" :profondeur="profondeur+1"></arbre-noeud>
      </div>
    </div>`,
};

// ---------------------------------------------------------------------------
const app = createApp({
  setup() {
    const pret = ref(false);
    const chargement = ref(false);
    const erreur = ref('');
    const statut = ref('');
    const progres = ref(0);
    const onglet = ref('reperage');
    const versionPrix = ref(0);
    const prixCharges = ref(false);
    const histoCharges = ref(false);

    const selection = ref(null);
    const detail = ref(null);
    const bulle = ref(null);
    const limite = ref(100);
    const zoom = ref(null);            // case de la carte sur laquelle on a clique
    const forcees = reactive({});      // "recetteId|ingId" -> methode imposee

    const table = reactive(V.chargerTable());

    // ---- Filtres ----
    const f = reactive({
      categories: C.CATEGORIES.map(c => c.cle),
      tiers: [4, 5, 6, 7, 8],
      ench: [0, 1, 2],
      lignes: C.LIGNES.map(l => l.cle),
      lignees: C.LIGNEES.map(l => l.cle),
      villesAchat: [...V.VILLES],
      villesVente: [...V.VILLES],
      recherche: '',
      maxAgeH: 24,
      margeMin: 10,
      // Volume quotidien minimal, applique une fois l'historique charge. Les
      // marches d'equipement sont bien plus etroits que ceux de la nourriture :
      // 3 ventes par jour est deja un marche vivant pour une piece T8 rare.
      volumeMin: 3,
      topAnalyse: 200,
    });

    // ---- Reglages ----
    const r = reactive({
      tarifStation: 400,
      villeFabrication: 'auto',
      villeRaffinage: 'auto',
      eventBonus: 0,
      premium: true,
      focusFabrication: false,
      focusRaffinage: false,
      autoriserRaffinage: true,
      undercut: 3,
      // Distribution reelle du tirage de qualite a la fabrication, 1 jet sans
      // bonus (wiki, page Crafting). Focus et nourriture de craft ajoutent des
      // jets dont seul le meilleur compte : ces parts sont donc un PLANCHER.
      parts: { 1: 68.9, 2: 25, 3: 5, 4: 1.1, 5: 0.1 },
    });

    // ---- Inventaire ----
    const stock = reactive(Inv.chargerStock());
    const inv = reactive({
      // Un seul poste de silver : il couvre les achats ET les frais de station,
      // que la banque ne fournit jamais. Un capital a zero interdit donc tout
      // craft, meme avec une banque pleine — c'est le jeu, pas un bug.
      capital: 5000000,
      focus: 30000,            // plafond du jeu
      efficaciteFocus: 0,
      villeBase: 'Martlock',
      nbVillesMax: 3,
      partVolume: 10,
      // Filtres du plan. Ils agissent AVANT la resolution, pas sur l'affichage :
      // masquer des lignes deja servies laisserait des totaux faux et du stock
      // immobilise sur ce qu'on ne voulait pas. En filtrant en amont, la banque
      // et le silver se reportent sur ce qui reste.
      tiers: [...C.TIERS],
      ench: [...C.ENCHANTEMENTS],
      villesVente: [...V.VILLES],
      villesAchat: [...V.VILLES],
      // Sans ce garde-fou, le solveur depense tout le capital sur l'objet le
      // plus rentable du jeu et laisse la banque intacte : sur un stock reel,
      // 99 % du stock dormait pendant qu'il achetait des sceaux royaux. C'est
      // le travail de l'onglet Tableau, pas de celui-ci.
      exigerBanque: true,
    });
    const plan = ref(null);
    const planCharge = ref(false);

    // ---- Persistance ----
    try {
      const sauv = JSON.parse(localStorage.getItem(CLE_REGLAGES) || 'null');
      if (sauv) {
        Object.assign(f, sauv.f || {});
        Object.assign(r, sauv.r || {});
        Object.assign(inv, sauv.inv || {});
      }
    } catch { /* reglages corrompus : on garde les defauts */ }
    watch(stock, () => Inv.sauverStock(stock), { deep: true });
    watch([f, r, inv], () => {
      try { localStorage.setItem(CLE_REGLAGES, JSON.stringify({ f, r, inv })); } catch {}
    }, { deep: true });

    // ---- Chargement du catalogue ----
    onMounted(async () => {
      try {
        const d = await (await fetch('data/equipment-data.json')).json();
        donnees = { ...d, byId: {}, fiches: { ip: {}, stats: {}, ordreQualites: [] } };
        for (const rec of d.recipes) donnees.byId[rec.id] = rec;
        pret.value = true;
        // Fiches techniques : 511 Ko qui ne servent qu'a l'onglet Fiche, donc
        // chargees apres coup et sans bloquer. Leur absence n'empeche rien.
        fetch('data/fiches.json')
          .then(x => x.json())
          .then(fx => { donnees.fiches = fx; versionFiche.value++; })
          .catch(() => { /* l'onglet Fiche dira simplement « donnee absente » */ });
        // 212 Ko qui ne servent qu'a l'onglet Artefact : meme traitement.
        fetch('data/artefacts.json')
          .then(x => x.json())
          .then(ax => {
            cataArt = ax;
            // Le rendu et le bareme viennent des donnees, pas de constantes
            // figees dans l'interface. On ne les impose PAS si l'utilisateur a
            // deja saisi les siens : sa mesure en jeu prime sur le defaut livre.
            if (ax.unitesRecyclage && artf.unites == null) artf.unites = ax.unitesRecyclage;
            if (ax.bareme && !artf.bareme) artf.bareme = JSON.parse(JSON.stringify(ax.bareme));
            baremeLivre = ax.bareme || null;
            versionArt.value++;
          })
          .catch(() => { erreur.value = 'data/artefacts.json est introuvable — relance scripts/build-data.js.'; });
      } catch {
        erreur.value = "Impossible de charger data/equipment-data.json. "
          + "Sers le dossier par un serveur HTTP (Lancer.bat) : le navigateur bloque fetch() en file://.";
      }
    });

    const nom = id => (donnees.names[id] || {}).fr || id;
    partage.nom = nom;

    // ---- Economie effective ----
    const eco = computed(() => ({
      ordre: r.premium ? donnees.economy.ordrePremium : donnees.economy.ordreFree,
      instant: r.premium ? donnees.economy.instantPremium : donnees.economy.instantFree,
    }));

    // Parts de qualite renormalisees. Un total a 0 vaudrait division par zero :
    // on retombe alors sur « tout en Normale ».
    const partsNormalisees = computed(() => {
      const total = Object.values(r.parts).reduce((a, b) => a + (+b || 0), 0);
      if (total <= 0) return { 1: 1 };
      const out = {};
      for (const [q, p] of Object.entries(r.parts)) if (p > 0) out[q] = p / total;
      return out;
    });
    const totalParts = computed(() => Object.values(r.parts).reduce((a, b) => a + (+b || 0), 0));

    // ---- Perimetre : les recettes retenues par les filtres ----
    const perimetre = computed(() => {
      if (!pret.value) return [];
      const q = f.recherche.trim().toLowerCase();
      return donnees.recipes.filter(rec => {
        if (!rec.categorie) return false;                       // sous-recette de la chaine
        if (!f.categories.includes(rec.categorie)) return false;
        if (!f.tiers.includes(rec.tier)) return false;
        if (!f.ench.includes(rec.enchantment)) return false;
        if (!f.lignees.includes(rec.lignee)) return false;
        // Le filtre de ligne ne s'applique qu'aux pieces qui en ont une.
        if (rec.ligne && !f.lignes.includes(rec.ligne)) return false;
        if (q && !nom(rec.id).toLowerCase().includes(q)) return false;
        return true;
      });
    });

    // Tous les ids a tarifer : les produits, plus toute leur chaine
    // d'ingredients. Les runes n'y figurent plus : la fonte n'etant plus une
    // voie d'obtention, leur prix n'entre dans aucun cout de cet onglet.
    function idsATarifer(liste) {
      const need = new Set();
      const pile = [];
      for (const rec of liste) { need.add(rec.id); for (const i of rec.ingredients) pile.push(i.id); }
      const vus = new Set();
      while (pile.length) {
        const id = pile.pop();
        need.add(id);
        if (vus.has(id)) continue;
        vus.add(id);
        const sous = donnees.byId[id];
        if (sous) for (const i of sous.ingredients) pile.push(i.id);
      }
      return [...need];
    }

    const estimation = computed(() => {
      const n = perimetre.value.length ? idsATarifer(perimetre.value).length : 0;
      const req = Mk.coutRequetes.prix(n);
      return { items: n, requetes: req, secondes: Mk.coutRequetes.secondes(req) };
    });

    // ---- Contexte du moteur ----
    function contexte() {
      return M.creerContexte({
        byId: donnees.byId, prices: prix, manual: {},
        villesAchat: f.villesAchat,
        villeRaffinage: r.villeRaffinage, villeFabrication: r.villeFabrication,
        tableVilles: table,
        focusRaffinage: r.focusRaffinage, focusFabrication: r.focusFabrication,
        eventBonus: r.eventBonus, tarifStation: r.tarifStation,
        autoriserRaffinage: r.autoriserRaffinage,
        maxAgeH: f.maxAgeH || null,
      });
    }

    // ---- Le calcul central ----
    const resultat = computed(() => {
      void versionPrix.value;
      if (!pret.value || !prixCharges.value) return { lignes: [], rejets: {} };

      const ctx = contexte();
      const opts = {
        villesVente: f.villesVente,
        undercut: r.undercut / 100,
        taxeOrdre: eco.value.ordre,
        taxeInstant: eco.value.instant,
        maxAgeH: f.maxAgeH || null,
        parts: partsNormalisees.value,
        // Tant que l'historique n'est pas charge, on ne peut ni exiger de
        // transactions ni filtrer sur le volume : le balayage donne donc des
        // marges NON corrigees, et la page le dit explicitement.
        exigerHistorique: histoCharges.value,
        volumeMin: histoCharges.value ? f.volumeMin : 0,
      };

      const out = [], rejets = {};
      const seuil = f.margeMin / 100;

      for (const rec of perimetre.value) {
        // Le produit est FABRIQUE, pas achete : c'est la premisse de l'outil.
        // Ses ingredients, eux, sont pris au moins cher (achat ou production).
        const c = M.coutFabrication(rec, ctx);
        const ev = D.evaluer(rec, c ? c.cost : null, prix, histoCharges.value ? histo : null, opts);
        if (ev.rejet) { rejets[ev.rejet] = (rejets[ev.rejet] || 0) + 1; continue; }
        if (ev.marge < seuil) { rejets['marge sous le seuil'] = (rejets['marge sous le seuil'] || 0) + 1; continue; }
        out.push({
          id: rec.id, tier: rec.tier, ench: rec.enchantment, station: rec.station,
          categorie: rec.categorie, ligne: rec.ligne, lignee: rec.lignee,
          cout: ev.cout, revenu: ev.revenu, profit: ev.profit, marge: ev.marge,
          meilleur: ev.meilleur, parQualite: ev.parQualite,
          qualite: ev.meilleur.qualite,
          vol: ev.meilleur.vol, age: ev.meilleur.ageH,
          nom: nom(rec.id),
        });
      }
      out.sort((a, b) => b.marge - a.marge);
      return { lignes: out, rejets };
    });

    // ---- Tri du tableau ----
    const tri = reactive({ cle: 'marge', sens: 'desc' });
    function trier(k) {
      if (tri.cle === k) tri.sens = tri.sens === 'asc' ? 'desc' : 'asc';
      else { tri.cle = k; tri.sens = k === 'nom' ? 'asc' : 'desc'; }
    }
    const fleche = k => tri.cle === k ? (tri.sens === 'asc' ? '▲' : '▼') : '';

    const lignes = computed(() => {
      let l = resultat.value.lignes;
      if (zoom.value) {
        const z = zoom.value;
        l = l.filter(x => x.categorie === z.categorie && x.tier === z.tier && x.ench === z.ench);
      }
      const sens = tri.sens === 'asc' ? 1 : -1;
      return l.slice().sort((a, b) => {
        if (tri.cle === 'nom') return a.nom.localeCompare(b.nom, 'fr') * sens;
        const av = a[tri.cle], bv = b[tri.cle];
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sens;
      });
    });

    // Fenetrage plutot que defilement virtualise : on cherche les MEILLEURES
    // occasions, pas a parcourir 6 000 lignes. Afficher les 100 premieres et
    // etendre a la demande evite un composant de virtualisation entier.
    const lignesAffichees = computed(() => lignes.value.slice(0, limite.value));
    watch([() => f.margeMin, () => tri.cle, zoom], () => limite.value = 100);

    // ---- Tuiles ----
    const meilleurProfit = computed(() =>
      lignes.value.slice().sort((a, b) => b.profit - a.profit)[0] || null);
    const partInstant = computed(() => {
      if (!lignes.value.length) return null;
      return lignes.value.filter(l => l.meilleur.instantane).length / lignes.value.length;
    });
    const nbBlackMarket = computed(() => lignes.value.filter(l => l.meilleur.bm).length);
    const nbAberrants = computed(() => lignes.value.filter(l => l.meilleur.aberrant).length);
    const resumeRejets = computed(() => Object.entries(resultat.value.rejets)
      .sort((a, b) => b[1] - a[1]).slice(0, 4)
      .map(([m, n]) => `${n} × ${m}`).join(' · '));

    // ---- Carte de reperage ----
    // Plafond de l'echelle : le 95e centile, pour qu'une poignee de marges
    // delirantes n'ecrase pas toute la carte dans la premiere marche.
    const plafondMarge = computed(() => {
      const ms = resultat.value.lignes.map(l => l.marge).sort((a, b) => a - b);
      if (!ms.length) return 1;
      return Math.max(f.margeMin / 100 + 0.05, ms[Math.floor(ms.length * 0.95)]);
    });

    const cartes = computed(() => {
      const parCat = {};
      for (const l of resultat.value.lignes) {
        const c = parCat[l.categorie] || (parCat[l.categorie] = { categorie: l.categorie, cases: {}, total: 0, tiers: new Set(), enchs: new Set() });
        c.total++;
        c.tiers.add(l.tier); c.enchs.add(l.ench);
        const k = l.tier + '|' + l.ench;
        if (!c.cases[k] || l.marge > c.cases[k].marge) c.cases[k] = { marge: l.marge, id: l.id, n: 0 };
        c.cases[k].n++;
      }
      return C.CATEGORIES
        .filter(cat => parCat[cat.cle])
        .map(cat => {
          const c = parCat[cat.cle];
          return { ...c, tiers: [...c.tiers].sort((a, b) => a - b), enchs: [...c.enchs].sort((a, b) => a - b) };
        });
    });

    // 6 marches d'une rampe a une seule teinte, validee pour l'ecart de clarte
    // et le contraste sur le panneau. L'encre bascule au clair sur les deux
    // marches sombres, sinon le chiffre dans la case devient illisible.
    function styleCase(marge) {
      const bas = f.margeMin / 100, haut = plafondMarge.value;
      const t = haut > bas ? Math.min(1, Math.max(0, (marge - bas) / (haut - bas))) : 1;
      const i = Math.min(5, Math.floor(t * 6));
      return { background: `var(--r${i + 1})`, color: i <= 1 ? '#f5ead2' : '#1a1a19' };
    }
    const estSelection = (cat, t, e) =>
      zoom.value && zoom.value.categorie === cat && zoom.value.tier === t && zoom.value.ench === e;

    function zoomer(cat, t, e) {
      if (estSelection(cat, t, e)) { zoom.value = null; return; }
      zoom.value = { categorie: cat, tier: t, ench: e };
      onglet.value = 'tableau';
    }

    function bulleCase(ev, carte, t, e) {
      const c = carte.cases[t + '|' + e];
      if (!c) { bulle.value = null; return; }
      const rect = ev.target.getBoundingClientRect();
      bulle.value = {
        x: Math.min(rect.left, window.innerWidth - 300),
        y: rect.bottom + 8,
        titre: nom(c.id),
        corps: `Meilleure marge <b>${C.fmtPct(c.marge)}</b><br>`
          + `<span class="m">${c.n} objet(s) rentable(s) en T${t}.${e} · clic pour filtrer</span>`,
      };
    }

    // ---- Chargement des donnees de marche ----
    async function balayer(forcer) {
      if (!pret.value || chargement.value) return;
      const liste = perimetre.value;
      if (!liste.length) { erreur.value = 'Aucune recette dans le périmètre : élargis les filtres.'; return; }
      chargement.value = true; erreur.value = ''; progres.value = 0;
      try {
        const ids = idsATarifer(liste);
        statut.value = `Prix 0/${Mk.coutRequetes.prix(ids.length)}…`;
        const { data, depuisCache } = await Mk.chargerPrix(ids, V.TOUS_LIEUX, {
          qualites: [1], forcer,
          onProgress: (fait, total) => {
            progres.value = Math.round(fait / total * 100);
            statut.value = `Prix ${fait}/${total}…`;
          },
        });
        prix = data;
        histo = {}; histoCharges.value = false;   // l'historique ne vaut plus pour ce perimetre
        prixCharges.value = true;
        versionPrix.value++;
        statut.value = `${C.fmt(Object.keys(data).length)} objets tarifés`
          + `${depuisCache ? ' (cache)' : ''} · ${new Date().toLocaleTimeString('fr-FR')}`;
      } catch (e) {
        erreur.value = 'API de prix indisponible (' + e.message + ').';
      } finally { chargement.value = false; progres.value = 0; }
    }

    // L'analyse fine ne porte que sur les meilleurs candidats : demander les 5
    // qualites et l'historique sur 6 000 objets couterait plus de 300 requetes
    // et des reponses enormes, pour un classement qu'on vient deja d'etablir.
    async function analyseFine() {
      if (!pret.value || chargement.value || !prixCharges.value) return;
      const candidats = resultat.value.lignes.slice(0, f.topAnalyse).map(l => l.id);
      if (!candidats.length) { erreur.value = "Rien à analyser : aucune opportunité au balayage."; return; }
      chargement.value = true; erreur.value = ''; progres.value = 0;
      try {
        statut.value = 'Qualités…';
        const { data: pq } = await Mk.chargerPrix(candidats, V.TOUS_LIEUX, {
          qualites: [1, 2, 3, 4, 5], cle: 'prix-qualites',
          onProgress: (fait, total) => {
            progres.value = Math.round(fait / total * 50);
            statut.value = `Qualités ${fait}/${total}…`;
          },
        });
        // Fusion : le balayage garde sa couverture large, l'analyse fine
        // enrichit les candidats sans effacer le reste.
        for (const [id, parLieu] of Object.entries(pq)) {
          const cible = prix[id] || (prix[id] = {});
          for (const [lieu, parQ] of Object.entries(parLieu)) {
            cible[lieu] = Object.assign(cible[lieu] || {}, parQ);
          }
        }

        statut.value = 'Historique…';
        const { data: h } = await Mk.chargerHistorique(candidats, V.TOUS_LIEUX, {
          qualites: [1, 2, 3, 4, 5],
          onProgress: (fait, total) => {
            progres.value = 50 + Math.round(fait / total * 50);
            statut.value = `Historique ${fait}/${total}…`;
          },
        });
        histo = h;
        histoCharges.value = true;
        versionPrix.value++;
        statut.value = `${candidats.length} candidats analysés en 5 qualités · `
          + `${C.fmt(Object.keys(h).length)} avec historique`;
      } catch (e) {
        erreur.value = 'Analyse fine interrompue (' + e.message + ').';
      } finally { chargement.value = false; progres.value = 0; }
    }

    async function viderLeCache() {
      await Mk.viderCache();
      statut.value = 'Cache vidé.';
    }

    // ---- Panneau de detail ----
    // L'arbre de cout doit refleter le contexte de l'onglet ouvert : depuis
    // « Ma banque », c'est le bonus de la ville de base qui s'applique, pas
    // celui du reglage global.
    function decomposerRecette(rec) {
      const ctx = onglet.value === 'fiche' ? ctxFiche()
        : onglet.value === 'inventaire' ? ctxInventaire()
        : contexte();
      // L'arbre de la fiche est en LECTURE SEULE : `forcees` n'agit qu'au premier
      // niveau de decomposer(), donc forcer une voie en profondeur changerait
      // l'affichage du noeud sans changer le total du parent. Le forçage reste
      // au panneau de detail, ou l'arbre n'a qu'un etage visible a la fois.
      return M.decomposer(rec, ctx, onglet.value === 'fiche' ? {} : forcees);
    }
    partage.decomposer = decomposerRecette;
    partage.choisirVoie = (recetteId, ingId, methode) => {
      const k = recetteId + '|' + ingId;
      if (forcees[k] === methode) delete forcees[k];
      else forcees[k] = methode;
      versionPrix.value++;   // force le recalcul de la decomposition affichee
    };

    // `villes` est explicite : ouvert depuis l'onglet Ma banque, le panneau doit
    // recalculer les debouches sur les villes de CET onglet, pas sur celles de
    // la barre de filtres, qui y est masquee.
    function ouvrir(l, villes = null) {
      selection.value = l.id;
      const canaux = D.debouchesDe(prix[l.id], histo[l.id] || null, {
        villesVente: villes || f.villesVente, qualite: l.qualite, undercut: r.undercut / 100,
        taxeOrdre: eco.value.ordre, taxeInstant: eco.value.instant, maxAgeH: f.maxAgeH || null,
      });
      detail.value = { ...l, canaux, station: donnees.byId[l.id].station };
    }

    const decomposition = computed(() => {
      void versionPrix.value;
      if (!detail.value) return { lignes: [], taux: 0, frais: 0, matieres: 0, cout: 0 };
      const rec = donnees.byId[detail.value.id];
      const d = decomposerRecette(rec);
      return { lignes: d.lignes, taux: d.taux, frais: d.frais, matieres: d.matieres, cout: d.cost };
    });

    // ========================= ONGLET INVENTAIRE =========================

    // Les lignes de saisie : un tableau par matiere, tiers en lignes,
    // enchantements en colonnes. Seuls les tiers coches sont rendus, sinon la
    // page fait 400 champs et personne ne la remplit deux fois.
    function grille(types) {
      return types.map(type => ({
        type, label: Inv.LIBELLES[type],
        lignes: stock.tiers.map(t => ({
          tier: t,
          cases: stock.enchantements.map(e => ({
            id: Inv.idRessource(type, t, e), ench: e,
          })),
        })),
      }));
    }
    const grilleBrut = computed(() => grille(Inv.TYPES_BRUTS));
    const grilleRaffine = computed(() => grille(Inv.TYPES_RAFFINES));
    const totalInventaire = computed(() => Inv.totalStock(stock));

    function ctxInventaire() {
      return M.creerContexte({
        byId: donnees.byId, prices: prix, manual: {},
        villesAchat: inv.villesAchat,
        villeRaffinage: inv.villeBase, villeFabrication: inv.villeBase,
        tableVilles: table,
        focusRaffinage: false, focusFabrication: false,   // le focus est budgete, pas coche
        eventBonus: r.eventBonus, tarifStation: r.tarifStation,
        autoriserRaffinage: true,
        maxAgeH: f.maxAgeH || null,
      });
    }

    // Le plan a besoin des prix ET des volumes des candidats. Le stock borne
    // naturellement l'ensemble, ce qui rend l'historique abordable : sans ce
    // filtre il faudrait plus de 300 requetes.
    // Les candidats retenus par la banque, puis restreints par les filtres.
    // Le filtrage se fait ICI, avant la resolution, et non a l'affichage :
    // masquer des lignes deja servies laisserait des totaux faux et du stock
    // immobilise sur ce qu'on ne voulait pas.
    function candidatsFiltres() {
      const tous = Sol.candidats(donnees.recipes, stock, donnees.byId);
      const gardes = tous.filter(x =>
        inv.tiers.includes(x.tier) && inv.ench.includes(x.enchantment));
      return { tous, gardes, ecartesParFiltre: tous.length - gardes.length };
    }

    // Identifiants dont on a reellement charge un prix. Elargir un filtre fait
    // entrer des recettes jamais tarifees, qui seraient rejetees en silence
    // comme « cout inconnu » : on veut pouvoir le signaler.
    let idsTarifes = new Set();

    function optionsSolveur() {
      return {
        capital: inv.capital, focus: inv.focus, efficaciteFocus: inv.efficaciteFocus,
        partVolume: inv.partVolume / 100,
        villesVente: inv.villesVente, nbVillesMax: inv.nbVillesMax,
        taxeOrdre: eco.value.ordre, taxeInstant: eco.value.instant,
        undercut: r.undercut / 100, parts: { 1: 1 }, maxAgeH: f.maxAgeH || null,
        exigerBanque: inv.exigerBanque,
      };
    }

    async function calculerPlan(forcer = false) {
      if (!pret.value || chargement.value) return;
      if (totalInventaire.value <= 0) {
        erreur.value = "Ta banque est vide : saisis au moins une ressource.";
        return;
      }
      chargement.value = true; erreur.value = ''; progres.value = 0;
      try {
        const { tous, gardes: cands } = candidatsFiltres();
        if (!tous.length) {
          erreur.value = "Aucune recette ne consomme ce que tu as en banque.";
          return;
        }
        if (!cands.length) {
          erreur.value = "Tes filtres de niveau et d'enchantement ne laissent passer "
            + "aucune des " + tous.length + " recettes que ta banque alimente.";
          return;
        }
        const ids = idsATarifer(cands);
        statut.value = `Prix de ${C.fmt(ids.length)} objets…`;
        const { data: px } = await Mk.chargerPrix(ids, V.TOUS_LIEUX, {
          qualites: [1], forcer, cle: 'prix-inventaire',
          onProgress: (fait, total) => {
            progres.value = Math.round(fait / total * 60);
            statut.value = `Prix ${fait}/${total}…`;
          },
        });
        prix = px;

        statut.value = 'Volumes…';
        const cibles = cands.map(x => x.id);
        const { data: h } = await Mk.chargerHistorique(cibles, V.TOUS_LIEUX, {
          qualites: [1], forcer, cle: 'histo-inventaire',
          onProgress: (fait, total) => {
            progres.value = 60 + Math.round(fait / total * 40);
            statut.value = `Volumes ${fait}/${total}…`;
          },
        });
        histo = h;
        idsTarifes = new Set(ids);

        plan.value = Sol.resoudre(cands, stock, ctxInventaire(), prix, histo, optionsSolveur());
        planCharge.value = true;
        versionPrix.value++;
        statut.value = `${cands.length} recettes examinées · `
          + `${plan.value.retenues.length} retenues · ${new Date().toLocaleTimeString('fr-FR')}`;
      } catch (e) {
        erreur.value = 'Calcul du plan interrompu (' + e.message + ').';
      } finally { chargement.value = false; progres.value = 0; }
    }

    // Rejoue la resolution sur les prix DEJA charges. Changer un filtre ne doit
    // pas relancer quatre-vingts requetes : retrecir un filtre travaille sur un
    // sous-ensemble deja tarife, et elargir est signale plutot que rejoue.
    const filtreElargi = ref(false);
    function resoudreDepuisMemoire() {
      if (!planCharge.value || chargement.value) return;
      const { gardes: cands } = candidatsFiltres();
      filtreElargi.value = cands.some(x => !idsTarifes.has(x.id));
      if (!cands.length) { plan.value = null; return; }
      plan.value = Sol.resoudre(cands, stock, ctxInventaire(), prix, histo, optionsSolveur());
    }

    // Le delai groupe les clics : cocher six niveaux d'affilee ne doit declencher
    // qu'une resolution.
    let timerPlan = null;
    watch(() => [inv.tiers, inv.ench, inv.villesVente, inv.villesAchat, inv.capital,
      inv.focus, inv.efficaciteFocus, inv.nbVillesMax, inv.partVolume,
      inv.exigerBanque, inv.villeBase], () => {
      if (!planCharge.value) return;
      clearTimeout(timerPlan);
      timerPlan = setTimeout(resoudreDepuisMemoire, 250);
    }, { deep: true });

    // Le panneau de detail attend la forme des lignes de l'onglet Tableau.
    // Les lignes du solveur portent d'autres noms : on adapte plutot que de
    // dupliquer tout le panneau.
    function ouvrirDepuisPlan(l) {
      ouvrir({
        id: l.id, tier: l.recette.tier, ench: l.recette.enchantment,
        station: l.recette.station, lignee: l.recette.lignee,
        cout: l.coutU, revenu: l.revenuU, profit: l.profitU, marge: l.marge,
        qualite: l.meilleur.qualite, meilleur: l.meilleur, parQualite: l.debouches,
        vol: l.meilleur.vol, age: l.meilleur.ageH, nom: nom(l.id),
      }, inv.villesVente);
    }

    // Combien de recettes les filtres de niveau et d'enchantement ecartent :
    // sans ce chiffre, un filtre trop serre passe pour un marche vide.
    const ecartesParFiltre = computed(() => {
      void [inv.tiers, inv.ench, stock.quantites];
      if (!pret.value || totalInventaire.value <= 0) return 0;
      return candidatsFiltres().ecartesParFiltre;
    });

    function viderInventaire() {
      Object.keys(stock.quantites).forEach(k => delete stock.quantites[k]);
      plan.value = null;
      planCharge.value = false;
    }

    // Le reste en banque, uniquement ce qui n'a pas ete consomme.
    const resteEnBanque = computed(() => {
      if (!plan.value) return [];
      return Object.entries(plan.value.stockRestant)
        .filter(([, v]) => v > 0.5)
        .map(([id, v]) => ({ id, qte: v, nom: nom(id) }))
        .sort((a, b) => b.qte - a.qte);
    });

    // Toutes les courses du plan, regroupees par ville d'achat.
    const achatsParVille = computed(() => {
      if (!plan.value) return [];
      const g = {};
      for (const l of plan.value.retenues) {
        for (const a of l.achats) {
          const cle = (a.ville || '?') + '|' + a.id;
          if (!g[cle]) g[cle] = { ville: a.ville || '?', id: a.id, qte: 0, cout: 0 };
          g[cle].qte += a.qte; g[cle].cout += a.cout;
        }
      }
      const parVille = {};
      for (const x of Object.values(g)) (parVille[x.ville] = parVille[x.ville] || []).push(x);
      return Object.entries(parVille)
        .map(([ville, items]) => ({
          ville, items: items.sort((a, b) => b.cout - a.cout),
          cout: items.reduce((a, b) => a + b.cout, 0),
        }))
        .sort((a, b) => b.cout - a.cout);
    });

    // ========================== ONGLET FICHE ==========================
    //
    //  Etat de marche PROPRE a la fiche. Ecrire dans `prix`/`histo` detruirait
    //  le balayage de l'onglet Tableau, et reciproquement.
    //  `versionFiche` est le declencheur explicite : tout computed qui lit
    //  prixFiche DOIT le lire aussi, sinon il ne se met jamais a jour.
    let prixFiche = {}, histoFiche = {};
    const versionFiche = ref(0);
    const ficheChargee = ref(false);
    const rechercheFiche = ref('');
    const baseFiche = ref(null);
    const enchFiche = ref(0);

    const fi = reactive({
      quantite: 1,
      prixVente: null,
      prixVenteBrut: true,      // true = prix affiche, false = net encaisse
      rrrForceFabrication: null,
      rrrForceRaffinage: null,
      tarifs: {},               // par ville ; vide = tarif global
      manual: {},               // id d'ingredient -> prix impose
    });

    // Index de recherche : une entree par objet de base. Aucun nom francais ne
    // designe deux objets differents, le partage entre un objet et ses
    // enchantements est justement le regroupement voulu.
    const sansAccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const indexFiches = computed(() => {
      if (!pret.value) return [];
      const vues = new Map();
      for (const rec of donnees.recipes) {
        if (!rec.categorie) continue;
        const base = rec.id.split('@')[0];
        if (!vues.has(base)) {
          vues.set(base, {
            base, nom: nom(base), tier: rec.tier, categorie: rec.categorie,
            lignee: rec.lignee, station: rec.station, enchs: [],
            cle: sansAccent(nom(base) + ' ' + base),
          });
        }
        const e = vues.get(base);
        if (!e.enchs.includes(rec.enchantment)) e.enchs.push(rec.enchantment);
      }
      return [...vues.values()].map(e => ({ ...e, enchs: e.enchs.sort((a, b) => a - b) }));
    });

    const resultatsRecherche = computed(() => {
      const q = sansAccent(rechercheFiche.value.trim());
      if (q.length < 2) return [];
      return indexFiches.value.filter(e => e.cle.includes(q)).slice(0, 60);
    });

    const objetFiche = computed(() =>
      indexFiches.value.find(e => e.base === baseFiche.value) || null);

    // Tous les ids a tarifer : le produit aux 5 enchantements, plus la fermeture
    // de leurs chaines. Mesure : mediane 50 ids, maximum 115.
    function idsFiche(base) {
      const need = new Set(), pile = [], vus = new Set();
      for (const e of [0, 1, 2, 3, 4]) {
        const id = e ? base + '@' + e : base;
        const rec = donnees.byId[id];
        if (!rec) continue;
        need.add(id);
        for (const i of rec.ingredients) pile.push(i.id);
      }
      while (pile.length) {
        const id = pile.pop();
        need.add(id);
        if (vus.has(id)) continue;
        vus.add(id);
        const sous = donnees.byId[id];
        if (sous) for (const i of sous.ingredients) pile.push(i.id);
      }
      return [...need];
    }

    async function chargerFiche(base, forcer = false) {
      if (!pret.value || chargement.value) return;
      baseFiche.value = base;
      rechercheFiche.value = '';
      ficheChargee.value = false;
      chargement.value = true; erreur.value = ''; progres.value = 0;
      try {
        const ids = idsFiche(base);
        const produits = ids.filter(x => x.split('@')[0] === base);
        statut.value = 'Prix…';
        // Les matieres n'existent qu'en qualite Normale, le produit en 5.
        const { data: pm } = await Mk.chargerPrix(ids, V.TOUS_LIEUX, {
          qualites: [1], forcer, cle: 'fiche:' + base,
          onProgress: (a, b) => { progres.value = Math.round(a / b * 50); },
        });
        const { data: pq } = await Mk.chargerPrix(produits, V.TOUS_LIEUX, {
          qualites: [1, 2, 3, 4, 5], forcer, cle: 'ficheq:' + base,
          onProgress: (a, b) => { progres.value = 50 + Math.round(a / b * 25); },
        });
        const { data: h } = await Mk.chargerHistorique(produits, V.TOUS_LIEUX, {
          qualites: [1], forcer, cle: 'ficheh:' + base,
          onProgress: (a, b) => { progres.value = 75 + Math.round(a / b * 25); },
        });
        // Fusion : la couverture large des matieres, enrichie des qualites du produit.
        prixFiche = pm;
        for (const [id, parLieu] of Object.entries(pq)) {
          const cible = prixFiche[id] || (prixFiche[id] = {});
          for (const [lieu, parQ] of Object.entries(parLieu)) {
            cible[lieu] = Object.assign(cible[lieu] || {}, parQ);
          }
        }
        histoFiche = h;
        ficheChargee.value = true;
        versionFiche.value++;
        enchFiche.value = (objetFiche.value?.enchs || [0])[0];
        statut.value = `${C.fmt(ids.length)} objets tarifés · ${new Date().toLocaleTimeString('fr-FR')}`;
      } catch (e) {
        erreur.value = 'Chargement de la fiche interrompu (' + e.message + ').';
      } finally { chargement.value = false; progres.value = 0; }
    }

    // Contexte de la fiche. `ville` null = les reglages globaux.
    function ctxFiche({ ville = null, villesAchat = null } = {}) {
      return M.creerContexte({
        byId: donnees.byId, prices: prixFiche,
        manual: fi.manual,
        villesAchat: villesAchat || f.villesAchat,
        villeRaffinage: ville || r.villeRaffinage,
        villeFabrication: ville || r.villeFabrication,
        tableVilles: table,
        focusRaffinage: r.focusRaffinage, focusFabrication: r.focusFabrication,
        eventBonus: r.eventBonus,
        tarifStation: (ville && fi.tarifs[ville] != null) ? fi.tarifs[ville] : r.tarifStation,
        autoriserRaffinage: r.autoriserRaffinage,
        maxAgeH: f.maxAgeH || null,
        rrrForceRaffinage: fi.rrrForceRaffinage,
        rrrForceFabrication: fi.rrrForceFabrication,
      });
    }

    // Prix de vente impose : on injecte un lieu synthetique. Le mode « net »
    // neutralise taxe et undercut, le mode « brut » les laisse s'appliquer :
    // 9,5 points d'ecart entre les deux, il faut que le choix soit explicite.
    function prixDeVente(id) {
      if (fi.prixVente == null || !(fi.prixVente > 0)) return prixFiche[id];
      const p = fi.prixVente;
      return { '(saisi)': { 1: { sell: p, buy: p, ageH: 0, ageAchatH: 0 } } };
    }
    function optsVente(extra = {}) {
      const net = !fi.prixVenteBrut && fi.prixVente > 0;
      return {
        villesVente: f.villesVente, undercut: net ? 0 : r.undercut / 100,
        taxeOrdre: net ? 0 : eco.value.ordre, taxeInstant: net ? 0 : eco.value.instant,
        maxAgeH: fi.prixVente > 0 ? null : (f.maxAgeH || null),
        parts: { 1: 1 }, ...extra,
      };
    }

    // ---- Les 5 colonnes d'enchantement ----
    const colonnes = computed(() => {
      void versionFiche.value;
      void [fi.manual, fi.prixVente, fi.prixVenteBrut, fi.rrrForceFabrication,
        fi.rrrForceRaffinage, fi.quantite, r.tarifStation, r.villeFabrication,
        r.villeRaffinage, r.focusFabrication, r.focusRaffinage, f.villesVente, f.villesAchat];
      const o = objetFiche.value;
      if (!o || !ficheChargee.value) return [];
      const ctx = ctxFiche();
      return o.enchs.map(e => {
        const id = e ? o.base + '@' + e : o.base;
        const rec = donnees.byId[id];
        if (!rec) return { ench: e, id, absent: true };
        const c = M.coutFabrication(rec, ctx);
        const ev = D.evaluer(rec, c ? c.cost : null, prixDeVente(id) ? { [id]: prixDeVente(id) } : prixFiche,
          histoFiche, optsVente());
        const h = (histoFiche[id] || {});
        const vol = Object.values(h).reduce((a, x) => a + ((x[1] || {}).vol || 0), 0);
        return {
          ench: e, id, recette: rec, nom: nom(id),
          cout: c ? c.cost : null,
          frais: M.fraisStation(rec, ctx),
          taux: M.rrrDe(rec, ctx),
          revenu: ev.rejet ? null : ev.revenu,
          profit: ev.rejet ? null : ev.profit,
          marge: ev.rejet ? null : ev.marge,
          meilleur: ev.rejet ? null : ev.meilleur,
          rejet: ev.rejet || null,
          vol,
        };
      });
    });

    const colonneChoisie = computed(() =>
      colonnes.value.find(c => c.ench === enchFiche.value) || colonnes.value[0] || null);

    // ---- Le tableau des villes ----
    const tableauVilles = computed(() => {
      void versionFiche.value;
      void [fi.manual, fi.tarifs, fi.rrrForceFabrication, fi.rrrForceRaffinage,
        fi.prixVente, fi.prixVenteBrut, enchFiche.value, r.focusFabrication, r.focusRaffinage];
      const col = colonneChoisie.value;
      if (!col || col.absent || !ficheChargee.value) return [];
      const rec = col.recette;

      return V.VILLES.map(ville => {
        // Lecture 1 : l'effet du bonus seul. Achats autorises partout, donc la
        // seule chose qui bouge d'une ligne a l'autre est le taux de retour.
        // C'est la part structurelle, celle sur laquelle on decide de s'installer.
        const ctxB = ctxFiche({ ville });
        const cB = M.coutFabrication(rec, ctxB);

        // Lecture 2 : et si je n'achetais que sur place ? Part volatile.
        const ctxL = ctxFiche({ ville, villesAchat: [ville] });
        const cL = M.coutFabrication(rec, ctxL);
        let sansPrix = 0;
        for (const ing of rec.ingredients) {
          if (!M.coutUnitaire(ing.id, ctxL)) sansPrix++;
        }

        const px = prixDeVente(col.id) ? { [col.id]: prixDeVente(col.id) } : prixFiche;
        const surPlace = D.debouchesDe(px[col.id], histoFiche[col.id],
          optsVente({ villesVente: [ville], inclureBM: false, qualite: 1 }))[0] || null;
        const auBM = D.debouchesDe(px[col.id], histoFiche[col.id],
          optsVente({ villesVente: [], inclureBM: true, qualite: 1 }))[0] || null;

        return {
          ville,
          bonusCraft: (table.fabrication[V.cleBonusFabrication(rec)] || {}).ville === ville,
          // Caerleon et Brecilien ne raffinent RIEN : leurs lignes paraitraient
          // simplement mauvaises alors qu'elles obeissent a une autre mecanique.
          bonusRaffinage: Object.values(table.raffinage).some(x => x.ville === ville),
          taux: M.rrrDe(rec, ctxB),
          cout: cB ? cB.cost : null,
          coutLocal: cL ? cL.cost : null,
          ecartLocal: (cB && cL) ? cL.cost - cB.cost : null,
          sansPrix,
          tarif: fi.tarifs[ville] != null ? fi.tarifs[ville] : r.tarifStation,
          surPlace, auBM,
          profitSurPlace: (cB && surPlace) ? surPlace.net - cB.cost : null,
          profitBM: (cB && auBM) ? auBM.net - cB.cost : null,
        };
      }).sort((a, b) => (b.profitBM ?? b.profitSurPlace ?? -Infinity)
        - (a.profitBM ?? a.profitSurPlace ?? -Infinity));
    });

    // ---- Le bloc quantite ----
    const bilanQuantite = computed(() => {
      void versionFiche.value;
      void [fi.quantite, fi.manual, fi.tarifs, enchFiche.value];
      const col = colonneChoisie.value;
      if (!col || col.absent || !ficheChargee.value || !(fi.quantite > 0)) return null;
      const q = fi.quantite;
      const ctx = ctxFiche();
      const rec = col.recette;

      // courses() ne rend que les ACHATS de feuilles. Les frais de station, eux,
      // se paient a CHAQUE etage : le craft final, mais aussi chaque raffinage
      // de la chaine. Les additionner a la main sous-estimait la depense de
      // 1 003 silver sur une hache T6 — trouve a l'audit.
      // On prend donc le cout total exact du moteur et on en deduit les frais,
      // meme comptabilite que le solveur de l'onglet banque.
      const liste = Object.values(M.courses(rec.id, q, ctx, {}, new Set()))
        .map(x => ({ ...x, cout: x.qte * x.prixU, nom: nom(x.id) }))
        .sort((a, b) => b.cout - a.cout);
      const matieres = liste.reduce((a, x) => a + x.cout, 0);
      const cf = M.coutFabrication(rec, ctx);
      const total = cf ? cf.cost * q : matieres;
      const frais = Math.max(0, total - matieres);

      // Focus : seul le raffinage a un cout publie. La fabrication, non.
      let focus = 0;
      if (r.focusRaffinage) {
        for (const x of liste) {
          const info = Inv.analyserRessource(x.id);
          if (info && !info.brut) focus += Inv.coutFocus(info.type, info.tier, info.ench, 0) * x.qte;
        }
      }
      const jours = col.vol > 0 ? q / col.vol : null;
      return {
        q, liste, matieres, frais, total,
        profit: col.profit != null ? col.profit * q : null,
        focus, focusDepasse: focus > 30000,
        jours, volumeTendu: jours != null && jours > 1,
      };
    });

    // ---- Fiche technique ----
    const ficheTechnique = computed(() => {
      const o = objetFiche.value;
      if (!o) return null;
      return {
        ip: (donnees.fiches.ip || {})[o.base] || null,
        stats: (donnees.fiches.stats || {})[o.base] || null,
        qualites: donnees.fiches.ordreQualites || [],
      };
    });

    const nbSurcharges = computed(() =>
      Object.values(fi.manual).filter(v => v > 0).length
      + (fi.prixVente > 0 ? 1 : 0)
      + (fi.rrrForceFabrication != null ? 1 : 0)
      + (fi.rrrForceRaffinage != null ? 1 : 0)
      + Object.keys(fi.tarifs).length);

    function viderSurcharges() {
      Object.keys(fi.manual).forEach(k => delete fi.manual[k]);
      Object.keys(fi.tarifs).forEach(k => delete fi.tarifs[k]);
      fi.prixVente = null;
      fi.rrrForceFabrication = null;
      fi.rrrForceRaffinage = null;
      versionFiche.value++;
    }
    function appliquerTarifPartout(t) {
      for (const v of V.VILLES) fi.tarifs[v] = t;
      versionFiche.value++;
    }

    // Les ingredients surchargeables : les feuilles reellement achetees, pas les
    // 115 identifiants de toute la chaine.
    const ingredientsSurchargeables = computed(() => {
      void versionFiche.value;
      const col = colonneChoisie.value;
      if (!col || col.absent || !ficheChargee.value) return [];
      const ctx = ctxFiche();
      return Object.values(M.courses(col.recette.id, 1, ctx, {}, new Set()))
        .map(x => ({ id: x.id, nom: nom(x.id), prixMarche: x.prixU, ville: x.where }))
        .sort((a, b) => b.prixMarche - a.prixMarche);
    });

    // ---- Table des bonus de ville ----
    function majTable() { V.sauverTable(table); versionPrix.value++; }
    const nbNonVerif = computed(() => V.nbNonVerifiees(table));

    // 30 categories a plat seraient illisibles : on les regroupe par ville
    // bonifiante, ce qui est aussi la façon dont on les verifie en jeu (on ouvre
    // une ville, on regarde tout ce qu'elle bonifie).
    const fabricationParVille = computed(() => {
      const g = {};
      for (const [cle, e] of Object.entries(table.fabrication)) {
        const v = e.ville || '(aucune)';
        (g[v] = g[v] || []).push({ cle, e });
      }
      return [...V.VILLES, '(aucune)']
        .filter(v => g[v])
        .map(v => ({ ville: v, entrees: g[v] }));
    });

    // Combien de recettes du catalogue chaque categorie touche : sans ça, une
    // ligne fausse dans un coin de la table passe pour un detail.
    const poidsCategories = computed(() => {
      const n = {};
      for (const r of donnees.recipes) if (r.bonusCategorie) n[r.bonusCategorie] = (n[r.bonusCategorie] || 0) + 1;
      return n;
    });

    // =======================================================================
    //  ONGLET ARTEFACT
    //
    //  Etat de marche isole, comme la fiche : ecrire dans `prix`/`histo`
    //  detruirait le balayage de l'onglet Tableau. Meme regle imperative — tout
    //  `computed` qui lit `prixArt` DOIT commencer par `void versionArt.value`.
    //
    //  Le tri et le fenetrage sont dedies eux aussi. Reutiliser `tri` et
    //  `limite` casserait l'onglet Tableau EN SILENCE : son comparateur
    //  (js/app.js, `lignes`) renvoie 1 des que la cle est absente, et trier sur
    //  une cle propre a l'artefact (« silver ») rendrait un ordre arbitraire
    //  sans la moindre erreur visible.
    // =======================================================================
    let prixArt = {}, histoArt = {};
    const versionArt = ref(0);
    const artChargees = ref(false);
    const artFabCharge = ref(false);

    const triArt = reactive({ cle: 'gainJour', sens: 'desc' });
    const limiteArt = ref(100);
    const manuelArt = reactive({});

    const artf = reactive({
      vue: 'artefacts',
      tiers: [4, 5, 6, 7, 8],
      lignees: C.LIGNEES.map(l => l.cle).filter(c => c !== 'commun'),
      matieres: ['RUNE', 'SOUL', 'RELIC', 'SHARD_AVALONIAN', 'SHARD_CRYSTAL'],
      recherche: '',
      villesAchat: [...V.VILLES],
      villesVente: [...V.VILLES],
      modeAchat: 'prudent',
      // null a l'ouverture : c'est le fichier genere qui fournit la valeur, et
      // une valeur deja persistee par l'utilisateur la garde.
      unites: null,
      partVolume: 10,
      volumeMinAchat: 1,
      // Le moteur achete au moins cher et vend au mieux, sans rien qui force
      // les deux villes a etre la meme : 12 % des verdicts supposent donc un
      // trajet. Ce garde-fou permet de ne garder que ce qui se fait sur place.
      memeVille: false,
      // Le bareme de silver, releve en jeu. Pre-rempli par le fichier genere,
      // modifiable ici et persiste : le joueur n'a rien a saisir pour demarrer,
      // et un changement de bareme du jeu ne demande pas de toucher au code.
      bareme: null,
      // Surcharges fines : par racine de matiere, « racine|tier », ou
      // « racine|tier|emplacement ».
      unitesPar: {},
      silverPar: {},
    });

    // Persistance a part, et pas dans `albion.eq.reglages` : la restauration
    // generale s'execute en tete de setup(), avant que `artf` n'existe.
    const CLE_ART = 'albion.eq.artefacts.v1';
    try {
      const sauv = JSON.parse(localStorage.getItem(CLE_ART) || 'null');
      if (sauv) {
        Object.assign(artf, sauv.artf || {});
        Object.assign(manuelArt, sauv.manuel || {});
      }
    } catch { /* reglages corrompus : on garde les defauts */ }
    watch([artf, manuelArt], () => {
      try { localStorage.setItem(CLE_ART, JSON.stringify({ artf, manuel: manuelArt })); } catch {}
    }, { deep: true });

    // Le catalogue d'artefacts, charge avec le reste.
    let cataArt = { artefacts: {}, bassins: {}, materiaux: [] };
    let baremeLivre = null;   // le bareme d'origine, pour pouvoir y revenir

    // La table de silver affichee dans les Reglages : les 4 x 5 x 4 montants
    // deduits, pour que le joueur puisse confronter chaque case a son jeu.
    const tableSilver = computed(() => {
      const b = artf.bareme;
      if (!b) return [];
      const EMPL = [
        { cle: 'HEAD', label: 'Tête, pieds, secondaire' },
        { cle: 'ARMOR', label: 'Poitrine' },
        { cle: 'MAIN', label: 'Arme à 1 main' },
        { cle: '2H', label: 'Arme à 2 mains' },
      ];
      return Object.keys(b.bases).map(rac => ({
        racine: rac,
        base: b.bases[rac],
        lignes: EMPL.map(e => ({
          ...e,
          facteur: b.facteurs[e.cle],
          parTier: [4, 5, 6, 7, 8].map(t =>
            b.bases[rac] * b.facteurs[e.cle] * Math.pow(b.parTier || 2, t - 4)),
        })),
      }));
    });

    function reinitialiserBareme() {
      if (baremeLivre) artf.bareme = JSON.parse(JSON.stringify(baremeLivre));
    }

    const ctxArt = () => ({
      prix: prixArt, histo: histoArt,
      villesAchat: artf.villesAchat, villesVente: artf.villesVente,
      maxAgeH: f.maxAgeH || null, undercut: r.undercut / 100,
      taxeOrdre: eco.value.ordre, taxeInstant: eco.value.instant,
      manuel: manuelArt, modeAchat: artf.modeAchat,
      unites: artf.unites, unitesPar: artf.unitesPar, silverPar: artf.silverPar,
      bareme: artf.bareme,
      volumeMinAchat: artf.volumeMinAchat, partVolume: artf.partVolume,
    });

    // ---- Chargement du marche des artefacts ----
    //
    // Deux passes. La premiere (750 identifiants, ~15 s) suffit a tout le coeur
    // du sujet : acheter, recycler, revendre, et les trois vues. La seconde
    // n'est demandee que si l'on veut la colonne « fabriquer », qui exige de
    // tarifer les 3 625 objets ET toute leur chaine d'ingredients.
    async function chargerArtefacts(forcer = false) {
      const ids = [...Object.keys(cataArt.artefacts), ...cataArt.materiaux];
      chargement.value = true; erreur.value = ''; progres.value = 0;
      try {
        statut.value = 'Prix des artéfacts et des matériaux…';
        // Le Black Market ne cote NI artefacts NI matieres — releve : 1 sur 725
        // et 1 sur 25, avec la date 0001-01-01 qui signale un residu. L'inclure
        // alourdirait chaque requete pour ne rendre que des zeros. Les objets
        // FABRIQUES, eux, s'y vendent tres bien : la seconde passe le reprend.
        const p = await Mk.chargerPrix(ids, V.VILLES, {
          qualites: [1], forcer, cle: 'artefacts',
          onProgress: (fait, total) => { progres.value = Math.round(fait / total * 40); },
        });
        statut.value = 'Transactions réelles sur 7 jours…';
        const h = await Mk.chargerHistorique(ids, V.VILLES, {
          qualites: [1], jours: 7, forcer, cle: 'artefacts-h',
          onProgress: (fait, total) => { progres.value = 40 + Math.round(fait / total * 60); },
        });
        // L'historique n'est pas un confort ici : sans lui, ni le prix prudent,
        // ni le rendement implicite, ni le volume realisable n'existent.
        prixArt = p.data; histoArt = h.data;
        artChargees.value = true; artFabCharge.value = false;
        versionArt.value++;
      } catch (e) {
        erreur.value = 'Chargement des artéfacts : ' + e.message;
      } finally {
        chargement.value = false; statut.value = ''; progres.value = 0;
      }
    }

    // Seconde passe : de quoi chiffrer la fabrication. On reprend `idsATarifer`
    // plutot que de composer la liste a la main — les 228 ressources de la
    // chaine manqueraient, et `coutFabrication` rendrait null partout.
    const recettesArtefact = computed(() =>
      donnees.recipes.filter(x => x.ingredients.some(i => i.id.includes('ARTEFACT'))));

    const estimationFab = computed(() => {
      const n = recettesArtefact.value.length ? idsATarifer(recettesArtefact.value).length : 0;
      const req = Mk.coutRequetes.prix(n) + Mk.coutRequetes.historique(n);
      return { items: n, requetes: req, secondes: Mk.coutRequetes.secondes(req) };
    });

    async function chargerFabrication(forcer = false) {
      const ids = idsATarifer(recettesArtefact.value);
      chargement.value = true; erreur.value = ''; progres.value = 0;
      try {
        statut.value = 'Prix des objets fabriqués…';
        const p = await Mk.chargerPrix(ids, V.TOUS_LIEUX, {
          qualites: [1], forcer, cle: 'artefacts-fab',
          onProgress: (fait, total) => { progres.value = Math.round(fait / total * 50); },
        });
        statut.value = 'Transactions des objets fabriqués…';
        const h = await Mk.chargerHistorique(ids, V.TOUS_LIEUX, {
          qualites: [1], jours: 7, forcer, cle: 'artefacts-fab-h',
          onProgress: (fait, total) => { progres.value = 50 + Math.round(fait / total * 50); },
        });
        // Fusion : les artefacts et les matieres restent ceux de la passe 1.
        for (const id of Object.keys(p.data)) if (!prixArt[id]) prixArt[id] = p.data[id];
        for (const id of Object.keys(h.data)) if (!histoArt[id]) histoArt[id] = h.data[id];
        artFabCharge.value = true;
        versionArt.value++;
      } catch (e) {
        erreur.value = 'Chargement de la fabrication : ' + e.message;
      } finally {
        chargement.value = false; statut.value = ''; progres.value = 0;
      }
    }

    // ---- Contexte moteur propre a l'onglet ----
    function ctxArtMoteur() {
      return M.creerContexte({
        byId: donnees.byId, prices: prixArt, manual: manuelArt,
        villesAchat: artf.villesAchat,
        villeRaffinage: r.villeRaffinage, villeFabrication: r.villeFabrication,
        tableVilles: table,
        focusRaffinage: r.focusRaffinage, focusFabrication: r.focusFabrication,
        eventBonus: r.eventBonus, tarifStation: r.tarifStation,
        autoriserRaffinage: r.autoriserRaffinage,
        maxAgeH: f.maxAgeH || null,
      });
    }

    // ---- Vue A : les artefacts ----
    const lignesArt = computed(() => {
      void versionArt.value;
      if (!artChargees.value) return [];
      const ctx = ctxArt();
      const ctxM = artFabCharge.value ? ctxArtMoteur() : null;
      const out = [];

      for (const [id, base] of Object.entries(cataArt.artefacts)) {
        if (!artf.tiers.includes(base.tier)) continue;
        if (!artf.lignees.includes(base.lignee)) continue;
        const rac = Art.racine(base.matiere);
        if (rac && !artf.matieres.includes(rac)) continue;
        if (artf.recherche) {
          const q = artf.recherche.toLowerCase();
          if (!nom(id).toLowerCase().includes(q) && !id.toLowerCase().includes(q)) continue;
        }

        const art = { ...base, id };
        const rec = Art.recyclage(art, ctx);
        const rev = Art.revente(art, ctx);
        if (artf.memeVille && rev && rev.trajet) rev.gain = null;

        // Fabrication : le meilleur des 5 enchantements, qui partagent le meme
        // artefact. Ne regarder que le .0 raterait souvent le vrai debouche.
        let fabrication = null;
        if (ctxM) {
          let best = null;
          for (let e = 0; e <= 4; e++) {
            const rid = e ? base.objet + '@' + e : base.objet;
            const rec2 = donnees.byId[rid];
            if (!rec2) continue;
            const c = M.coutFabrication(rec2, ctxM);
            if (!c) continue;
            const ev = D.evaluer(rec2, c.cost, prixArt, histoArt, {
              villesVente: artf.villesVente, parts: partsNormalisees.value,
              undercut: r.undercut / 100, taxeOrdre: eco.value.ordre, taxeInstant: eco.value.instant,
              maxAgeH: f.maxAgeH || null, volumeMin: 0, exigerHistorique: true, inclureBM: true,
            });
            if (ev.rejet) continue;
            if (!best || ev.profit > best.profit) best = { id: rid, ench: e, profit: ev.profit, marge: ev.marge };
          }
          fabrication = best;
        }

        const v = Art.verdict({ rec, rev, fabrication });
        const achat = rec && rec.achat ? rec.achat : Art.achat(id, ctx);
        const volMat = base.matiere ? Art.transige(histoArt[base.matiere], artf.villesVente) : null;
        const real = Art.realisable(v.gain, {
          volArtefact: achat ? achat.volJour : null,
          volMatiere: volMat ? volMat.volJour : 0,
          unites: rec && rec.unites ? rec.unites : artf.unites,
          partVolume: artf.partVolume,
        });

        out.push({
          id, nom: nom(id), tier: base.tier, lignee: base.lignee,
          objet: base.objet, nomObjet: nom(base.objet),
          matiere: base.matiere, nomMatiere: base.matiere ? nom(base.matiere) : null,
          matiereWiki: base.matiereWiki,
          silver: rec ? rec.silver : base.silver,
          prixAchat: achat ? achat.prix : null,
          lieuAchat: achat ? achat.lieu : null,
          affiche: achat ? achat.affiche : null,
          transigeArt: achat ? achat.transige : null,
          manuel: achat ? achat.manuel : false,
          bilan: rec ? rec.bilan : null,
          gainRecyclage: rec ? rec.gain : null,
          margeRecyclage: rec ? rec.marge : null,
          valeurRevente: rec ? rec.valeurRevente : null,
          lieuMatiere: rec ? rec.lieuMatiere : null,
          emplacement: base.emplacement,
          coutMatiere: rec ? rec.coutMatiere : null,
          prixMarcheMatiere: rec ? rec.prixMarcheMatiere : null,
          economieMatiere: rec ? rec.economieMatiere : null,
          rendement: rec ? rec.rendementImplicite : null,
          doute: rec ? rec.doute : null,
          gainRevente: rev ? rev.gain : null,
          trajet: rev ? rev.trajet : null,
          lieuVente: rev && rev.debouche ? rev.debouche.lieu : null,
          fabrication,
          verdict: v.voie, gain: v.gain, marge: v.marge,
          gainJour: real ? real.gain : null,
          qteJour: real ? real.qte : null,
          bride: real ? real.bride : null,
          vol: achat ? achat.volJour : null,
        });
      }

      const sens = triArt.sens === 'asc' ? 1 : -1;
      return out.sort((a, b) => {
        if (triArt.cle === 'nom') return a.nom.localeCompare(b.nom, 'fr') * sens;
        const av = a[triArt.cle], bv = b[triArt.cle];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * sens;
      });
    });

    const lignesArtAffichees = computed(() => lignesArt.value.slice(0, limiteArt.value));
    watch([() => triArt.cle, () => artf.vue, () => artf.recherche], () => { limiteArt.value = 100; });

    function trierArt(k) {
      if (triArt.cle === k) triArt.sens = triArt.sens === 'asc' ? 'desc' : 'asc';
      else { triArt.cle = k; triArt.sens = k === 'nom' ? 'asc' : 'desc'; }
    }
    const flecheArt = k => triArt.cle === k ? (triArt.sens === 'asc' ? '▲' : '▼') : '';

    const resumeArt = computed(() => {
      const l = lignesArt.value;
      const par = {};
      for (const x of l) par[x.verdict] = (par[x.verdict] || 0) + 1;
      return {
        total: l.length, par,
        gainJour: l.filter(x => x.gainJour > 0).reduce((a, x) => a + x.gainJour, 0),
      };
    });

    // ---- Vue B : les bassins de fonte ----
    const bassinsArt = computed(() => {
      void versionArt.value;
      if (!artChargees.value) return [];
      const ctx = ctxArt();
      const out = [];
      for (const [cle, b] of Object.entries(cataArt.bassins)) {
        if (!artf.tiers.includes(b.tier)) continue;
        if (!artf.matieres.includes(Art.racine(b.matiere))) continue;
        const res = Art.bassin(b, cataArt.artefacts, ctx);
        if (!res) continue;
        // `b.cout` est un NOMBRE D'UNITES (50 ou 36), `res.cout` un montant en
        // silver : les etaler dans le meme objet ecraserait le premier.
        out.push({
          cle, tier: b.tier, matiere: b.matiere, branche: b.branche,
          unitesFonte: b.cout, nomMatiere: nom(b.matiere), ...res,
        });
      }
      return out.sort((a, b) => (b.gainMedian ?? -Infinity) - (a.gainMedian ?? -Infinity));
    });

    // ---- Vue C : les matieres ----
    //
    // Le plancher implicite est le vrai apport de cette vue : le meilleur
    // artefact du couple, recycle, dit a quel prix on peut REELLEMENT se
    // procurer la matiere — souvent bien sous le prix affiche du marche.
    const matieresArt = computed(() => {
      void versionArt.value;
      if (!artChargees.value) return [];
      const ctx = ctxArt();
      const parMatiere = {};
      for (const [id, base] of Object.entries(cataArt.artefacts)) {
        if (!base.matiere) continue;
        const rec = Art.recyclage({ ...base, id }, ctx);
        if (!rec || rec.doute || rec.coutMatiere == null || !(rec.coutMatiere > 0)) continue;
        const cur = parMatiere[base.matiere];
        if (!cur || rec.coutMatiere < cur.cout) {
          parMatiere[base.matiere] = { cout: rec.coutMatiere, via: id, nomVia: nom(id) };
        }
      }
      return cataArt.materiaux.map(mid => {
        const a = Art.achat(mid, ctx);
        const t = Art.transige(histoArt[mid], artf.villesVente);
        const plancher = parMatiere[mid] || null;
        const parVille = V.VILLES.map(v => {
          const e = ((prixArt[mid] || {})[v] || {})[1];
          return { ville: v, sell: e && e.sell > 0 ? e.sell : null, buy: e && e.buy > 0 ? e.buy : null };
        });
        return {
          id: mid, nom: nom(mid), racine: Art.racine(mid), tier: +mid.slice(1, 2),
          prix: a ? a.prix : null, lieu: a ? a.lieu : null,
          transige: t ? t.prix : null, volJour: t ? t.volJour : null,
          parVille, plancher,
          economie: plancher && a ? a.prix - plancher.cout : null,
        };
      }).filter(x => artf.tiers.includes(x.tier) && artf.matieres.includes(x.racine));
    });

    // ---- Etalonnage : ce que le marche dit de nos donnees ----
    //
    // Le rendement implicite R = (prix transige − silver) / prix de la matiere
    // vaudrait le rendu si le marche arbitrait parfaitement. Il peut le
    // DEPASSER sans probleme, mais jamais etre negatif. Ce tableau range les
    // groupes par plausibilite et met en evidence ceux dont une donnee est
    // refutee — sans avoir a deviner laquelle.
    const etalonnage = computed(() => {
      void versionArt.value;
      if (!artChargees.value) return [];
      const ctx = ctxArt();
      const groupes = {};
      for (const [id, base] of Object.entries(cataArt.artefacts)) {
        if (!base.matiere) continue;
        const R = Art.rendementImplicite({ ...base, id }, ctx);
        if (R == null) continue;
        const cle = Art.racine(base.matiere) + '|' + base.tier;
        (groupes[cle] = groupes[cle] || { cle, racine: Art.racine(base.matiere), tier: base.tier, R: [], silver: base.silver }).R.push(R);
      }
      return Object.values(groupes).map(g => {
        const s = g.R.sort((a, b) => a - b);
        const n = s.length;
        const q = p => s[Math.min(n - 1, Math.floor(p * n))];
        return {
          ...g, n,
          mediane: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2,
          q1: q(0.25), q3: q(0.75),
          negatifs: s.filter(x => x < 0).length,
          unites: (artf.unitesPar[g.racine + '|' + g.tier] ?? artf.unitesPar[g.racine] ?? artf.unites),
        };
      }).sort((a, b) => b.negatifs - a.negatifs || a.racine.localeCompare(b.racine) || a.tier - b.tier);
    });

    // ---- Divers ----
    function imgErr(ev, id) {
      if (ev.target.dataset.fb) return;
      ev.target.dataset.fb = 1;
      ev.target.src = C.RENDU(id.split('@')[0]);
    }

    return {
      // etat
      pret, chargement, erreur, statut, progres, onglet, prixCharges, histoCharges,
      selection, detail, bulle, limite, zoom, f, r, table, tri,
      nbRecettes: computed(() => donnees.recipes.filter(x => x.categorie).length),
      // vocabulaire
      CATEGORIES: C.CATEGORIES, TIERS: C.TIERS, ENCHANTEMENTS: C.ENCHANTEMENTS,
      LIGNES: C.LIGNES, LIGNEES: C.LIGNEES, QUALITES: C.QUALITES, VILLES: V.VILLES,
      labelCategorie: C.labelCategorie, labelStation: C.labelStation,
      labelLignee: C.labelLignee, labelQualite: C.labelQualite,
      iconeCategorie: C.iconeCategorie, labelStat: C.labelStat,
      // calcul
      perimetre, lignes, lignesAffichees, estimation, eco, partsNormalisees, totalParts,
      meilleurProfit, partInstant, nbBlackMarket, nbAberrants, resumeRejets,
      cartes, plafondMarge, decomposition, nbNonVerif,
      fabricationParVille, poidsCategories,
      // inventaire
      stock, inv, plan, planCharge, grilleBrut, grilleRaffine, totalInventaire,
      calculerPlan, viderInventaire, resteEnBanque, achatsParVille, ouvrirDepuisPlan,
      filtreElargi, ecartesParFiltre,
      // fiche
      fi, rechercheFiche, baseFiche, enchFiche, ficheChargee,
      resultatsRecherche, objetFiche, colonnes, colonneChoisie,
      tableauVilles, bilanQuantite, ficheTechnique, ingredientsSurchargeables,
      nbSurcharges, chargerFiche, viderSurcharges, appliquerTarifPartout,
      decomposerFiche: computed(() => {
        void versionFiche.value;
        const c = colonneChoisie.value;
        return (c && !c.absent) ? decomposerRecette(c.recette) : null;
      }),
      // artefact
      artf, triArt, limiteArt, manuelArt, artChargees, artFabCharge,
      lignesArt, lignesArtAffichees, bassinsArt, matieresArt, etalonnage, resumeArt,
      estimationFab, chargerArtefacts, chargerFabrication, trierArt, flecheArt,
      tableSilver, reinitialiserBareme,
      MODES_ACHAT: Art.MODES_ACHAT, DOUTES: Art.DOUTES,
      // Filtre en amont : un `v-for` porteur d'un `v-if` sur le meme element
      // s'evalue a l'envers en Vue 3.
      LIGNEES_ART: C.LIGNEES.filter(l => l.cle !== 'commun'),
      RACINES_MAT: [
        { cle: 'RUNE', label: 'Rune' }, { cle: 'SOUL', label: 'Âme' },
        { cle: 'RELIC', label: 'Relique' }, { cle: 'SHARD_AVALONIAN', label: "Éclat d'Avalon" },
        { cle: 'SHARD_CRYSTAL', label: 'Éclat de cristal' },
      ],
      libelleVerdict: v => ({
        recycler: 'Recycler', fabriquer: 'Fabriquer', revendre: 'Revendre',
        rien: 'Rien', doute: 'Données douteuses',
      }[v] || v),
      TIERS_STOCK: C.TIERS, LIBELLES_MAT: Inv.LIBELLES,
      // actions
      balayer, analyseFine, viderLeCache, trier, fleche, ouvrir, majTable,
      zoomer, estSelection, bulleCase, styleCase, imgErr,
      // helpers
      nom, rendu: C.RENDU, fmt: C.fmt, fmtM: C.fmtM, fmtPct: C.fmtPct,
      signe: C.signe, fmtAge: C.fmtAge,
      // Vert si positif, rouge si negatif, gris si inconnu. Le signe accompagne
      // toujours la couleur : elle ne porte jamais l'information seule.
      profitClasse: v => v == null ? 'na' : (v >= 0 ? 'pos' : 'neg'),
    };
  },
});

app.component('ArbreNoeud', ArbreNoeud);
app.mount('#app');
