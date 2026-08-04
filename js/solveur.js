// ============================================================================
//  solveur.js — que fabriquer avec ce qu'on possede.
//
//  Le tableau de l'onglet principal classe par marge. C'est le bon critere
//  quand on achete tout : on refait le meme craft tant qu'il rapporte. Ce n'est
//  PAS le bon critere quand le stock est fini.
//
//  Exemple : une hache a 40 % de marge consomme 20 barres, un casque a 25 %
//  n'en consomme que 8. Avec 1 000 barres on fait 50 haches ou 125 casques, et
//  c'est le profit PAR BARRE qui decide, pas la marge.
//
//  D'ou un classement par retour sur ressource rare. Reste a savoir laquelle.
//
//  Premiere version : le retour sur la matiere TOTALE engagee. Un audit sur
//  stock reel l'a condamnee. Sur 3 000 barres en banque, le plan en consommait
//  12 et depensait 5 M a acheter des sceaux royaux : la banque ne fournissait
//  que 5 % du plan. En comptant la matiere deja possedee au denominateur, on
//  penalise justement les lignes qui s'appuient sur la banque, alors que cette
//  matiere est deja payee et ne contraint rien.
//
//  Deuxieme version : le retour sur le SILVER deverse. Elle fait remonter les
//  lignes qui vident la banque — mais un second audit l'a condamnee aussi. Sur
//  le meme stock reel elle rendait 4,69 M la ou la premiere rendait 8,83 M :
//  en depensant la banque sur des conversions mediocres, elle n'en gardait plus
//  pour les lignes a forte valeur.
//
//  Le fond du probleme : il y a DEUX ressources rares, la banque et le silver,
//  et aucun ratio unique ne sert les deux. Selon le stock et le capital, tantot
//  l'une tantot l'autre est contraignante, et le bon denominateur change.
//
//  On tranche donc en executant les deux allocations et en gardant celle qui
//  rapporte le plus. C'est exactement l'objectif demande — maximiser le profit
//  realisable — plutot qu'un pari sur la contrainte qui mordra. Le plan indique
//  quelle strategie l'a emporte, pour que le choix reste lisible.
// ============================================================================

import { coutFabrication, courses, meilleurAchat, coutUnitaire, rrrDe } from './moteur.js';
import { debouchesDe, revenuPondere } from './debouches.js';
import { puiser, poolDepuis } from './inventaire.js';

export const MOTIFS = {
  horsStock: 'ne consomme rien de ta banque',
  coutInconnu: 'coût inconnu (un ingrédient sans prix)',
  pasDeDebouche: 'aucun acheteur',
  nonRentable: 'non rentable',
  volumeNul: 'aucune transaction relevée',
  quantiteNulle: 'quantité réalisable inférieure à 1',
};

// ---------------------------------------------------------------------------
//  Candidats : les recettes que la banque alimente, a n'importe quel etage.
//
//  Il faut descendre TOUTE la chaine, pas seulement les ingredients directs.
//  Aucun equipement ne consomme du minerai : il consomme des barres, qui
//  consomment du minerai. Se limiter au premier etage ecarterait donc tout
//  stock de matiere brute — precisement ce que Vigile veut pouvoir saisir.
//
//  Ce filtre n'est pas qu'une optimisation : il borne l'ensemble a quelques
//  centaines d'objets au lieu de 6 700, ce qui rend le chargement de
//  l'historique des transactions abordable. Sans lui, la contrainte de volume
//  couterait plus de 300 requetes.
// ---------------------------------------------------------------------------
function fermeture(id, byId, cache, profondeur = 0) {
  const vu = cache.get(id);
  if (vu) return vu;
  const set = new Set([id]);
  cache.set(id, set);              // pose avant de descendre : coupe les cycles
  const r = byId[id];
  if (r && profondeur < 12) {
    for (const i of r.ingredients) {
      for (const x of fermeture(i.id, byId, cache, profondeur + 1)) set.add(x);
    }
  }
  return set;
}

