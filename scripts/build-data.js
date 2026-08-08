/*
 * build-data.js
 * -----------------------------------------------------------------------------
 * Genere le fichier de donnees consomme par index.html.
 *
 * DEUX sources, complementaires :
 *
 *   1. ../Albion_librairie_des_recettes_du_jeu/data  (dumps Jaccak, juin 2026)
 *      Les recettes, avec leurs identifiants machine et leur nutrition.
 *
 *   2. ../Albion_Analyse_site_web/data               (wiki officiel, aout 2026)
 *      La categorie de bonus de ville de chaque objet, et les objets que les
 *      dumps de juin n'avaient pas encore (ligne Royale, artefacts Crystal).
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

const LIB = path.resolve(__dirname, '..', '..', 'Albion_librairie_des_recettes_du_jeu', 'data');
const WIKI = path.resolve(__dirname, '..', '..', 'Albion_Analyse_site_web', 'data');
const OUT = path.resolve(__dirname, '..', 'data', 'equipment-data.json');

const load = rel => JSON.parse(fs.readFileSync(path.join(LIB, rel), 'utf8'));
const loadWiki = rel => JSON.parse(fs.readFileSync(path.join(WIKI, rel), 'utf8'));

console.log('Recettes  :', LIB);
console.log('Wiki      :', WIKI);

const allRecipes = load('all-recipes.json').recipes;
const names = load('names.json').items;
const meta = load('meta.json');
const foundry = load('recipes/artefact_foundry.json');

const wikiItems = loadWiki('items.json');
const wikiNoms = loadWiki('noms_items.json');
const wikiRecettes = loadWiki('recipes.json');
const wikiVilles = loadWiki('city_bonuses.json');

// Index du wiki par identifiant machine.
const wikiParId = {};
for (const it of wikiItems) if (it.unique_name) wikiParId[it.unique_name] = it;

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
  const it = wikiParId[base];
  if (it) {
    const parCat = PAR_CATEGORIE[it.shop_category];
    if (parCat) return parCat;
    const parSous = SOUS_CATEGORIE[it.shop_subcategory];
    if (parSous) return parSous;
  }
  // Replis, pour ce que l'extraction du wiki ne couvre pas. Chacun est verifie :
  // les outils de recolte et les batons de moine noir n'ont pas de fiche objet.
  if (base.includes('_TOOL_')) return 'Tools';
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

// La station n'est pas dans le wiki. On la deduit de ce que les recettes deja
// connues utilisent pour la meme sous-categorie : aucune supposition, juste une
// generalisation de ce que les dumps disent deja.
const stationParSousCat = {};
for (const { recette } of cibles) {
  const it = wikiParId[recette.id.split('@')[0]];
  if (it && it.shop_subcategory) stationParSousCat[it.shop_subcategory] = recette.station;
}

const dejaConnu = new Set(Object.keys(includedRecipes));
const importes = [];
const rejets = { nomAmbigu: [], materiauIrresolu: [], sansFiche: [], horsPerimetre: 0 };

for (const rw of wikiRecettes) {
  const base = idDeNom(rw.item);
  if (!base) { rejets.nomAmbigu.push(rw.item); continue; }
  const ench = rw.enchantement || 0;
  const id = ench > 0 ? `${base}@${ench}` : base;
  if (dejaConnu.has(id)) continue;

  const it = wikiParId[base];
  if (!it) { rejets.sansFiche.push(rw.item); continue; }
  // Montures et mobilier sortent du perimetre de ce calculateur.
  if (!PAR_CATEGORIE[it.shop_category] && !SOUS_CATEGORIE[it.shop_subcategory]) {
    rejets.horsPerimetre++; continue;
  }
  const bonus = categorieBonus(id);
  if (!bonus) { rejets.sansFiche.push(rw.item); continue; }

  const ing = [];
  let manque = null;
  for (const m of (rw.ingredients || [])) {
    const mid = idDeNom(m.materiau);
    if (!mid) { manque = m.materiau; break; }
    const mt = parseInt(mid.slice(1), 10) || 0;
    const me = (mid.match(/@(\d)/) || [, 0])[1];
    ing.push({ id: mid, tier: mt, enchantment: +me, quantity: m.quantite });
  }
  if (manque) { rejets.materiauIrresolu.push(rw.item + ' : ' + manque); continue; }
  if (!ing.length) continue;

  const slot = { Head: 'tete', Chest: 'poitrine', Shoes: 'pieds', Cape: 'cape', Bag: 'sac' };
  const categorie = it.shop_category === 'gathering' ? 'recolte'
    : it.shop_category === 'weapons' ? 'arme'
    : it.shop_category === 'offhands' ? 'arme_secondaire'
    : slot[it.equipment_slot] || 'arme';
  const ligne = (it.shop_subcategory || '').startsWith('plate_') ? 'plaque'
    : (it.shop_subcategory || '').startsWith('leather_') ? 'cuir'
    : (it.shop_subcategory || '').startsWith('cloth_') ? 'tissu' : null;
  const suffixe = base.split('@')[0].split('_').pop();

  const rec = {
    id,
    station: stationParSousCat[it.shop_subcategory] || 'warriors_forge',
    tier: it.tier || parseInt(base.slice(1), 10) || 0,
    enchantment: ench,
    quantity: 1,
    // La valeur d'objet du wiki redonne exactement la nutrition des dumps
    // (relation verifiee sur 1 191 objets) : nutrition = item_value x 0,1125 / 100.
    nutrition: (it.item_value || 0) * 0.001125 * Math.pow(2, ench),
    excludeFromRRR: ing.filter(i => i.id.includes('ARTEFACT')).map(i => i.id),
    ingredients: ing,
    categorie,
    famille: it.shop_subcategory,
    lignee: LIGNEES_ARTEFACT.has(suffixe) ? suffixe : 'commun',
    bonusCategorie: bonus,
    source: 'wiki',
  };
  if (ligne) rec.ligne = ligne;

  includedRecipes[id] = rec;
  dejaConnu.add(id);
  referencedItems.add(id);
  for (const i of ing) referencedItems.add(i.id);
  importes.push(id);
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
// Repli sur le wiki pour les objets que les dumps de juin ne connaissent pas
// encore : ce sont precisement ceux qu'on vient d'importer.
const nomsWikiParId = {};
for (const x of wikiNoms) if (x.unique_name) nomsWikiParId[x.unique_name] = x;

// Les dumps Jaccak contiennent 166 caracteres de remplacement U+FFFD, sequelles
// d'un decodage rate en amont (« ma<?>tre » pour « maitre »). Le wiki, lui, est
// propre. Quand le nom des dumps est abime, on prend celui du wiki.
const abime = s => typeof s === 'string' && s.includes('�');

const outNames = {};
let missingNames = 0, reparesEncodage = 0;
for (const id of referencedItems) {
  const n = names[id] || names[id.split('@')[0]];
  const w = nomsWikiParId[id] || nomsWikiParId[id.split('@')[0]];
  if (n) {
    let fr = n['FR-FR'] || n['EN-US'] || id;
    const en = n['EN-US'] || id;
    if (abime(fr)) {
      if (w && w.nom_fr && !abime(w.nom_fr)) { fr = w.nom_fr; reparesEncodage++; }
      else { fr = en; reparesEncodage++; }
    }
    outNames[id] = { fr, en };
    continue;
  }
  if (w) { outNames[id] = { fr: w.nom_fr || w.nom_en || id, en: w.nom_en || id }; continue; }
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

const affichables = recipes.filter(r => r.categorie).length;
const parVille = {};
for (const r of recipes) {
  if (!r.bonusCategorie) continue;
  const v = wikiVilles.bonus_craft_par_categorie[r.bonusCategorie] || '(aucune)';
  parVille[v] = (parVille[v] || 0) + 1;
}

console.log('--- Donnees generees ---');
console.log('Recettes affichables     :', affichables, '(' + nbCibles + ' des dumps + ' + importes.length + ' du wiki)');
for (const [k, v] of Object.entries(parCategorie).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + (k + '                ').slice(0, 16), v);
}
console.log('Sous-recettes (chaine)   :', recipes.length - affichables);
console.log('Recettes totales         :', recipes.length);
console.log('Artefacts a la fonderie  :', Object.keys(artefacts).length);
console.log('Items nommes             :', Object.keys(outNames).length, '(' + missingNames + ' sans nom officiel)');
if (reparesEncodage) console.log('   dont noms repares       :', reparesEncodage, '(caracteres abimes dans les dumps)');
console.log('Fiches techniques        :', Object.keys(ip).length, 'objets avec Item Power,',
  Object.keys(stats).length, 'avec statistiques ->',
  (fs.statSync(OUT_FICHES).size / 1024).toFixed(0), 'Ko');

console.log('--- Bonus de fabrication, par ville bonifiante ---');
for (const [v, n] of Object.entries(parVille).sort((a, b) => b[1] - a[1])) {
  console.log('   ' + (v + '              ').slice(0, 15), n, 'recettes');
}

console.log('--- Import wiki ---');
console.log('   importees              :', importes.length);
console.log('   hors perimetre         :', rejets.horsPerimetre, '(montures, mobilier)');
if (rejets.nomAmbigu.length) console.log('   nom non resolu         :', new Set(rejets.nomAmbigu).size, 'ex:', rejets.nomAmbigu[0]);
if (rejets.sansFiche.length) console.log('   sans fiche objet       :', new Set(rejets.sansFiche).size, 'ex:', rejets.sansFiche[0]);
if (rejets.materiauIrresolu.length) console.log('   materiau non resolu    :', new Set(rejets.materiauIrresolu).size, 'ex:', rejets.materiauIrresolu[0]);

console.log('Taille du fichier        :', (fs.statSync(OUT).size / 1024 / 1024).toFixed(2), 'Mo ->', OUT);

// Une recette d'equipement sans categorie de bonus prendrait le taux de base sans
// que rien ne le signale. On refuse de livrer un fichier dans cet etat.
if (sansBonus.length) {
  console.error('\nECHEC : ' + sansBonus.length + ' recettes sans categorie de bonus de ville.');
  console.error('Ajouter un repli dans categorieBonus(). Exemples :');
  sansBonus.slice(0, 10).forEach(id => console.error('   ' + id));
  process.exit(1);
}
