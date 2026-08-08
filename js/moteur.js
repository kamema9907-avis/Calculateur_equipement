// ============================================================================
//  moteur.js — cout d'obtention d'un objet.
//
//  Descendant direct de engine.js du calculateur Cuisine & Potions, dont le
//  contrat `ctx` et la recursion « acheter vs fabriquer » sont repris. Trois
//  differences de fond :
//
//   1. La branche « cultiver » est remplacee par « raffiner », qui n'est pas
//      un cas particulier mais une recursion sur toute la hauteur des tiers :
//      T8_PLANKS = 5x T8_WOOD + 1x T7_PLANKS = ... jusqu'a T2. A chaque etage
//      se repose la question acheter-ou-raffiner.
//   2. Le raffinage et la fabrication ont leur PROPRE ville et leur PROPRE
//      focus, donc deux taux de retour de ressources distincts.
//   3. Les frais de station se lisent directement dans `nutrition`, qui porte
//      la valeur d'objet exacte du jeu. Le calculateur cuisine l'approximait
//      par une somme de 2^tier ; l'ecart se voit sur les recettes a artefact,
//      dont la valeur ne suit pas cette regle.
// ============================================================================

import {
  typeRaffinage, cleBonusFabrication,
  POINTS_SPECIALITE_RAFFINAGE, POINTS_SPECIALITE_FABRICATION,
} from './villes.js';

// ---------------------------------------------------------------------------
//  Taux de retour de ressources
//
//    RRR = B / (1 + B)   soit   1 - 1/(1 + B)
//
//  ou B est le bonus de production total. On le manipule ici en POINTS
//  (B = points / 100) pour eviter les flottants a rallonge dans les additions.
//
//    B = base 18
//      + specialite de ville : 40 au raffinage, 15 a la fabrication
//      + evenement : 0, 10 ou 20
//      + focus : 59
//
//  Valeurs de reference, confirmees par Vigile :
//    base seule ........................... 15,25 %
//    raffinage en ville specialisee ....... 36,71 %
//    raffinage ville specialisee + focus .. 53,92 %
//    fabrication en ville specialisee ..... 24,81 %
// ---------------------------------------------------------------------------
const POINTS_BASE = 18;
const POINTS_FOCUS = 59;

// ---------------------------------------------------------------------------
//  Le contexte attendu par toutes les fonctions :
//
//  ctx = {
//    byId,               // { itemId: recette }
//    artefacts,          // { artefactId: { runeId, runeQty } }
//    prices,             // { itemId: { lieu: { q: { sell, buy, ageH } } } }
//    manual,             // { itemId: prix force a la main }
//    villesAchat,        // string[] : ou l'on accepte d'acheter
//    villeRaffinage,     // 'auto' | nom de ville | 'aucune'
//    villeFabrication,   // idem
//    tableVilles,        // table des bonus (voir villes.js)
//    focusRaffinage,     // booleen
//    focusFabrication,   // booleen
//    eventBonus,         // 0 | 10 | 20  (evenement de retour de ressources)
//    tarifStation,       // silver pour 100 de nutrition
//    autoriserRaffinage, // false => on achete toujours les ressources raffinees
//    autoriserArtefact,  // false => on achete toujours les artefacts
//    maxAgeH,            // null = pas de filtre, sinon age max du prix
//    cache, enCours,     // memoisation, cf. creerContexte()
//  }
// ---------------------------------------------------------------------------

// Un contexte neuf par passe de calcul : la memoisation ne doit jamais survivre
// a un changement de reglage.
export function creerContexte(base) {
  return { ...base, cache: new Map(), enCours: new Set() };
}

// ---------------------------------------------------------------------------
//  Prix
// ---------------------------------------------------------------------------

// Les ressources, artefacts et runes n'existent qu'en qualite Normale : c'est
// toujours la qualite 1 que l'on achete comme matiere premiere.
function entree(ctx, id, lieu, q = 1) {
  const parLieu = ctx.prices[id];
  if (!parLieu) return null;
  const parQ = parLieu[lieu];
  return parQ ? parQ[q] || null : null;
}