export function candidats(recettes, stock, byId) {
  const possede = new Set(Object.keys(stock.quantites).filter(k => stock.quantites[k] > 0));
  if (!possede.size) return [];
  const cache = new Map();
  return recettes.filter(r => {
    if (!r.categorie) return false;
    for (const i of r.ingredients) {
      for (const x of fermeture(i.id, byId, cache)) if (possede.has(x)) return true;
    }
    return false;
  });
}

// Valeur de marche de ce qu'une unite consomme, tous ingredients confondus.
// C'est le denominateur du classement.
function valeurMatiere(recette, ctx) {
  const liste = Object.values(courses(recette.id, 1, ctx, {}, new Set()));
  return liste.reduce((a, x) => a + x.qte * x.prixU, 0);
}

// ---------------------------------------------------------------------------
//  Revendre la matiere plutot que la fabriquer
//
//  Le stock etant valorise au prix d'ACHAT, revendre rapporte au mieux ce prix
//  moins la taxe : par construction, un craft a marge positive bat presque
//  toujours la revente. L'exception reelle est le Black Market, dont les ordres
//  d'achat sur les ressources raffinees depassent parfois le prix des villes.
//  On calcule donc la comparaison pour de vrai, sans presumer du resultat.
// ---------------------------------------------------------------------------
function gainRevente(recette, ctx, prix, histo, opts) {
  const liste = Object.values(courses(recette.id, 1, ctx, {}, new Set()));
  let net = 0, base = 0;
  for (const x of liste) {
    const d = debouchesDe(prix[x.id], histo && histo[x.id], { ...opts, qualite: 1 });
    if (d.length) net += d[0].net * x.qte;
    base += x.prixU * x.qte;
  }
  // Ce que la revente rapporte EN PLUS de la valeur deja comptee dans le cout.
  return net - base;
}

// ---------------------------------------------------------------------------
//  Resolution
// ---------------------------------------------------------------------------
export function resoudre(recettes, stock, ctx, prix, histo, opts) {
  const {
    capital = 0, focus = 0, efficaciteFocus = 0,
    partVolume = 0.10, villesVente = [], nbVillesMax = 3,
    taxeOrdre, taxeInstant, undercut = 0.03, parts = { 1: 1 }, maxAgeH = null,
    exigerBanque = true,
  } = opts;

  const optsDeb = { villesVente, undercut, taxeOrdre, taxeInstant, maxAgeH, parts,
    exigerHistorique: !!histo, volumeMin: 0 };

  // Etat de la banque au depart, fige : sert a estimer la depense de chaque
  // candidat AVANT toute allocation, donc a les classer entre eux.
  const poolInitial = poolDepuis(stock);

  // ---- 1. Evaluer chaque candidat ----
  const lignes = [], rejets = {};
  const noter = m => { rejets[m] = (rejets[m] || 0) + 1; };

  for (const r of candidats(recettes, stock, ctx.byId)) {
    const c = coutFabrication(r, ctx);
    if (!c) { noter(MOTIFS.coutInconnu); continue; }

    const rev = revenuPondere(prix[r.id], histo && histo[r.id], optsDeb);
    if (!rev || !rev.meilleur) { noter(MOTIFS.pasDeDebouche); continue; }

    const profit = rev.net - c.cost;
    if (profit <= 0) { noter(MOTIFS.nonRentable); continue; }

    // Ce que produire UNE unite couterait en silver, contre la banque telle
    // qu'elle est aujourd'hui. Simule sur copie : rien n'est consomme ici.
    const essai = simuler(r, 1, poolInitial, { focus, efficaciteFocus }, ctx);

    // Une ligne qui ne prend RIEN dans la banque n'a pas sa place ici : c'est du
    // pur negoce, et c'est le travail de l'onglet Tableau. Sans ce garde-fou,
    // le solveur depense tout le capital sur l'objet le plus rentable du jeu et
    // laisse le stock intact — releve en audit : 99 % de la banque inutilisee.
    if (exigerBanque && !(essai.valeurBanque > 0)) { noter(MOTIFS.horsStock); continue; }

    lignes.push({
      id: r.id, recette: r,
      coutU: c.cost, revenuU: rev.net, profitU: profit,
      marge: profit / c.cost,
      matiereU: valeurMatiere(r, ctx),
      depenseU: essai.coutAchat,
      banqueU: essai.valeurBanque,
      // Part du besoin que la banque couvre : dit d'un coup d'oeil si la ligne
      // vide le stock ou si elle se contente de depenser.
      partBanque: (essai.valeurBanque + essai.coutAchat) > 0
        ? essai.valeurBanque / (essai.valeurBanque + essai.coutAchat) : 0,
      // Deux classements concurrents, evalues tous les deux plus bas.
      // Le premier favorise les lignes qui vident la banque, le second celles
      // qui tirent le meilleur parti de chaque silver de matiere.
      retour: profit / Math.max(essai.coutAchat, 1),
      retourMatiere: essai.valeurBanque + essai.coutAchat > 0
        ? profit / (essai.valeurBanque + essai.coutAchat) : Infinity,
      debouches: rev.parQualite,
      meilleur: rev.meilleur,
      reventeMieux: gainRevente(r, ctx, prix, histo, optsDeb) > profit,
    });
  }

  // ---- 2. Allouer, selon les deux strategies, et garder la meilleure ----
  const strategies = [
    { cle: 'silver', libelle: 'retour sur le silver dépensé', tri: (a, b) => b.retour - a.retour },
    { cle: 'matiere', libelle: 'retour sur la matière engagée', tri: (a, b) => b.retourMatiere - a.retourMatiere },
  ];
  let meilleur = null;
  for (const s of strategies) {
    const essai = allouer(lignes.slice().sort(s.tri), stock, ctx, prix, histo, optsDeb, {
      capital, focus, efficaciteFocus, partVolume, nbVillesMax,
    });
    essai.strategie = s.libelle;
    if (!meilleur || essai.totalProfit > meilleur.totalProfit) meilleur = essai;
  }
  return { ...meilleur, rejets, nbCandidats: lignes.length };
}

