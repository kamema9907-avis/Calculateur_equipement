/*
 * build-data.js
 * -----------------------------------------------------------------------------
 * Genere le fichier de donnees consomme par index.html.
 *
 * DEUX sources, aux roles desormais bien separes :
 *
 *   1. ../../donnees/base  (dumps du jeu, a jour)
 *      Les recettes, les categories de boutique, les noms, la nutrition de
 *      fabrication, les exclusions du retour de ressources, la fonderie.
 *
 *   2. ../../reference/data               (wiki officiel, aout 2026)
 *      Uniquement ce que le jeu ne publie pas : l'Item Power par qualite,
 *      les statistiques de combat, le recyclage des artefacts et la ville
 *      bonifiante de chaque categorie.
 *
 * MIGRATION DU 2026-09-20
 *   Ce script lisait la librairie sous sa forme Jaccak, source morte depuis
 *   novembre 2024, et completait ses manques avec le wiki. La librairie lit
 *   maintenant les fichiers du jeu, republies tous les 3 a 5 jours : elle est
 *   devenue la source la plus fraiche. Ont donc disparu l'import de recettes
 *   depuis le wiki, la deduction de station par sous-categorie et la
 *   reparation des noms francais abimes.
 *
 * Sortie : data/equipment-data.json
 *
 *   - recipes   : tout l'equipement (armes, armes secondaires, tete/poitrine/pieds
 *                 sur les 3 lignes, capes, equipement de recolte, sacs, outils)
 *                 PLUS la fermeture des sous-recettes, c'est-a-dire toute la chaine
 *                 de raffinage (lingot -> lingot du tier inferieur -> ... -> T2).
 *                 Chaque recette d'equipement porte sa `bonusCategorie`.
 *   - artefacts : voie « fabriquer l'artefact avec des runes » (fonderie d'artefacts).
 *   - names     : noms FR + EN de chaque item reference.
 *   - economy   : taux de taxes, separes ordre de vente / vente instantanee.
 *
 * Usage : node scripts/build-data.js
 * Aucune dependance npm (modules natifs uniquement).
 */

const fs = require('fs');
const path = require('path');

const LIB = path.resolve(__dirname, '..', '..', '..', 'donnees', 'base');
const WIKI = path.resolve(__dirname, '..', '..', '..', 'reference', 'data');
const OUT = path.resolve(__dirname, '..', 'data', 'equipment-data.json');

const load = rel => JSON.parse(fs.readFileSync(path.join(LIB, rel), 'utf8'));
const loadWiki = rel => JSON.parse(fs.readFileSync(path.join(WIKI, rel), 'utf8'));

console.log('Recettes  :', LIB);
console.log('Wiki      :', WIKI);

const lignes = load('recettes.json').recettes;
const items = load('items.json').items;
const noms = load('noms.json').items;
const meta = load('meta.json');

// Index des objets de la librairie : il porte les categories de boutique du
// jeu, que l'on allait chercher dans le wiki jusqu'ici.
const itemParId = {};
for (const o of items) itemParId[o.id] = o;

const tierDe = id => { const m = /^T(\d+)_/.exec(id); return m ? +m[1] : 0; };

// ---------------------------------------------------------------------------
//  Adaptation au format historique de ce script.
//  base/ groupe sous un meme identifiant les variantes d'une recette (le
//  raffinage en a deux, avec ou sans jeton de faction) ; la premiere est
//  exactement celle que fournissait l'ancienne source.
// ---------------------------------------------------------------------------
// La librairie distingue les cinq batiments de raffinage (fonderie, tannerie,
// tisserand, scierie, tailleur de pierre) la ou l'ancienne source les confondait
// sous « refinery ». Le moteur, lui, ne pose qu'une question : est-ce du
// raffinage ? (moteur.js teste station === 'refinery' pour choisir le taux de
// retour et l'intitule « raffiner »). On recolle donc les cinq ici. Le detail
// reste disponible dans base/ pour qui voudra un bonus de ville par batiment.
const RAFFINAGE = new Set(['smelter', 'tannery', 'weaver', 'lumbermill', 'stonemason']);

