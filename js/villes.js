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
//  Fabrication — quelle ville bonifie quel groupe d'objets.
//
//  Le jeu decoupe plus finement que la station : plusieurs groupes ne suivent
//  PAS l'atelier qui les produit. Les gants de guerre sortent a la Forge des
//  Guerriers mais portent le bonus de Caerleon ; les sacs sortent du Fabricant
//  d'Outils comme les capes et les outils, mais portent celui de Brecilien.
//  C'est pourquoi la cle passe par cleBonusFabrication() plutot que par un
//  simple `station|groupe` : les exceptions doivent primer sur la station.
//
//  Confirme par Vigile (2026-08-01) : gants de guerre, sacs, equipement de
//  recolte et outils. Le reste est encore suppose.
// ---------------------------------------------------------------------------
export const BONUS_FABRICATION_DEFAUT = {
  // --- confirme ---
  'gants_de_guerre':           { ville: 'Caerleon',    libelle: 'Gants de guerre (gantelets)',            verifie: true },
  'sacs':                      { ville: 'Brecilien',   libelle: 'Sacs',                                   verifie: true },
  'recolte':                   { ville: 'Caerleon',    libelle: 'Équipement de récolte (dont sacs à dos)', verifie: true },
  'outils':                    { ville: 'Caerleon',    libelle: 'Outils de récolte',                      verifie: true },
  // --- suppose, a verifier en jeu ---
  // Les capes partent SANS ville : Vigile ne les a pas mentionnees, et un bonus
  // invente gonflerait le profit en silence. Aucun bonus sous-estime, ce qui est
  // le bon sens de l'erreur.
  'capes':                     { ville: null,          libelle: 'Capes',                                  verifie: false },
  'warriors_forge|armure':     { ville: 'Bridgewatch', libelle: 'Armures de plaque',                      verifie: false },
  'warriors_forge|arme':       { ville: 'Bridgewatch', libelle: 'Armes de guerrier (hors gants)',         verifie: false },
  'warriors_forge|secondaire': { ville: 'Bridgewatch', libelle: 'Boucliers',                              verifie: false },
  'mages_tower|armure':        { ville: 'Thetford',    libelle: 'Armures de tissu',                       verifie: false },
  'mages_tower|arme':          { ville: 'Thetford',    libelle: 'Bâtons de mage',                         verifie: false },
  'mages_tower|secondaire':    { ville: 'Thetford',    libelle: 'Tomes, orbes, totems',                   verifie: false },
  'hunters_lodge|armure':      { ville: 'Lymhurst',    libelle: 'Armures de cuir',                        verifie: false },
  'hunters_lodge|arme':        { ville: 'Lymhurst',    libelle: 'Armes de chasseur',                      verifie: false },
  'hunters_lodge|secondaire':  { ville: 'Lymhurst',    libelle: 'Torches, cors, lampes',                  verifie: false },
};

// Groupe de bonus auquel appartient une recette, d'apres sa categorie.
// N'est plus consulte que pour les armes et armures des trois stations : les
// categories a exception sont interceptees avant par cleBonusFabrication().
export function groupeDe(categorie) {
  switch (categorie) {
    case 'tete': case 'poitrine': case 'pieds': return 'armure';
    case 'arme_secondaire': return 'secondaire';
    default: return 'arme';
  }
}

// Ligne de la table qui s'applique a une recette.
// L'ordre des regles est le coeur de la fonction : une exception connue prime
// toujours sur la station qui produit l'objet.
export function cleBonusFabrication(recette) {
  if (recette.famille === 'KNUCKLES') return 'gants_de_guerre';
  switch (recette.categorie) {
    case 'sac':     return 'sacs';
    case 'cape':    return 'capes';
    case 'recolte': return 'recolte';   // y compris les sacs a dos GATHERER
    case 'outil':   return 'outils';
  }
  return recette.station + '|' + groupeDe(recette.categorie);
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
// La version est dans la cle : les defauts ont change (baremes 40/15, cinq
// lignes de raffinage et quatre de fabrication desormais confirmees, groupes du
// Fabricant d'Outils eclates). Une sauvegarde de l'ancienne forme rendrait ces
// lignes a leur etat « a verifier » et masquerait la correction.
const CLE = 'albion.eq.villes.v2';

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
