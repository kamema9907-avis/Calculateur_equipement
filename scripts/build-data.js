/*
 * build-data.js
 * -----------------------------------------------------------------------------
 * Genere le fichier de donnees consomme par index.html, a partir de la librairie
 * voisine.
 *
 * Source : ../Albion_librairie_des_recettes_du_jeu/data  (~12 Mo)
 * Sortie : data/equipment-data.json
 *
 * Contenu de la sortie :
 *   - recipes   : tout l'equipement (armes, armes secondaires, tete/poitrine/pieds
 *                 sur les 3 lignes, capes, equipement de recolte, sacs, outils)
 *                 PLUS la fermeture des sous-recettes, c'est-a-dire toute la chaine
 *                 de raffinage (lingot -> lingot du tier inferieur -> ... -> T2).
 *   - artefacts : voie « fabriquer l'artefact avec des runes » (fonderie d'artefacts).
 *   - names     : noms FR + EN de chaque item reference.
 *   - economy   : taux de taxes, separes ordre de vente / vente instantanee.
 *
 * Usage : node scripts/build-data.js
 * Aucune dependance npm (modules natifs uniquement).
 */

const fs = require('fs');
const path = require('path');

const LIB = path.resolve(__dirname, '..', '..', 'Albion_librairie_des_recettes_du_jeu', 'data');
const OUT = path.resolve(__dirname, '..', 'data', 'equipment-data.json');

const load = rel => JSON.parse(fs.readFileSync(path.join(LIB, rel), 'utf8'));

console.log('Lecture de la librairie depuis :', LIB);

const allRecipes = load('all-recipes.json').recipes;
const names = load('names.json').items;
const meta = load('meta.json');
const foundry = load('recipes/artefact_foundry.json');

// ---------------------------------------------------------------------------
//  Perimetre
// ---------------------------------------------------------------------------
// Les 3 stations d'equipement + le fabricant d'outils. La raffinerie n'est PAS
// une cible : elle entre par la fermeture des dependances, puisqu'on ne veut pas
// afficher « fabriquer un lingot » comme une opportunite mais comme une option
// de cout a l'interieur d'une recette.
const STATIONS_CIBLES = new Set(['warriors_forge', 'mages_tower', 'hunters_lodge', 'toolmaker']);

// Slots retenus. Exclut FURNITUREITEM et SIEGE du fabricant d'outils : ce sont des
// objets de construction, pas de l'equipement.
const SLOTS = new Set(['2H', 'MAIN', 'OFF', 'HEAD', 'ARMOR', 'SHOES', 'CAPE', 'BACKPACK', 'BAG']);

// Suffixes qui designent une lignee d'artefact plutot qu'un objet commun.
const LIGNEES_ARTEFACT = new Set(['UNDEAD', 'HELL', 'KEEPER', 'MORGANA', 'AVALON', 'CRYSTAL', 'ROYAL']);

// Les 3 lignes d'armure du jeu, telles qu'elles apparaissent dans l'id.
const LIGNES = { PLATE: 'plaque', LEATHER: 'cuir', CLOTH: 'tissu' };

// Metier de recolte, pour les pieces GATHERER.
const METIERS = {
  FIBER: 'récolteur de fibre', HIDE: 'écorcheur', ORE: 'mineur',
  ROCK: 'tailleur de pierre', WOOD: 'bûcheron', FISH: 'pêcheur',
};