const allRecipes = lignes.map(l => {
  const r = l.recettes[0];
  return {
    id: l.id,
    station: RAFFINAGE.has(l.station) ? 'refinery' : l.station,
    tier: l.tier,
    enchantment: l.enchantement,
    quantity: r.quantiteProduite,
    // nutritionCraft est la nutrition CONSOMMEE par la fabrication, calculee
    // par la librairie comme valeur des ingredients x 0,001125 — la relation
    // que ce script avait deja verifiee sur 1 191 objets du wiki.
    nutrition: r.nutritionCraft || 0,
    excludeFromRRR: r.ingredients.filter(i => i.exclusDuRetour).map(i => i.id),
    ingredients: r.ingredients.map(i => ({
      id: i.id, tier: tierDe(i.id), enchantment: i.enchantement || 0, quantity: i.quantite,
    })),
  };
});

// ---------------------------------------------------------------------------
//  Fonderie d'artefacts, reconstituee depuis la librairie
//
//  L'ancienne source livrait un artefact_foundry.json tout fait. Les dumps du
//  jeu donnent mieux : la recette exacte de chaque artefact (50 unites de
//  T4_SOUL, par exemple). Il manque seulement la BRANCHE, car la fonderie tire
//  au hasard dans un bassin propre a Guerrier, Mage ou Chasseur.
//
//  Cette branche se deduit sans rien supposer : c'est la station de l'objet qui
//  consomme l'artefact. Verifie contre les 560 artefacts de l'ancien fichier,
//  560 branches retrouvees a l'identique. La derivation en couvre 760, soit
//  200 de plus, parce que le jeu a continue d'en ajouter depuis 2024.
// ---------------------------------------------------------------------------
const BRANCHE_PAR_STATION = {
  warriors_forge: 'warrior', mages_tower: 'mage', hunters_lodge: 'hunter',
};

const brancheParArtefact = {};
for (const r of allRecipes) {
  const branche = BRANCHE_PAR_STATION[r.station];
  if (!branche) continue;
  for (const i of r.ingredients) {
    if (i.id.includes('ARTEFACT')) brancheParArtefact[i.id] = branche;
  }
}

const foundry = { warrior: [], mage: [], hunter: [] };
{
  const groupes = {};
  for (const o of items) {
    if (o.categorieBoutique !== 'artefacts' || !o.recettes.length) continue;
    const ing = o.recettes[0].ingredients[0];
    const branche = brancheParArtefact[o.id];
    if (!ing || !branche) continue;              // artefact d'aucune recette du jeu
    const cle = branche + '|' + o.tier + '|' + ing.id + '|' + ing.quantite;
    const g = groupes[cle] || (groupes[cle] = {
      runeId: ing.id, runeQty: ing.quantite, tier: o.tier, artefacts: [],
    });
    g.artefacts.push(o.id);
    if (!foundry[branche].includes(g)) foundry[branche].push(g);
  }
}

const wikiItems = loadWiki('items.json');
const wikiNoms = loadWiki('noms_items.json');
const wikiVilles = loadWiki('city_bonuses.json');

// ---------------------------------------------------------------------------
//  Categorie de bonus de ville
//
//  Le jeu attribue le bonus de fabrication PIECE PAR PIECE et par arbre d'armes,
//  pas par atelier : les bottes de plaque sont bonifiees a Martlock, le plastron
//  a Bridgewatch et le casque a Fort Sterling. Il y a 32 categories.
//
//  On les resout ici, une fois, plutot qu'a l'affichage : la sous-categorie de
//  boutique du wiki est exactement cette granularite.
// ---------------------------------------------------------------------------
const SOUS_CATEGORIE = {
  arcanestaff: 'Arcane Staff', axe: 'Axe', bow: 'Bow', crossbow: 'Crossbow',
  cursestaff: 'Cursed Staff', dagger: 'Dagger', firestaff: 'Fire Staff',
  froststaff: 'Frost Staff', hammer: 'Hammer', holystaff: 'Holy Staff',
  knuckles: 'War Gloves', mace: 'Mace', naturestaff: 'Nature Staff',
  quarterstaff: 'Quarterstaff', shapeshifterstaff: 'Shapeshifter Staff',
  spear: 'Spear', sword: 'Sword',
  cloth_armor: 'Cloth Armor', leather_armor: 'Leather Armor', plate_armor: 'Plate Armor',
  cloth_helmet: 'Cloth Helmet', leather_helmet: 'Leather Helmet', plate_helmet: 'Plate Helmet',
  cloth_shoes: 'Cloth Shoes', leather_shoes: 'Leather Shoes', plate_shoes: 'Plate Shoes',
};