// Meilleur prix d'achat parmi les villes retenues. Un prix trop vieux est
// ecarte : sur l'equipement, un ordre releve il y a trois jours ne dit plus rien.
export function meilleurAchat(id, ctx) {
  if (ctx.manual[id] != null) return { price: ctx.manual[id], where: 'manuel' };
  let best = null;
  for (const v of ctx.villesAchat) {
    const e = entree(ctx, id, v);
    if (!e || !(e.sell > 0)) continue;
    if (ctx.maxAgeH != null && e.ageH > ctx.maxAgeH) continue;
    if (!best || e.sell < best.price) best = { price: e.sell, where: v };
  }
  return best;
}

// Le bonus de ville ne s'applique que si l'on travaille effectivement dans la
// ville specialisee. 'auto' signifie « je me deplace toujours au bon endroit ».
function rrr(points) { return 1 - 1 / (1 + points / 100); }

function pointsSpecialite(entreeTable, villeChoisie, bareme) {
  if (!entreeTable || !entreeTable.ville) return 0;
  if (villeChoisie === 'aucune') return 0;
  if (villeChoisie === 'auto' || villeChoisie === entreeTable.ville) return bareme;
  return 0;
}

// `rrrForce…` permet a l'onglet Fiche d'imposer un taux mesure en jeu, pour un
// bonus que l'outil ne modelise pas (repaire, Power Cores, evenement inconnu).
// Strictement additif : aucun contexte existant ne porte ces champs. Attention,
// inventaire.js propage tout le contexte dans ses appels : ne jamais les poser
// sur le contexte de l'onglet banque.
export function rrrRaffinage(id, ctx) {
  if (ctx.rrrForceRaffinage != null) return ctx.rrrForceRaffinage;
  const type = typeRaffinage(id);
  let pts = POINTS_BASE + ctx.eventBonus + (ctx.focusRaffinage ? POINTS_FOCUS : 0);
  pts += pointsSpecialite(ctx.tableVilles.raffinage[type], ctx.villeRaffinage,
    POINTS_SPECIALITE_RAFFINAGE);
  return rrr(pts);
}

export function rrrFabrication(recette, ctx) {
  if (ctx.rrrForceFabrication != null) return ctx.rrrForceFabrication;
  const cle = cleBonusFabrication(recette);
  let pts = POINTS_BASE + ctx.eventBonus + (ctx.focusFabrication ? POINTS_FOCUS : 0);
  pts += pointsSpecialite(ctx.tableVilles.fabrication[cle], ctx.villeFabrication,
    POINTS_SPECIALITE_FABRICATION);
  return rrr(pts);
}

// Le taux qui s'applique a une recette donnee, quelle qu'elle soit.
export function rrrDe(recette, ctx) {
  return recette.station === 'refinery' ? rrrRaffinage(recette.id, ctx) : rrrFabrication(recette, ctx);
}

// Frais d'utilisation de la station. `nutrition` porte la valeur d'objet du jeu,
// facteur 0,1125 deja applique et exprimee pour 100 : les objets sous T4 y
// valent 0, ce qui reproduit exactement la gratuite des stations a bas tier.
export function fraisStation(recette, ctx) {
  return (recette.nutrition || 0) * ctx.tarifStation;
}

