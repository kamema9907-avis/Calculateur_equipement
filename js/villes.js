// ============================================================================
//  villes.js — villes, et table des bonus de retour de ressources.
//
//  Travailler dans la ville specialisee ajoute des points au bonus de
//  production, ce qui change beaucoup le cout final. Cette table n'existe dans
//  AUCUN des fichiers de donnees du jeu que nous extrayons : elle est ecrite
//  ici a la main.
//
//  D'ou le champ `verifie`. Tant qu'il vaut false, la page affiche l'entree en
//  orange avec la mention « a verifier en jeu ». Vigile corrige et confirme
//  chaque ligne depuis l'interface, et son choix est memorise. Aucun chiffre
//  suppose ne circule en silence dans le calcul.
// ============================================================================

export const VILLES = [
  'Bridgewatch', 'Caerleon', 'Fort Sterling', 'Lymhurst', 'Martlock', 'Thetford', 'Brecilien',
];

// Le Black Market est a Caerleon mais se comporte comme un lieu distinct pour
// l'API : il n'a que des ordres d'achat, poses par le jeu lui-meme.
export const BLACK_MARKET = 'Black Market';

export const TOUS_LIEUX = [...VILLES, BLACK_MARKET];

// Bonus de specialite, en points ajoutes au bonus de base de 18.
// Les deux baremes different, et c'est un ecart considerable : raffiner dans la
// bonne ville rend 36,7 % de la matiere, y fabriquer n'en rend que 24,8 %.
// Valeurs donnees et confirmees par Vigile (joueur), 2026-08-01.
export const POINTS_SPECIALITE_RAFFINAGE = 40;
export const POINTS_SPECIALITE_FABRICATION = 15;

// ---------------------------------------------------------------------------
//  Raffinage — quelle ville bonifie quelle transformation.
//  Les cles correspondent au suffixe de l'id de la ressource raffinee.
//  Les cinq associations sont confirmees par Vigile (2026-08-01).
// ---------------------------------------------------------------------------
export const BONUS_RAFFINAGE_DEFAUT = {
  METALBAR:   { ville: 'Thetford',      libelle: 'Minerai → Lingot',  verifie: true },
  CLOTH:      { ville: 'Lymhurst',      libelle: 'Fibre → Tissu',     verifie: true },
  LEATHER:    { ville: 'Martlock',      libelle: 'Peau → Cuir',       verifie: true },
  PLANKS:     { ville: 'Fort Sterling', libelle: 'Bois → Planches',   verifie: true },
  STONEBLOCK: { ville: 'Bridgewatch',   libelle: 'Pierre → Blocs',    verifie: true },
};

// ---------------------------------------------------------------------------
//  Fabrication — quelle ville bonifie quoi.
//
//  Le bonus s'applique PIECE PAR PIECE et par arbre d'armes, PAS par atelier.
//  Les trois pieces d'une meme armure dependent de trois villes differentes :
//  bottes de plaque a Martlock, plastron a Bridgewatch, casque a Fort Sterling.
//  Une table clavetee sur l'atelier est donc structurellement incapable de dire
//  la verite — c'etait l'erreur des premieres versions de ce fichier.
//
//  Les 30 categories ci-dessous viennent du wiki officiel
//  (Albion_Analyse_site_web/data/city_bonuses.json, extraction d'aout 2026), et
//  recoupent les quatre que Vigile avait confirmees en jeu : gants de guerre,
//  equipement de recolte et outils a Caerleon, sacs a Brecilien.
//
//  La categorie de chaque recette est calculee a la generation des donnees, dans
//  le champ `bonusCategorie` : voir scripts/build-data.js.
//
//  « Food » et « Potions » appartiennent aussi a la table du jeu (Caerleon et
//  Brecilien) mais ne sont pas dans ce calculateur : ils relevent du
//  calculateur Cuisine & Potions.
// ---------------------------------------------------------------------------
export const BONUS_FABRICATION_DEFAUT = {
  // --- Martlock ---
  'Axe':                { ville: 'Martlock',      libelle: 'Haches',                verifie: true },
  'Quarterstaff':       { ville: 'Martlock',      libelle: 'Bâtons de combat',      verifie: true },
  'Frost Staff':        { ville: 'Martlock',      libelle: 'Bâtons de glace',       verifie: true },
  'Plate Shoes':        { ville: 'Martlock',      libelle: 'Bottes de plaque',      verifie: true },
  'Off-Hand':           { ville: 'Martlock',      libelle: 'Armes secondaires',     verifie: true },
  // --- Bridgewatch ---
  'Crossbow':           { ville: 'Bridgewatch',   libelle: 'Arbalètes',             verifie: true },
  'Dagger':             { ville: 'Bridgewatch',   libelle: 'Dagues',                verifie: true },
  'Cursed Staff':       { ville: 'Bridgewatch',   libelle: 'Bâtons maudits',        verifie: true },
  'Plate Armor':        { ville: 'Bridgewatch',   libelle: 'Plastrons de plaque',   verifie: true },
  'Cloth Shoes':        { ville: 'Bridgewatch',   libelle: 'Chaussures de tissu',   verifie: true },
  // --- Lymhurst ---
  'Sword':              { ville: 'Lymhurst',      libelle: 'Épées',                 verifie: true },
  'Bow':                { ville: 'Lymhurst',      libelle: 'Arcs',                  verifie: true },
  'Arcane Staff':       { ville: 'Lymhurst',      libelle: 'Bâtons arcaniques',     verifie: true },
  'Leather Helmet':     { ville: 'Lymhurst',      libelle: 'Casques de cuir',       verifie: true },
  'Leather Shoes':      { ville: 'Lymhurst',      libelle: 'Bottes de cuir',        verifie: true },
  // --- Fort Sterling ---
  'Hammer':             { ville: 'Fort Sterling', libelle: 'Marteaux',              verifie: true },
  'Spear':              { ville: 'Fort Sterling', libelle: 'Lances',                verifie: true },
  'Holy Staff':         { ville: 'Fort Sterling', libelle: 'Bâtons sacrés',         verifie: true },
  'Plate Helmet':       { ville: 'Fort Sterling', libelle: 'Casques de plaque',     verifie: true },
  'Cloth Armor':        { ville: 'Fort Sterling', libelle: 'Robes de tissu',        verifie: true },
  // --- Thetford ---
  'Mace':               { ville: 'Thetford',      libelle: 'Masses',                verifie: true },
  'Nature Staff':       { ville: 'Thetford',      libelle: 'Bâtons de la nature',   verifie: true },
  'Fire Staff':         { ville: 'Thetford',      libelle: 'Bâtons de feu',         verifie: true },
  'Leather Armor':      { ville: 'Thetford',      libelle: 'Vestes de cuir',        verifie: true },
  'Cloth Helmet':       { ville: 'Thetford',      libelle: 'Capuches de tissu',     verifie: true },
  // --- Caerleon ---
  'War Gloves':         { ville: 'Caerleon',      libelle: 'Gants de guerre',       verifie: true },
  'Shapeshifter Staff': { ville: 'Caerleon',      libelle: 'Bâtons métamorphes',    verifie: true },
  'Gathering Gear':     { ville: 'Caerleon',      libelle: 'Équipement de récolte', verifie: true },
  'Tools':              { ville: 'Caerleon',      libelle: 'Outils de récolte',     verifie: true },
  // --- Brecilien ---
  'Capes':              { ville: 'Brecilien',     libelle: 'Capes',                 verifie: true },
  'Bags':               { ville: 'Brecilien',     libelle: 'Sacs',                  verifie: true },
};