// Categories ou toute la famille partage une seule ville, quelle que soit la
// sous-categorie : les 4 types d'armes secondaires vont tous a Martlock, les
// 15 declinaisons de capes toutes a Brecilien.
const PAR_CATEGORIE = {
  offhands: 'Off-Hand', capes: 'Capes', bags: 'Bags', gathering: 'Gathering Gear',
};

function categorieBonus(id) {
  const base = id.split('@')[0];

  // Les outils passent AVANT la categorie de boutique. Le jeu les range sous
  // shopcategory="gathering", ce qui les ferait basculer vers « Gathering
  // Gear » alors que leur bonus de ville est celui des « Tools ». Les deux
  // pointent Caerleon, donc le calcul serait juste, mais l'etiquette servirait
  // a regrouper des pioches avec des sacs de recolte.
  if (base.includes('_TOOL_')) return 'Tools';

  // Les categories viennent desormais de la librairie et non du wiki : memes
  // valeurs, mais elles couvrent aussi les objets que le wiki n'a jamais vus.
  const it = itemParId[base];
  if (it) {
    const parCat = PAR_CATEGORIE[it.categorieBoutique];
    if (parCat) return parCat;
    const parSous = SOUS_CATEGORIE[it.sousCategorieBoutique];
    if (parSous) return parSous;
  }
  // Replis pour ce qui n'entre dans aucune categorie du jeu.
  if (base.includes('GATHERER')) return 'Gathering Gear';
  if (base.includes('COMBATSTAFF')) return 'Quarterstaff';
  if (/^T\d_BAG/.test(base)) return 'Bags';
  if (/^T\d_CAPE/.test(base)) return 'Capes';
  return null;
}

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
// FEY manquait : les 225 recettes Feerique etaient classees « commun », donc
// invisibles au filtre de lignee et affichees sans leur couleur.
// DRAGON ajoute a la migration du 2026-09-20 : l'armure en Peau de Dragon est
// une lignee complete de 15 artefacts (tete, poitrine, pieds x T4-T8) que
// l'ancienne source ne voyait qu'a moitie, et qui aurait eu le meme sort.
const LIGNEES_ARTEFACT = new Set(['UNDEAD', 'HELL', 'KEEPER', 'MORGANA', 'AVALON', 'CRYSTAL', 'ROYAL', 'FEY', 'DRAGON']);

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
// Une recette sans categorie de bonus recevrait silencieusement le taux de base :
// on prefere faire echouer la generation, quitte a ajouter un repli explicite.
const sansBonus = [];

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
    o.bonusCategorie = categorieBonus(r.id);
    if (!o.bonusCategorie) sansBonus.push(r.id);
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
//  Complement depuis le wiki
//
//  Les dumps Jaccak datent de juin 2026, le wiki d'aout : toute la ligne Royale
//  et une partie des artefacts Crystal manquent aux premiers. On les ajoute.
//
//  Le wiki ne publie AUCUN identifiant machine (ses recettes ne connaissent que
//  des noms anglais, materiaux compris), d'ou le passage systematique par
//  noms_items.json. C'est la regle numero 7 du socle de connaissances Albion.
// ---------------------------------------------------------------------------
const idParNomEn = {};        // nom anglais -> identifiant, variantes enchantees comprises
for (const x of wikiNoms) {
  if (!x.nom_en || !x.unique_name) continue;
  const l = idParNomEn[x.nom_en] || (idParNomEn[x.nom_en] = []);
  l.push(x.unique_name);
}
// Un nom d'objet rend sa base ET ses 4 variantes enchantees. La base est celle
// sans `@` ; pour un materiau enchante (« Uncommon Pine Planks »), le nom porte
// deja la qualite et ne rend qu'un seul identifiant.
function idDeNom(nom) {
  const l = idParNomEn[nom];
  if (!l) return null;
  const bases = l.filter(i => !i.includes('@'));
  if (bases.length === 1) return bases[0];
  if (bases.length === 0 && l.length === 1) return l[0];
  return null;   // ambigu : on prefere ne rien importer plutot que le mauvais objet
}