// ---------------------------------------------------------------------------
//  Classification d'un id
//  Un id se lit T[tier]_[SLOT]_[reste...][@ench]. Le « reste » porte selon le
//  slot soit la ligne d'armure, soit la famille d'arme, soit le metier de recolte.
// ---------------------------------------------------------------------------
function classer(r) {
  const parts = r.id.split('@')[0].split('_');
  const slot = parts[1];
  const reste = parts.slice(2);
  const tete = reste[0] || null;
  const queue = reste[reste.length - 1] || null;

  const estArtefact = LIGNEES_ARTEFACT.has(queue);
  const lignee = estArtefact ? queue : 'commun';

  // Equipement de recolte : T4_HEAD_GATHERER_ORE, T4_BACKPACK_GATHERER_FIBER…
  if (tete === 'GATHERER') {
    return {
      categorie: 'recolte', ligne: null,
      famille: METIERS[queue] || queue, lignee: 'commun',
      slot,
    };
  }

  switch (slot) {
    case 'HEAD': case 'ARMOR': case 'SHOES':
      return {
        categorie: { HEAD: 'tete', ARMOR: 'poitrine', SHOES: 'pieds' }[slot],
        ligne: LIGNES[tete] || null,
        // Pour une armure, la « famille » utile est le set : SET1/2/3 ou la lignee.
        famille: LIGNES[tete] || tete, lignee, slot,
      };
    case 'CAPE':
      return { categorie: 'cape', ligne: null, famille: 'cape', lignee: 'commun', slot };
    case 'BAG':
      return { categorie: 'sac', ligne: null, famille: 'sac', lignee: 'commun', slot };
    case 'BACKPACK':
      return { categorie: 'recolte', ligne: null, famille: 'sac de récolte', lignee: 'commun', slot };
    case 'OFF':
      return { categorie: 'arme_secondaire', ligne: null, famille: tete, lignee, slot };
    case '2H': case 'MAIN':
      // Le fabricant d'outils range ses outils de recolte sur le slot 2H
      // (T4_2H_TOOL_PICK) : c'est une categorie a part, pas une arme.
      if (tete === 'TOOL') {
        return { categorie: 'outil', ligne: null, famille: reste[1] || 'outil', lignee, slot };
      }
      return { categorie: 'arme', ligne: null, famille: tete, lignee, slot };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
//  Cibles
// ---------------------------------------------------------------------------
const cibles = [];
for (const r of allRecipes) {
  if (!STATIONS_CIBLES.has(r.station)) continue;
  const parts = r.id.split('@')[0].split('_');
  if (!SLOTS.has(parts[1])) continue;
  const c = classer(r);
  if (!c) continue;
  cibles.push({ recette: r, classe: c });
}

// Index de TOUTES les recettes du jeu, pour resoudre les sous-ingredients
// craftables (essentiellement le raffinage, qui descend d'un tier a chaque etage).
const recipeById = {};
for (const r of allRecipes) if (!recipeById[r.id]) recipeById[r.id] = r;

// ---------------------------------------------------------------------------
//  Reduction d'une recette
//  On garde `nutrition` : contrairement a ce que son nom laisse croire, ce champ
//  porte la valeur d'objet du jeu (facteur 0,1125 deja applique, exprimee pour
//  100 unites). Les frais de station valent exactement nutrition x tarif, y
//  compris pour les recettes a artefact dont la valeur ne suit pas 2^tier.
// ---------------------------------------------------------------------------
function slimRecipe(r, classe) {
  const o = {
    id: r.id,
    station: r.station,
    tier: r.tier,
    enchantment: r.enchantment,
    quantity: r.quantity,
    nutrition: r.nutrition || 0,
    excludeFromRRR: r.excludeFromRRR || [],
    ingredients: r.ingredients.map(i => ({
      id: i.id, tier: i.tier, enchantment: i.enchantment, quantity: i.quantity,
    })),
  };
  if (classe) {
    o.categorie = classe.categorie;
    o.famille = classe.famille;
    o.lignee = classe.lignee;
    if (classe.ligne) o.ligne = classe.ligne;
  }
  return o;
}

// ---------------------------------------------------------------------------
//  Fermeture des dependances
//  Depart : les cibles. On descend dans chaque ingredient ; s'il est craftable
//  (raffinage, sous-composant) on l'inclut et on continue, sinon c'est une
//  feuille : matiere brute achetee ou recoltee, ou artefact achete.
// ---------------------------------------------------------------------------
const includedRecipes = {};
const referencedItems = new Set();
const stack = [];

for (const { recette, classe } of cibles) {
  includedRecipes[recette.id] = slimRecipe(recette, classe);
  referencedItems.add(recette.id);
  for (const ing of recette.ingredients) stack.push(ing.id);
}
const nbCibles = Object.keys(includedRecipes).length;

const visited = new Set();
while (stack.length) {
  const id = stack.pop();
  referencedItems.add(id);
  if (visited.has(id)) continue;
  visited.add(id);
  const rec = recipeById[id];
  if (rec && !includedRecipes[id]) {
    includedRecipes[id] = slimRecipe(rec, null);   // sous-recette : pas de classe
    for (const ing of rec.ingredients) stack.push(ing.id);
  }
}

// ---------------------------------------------------------------------------
//  Fonderie d'artefacts : runeQty unites de runeId -> 1 artefact au choix.
//  Aplati en { artefactId: { runeId, runeQty, tier } } pour un acces direct.
// ---------------------------------------------------------------------------
const artefacts = {};
for (const branche of ['warrior', 'mage', 'hunter']) {
  for (const groupe of (foundry[branche] || [])) {
    for (const a of groupe.artefacts) {
      artefacts[a] = { runeId: groupe.runeId, runeQty: groupe.runeQty, tier: groupe.tier };
      referencedItems.add(groupe.runeId);
    }
  }
}
// On ne garde que les artefacts effectivement utilises par nos recettes : la
// fonderie en liste pour tout le jeu, y compris des lignees hors perimetre.
for (const id of Object.keys(artefacts)) {
  if (!referencedItems.has(id)) delete artefacts[id];
}

// ---------------------------------------------------------------------------
//  Noms FR / EN
//  Un id enchante (T6_METALBAR_LEVEL2@2) a sa propre entree ; sinon on retombe
//  sur l'id de base.
// ---------------------------------------------------------------------------
const outNames = {};
let missingNames = 0;
for (const id of referencedItems) {
  const n = names[id] || names[id.split('@')[0]];
  if (n) outNames[id] = { fr: n['FR-FR'] || n['EN-US'] || id, en: n['EN-US'] || id };
  else { outNames[id] = { fr: id, en: id }; missingNames++; }
}

// ---------------------------------------------------------------------------
//  Economie
//  meta.json ne donne que le total « poster un ordre de vente » :
//    premium 6,5 % = 4 % de taxe + 2,5 % de frais d'ordre
//    sans     10,5 % = 8 % de taxe + 2,5 % de frais d'ordre
//  Vendre instantanement DANS un ordre d'achat existant (le mode normal du
//  Black Market) ne paie pas les frais d'ordre. La distinction vaut 2,5 points
//  de marge, elle est decisive pour comparer les debouches.
// ---------------------------------------------------------------------------
const FRAIS_ORDRE = 0.025;
const economy = {
  ordrePremium: meta.economy.taxPremium,
  ordreFree: meta.economy.taxFree,
  instantPremium: +(meta.economy.taxPremium - FRAIS_ORDRE).toFixed(4),
  instantFree: +(meta.economy.taxFree - FRAIS_ORDRE).toFixed(4),
  fraisOrdre: FRAIS_ORDRE,
  retourBase: meta.economy.defaultReturnRate,
};

// ---------------------------------------------------------------------------
//  Ecriture
// ---------------------------------------------------------------------------
const recipes = Object.values(includedRecipes);
const out = {
  version: meta.version,
  generatedAt: new Date().toISOString(),
  source: meta.source,
  economy,
  recipes,
  artefacts,
  names: outNames,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));

// ---------------------------------------------------------------------------
//  Rapport
// ---------------------------------------------------------------------------
const parCategorie = {};
for (const r of recipes) if (r.categorie) parCategorie[r.categorie] = (parCategorie[r.categorie] || 0) + 1;

console.log('--- Donnees generees ---');
console.log('Recettes affichables     :', nbCibles);
for (const [k, v] of Object.entries(parCategorie).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + (k + '                ').slice(0, 16), v);
}
console.log('Sous-recettes (chaine)   :', recipes.length - nbCibles);
console.log('Recettes totales         :', recipes.length);
console.log('Artefacts a la fonderie  :', Object.keys(artefacts).length);
console.log('Items nommes             :', Object.keys(outNames).length, '(' + missingNames + ' sans nom officiel)');
console.log('Taille du fichier        :', (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'Mo ->', OUT);