// La categorie est resolue une fois pour toutes a la generation des donnees.
export function cleBonusFabrication(recette) {
  return recette.bonusCategorie || null;
}

// Type de raffinage d'un id de ressource raffinee, ou null si ce n'en est pas une.
// T6_METALBAR_LEVEL2@2 -> METALBAR
export function typeRaffinage(id) {
  const m = id.split('@')[0].match(/^T\d_(METALBAR|CLOTH|LEATHER|PLANKS|STONEBLOCK)(_LEVEL\d)?$/);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
//  Etat vivant de la table : les defauts, ecrases par ce que Vigile a corrige.
// ---------------------------------------------------------------------------
// La version est dans la cle. La v3 abandonne les groupes par atelier au profit
// des 30 categories du wiki : aucune ancienne cle n'existe plus, et une
// sauvegarde de l'ancienne forme ne pourrait que remettre des valeurs fausses.
const CLE = 'albion.eq.villes.v3';

export function chargerTable() {
  const table = {
    raffinage: structuredClone(BONUS_RAFFINAGE_DEFAUT),
    fabrication: structuredClone(BONUS_FABRICATION_DEFAUT),
  };
  try {
    const sauv = JSON.parse(localStorage.getItem(CLE) || 'null');
    if (sauv) {
      for (const section of ['raffinage', 'fabrication']) {
        for (const [k, v] of Object.entries(sauv[section] || {})) {
          // Le libelle vient toujours du code : si on renomme un groupe ici, la
          // sauvegarde ne doit pas ressusciter l'ancien nom.
          if (table[section][k]) Object.assign(table[section][k], { ville: v.ville, verifie: !!v.verifie });
        }
      }
    }
  } catch { /* sauvegarde corrompue : on garde les defauts */ }
  return table;
}

export function sauverTable(table) {
  try {
    const reduit = { raffinage: {}, fabrication: {} };
    for (const section of ['raffinage', 'fabrication']) {
      for (const [k, v] of Object.entries(table[section])) {
        reduit[section][k] = { ville: v.ville, verifie: v.verifie };
      }
    }
    localStorage.setItem(CLE, JSON.stringify(reduit));
  } catch { /* quota : tant pis, la table reprendra ses defauts */ }
}

// Nombre d'entrees encore non confirmees, pour l'avertissement en tete de page.
// Une entree SANS ville compte aussi : « je ne sais pas encore » est un reglage
// a faire, pas un dossier clos. Sinon la ligne des capes, laissee vide faute
// d'information, disparaitrait silencieusement du bandeau.
export function nbNonVerifiees(table) {
  return [...Object.values(table.raffinage), ...Object.values(table.fabrication)]
    .filter(e => !e.verifie).length;
}