// ---------------------------------------------------------------------------
//  L IMPORT DEPUIS LE WIKI A ETE SUPPRIME (migration du 2026-09-20)
//
//  Il existait parce que les dumps Jaccak dataient de juin 2026 et ignoraient
//  toute la ligne Royale et une partie des artefacts Crystal, que le wiki
//  d aout connaissait. La librairie lit desormais les fichiers du jeu,
//  republies tous les 3 a 5 jours : elle est la source la plus fraiche des
//  deux et ce complement n a plus d objet.
//
//  Avec lui disparaissent la deduction de station par sous-categorie et la
//  resolution des materiaux par nom anglais, qui etaient deux approximations.
//  idDeNom() ci-dessus reste utilise par le recyclage des artefacts, ou la
//  jointure par nom anglais demeure la seule possible (materials.json ne
//  publie aucun identifiant machine).
// ---------------------------------------------------------------------------


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
// La reparation d'encodage a disparu avec la migration. L'ancienne source
// contenait 166 caracteres de remplacement U+FFFD (« ma<?>tre » pour
// « maitre ») qu'il fallait aller corriger dans le wiki. Les dumps du jeu sont
// en UTF-8 propre : verifie, zero caractere abime sur les 6 049 objets.
const outNames = {};
let missingNames = 0;
for (const id of referencedItems) {
  const n = noms[id] || noms[id.split('@')[0]];
  if (n) { outNames[id] = { fr: n.fr, en: n.en }; continue; }
  outNames[id] = { fr: id, en: id };
  missingNames++;
}

// ---------------------------------------------------------------------------
//  Fiche technique : Item Power et statistiques de combat
//
//  Sortie separee (data/fiches.json) : ces donnees ne servent qu'a l'onglet
//  Fiche, inutile de les charger avec le catalogue.
//
//  Les deux sources brutes pesent 8,9 Mo et vivent dans un AUTRE projet : ni
//  servables par Lancer.bat, ni deployables sur Pages. On les elague ici aux
//  seuls objets du catalogue.
//
//  Piege de jointure : dans item_variants.json, `unique_name` ne contient JAMAIS
//  de « @ » (verifie : 0 sur 34 122). La cle est le triplet
//  (base, enchantement, qualite), la qualite etant une CHAINE et non l'entier
//  1-5 de l'API. On indexe par [base][enchantement] = 5 valeurs, dans l'ordre
//  des qualites de l'API.
// ---------------------------------------------------------------------------
const ORDRE_QUALITES = ['Normal', 'Good', 'Outstanding', 'Excellent', 'Masterpiece'];

const basesCatalogue = new Set();
for (const r of Object.values(includedRecipes)) {
  if (r.categorie) basesCatalogue.add(r.id.split('@')[0]);
}

const variants = loadWiki('item_variants.json');
const ip = {};
for (const v of variants) {
  const base = v.unique_name;
  if (!base || !basesCatalogue.has(base)) continue;
  const q = ORDRE_QUALITES.indexOf(v.quality);
  if (q < 0) continue;
  const parEnch = ip[base] || (ip[base] = {});
  const ligne = parEnch[v.enchantment] || (parEnch[v.enchantment] = [null, null, null, null, null]);
  ligne[q] = v.item_power;
}

// Statistiques de combat. items.json est ENTIEREMENT en qualite Normale et en
// enchantement 0 : ces valeurs ne valent donc que pour l'objet de base. On ne
// les extrapole pas, ce serait inventer une donnee.
const CHAMPS_STATS = [
  'item_value', 'weight', 'equipment_slot', 'shop_category', 'shop_subcategory',
  'attack_damage', 'attack_speed', 'ability_power', 'armor', 'magical_resistance',
  'max_hit_points', 'max_energy', 'hit_points_regeneration_bonus',
  'energy_regeneration_bonus', 'cc_resistance', 'resilience_penetration',
];
const stats = {};
for (const it of wikiItems) {
  if (!it.unique_name || !basesCatalogue.has(it.unique_name)) continue;
  const o = {};
  for (const c of CHAMPS_STATS) {
    let v = it[c];
    // max_energy est stocke en CHAINE dans le wiki alors que ses voisins sont
    // numeriques : on normalise ici plutot que de pieger l'affichage.
    if (v != null && v !== '' && c !== 'equipment_slot' && c !== 'shop_category'
      && c !== 'shop_subcategory' && typeof v === 'string') {
      const n = parseFloat(v);
      v = isNaN(n) ? v : n;
    }
    if (v != null && v !== '') o[c] = v;
  }
  if (Object.keys(o).length) stats[it.unique_name] = o;
}

