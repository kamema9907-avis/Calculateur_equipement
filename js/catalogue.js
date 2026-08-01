// ============================================================================
//  catalogue.js — vocabulaire de l'interface.
//
//  Tout ce qui est libelle affichable est ici, pas disperse dans les vues.
//
//  Choix assume : on ne traduit PAS les 85 familles d'armes du jeu a la main.
//  Le fichier de donnees porte deja le nom francais officiel de chaque objet,
//  extrait du jeu ; inventer une table de traduction en parallele reviendrait a
//  introduire une seconde verite, forcement moins fiable. Le filtrage fin passe
//  donc par la recherche textuelle sur le nom officiel.
// ============================================================================

export const TIERS = [1, 2, 3, 4, 5, 6, 7, 8];
export const ENCHANTEMENTS = [0, 1, 2, 3, 4];

// Les 5 qualites du jeu. L'API les numerote de 1 a 5.
export const QUALITES = [
  { q: 1, label: 'Normale',      court: 'Nml' },
  { q: 2, label: 'Bonne',        court: 'Bon' },
  { q: 3, label: 'Exceptionnelle', court: 'Exc' },
  { q: 4, label: 'Excellente',   court: 'Exl' },
  { q: 5, label: "Chef-d'œuvre", court: 'CdO' },
];

export const CATEGORIES = [
  { cle: 'arme',            label: 'Armes',              icone: '⚔️' },
  { cle: 'arme_secondaire', label: 'Armes secondaires',  icone: '🛡️' },
  { cle: 'tete',            label: 'Tête',               icone: '🪖' },
  { cle: 'poitrine',        label: 'Poitrine',           icone: '🥋' },
  { cle: 'pieds',           label: 'Pieds',              icone: '🥾' },
  { cle: 'cape',            label: 'Capes',              icone: '🧣' },
  { cle: 'recolte',         label: 'Équipement de récolte', icone: '⛏️' },
  { cle: 'sac',             label: 'Sacs',               icone: '🎒' },
  { cle: 'outil',           label: 'Outils',             icone: '🔨' },
];

export const LIGNES = [
  { cle: 'plaque', label: 'Plaque', couleur: '#b0b7c3' },
  { cle: 'cuir',   label: 'Cuir',   couleur: '#c99a5b' },
  { cle: 'tissu',  label: 'Tissu',  couleur: '#a98fd6' },
];

export const STATIONS = [
  { cle: 'warriors_forge', label: 'Forge des Guerriers' },
  { cle: 'mages_tower',    label: 'Tour des Mages' },
  { cle: 'hunters_lodge',  label: 'Loge des Chasseurs' },
  { cle: 'toolmaker',      label: "Fabricant d'Outils" },
];

// Lignees d'artefact. Les noms sont ceux des factions du jeu en francais.
export const LIGNEES = [
  { cle: 'commun',  label: 'Commun',      couleur: null },
  { cle: 'UNDEAD',  label: 'Mort-vivant', couleur: '#8fbf8f' },
  { cle: 'HELL',    label: 'Démon',       couleur: '#e08060' },
  { cle: 'KEEPER',  label: 'Gardien',     couleur: '#d8c070' },
  { cle: 'MORGANA', label: 'Morgane',     couleur: '#c07fc0' },
  { cle: 'AVALON',  label: 'Avalon',      couleur: '#7fb8e0' },
  { cle: 'CRYSTAL', label: 'Cristal',     couleur: '#9fe0e0' },
  { cle: 'ROYAL',   label: 'Royal',       couleur: '#e0b060' },
];

// ---------------------------------------------------------------------------
//  Debouches de vente. L'ordre compte : il sert de departage a marge egale, du
//  plus sur au plus incertain. Vendre dans un ordre d'achat existant est
//  immediat ; poster un ordre suppose qu'un acheteur passe.
// ---------------------------------------------------------------------------
export const CANAUX = [
  { cle: 'bm_instant',    label: 'Black Market (immédiat)', court: 'BM ⚡', instantane: true,  bm: true },
  { cle: 'ville_instant', label: 'Ville (immédiat)',        court: 'Ville ⚡', instantane: true,  bm: false },
  { cle: 'bm_ordre',      label: 'Black Market (ordre)',    court: 'BM 📋', instantane: false, bm: true },
  { cle: 'ville_ordre',   label: 'Ville (ordre de vente)',  court: 'Ville 📋', instantane: false, bm: false },
];

// ---------------------------------------------------------------------------
//  Helpers d'affichage
// ---------------------------------------------------------------------------
export const RENDU = (id, q = 1) =>
  `https://render.albiononline.com/v1/item/${encodeURIComponent(id)}.png?quality=${q}&size=64`;

const parLabel = (liste, cle) => (liste.find(x => x.cle === cle) || {}).label || cle;
export const labelCategorie = c => parLabel(CATEGORIES, c);
export const labelStation = s => parLabel(STATIONS, s);
export const labelLignee = l => parLabel(LIGNEES, l);
export const labelLigne = l => parLabel(LIGNES, l);
export const labelCanal = c => parLabel(CANAUX, c);
export const labelQualite = q => (QUALITES.find(x => x.q === q) || {}).label || ('Q' + q);

export const iconeCategorie = c => (CATEGORIES.find(x => x.cle === c) || {}).icone || '';
export const couleurLigne = l => (LIGNES.find(x => x.cle === l) || {}).couleur || null;
export const couleurLignee = l => (LIGNEES.find(x => x.cle === l) || {}).couleur || null;

// Formatage francais. `—` marque une donnee absente, jamais 0 : la difference
// entre « ca vaut zero » et « on ne sait pas » doit rester lisible.
export const fmt = v => v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('fr-FR');
export const fmtM = v => {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(2) + ' M';
  if (a >= 1e4) return (v / 1e3).toFixed(0) + ' k';
  return fmt(v);
};
export const fmtPct = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + ' %';
export const signe = v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + fmtM(v);

// Ancienneté d'un prix, en langage courant.
export function fmtAge(h) {
  if (h == null || !isFinite(h)) return 'jamais relevé';
  if (h < 1) return Math.round(h * 60) + ' min';
  if (h < 48) return Math.round(h) + ' h';
  return Math.round(h / 24) + ' j';
}