// ---------------------------------------------------------------------------
//  Une passe d'allocation, pour un ordre de candidats donne.
// ---------------------------------------------------------------------------
function allouer(lignes, stock, ctx, prix, histo, optsDeb, opts) {
  const { capital, focus, efficaciteFocus, partVolume, nbVillesMax } = opts;
  const pool = poolDepuis(stock);
  const budget = { focus, efficaciteFocus };
  let capRestant = capital;

  const retenues = [], ecartees = [];

  for (const l of lignes) {
    // Borne de liquidite : 10 % du volume quotidien, par marche, sur les
    // meilleures villes seulement. Vendre partout est theorique.
    const marches = debouchesDe(prix[l.id], histo && histo[l.id], { ...optsDeb, qualite: l.meilleur.qualite })
      .filter(d => d.vol > 0)
      .slice(0, nbVillesMax);
    const borneVolume = marches.reduce((a, d) => a + d.vol * partVolume, 0);
    if (!(borneVolume >= 1)) { ecartees.push({ ...l, motif: MOTIFS.volumeNul }); continue; }

    // Borne de capital : on ne connait le cout d'achat qu'apres avoir puise
    // dans la banque, et ce cout n'est pas lineaire (les premieres unites sont
    // couvertes par le stock, les suivantes non). On converge en trois passes,
    // toujours par le bas pour ne jamais depasser le capital.
    let q = Math.floor(borneVolume);
    let simu = null;
    for (let i = 0; i < 3 && q >= 1; i++) {
      simu = simuler(l.recette, q, pool, budget, ctx);
      if (simu.coutAchat <= capRestant) break;
      q = Math.floor(q * (capRestant / simu.coutAchat) * 0.98);
      simu = null;
    }
    if (q < 1 || !simu) { ecartees.push({ ...l, motif: MOTIFS.quantiteNulle }); continue; }

    // ---- Engagement : on consomme pour de vrai ----
    const reel = appliquer(l.recette, q, pool, budget, ctx);
    capRestant -= reel.coutAchat;

    const repartition = repartir(q, marches);
    retenues.push({
      ...l, q,
      profit: q * l.profitU,
      matiereEngagee: q * l.matiereU,
      coutAchat: reel.coutAchat,
      valeurBanque: reel.valeurBanque,
      prisEnBanque: reel.prisEnBanque,
      focusUtilise: reel.focus,
      achats: reel.achats,
      repartition,
    });
  }

  const totalProfit = retenues.reduce((a, r) => a + r.profit, 0);
  return {
    retenues, ecartees,
    totalProfit,
    capitalUtilise: capital - capRestant,
    capitalRestant: capRestant,
    focusRestant: budget.focus,
    stockRestant: pool,
    nbLignes: retenues.length,
    valeurBanqueUtilisee: retenues.reduce((a, r) => a + r.valeurBanque, 0),
  };
}