const OUT_FICHES = path.resolve(__dirname, '..', 'data', 'fiches.json');
fs.writeFileSync(OUT_FICHES, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'wiki Albion (item_variants.json + items.json)',
  ordreQualites: ORDRE_QUALITES,
  ip, stats,
}));

// ---------------------------------------------------------------------------
//  Artefacts : recyclage et bassins de fonte  (data/artefacts.json)
//
//  Trois choses que l'onglet Artefact doit savoir et que personne d'autre ne
//  porte :
//
//   1. CE QUE REND LE RECYCLAGE. materials.json (wiki) donne pour chaque
//      artefact le materiau rendu et le silver. `unique_name` y est nul PARTOUT
//      (712 entrees sur 712) : la seule cle de jointure est le nom anglais.
//
//   2. LE SILVER. Il ne depend pas de l'artefact mais du couple
//      (materiau, tier) — 25 valeurs. Recoupe : le wiki ecrit que recycler
//      « Adept's Runed Rock » rend 96 silver, et notre table donne bien 96 pour
//      (Rune, T4).
//
//   3. LES BASSINS DE FONTE. La fonderie ne vend pas la piece qu'on demande :
//      elle en TIRE une au hasard. 50 unites tirent dans une branche
//      (Guerrier / Mage / Chasseur, 9-10 pieces), 36 unites tirent dans les
//      trois reunies (28 pieces). On aplatit donc les 60 groupes du dump en
//      80 bassins : 5 tiers x 4 materiaux x (3 branches + « toutes »).
//
//  Seuls 25 materiaux sont NEGOCIABLES : T4..T8 x {RUNE, SOUL, RELIC,
//  SHARD_AVALONIAN, SHARD_CRYSTAL}. Les familles wiki « Fey » et « Crystal »
//  n'ont aucun item echangeable et un silver de 0 : leur recyclage n'est pas
//  chiffrable, ce qui doit s'afficher comme tel et jamais comme un zero.
// ---------------------------------------------------------------------------
const UNITES_RECYCLAGE = 10;   // releve en jeu par Vigile
const FONTE_BRANCHE = 50;
const FONTE_TOUTES = 36;

// ---------------------------------------------------------------------------
//  Le bareme de silver, releve en jeu apres la mise a jour de 2026.
//
//  Le wiki d'aout 2026 publie UN SEUL montant par (materiau, tier), et c'est
//  celui des armes a DEUX MAINS : rapport quasi constant entre l'ancienne
//  valeur et le nouveau x4 — 84/96 = 0,875 · 248/288 = 0,861 · 580/672 = 0,863
//  · 1244/1440 = 0,864. L'appliquer aux casques, bottes et secondaires les
//  surevaluait donc d'un facteur QUATRE, sur 195 artefacts du catalogue.
//
//     silver = base(materiau) x facteur(emplacement) x 2^(tier - 4)
//
//  Le facteur suit la valeur d'objet du jeu. Le x3 de l'arme a une main a ete
//  confronte au marche : un artefact ne pouvant pas se vendre durablement sous
//  le silver de son recyclage, on compte les impossibilites sur 420 artefacts
//  cotes hors Avalon — x2 en donne 1, x3 en donne 1, x4 en donne 4. Le x3 passe,
//  le x4 est refute. Mieux : la plus basse arme a une main rune se transige a
//  3,3 fois sa base, donc au-dessus de x3 et sous x4.
//
//  Controle de coherence du modele entier : la hallebarde de Morgane T4 (arme a
//  deux mains, 939 ventes par jour) se transige a 83 pour un plancher de 84.
// ---------------------------------------------------------------------------
const BAREME = {
  // Montant a T4 pour un emplacement de facteur 1.
  bases: { RUNE: 21, SOUL: 62, RELIC: 145, SHARD_AVALONIAN: 311 },
  // Emplacements sans valeur : releve non encore fait en jeu (cf. LISEZ-MOI).
  facteurs: { HEAD: 1, SHOES: 1, OFF: 1, ARMOR: 2, MAIN: 3, '2H': 4 },
  parTier: 2,
};