// ---------------------------------------------------------------------------
//  Cout de production d'une recette (par unite produite)
//
//  Deux traitements DIFFERENTS, et c'est voulu (modele confirme en jeu) :
//
//   • Les matieres sont multipliees par (1 - taux). Le facteur suppose que la
//     matiere rendue repart dans la production : engager Q donne
//     Q + Q·RRR + Q·RRR² + … = Q/(1-RRR) unites au total, donc il faut
//     Q × (1 - RRR) par unite produite. Si on revendait les retours au lieu de
//     les recycler, il faudrait les valoriser au prix de VENTE et l'ecart des
//     ordres rognerait le gain.
//
//   • Les frais restent entiers. Le retour rend de la matiere, pas des frais :
//     pour sortir N unites on fait N operations et on en paie N.
//
//  Le retour porte sur TOUS les intrants, y compris le produit raffine du tier
//  inferieur (le T5_CLOTH dans le T6_CLOTH). Seul `excludeFromRRR` echappe au
//  retour, ce qui en pratique ne vise que les artefacts.
// ---------------------------------------------------------------------------
export function coutRecette(recette, ctx) {
  const taux = rrrDe(recette, ctx);
  let matieres = 0;
  const detail = [];
  for (const ing of recette.ingredients) {
    const c = coutUnitaire(ing.id, ctx);
    if (c == null) return null;                 // un ingredient sans prix rend tout le cout inconnu
    const exclu = recette.excludeFromRRR.includes(ing.id);
    const qteReelle = ing.quantity * (exclu ? 1 : (1 - taux));
    matieres += c.cost * qteReelle;
    detail.push({ id: ing.id, quantity: ing.quantity, qteReelle, exclu, coutU: c.cost, via: c });
  }
  const frais = fraisStation(recette, ctx);
  return {
    cost: (matieres + frais) / recette.quantity,
    parCraft: matieres + frais,
    matieres, frais, taux, detail,
  };
}

// ---------------------------------------------------------------------------
//  Cout de FABRICATION d'un produit fini, par unite.
//
//  A ne pas confondre avec coutUnitaire(), qui repond a « comment obtenir cet
//  objet au moins cher » et peut donc repondre « en l'achetant ». Pour un objet
//  qu'on veut vendre, c'est le cout de fabrication qui fait foi : si on le
//  valorisait a son prix d'achat, on mesurerait la marge d'un revendeur, pas
//  celle d'un artisan. Les INGREDIENTS, eux, passent bien par coutUnitaire :
//  c'est la tout l'interet de l'arbitrage acheter-vs-raffiner.
// ---------------------------------------------------------------------------
export function coutFabrication(recette, ctx) {
  return coutRecette(recette, ctx);
}

// ---------------------------------------------------------------------------
//  Les voies possibles pour obtenir une unite de `id`
// ---------------------------------------------------------------------------
export function voiesPour(id, ctx) {
  const voies = [];

  const achat = meilleurAchat(id, ctx);
  if (achat) voies.push({ methode: 'acheter', cost: achat.price, where: achat.where });

  const r = ctx.byId[id];
  if (r) {
    const raffinage = r.station === 'refinery';
    if (!(raffinage && !ctx.autoriserRaffinage)) {
      const c = coutRecette(r, ctx);
      if (c) voies.push({ methode: raffinage ? 'raffiner' : 'fabriquer', cost: c.cost, where: null, calcul: c });
    }
  }

  // Un artefact s'achete, ou se fabrique a la fonderie en fondant des runes.
  const a = ctx.artefacts[id];
  if (a && ctx.autoriserArtefact) {
    const rune = meilleurAchat(a.runeId, ctx);
    if (rune) {
      voies.push({
        methode: 'runes', cost: rune.price * a.runeQty,
        where: `${a.runeQty} × ${a.runeId} (${rune.where})`,
      });
    }
  }

  return voies;
}

// ---------------------------------------------------------------------------
//  Cout d'une unite : la voie la moins chere.
//
//  Memoise. Sans cache, decomposer 6 100 recettes qui partagent toutes les
//  memes chaines de raffinage recalculerait le meme lingot des milliers de fois.
//  `enCours` coupe les cycles ; le graphe des recettes est en pratique un DAG
//  (le raffinage descend toujours d'un tier), donc aucun resultat memoise ne
//  peut avoir ete tronque par cette coupure.
// ---------------------------------------------------------------------------
export function coutUnitaire(id, ctx) {
  if (ctx.cache.has(id)) return ctx.cache.get(id);
  if (ctx.enCours.has(id)) return null;
  ctx.enCours.add(id);

  const voies = voiesPour(id, ctx);
  const meilleure = voies.length
    ? voies.reduce((a, b) => (b.cost < a.cost ? b : a))
    : null;

  ctx.enCours.delete(id);
  ctx.cache.set(id, meilleure);
  return meilleure;
}

