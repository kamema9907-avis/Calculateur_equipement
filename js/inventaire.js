// ============================================================================
//  inventaire.js — ce que Vigile possede en banque, et ce qu'on peut en tirer.
//
//  Choix fondateur : le stock est valorise au PRIX DE RACHAT DU MARCHE, pas a
//  zero. Posseder 500 barres n'est pas « gratuit » : on pourrait les revendre.
//  Compter zero pousserait l'outil a fondre des barres T8 en un objet qui vaut
//  moins que les barres, sans jamais le signaler.
//
//  Consequence heureuse : le COUT d'un objet ne depend pas de ce qu'on possede,
//  donc moteur.js reste valable tel quel. L'inventaire n'agit que sur deux
//  plans : la QUANTITE faisable, et le CAPITAL a debourser pour le reste.
//
//  Ce module ne calcule aucun prix. Il repond a une seule question : « pour
//  produire tant d'unites, qu'est-ce que je prends dans ma banque, qu'est-ce
//  que je raffine, et qu'est-ce qu'il reste a acheter ? »
// ============================================================================

import { rrrRaffinage, coutUnitaire } from './moteur.js';

// Les cinq chaines de production du jeu. L'ordre des deux tableaux se
// correspond : ORE se raffine en METALBAR, FIBER en CLOTH, etc.
export const TYPES_BRUTS = ['ORE', 'FIBER', 'HIDE', 'WOOD', 'ROCK'];
export const TYPES_RAFFINES = ['METALBAR', 'CLOTH', 'LEATHER', 'PLANKS', 'STONEBLOCK'];

export const LIBELLES = {
  ORE: 'Minerai', FIBER: 'Fibre', HIDE: 'Peau', WOOD: 'Bois', ROCK: 'Pierre',
  METALBAR: 'Lingots', CLOTH: 'Tissu', LEATHER: 'Cuir', PLANKS: 'Planches', STONEBLOCK: 'Blocs',
};

// Identifiant d'une ressource. Les ressources enchantees suivent une convention
// differente des equipements : T4_METALBAR_LEVEL1@1 et non T4_METALBAR@1.
export function idRessource(type, tier, ench) {
  return ench > 0 ? `T${tier}_${type}_LEVEL${ench}@${ench}` : `T${tier}_${type}`;
}

// ---------------------------------------------------------------------------
//  Cout en focus du raffinage
//
//  Table relevee sur le wiki (page Crafting Focus), a specialisation nulle.
//  Le cout en focus de la FABRICATION, lui, n'est publie nulle part : c'est
//  pourquoi le plan ne budgete le focus qu'au raffinage et calcule la
//  fabrication sans focus. Le benefice annonce est donc un plancher.
// ---------------------------------------------------------------------------
const FOCUS_BASE = { 2: 18, 3: 31, 4: 54, 5: 94, 6: 164, 7: 287, 8: 503 };

// L'enchantement multiplie le cout par ~1,75 a chaque niveau. La pierre fait
// exception : il le double.
function multiplicateurEnchantement(type, ench) {
  if (!ench) return 1;
  return Math.pow(type === 'STONEBLOCK' ? 2 : 1.75, ench);
}

// L'efficacite de focus, gagnee au Destiny Board, divise le cout par deux tous
// les 10 000 points. 40 000 points ramenent le raffinage a 6,25 % du cout brut.
export function coutFocus(type, tier, ench, efficacite = 0) {
  const base = FOCUS_BASE[tier];
  if (!base) return 0;
  return base * multiplicateurEnchantement(type, ench) / Math.pow(2, efficacite / 10000);
}

// ---------------------------------------------------------------------------
//  Le stock
//  Structure a plat { itemId: quantite }, pour se brancher directement sur les
//  identifiants du moteur sans table de correspondance.
// ---------------------------------------------------------------------------
const CLE = 'albion.eq.inventaire';

export function stockVide() {
  return { quantites: {}, tiers: [4, 5, 6, 7, 8], enchantements: [0, 1, 2] };
}

export function chargerStock() {
  try {
    const s = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (s && s.quantites) return { ...stockVide(), ...s };
  } catch { /* sauvegarde corrompue : on repart d'un stock vide */ }
  return stockVide();
}

export function sauverStock(stock) {
  try {
    // On ne garde que les quantites non nulles : inutile de sauver 400 zeros.
    const q = {};
    for (const [k, v] of Object.entries(stock.quantites)) if (v > 0) q[k] = v;
    localStorage.setItem(CLE, JSON.stringify({ ...stock, quantites: q }));
  } catch { /* quota : le stock ne survivra pas a la session, tant pis */ }
}

export function totalStock(stock) {
  return Object.values(stock.quantites).reduce((a, b) => a + (+b || 0), 0);
}

// Type et tier d'un identifiant de ressource, ou null si ce n'en est pas une.
export function analyserRessource(id) {
  const m = id.split('@')[0].match(/^T(\d)_(ORE|FIBER|HIDE|WOOD|ROCK|METALBAR|CLOTH|LEATHER|PLANKS|STONEBLOCK)(?:_LEVEL(\d))?$/);
  if (!m) return null;
  return { tier: +m[1], type: m[2], ench: +(m[3] || 0), brut: TYPES_BRUTS.includes(m[2]) };
}