// L'emplacement se lit dans l'identifiant : c'est la seule source, et elle est
// exacte — les 725 artefacts se rangent sans reste dans ces six familles.
function emplacementDe(id) {
  if (id.includes('_2H_')) return '2H';
  if (id.includes('_MAIN_')) return 'MAIN';
  if (id.includes('_ARMOR_')) return 'ARMOR';
  if (id.includes('_OFF_')) return 'OFF';
  if (id.includes('_HEAD_')) return 'HEAD';
  if (id.includes('_SHOES_')) return 'SHOES';
  return null;
}

function silverDe(matiere, id, tier) {
  const base = BAREME.bases[(matiere || '').replace(/^T\d_/, '')];
  const f = BAREME.facteurs[emplacementDe(id)];
  if (base == null || f == null) return null;   // famille non relevee : on ne devine pas
  return base * f * Math.pow(BAREME.parTier, tier - 4);
}

const wikiMateriaux = loadWiki('materials.json');

// La jointure passe par `idDeNom()`, deja ecrit plus haut : il ecarte les
// variantes enchantees et refuse les noms ambigus plutot que de deviner. Un
// artefact n'existe qu'en niveau 0, il tombe donc toujours sur sa base.

const MATIERES_NEGOCIABLES = new Set();
for (const t of [4, 5, 6, 7, 8]) {
  for (const m of ['RUNE', 'SOUL', 'RELIC', 'SHARD_AVALONIAN', 'SHARD_CRYSTAL']) {
    MATIERES_NEGOCIABLES.add(`T${t}_${m}`);
  }
}

// `salvage_mat` compte SEPT racines, pas cinq : Rune, Ame, Relique, Eclat
// d'Avalon, Eclat de cristal, plus « Crystal » (15) et « Fey » (46) qui ne
// correspondent a aucun item echangeable.
//
// Les 15 « Crystal » sont exactement 3 pieces par tier — Arclight Blasters,
// Forgebark Staff, Flamewalker Staff — toutes de la lignee CRYSTAL, dont les
// 17 voisines du meme tier disent « Crystal Shard ». C'est une troncature du
// wiki, pas un materiau distinct : on les rattache aux eclats de cristal.
// Verification independante : leurs identifiants se terminent tous par
// _CRYSTAL, et aucun item « Adept's Crystal » n'existe dans les 11 218 noms.
const RACINE_TRONQUEE = /^(Adept|Expert|Master|Grandmaster|Elder)'s Crystal$/;
const idMateriauDeNom = (nom, idArt) => {
  if (RACINE_TRONQUEE.test(nom) && idArt.endsWith('_CRYSTAL')) {
    return `T${idArt.slice(1, 2)}_SHARD_CRYSTAL`;
  }
  return idDeNom(nom);
};

// Ce que le wiki sait du recyclage, indexe par identifiant d'artefact.
const recyclageParId = {};
for (const m of wikiMateriaux) {
  const idArt = idDeNom(m.nom_page);
  if (!idArt) continue;
  const idMat = idMateriauDeNom(m.salvage_mat, idArt);
  recyclageParId[idArt] = {
    matiere: idMat && MATIERES_NEGOCIABLES.has(idMat) ? idMat : null,
    matiereWiki: m.salvage_mat,
    silver: m.salvage_silver || 0,
    famille: m.artifact_family || null,
    // Le wiki donne « 12-13 » partout ; on garde la mention brute pour pouvoir
    // afficher l'ecart avec la valeur relevee en jeu, sans la trancher ici.
    qteWiki: m.salvage_mat_qty || null,
  };
}

// Quel objet chaque artefact fabrique. Nos recettes le disent mieux que le wiki :
// chaque artefact sert a EXACTEMENT 5 recettes, les 5 enchantements d'un meme
// objet de base. La relation est donc 1:1 avec l'objet, pas avec la recette.
const objetParArtefact = {};
for (const r of Object.values(includedRecipes)) {
  for (const i of r.ingredients) {
    if (!i.id.includes('ARTEFACT')) continue;
    const base = r.id.split('@')[0];
    (objetParArtefact[i.id] || (objetParArtefact[i.id] = new Set())).add(base);
  }
}

