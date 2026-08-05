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
      libelleVoie: m => ({ acheter: 'Acheter', raffiner: 'Raffiner', fabriquer: 'Fabriquer', runes: 'Fondre des runes' }[m] || m),
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
      autoriserArtefact: true,
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
        donnees = { ...d, byId: {} };
        for (const rec of d.recipes) donnees.byId[rec.id] = rec;
        pret.value = true;
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
    // d'ingredients, plus les runes des artefacts qu'on pourrait fondre.
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
        const a = donnees.artefacts[id];
        if (a) need.add(a.runeId);
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
        byId: donnees.byId, artefacts: donnees.artefacts, prices: prix, manual: {},
        villesAchat: f.villesAchat,
        villeRaffinage: r.villeRaffinage, villeFabrication: r.villeFabrication,
        tableVilles: table,
        focusRaffinage: r.focusRaffinage, focusFabrication: r.focusFabrication,
        eventBonus: r.eventBonus, tarifStation: r.tarifStation,
        autoriserRaffinage: r.autoriserRaffinage, autoriserArtefact: r.autoriserArtefact,
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
      return M.decomposer(rec, onglet.value === 'inventaire' ? ctxInventaire() : contexte(), forcees);
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
        byId: donnees.byId, artefacts: donnees.artefacts, prices: prix, manual: {},
        villesAchat: inv.villesAchat,
        villeRaffinage: inv.villeBase, villeFabrication: inv.villeBase,
        tableVilles: table,
        focusRaffinage: false, focusFabrication: false,   // le focus est budgete, pas coche
        eventBonus: r.eventBonus, tarifStation: r.tarifStation,
        autoriserRaffinage: true, autoriserArtefact: r.autoriserArtefact,
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
      iconeCategorie: C.iconeCategorie,
      // calcul
      perimetre, lignes, lignesAffichees, estimation, eco, partsNormalisees, totalParts,
      meilleurProfit, partInstant, nbBlackMarket, nbAberrants, resumeRejets,
      cartes, plafondMarge, decomposition, nbNonVerif,
      fabricationParVille, poidsCategories,
      // inventaire
      stock, inv, plan, planCharge, grilleBrut, grilleRaffine, totalInventaire,
      calculerPlan, viderInventaire, resteEnBanque, achatsParVille, ouvrirDepuisPlan,
      filtreElargi, ecartesParFiltre,
      TIERS_STOCK: C.TIERS, LIBELLES_MAT: Inv.LIBELLES,
      // actions
      balayer, analyseFine, viderLeCache, trier, fleche, ouvrir, majTable,
      zoomer, estSelection, bulleCase, styleCase, imgErr,
      // helpers
      nom, rendu: C.RENDU, fmt: C.fmt, fmtM: C.fmtM, fmtPct: C.fmtPct,
      signe: C.signe, fmtAge: C.fmtAge,
    };
  },
});

app.component('ArbreNoeud', ArbreNoeud);
app.mount('#app');
