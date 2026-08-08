// ============================================================================
//  debouches.js — ou vendre, et a quel prix reellement encaisse.
//
//  Le calculateur Cuisine & Potions ne connaissait qu'un debouche : poster un
//  ordre de vente en ville. Pour l'equipement c'est le mauvais reflexe par
//  defaut. Releve en production sur une armure de plaque T6 : ordre de vente a
//  24 497 a Thetford, alors que le Black Market l'achete IMMEDIATEMENT a 32 864.
//
//  Quatre debouches, deux axes :
//   • ou   : une ville royale, ou le Black Market de Caerleon ;
//   • comment : poser un ordre de vente et attendre un acheteur (taxe 6,5 %,
//     frais d'ordre compris), ou vendre sur-le-champ dans un ordre d'achat deja
//     poste (taxe 4 %, pas de frais d'ordre).
//
//  Les frais d'ordre valent 2,5 points de marge. Les ignorer, comme le faisait
//  le calculateur cuisine en appliquant 6,5 % partout, sous-estime
//  systematiquement la vente immediate.
// ============================================================================

import { BLACK_MARKET } from './villes.js';

// Au-dela de ce rapport entre le prix affiche et le prix reellement transige,
// on considere que l'ordre est fantaisiste et on ne le croit plus.
const SEUIL_ABERRANT = 1.3;

export const MOTIFS = {
  coutInconnu:   'coût inconnu (un ingrédient sans prix)',
  aucunDebouche: 'aucun acheteur ni vendeur',
  prixPerime:    'prix trop ancien',
  pasHistorique: 'aucune transaction relevée',
  volumeFaible:  'volume quotidien insuffisant',
  nonRentable:   'non rentable',
};

// ---------------------------------------------------------------------------
//  Prix retenu pour une vente.
//
//  Regle heritee du planificateur cuisine, et encore plus necessaire ici : on ne
//  valorise JAMAIS au-dessus du prix auquel l'objet s'est reellement echange.
//  Un ordre isole a 440 fois le prix reel ne vaut pas 440 fois.
//
//  L'undercut ne s'applique qu'aux ordres de vente : pour vendre immediatement
//  dans un ordre d'achat, on encaisse le prix affiche, sans avoir a passer sous
//  qui que ce soit.
// ---------------------------------------------------------------------------
function prixRetenu(affiche, reel, { instantane, undercut }) {
  if (!(affiche > 0)) return null;
  const plafonne = reel > 0 ? Math.min(affiche, reel) : affiche;
  return instantane ? plafonne : plafonne * (1 - undercut);
}

// ---------------------------------------------------------------------------
//  Tous les debouches d'un objet, tries du meilleur revenu net au moins bon.
//
//  prixItem     = { lieu: { qualite: { sell, buy, ageH, ageAchatH } } }
//  histoItem    = { lieu: { qualite: { vol, prixMoyen } } }   (peut etre absent)
// ---------------------------------------------------------------------------
export function debouchesDe(prixItem, histoItem, opts) {
  const {
    villesVente, qualite = 1, undercut = 0.03,
    taxeOrdre, taxeInstant, maxAgeH = null, volumeMin = 0,
    exigerHistorique = false, inclureBM = true,
  } = opts;

  const out = [];
  // Le Black Market gagne la plupart du temps, et l'appelant ne retient souvent
  // que le meilleur debouche. Comparer des VILLES entre elles exige donc de
  // pouvoir l'ecarter : sinon toutes les lignes affichent le meme revenu, celui
  // du Black Market, et la comparaison ne compare plus rien.
  const lieux = inclureBM ? [...villesVente, BLACK_MARKET] : [...villesVente];

  for (const lieu of lieux) {
    const px = ((prixItem || {})[lieu] || {})[qualite];
    if (!px) continue;
    const h = ((histoItem || {})[lieu] || {})[qualite] || null;
    const bm = lieu === BLACK_MARKET;

    for (const instantane of [true, false]) {
      const affiche = instantane ? px.buy : px.sell;
      const age = instantane ? px.ageAchatH : px.ageH;
      if (!(affiche > 0)) continue;
      if (maxAgeH != null && age > maxAgeH) continue;

      // Un lieu SANS aucune transaction relevee est le cas le plus dangereux,
      // pas le plus anodin : la regle « ne jamais valoriser au-dessus du prix
      // reellement transige » n'a rien a quoi se comparer et laisserait passer
      // l'ordre tel quel. Releve en production : une armure Morgana T6 affichee
      // 622 222 a Caerleon, ou elle ne s'echange jamais, alors qu'elle se vend
      // 90 000 partout ailleurs et que le Black Market l'achete 102 483.
      // Des que l'historique est disponible, un lieu sans transaction n'est
      // donc pas un debouche.
      if (exigerHistorique && !h) continue;
      if (h && volumeMin > 0 && h.vol < volumeMin) continue;

      const reel = h ? h.prixMoyen : 0;
      const brut = prixRetenu(affiche, reel, { instantane, undercut });
      if (brut == null) continue;

      const taxe = instantane ? taxeInstant : taxeOrdre;
      out.push({
        canal: (bm ? 'bm' : 'ville') + '_' + (instantane ? 'instant' : 'ordre'),
        lieu, instantane, bm, qualite,
        prixAffiche: affiche,
        prixReel: h ? h.prixMoyen : null,
        prixRetenu: brut,
        net: brut * (1 - taxe),
        taxe,
        ageH: age,
        vol: h ? h.vol : null,
        // Rapport entre ce qui est demande et ce qui se transige vraiment.
        ratio: reel > 0 ? affiche / reel : null,
        aberrant: reel > 0 && affiche / reel > SEUIL_ABERRANT,
      });
    }
  }

  return out.sort((a, b) => b.net - a.net);
}