// Les 80 bassins de fonte.
const bassins = {};
const bassinParArtefact = {};
for (const branche of ['warrior', 'mage', 'hunter']) {
  for (const groupe of (foundry[branche] || [])) {
    for (const cle of [`${groupe.tier}|${groupe.runeId}|${branche}`,
                       `${groupe.tier}|${groupe.runeId}|toutes`]) {
      const b = bassins[cle] || (bassins[cle] = {
        tier: groupe.tier,
        matiere: groupe.runeId,
        branche: cle.endsWith('|toutes') ? 'toutes' : branche,
        cout: cle.endsWith('|toutes') ? FONTE_TOUTES : FONTE_BRANCHE,
        artefacts: [],
      });
      for (const a of groupe.artefacts) if (objetParArtefact[a]) b.artefacts.push(a);
    }
    for (const a of groupe.artefacts) {
      if (objetParArtefact[a]) bassinParArtefact[a] = `${groupe.tier}|${groupe.runeId}|${branche}`;
    }
  }
}
// Un bassin vide de tout artefact de notre perimetre n'a rien a dire.
for (const cle of Object.keys(bassins)) if (!bassins[cle].artefacts.length) delete bassins[cle];

const artefactsDetail = {};
let nbRecyclables = 0, nbNonChiffrables = 0, nbSansDonnees = 0;
for (const idArt of Object.keys(objetParArtefact)) {
  const objets = [...objetParArtefact[idArt]];
  const rec = recyclageParId[idArt] || null;
  const suffixe = idArt.split('_').pop();
  const tier = parseInt(idArt.slice(1, 2), 10);

  if (!rec) nbSansDonnees++;
  else if (rec.matiere) nbRecyclables++;
  else nbNonChiffrables++;

  const matiere = rec ? rec.matiere : null;
  const emplacement = emplacementDe(idArt);
  const silver = silverDe(matiere, idArt, tier);

  artefactsDetail[idArt] = {
    objet: objets[0],
    // Un artefact qui servirait a deux objets casserait la lecture « 1:1 » du
    // tableau : on le signale plutot que de choisir en silence.
    objetsMultiples: objets.length > 1 ? objets : undefined,
    tier,
    lignee: suffixe,
    emplacement,
    famille: rec ? rec.famille : null,
    matiere,
    matiereWiki: rec ? rec.matiereWiki : null,
    // Le bareme releve en jeu fait foi. La valeur du wiki est conservee a cote
    // pour que l'ecart reste verifiable, pas pour servir de repli : un repli
    // silencieux sur une donnee fausse est pire que pas de donnee du tout.
    silver,
    silverWiki: rec ? rec.silver : null,
    bassin: bassinParArtefact[idArt] || null,
  };
}

// Garde-fou. Un SEUIL de couverture serait le mauvais outil : la couverture est
// de 705/725 par construction et le restera, puisque les 20 manquants sont un
// contenu que ni le wiki d'aout 2026 ni le dump de juin ne connaissent. Un
// seuil ne distinguerait donc pas « toujours les memes 20 » d'un renommage
// cote wiki qui en casserait 20 autres. On nomme donc les absents attendus :
// tout ecart, dans un sens comme dans l'autre, arrete la generation.
const ABSENTS_ATTENDUS = new Set();
for (const t of [4, 5, 6, 7, 8]) {
  for (const l of ['MORGANA', 'HELL', 'KEEPER', 'AVALON']) {
    ABSENTS_ATTENDUS.add(`T${t}_ARTEFACT_2H_SHAPESHIFTER_${l}`);
  }
  // Armure en Peau de Dragon, apparue avec la migration vers les dumps du jeu.
  // Le wiki d'aout 2026 n'en connait aucun : ses 15 pieces sont absentes de
  // noms_items.json, donc la jointure par nom anglais ne peut pas aboutir.
  // materials.json en mentionne 5 sous « Dragon », sans identifiant machine.
  // A retirer d'ici quand une extraction plus recente du wiki les aura.
  for (const e of ['HEAD', 'ARMOR', 'SHOES']) {
    ABSENTS_ATTENDUS.add(`T${t}_ARTEFACT_${e}_LEATHER_DRAGON`);
  }
}
const totalArtefacts = Object.keys(artefactsDetail).length;
const absents = Object.keys(artefactsDetail).filter(id => !recyclageParId[id]);
const inattendus = absents.filter(id => !ABSENTS_ATTENDUS.has(id));
const reapparus = [...ABSENTS_ATTENDUS].filter(id => artefactsDetail[id] && recyclageParId[id]);
if (inattendus.length) {
  console.error(`ECHEC : ${inattendus.length} artefacts sans donnees de recyclage en dehors des ` +
                `metamorphes connus. La jointure par nom anglais est cassee.\n  ` +
                inattendus.slice(0, 10).join('\n  '));
  process.exit(1);
}
if (reapparus.length) {
  console.log(`Note : ${reapparus.length} metamorphes ont desormais des donnees wiki ` +
              `— retirer ABSENTS_ATTENDUS de build-data.js.`);
}