// ---------------------------------------------------------------------------
//  Simulation sur copie : combien couterait de produire `q` unites, sans rien
//  consommer. Sert a caler la quantite sous le capital disponible.
// ---------------------------------------------------------------------------
function simuler(recette, q, pool, budget, ctx) {
  return parcourir(recette, q, { ...pool }, { ...budget }, ctx);
}

// Meme chose, mais en consommant reellement le stock et le focus.
function appliquer(recette, q, pool, budget, ctx) {
  return parcourir(recette, q, pool, budget, ctx);
}

// ---------------------------------------------------------------------------
//  Ce que produire `q` unites prend a la banque, et ce qu'il reste a debourser.
//
//  On part des ingredients DIRECTS de la recette, pas de courses(). C'est le
//  correctif d'un bug trouve a l'audit : courses() suit le chemin le moins
//  cher, qui peut etre « raffiner du minerai » alors qu'on a justement des
//  barres en banque. Elle reclamait donc du minerai absent en ignorant le stock
//  pose a cote, et le plan sortait vide des qu'on n'avait pas de capital.
//
//  puiser() applique le bon ordre a chaque etage : banque, puis raffinage
//  depuis la banque, puis achat.
//
//  Comptabilite : le COUT total reste celui de coutFabrication() — la banque ne
//  change pas la valeur des choses. Elle ne fait que reduire le CAPITAL a
//  sortir, a hauteur de la valeur de marche de ce qu'elle fournit.
// ---------------------------------------------------------------------------
function parcourir(recette, q, pool, budget, ctx) {
  const taux = rrrDe(recette, ctx);
  const nbCrafts = q / recette.quantity;
  const out = { coutAchat: 0, valeurBanque: 0, prisEnBanque: 0, focus: 0, achats: [], detail: [] };

  for (const ing of recette.ingredients) {
    const exclu = recette.excludeFromRRR.includes(ing.id);
    const besoin = ing.quantity * nbCrafts * (exclu ? 1 : (1 - taux));
    const r = puiser(ing.id, besoin, pool, ctx, budget);
    out.valeurBanque += r.valeurBanque;
    out.prisEnBanque += r.pris + r.raffine;
    out.focus += r.focus;
    if (r.achete > 0) {
      const p = meilleurAchat(ing.id, ctx);
      const u = (coutUnitaire(ing.id, ctx) || { cost: 0 }).cost;
      out.achats.push({ id: ing.id, qte: r.achete, cout: r.achete * u, ville: p ? p.where : null });
    }
    out.detail.push({ id: ing.id, besoin, ...r });
  }

  const coutTotal = (coutFabrication(recette, ctx) || { cost: 0 }).cost * q;
  out.coutAchat = Math.max(0, coutTotal - out.valeurBanque);
  return out;
}

// ---------------------------------------------------------------------------
//  Repartition d'une quantite entre les marches retenus, proportionnellement a
//  leur volume : on ecoule davantage la ou il se vend davantage.
// ---------------------------------------------------------------------------
function repartir(q, marches) {
  const total = marches.reduce((a, d) => a + d.vol, 0);
  if (!total) return [];
  let reste = q;
  const out = marches.map((d, i) => {
    const part = i === marches.length - 1 ? reste : Math.floor(q * d.vol / total);
    reste -= part;
    return { lieu: d.lieu, bm: d.bm, instantane: d.instantane, net: d.net, vol: d.vol, qte: part };
  }).filter(x => x.qte > 0);
  return out;
}