// ---------------------------------------------------------------------------
//  Decomposition complete d'une recette, pour le panneau de detail.
//  `forcees` permet a l'utilisateur d'imposer une voie sur un ingredient precis,
//  cle = `${recetteId}|${ingredientId}`.
// ---------------------------------------------------------------------------
export function decomposer(recette, ctx, forcees = {}) {
  const taux = rrrDe(recette, ctx);
  let matieres = 0, chiffrable = true;

  const lignes = recette.ingredients.map(ing => {
    const voies = voiesPour(ing.id, ctx);
    const spontanee = voies.length ? voies.reduce((a, b) => (b.cost < a.cost ? b : a)) : null;
    const impose = forcees[recette.id + '|' + ing.id];
    const forcee = impose ? voies.find(v => v.methode === impose) : null;
    const retenue = forcee || spontanee;

    const exclu = recette.excludeFromRRR.includes(ing.id);
    const qteReelle = ing.quantity * (exclu ? 1 : (1 - taux));
    if (!retenue) chiffrable = false;
    else matieres += retenue.cost * qteReelle;

    // L'ecart avec la deuxieme voie dit si le choix est net ou marginal.
    const autres = voies.filter(v => v !== retenue).sort((a, b) => a.cost - b.cost);
    const ecart = retenue && autres.length ? (autres[0].cost - retenue.cost) / retenue.cost : null;

    return {
      id: ing.id, quantity: ing.quantity, qteReelle, exclu,
      voies: voies.map(v => ({ methode: v.methode, cost: v.cost, where: v.where })),
      retenue: retenue ? retenue.methode : null,
      coutU: retenue ? retenue.cost : null,
      where: retenue ? retenue.where : null,
      forcee: !!forcee,
      ecartSuivante: ecart,
      // Sous-arbre : seulement si l'ingredient est lui-meme produit.
      sousRecette: retenue && retenue.calcul ? retenue.calcul : null,
    };
  });

  const frais = fraisStation(recette, ctx);
  const parCraft = chiffrable ? matieres + frais : null;
  return {
    lignes, taux, frais, matieres: chiffrable ? matieres : null,
    parCraft,
    cost: parCraft != null ? parCraft / recette.quantity : null,
  };
}

// ---------------------------------------------------------------------------
//  Liste de courses : ce qu'il faut REELLEMENT acheter pour produire `qte`
//  unites, en descendant dans tout ce que l'on a choisi de produire soi-meme.
// ---------------------------------------------------------------------------
export function courses(recetteId, qte, ctx, acc = {}, seen = new Set()) {
  const r = ctx.byId[recetteId];
  if (!r || seen.has(recetteId)) return acc;
  const s2 = new Set(seen); s2.add(recetteId);
  const taux = rrrDe(r, ctx);
  const nbCrafts = qte / r.quantity;

  for (const ing of r.ingredients) {
    const c = coutUnitaire(ing.id, ctx);
    if (!c) continue;
    const exclu = r.excludeFromRRR.includes(ing.id);
    const besoin = ing.quantity * nbCrafts * (exclu ? 1 : (1 - taux));

    if (c.methode === 'raffiner' || c.methode === 'fabriquer') {
      courses(ing.id, besoin, ctx, acc, s2);
    } else if (c.methode === 'runes') {
      const a = ctx.artefacts[ing.id];
      const rune = meilleurAchat(a.runeId, ctx);
      const cle = a.runeId + '|' + (rune ? rune.where : '?');
      if (!acc[cle]) acc[cle] = { id: a.runeId, where: rune && rune.where, qte: 0, prixU: rune ? rune.price : 0 };
      acc[cle].qte += besoin * a.runeQty;
    } else {
      const cle = ing.id + '|' + c.where;
      if (!acc[cle]) acc[cle] = { id: ing.id, where: c.where, qte: 0, prixU: c.cost };
      acc[cle].qte += besoin;
    }
  }
  return acc;
}