const OUT_ARTEFACTS = path.resolve(__dirname, '..', 'data', 'artefacts.json');
fs.writeFileSync(OUT_ARTEFACTS, JSON.stringify({
  generatedAt: new Date().toISOString(),
  source: 'barème relevé en jeu (2026) + fonderie dérivée de base/ (ao-bin-dumps)',
  unitesRecyclage: UNITES_RECYCLAGE,
  fonte: { branche: FONTE_BRANCHE, toutes: FONTE_TOUTES },
  bareme: BAREME,
  materiaux: [...MATIERES_NEGOCIABLES],
  artefacts: artefactsDetail,
  bassins,
}));

console.log(`Artefacts : ${totalArtefacts} au total — ${nbRecyclables} recyclables, ` +
            `${nbNonChiffrables} sans matiere negociable, ${nbSansDonnees} sans donnees, ` +
            `${Object.keys(bassins).length} bassins de fonte`);

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
// base/meta.json nomme ses champs en francais.
const eco = meta.economie;
const economy = {
  ordrePremium: eco.taxePremium,
  ordreFree: eco.taxeSansPremium,
  instantPremium: +(eco.taxePremium - FRAIS_ORDRE).toFixed(4),
  instantFree: +(eco.taxeSansPremium - FRAIS_ORDRE).toFixed(4),
  fraisOrdre: FRAIS_ORDRE,
  retourBase: eco.tauxRetourBase,
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

const affichables = recipes.filter(r => r.categorie).length;
const parVille = {};
for (const r of recipes) {
  if (!r.bonusCategorie) continue;
  const v = wikiVilles.bonus_craft_par_categorie[r.bonusCategorie] || '(aucune)';
  parVille[v] = (parVille[v] || 0) + 1;
}

console.log('--- Donnees generees ---');
console.log('Recettes affichables     :', affichables, '(toutes issues des dumps du jeu)');
for (const [k, v] of Object.entries(parCategorie).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + (k + '                ').slice(0, 16), v);
}
console.log('Sous-recettes (chaine)   :', recipes.length - affichables);
console.log('Recettes totales         :', recipes.length);
console.log('Artefacts a la fonderie  :', Object.keys(artefacts).length);
console.log('Items nommes             :', Object.keys(outNames).length, '(' + missingNames + ' sans nom officiel)');
console.log('Fiches techniques        :', Object.keys(ip).length, 'objets avec Item Power,',
  Object.keys(stats).length, 'avec statistiques ->',
  (fs.statSync(OUT_FICHES).size / 1024).toFixed(0), 'Ko');

console.log('--- Bonus de fabrication, par ville bonifiante ---');
for (const [v, n] of Object.entries(parVille).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + (v + '              ').slice(0, 15), n, 'recettes');
}


console.log('Taille du fichier        :', (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'Mo ->', OUT);

// Une recette d'equipement sans categorie de bonus prendrait le taux de base sans
// que rien ne le signale. On refuse de livrer un fichier dans cet etat.
if (sansBonus.length) {
  console.error('\nECHEC : ' + sansBonus.length + ' recettes sans categorie de bonus de ville.');
  console.error('Ajouter un repli dans categorieBonus(). Exemples :');
  sansBonus.slice(0, 10).forEach(id => console.error('   ' + id));
  process.exit(1);
}