// ---------------------------------------------------------------------------
//  Revenu net attendu, pondere par la qualite de sortie.
//
//  Fabriquer de l'equipement ne produit pas que de la qualite Normale : selon la
//  specialisation, une part sort en Bonne, Exceptionnelle, etc. `parts` donne la
//  repartition ({ 1: 0.7, 2: 0.2, 3: 0.1 }). C'est un REGLAGE, pas une
//  prediction : le jeu ne publie pas ces taux.
//
//  Chaque qualite est vendue la ou elle rapporte le plus : on peut tres bien
//  ecouler le Normal au Black Market et le Bon en ville.
// ---------------------------------------------------------------------------
export function revenuPondere(prixItem, histoItem, opts) {
  const { parts } = opts;
  let net = 0, poidsUtile = 0;
  const parQualite = [];

  for (const [q, part] of Object.entries(parts)) {
    if (!(part > 0)) continue;
    const liste = debouchesDe(prixItem, histoItem, { ...opts, qualite: +q });
    const meilleur = liste[0] || null;
    parQualite.push({ qualite: +q, part, meilleur, nbDebouches: liste.length });
    if (meilleur) { net += meilleur.net * part; poidsUtile += part; }
  }

  // Si aucune qualite n'a de debouche, l'objet n'est pas vendable.
  if (poidsUtile <= 0) return null;

  // Les qualites sans acheteur sont ecartees du calcul plutot que comptees a
  // zero : sinon regler « 10 % de Chef-d'oeuvre » ferait chuter le revenu de
  // 10 % alors qu'en pratique on garde la piece ou on la vend ailleurs.
  return {
    net: net / poidsUtile,
    partCouverte: poidsUtile,
    parQualite,
    meilleur: parQualite.map(x => x.meilleur).filter(Boolean).sort((a, b) => b.net - a.net)[0] || null,
  };
}

// ---------------------------------------------------------------------------
//  Evaluation complete d'une recette : cout, meilleur debouche, marge.
//  Retourne soit une ligne exploitable, soit un motif de rejet.
// ---------------------------------------------------------------------------
export function evaluer(recette, coutU, prix, histo, opts) {
  if (coutU == null) return { rejet: MOTIFS.coutInconnu };

  const histoItem = histo && histo[recette.id];
  const rev = revenuPondere(prix[recette.id], histoItem, opts);
  if (!rev) {
    // Distinguer les trois raisons de n'avoir aucun debouche : elles appellent
    // des corrections differentes de la part de l'utilisateur.
    if (opts.exigerHistorique && !histoItem) return { rejet: MOTIFS.pasHistorique };
    if (opts.volumeMin > 0 && histoItem) return { rejet: MOTIFS.volumeFaible };
    return { rejet: opts.maxAgeH != null ? MOTIFS.prixPerime : MOTIFS.aucunDebouche };
  }

  // Le cout porte sur une unite produite ; certaines recettes en sortent
  // plusieurs, la quantite est deja prise en compte dans coutU.
  const profit = rev.net - coutU;
  if (profit <= 0) {
    return {
      rejet: MOTIFS.nonRentable,
      detail: rev.meilleur && rev.meilleur.aberrant
        ? 'prix affiché ' + rev.meilleur.ratio.toFixed(0) + '× le réel'
        : null,
    };
  }

  return {
    cout: coutU,
    revenu: rev.net,
    profit,
    marge: profit / coutU,
    partCouverte: rev.partCouverte,
    meilleur: rev.meilleur,
    parQualite: rev.parQualite,
  };
}