// ---------------------------------------------------------------------------
//  Puiser dans le stock
//
//  Pour obtenir `qte` unites de `id`, dans l'ordre :
//    1. ce que la banque contient deja ;
//    2. ce qu'on peut RAFFINER a partir de la banque (recursivement, en
//       consommant du focus) ;
//    3. le reste, qu'il faudra acheter.
//
//  L'ordre compte. Prendre dans la banque avant d'acheter ne change pas le cout
//  (tout est valorise au marche) mais economise du capital, qui est la
//  ressource reellement limitante d'une session de jeu.
//
//  `pool` est mute : c'est une copie de travail du stock, que le solveur
//  decremente ligne apres ligne.
// ---------------------------------------------------------------------------
export function puiser(id, qte, pool, ctx, budget, profondeur = 0) {
  const res = { pris: 0, raffine: 0, achete: 0, focus: 0, valeurBanque: 0, detail: [] };
  if (qte <= 0) return res;

  // Valeur de marche d'une unite : ce que la banque nous evite de debourser.
  // C'est la meme grandeur que celle qu'emploie coutFabrication(), donc les
  // deux comptabilites restent coherentes.
  const prixU = (coutUnitaire(id, ctx) || { cost: 0 }).cost;

  // 1. La banque
  const dispo = pool[id] || 0;
  const pris = Math.min(dispo, qte);
  if (pris > 0) {
    pool[id] = dispo - pris;
    res.pris = pris;
    res.valeurBanque += pris * prixU;
    res.detail.push({ id, source: 'banque', qte: pris, valeur: pris * prixU });
  }
  let reste = qte - pris;
  if (reste <= 1e-9) return res;

  // 2. Le raffinage, si la recette existe et que le budget de focus le permet.
  //    La profondeur borne la descente : une chaine de raffinage ne depasse
  //    jamais 7 etages (T8 -> T2), au-dela c'est un cycle.
  const recette = ctx.byId[id];
  const info = analyserRessource(id);
  if (recette && recette.station === 'refinery' && info && profondeur < 8) {
    // Deux regimes de raffinage, et il faut les DEUX :
    //   • au focus, tant qu'il en reste : +59 points de bonus, donc moins de
    //     matiere consommee, mais chaque operation coute des points ;
    //   • sans focus ensuite : on raffine tout de meme, au taux de base.
    // Ne garder que le premier regime laisserait le minerai dormir en banque
    // des le focus epuise, ce qui n'a aucun sens en jeu.
    const tauxFocus = rrrRaffinage(id, { ...ctx, focusRaffinage: true });
    const tauxBase = rrrRaffinage(id, { ...ctx, focusRaffinage: false });
    const parCraft = coutFocus(info.type, info.tier, info.ench, budget.efficaciteFocus || 0);

    const auFocus = (parCraft > 0 && budget.focus > 0)
      ? Math.min(reste, budget.focus / parCraft) : 0;

    for (const [aRaffiner, taux, coutParCraft] of [[auFocus, tauxFocus, parCraft],
      [reste - auFocus, tauxBase, 0]]) {
      if (aRaffiner <= 1e-9) continue;

      // Ce que la banque peut reellement alimenter, teste sur copie pour ne
      // rien consommer si le raffinage n'aboutit pas. On ne raffine qu'a
      // partir de la banque : acheter la matiere pour la raffiner reviendrait
      // a acheter le produit fini en payant en plus frais et focus.
      let possible = aRaffiner;
      const essai = { ...pool };
      const sousBudget = { ...budget };
      for (const ing of recette.ingredients) {
        const parUnite = ing.quantity * (1 - taux);
        const t = puiser(ing.id, parUnite * aRaffiner, essai, ctx, sousBudget, profondeur + 1);
        possible = Math.min(possible, (t.pris + t.raffine) / (parUnite || 1));
      }
      const n = Math.floor(Math.min(aRaffiner, possible) * 1000) / 1000;
      if (n <= 1e-9) continue;

      for (const ing of recette.ingredients) {
        const sous = puiser(ing.id, ing.quantity * (1 - taux) * n, pool, ctx, budget, profondeur + 1);
        // La valeur remonte de la profondeur : ce sont les matieres du
        // sous-etage qui sortent de la banque, pas le produit raffine.
        res.valeurBanque += sous.valeurBanque;
        res.focus += sous.focus;
        res.detail.push(...sous.detail);
      }
      const utilise = n * coutParCraft;
      if (utilise > 0 && budget.focus != null) budget.focus -= utilise;
      res.raffine += n;
      res.focus += utilise;
      res.detail.push({ id, source: coutParCraft ? 'raffine (focus)' : 'raffine', qte: n, focus: utilise });
      reste -= n;
    }
  }

  // 3. L'achat
  if (reste > 1e-9) {
    res.achete = reste;
    res.detail.push({ id, source: 'achat', qte: reste, valeur: reste * prixU });
  }
  return res;
}

// Copie de travail du stock, que le solveur peut decrementer sans abimer la
// saisie de l'utilisateur.
export function poolDepuis(stock) {
  const p = {};
  for (const [k, v] of Object.entries(stock.quantites)) if (v > 0) p[k] = +v;
  return p;
}
