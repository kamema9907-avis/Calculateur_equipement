// ============================================================================
//  artefacts.js — l'economie de l'artefact : acheter, recycler, fondre.
//
//  Trois operations, une seule etait modelisee jusqu'ici.
//
//   • ACHETER pour produire. Seule facon d'obtenir une piece PRECISE.
//   • RECYCLER pour recolter la matiere : l'artefact rend des unites de son
//     materiau PLUS un montant fixe de silver. Le silver compte : il abaisse le
//     cout de revient de la matiere, parfois de moitie.
//   • FONDRE. 50 unites tirent un artefact AU HASARD dans une branche, 36 dans
//     les trois reunies. Ce n'est pas un approvisionnement, c'est un pari sur un
//     panier, et il se juge en esperance.
//
//  ---------------------------------------------------------------------------
//  QUATRE PIEGES MESURES, qui ont dicte cette conception
//  ---------------------------------------------------------------------------
//
//  1. LE BLACK MARKET N'ACHETE NI ARTEFACTS NI MATIERES. Releve sur l'API :
//     1 artefact sur 725 et 1 materiau sur 25 y portent un ordre, avec la date
//     0001-01-01 qui signale un residu. L'objet FINI, lui, s'y vend tres bien
//     (297 027 pour T6_ARMOR_PLATE_KEEPER). Tout appel a debouchesDe() passe
//     donc ici par `inclureBM: false`.
//
//  2. LE CARNET D'ORDRES EST TROP CREUX POUR VALORISER UN ARTEFACT. 425 des 725
//     n'ont AUCUN ordre d'achat, mais 717 ont un historique de transactions.
//     Valoriser un tirage au carnet obligerait a choisir entre compter zero
//     (sous-estimation d'un facteur 5) et exclure (surestimation). On valorise
//     donc au prix REELLEMENT TRANSIGE, et le carnet ne sert plus qu'a dire ce
//     qu'on paie aujourd'hui.
//
//  3. RIEN NE PROTEGE LA JAMBE ACHAT. debouches.js est un module exclusivement
//     cote vente : son plafond `min(affiche, reel)`, `exigerHistorique` et
//     `volumeMin` n'existent que la. Or le danger s'INVERSE quand on achete :
//     a la vente le piege est un prix affiche trop haut, a l'achat c'est un
//     prix trop bas — une aubaine fantome, exactement le carburant d'un faux
//     verdict « recycler ». Mesure : 12 artefacts sur 524 se demandent sous la
//     moitie de leur prix transige.
//
//  4. VENDRE LA MATIERE ET S'EN SERVIR NE VALENT PAS PAREIL. Revendre paie une
//     taxe, utiliser n'en paie aucune. Les deux valeurs sont donc calculees
//     separement, et le cout de revient se compare au prix d'ACHAT du materiau
//     — jamais a son prix net de revente, ce qui melangerait deux conventions
//     et biaiserait de 4 a 9 points en faveur du recyclage.
// ============================================================================

import { debouchesDe } from './debouches.js';

// Le jeu ne publie pas ce nombre. Releve en jeu par Vigile ; le wiki annonce
// 12-13. Le marche donne raison a Vigile sur la borne basse : sur les groupes
// les plus liquides (Relique T6/T7, Rune T7/T8, Ame T6/T7/T8), le rendement
// implicite se serre entre 6,7 et 10,4, ce qui exige un rendu d'AU MOINS 10.
// Il n'exclut pas 12-13 pour autant : d'ou le reglage.
export const UNITES_DEFAUT = 10;

export const MODES_ACHAT = [
  { cle: 'prudent',  label: 'Le plus prudent', aide: 'le plus haut des deux : ne suppose jamais une bonne affaire' },
  { cle: 'affiche',  label: 'Prix affiché',    aide: "l'ordre de vente le moins cher, achetable tout de suite" },
  { cle: 'transige', label: 'Prix transigé',   aide: 'la moyenne pondérée des ventes réellement conclues sur 7 jours' },
];

// Motifs de mise en doute. Comme MOTIFS dans debouches.js : « je ne sais pas »
// et « ca ne vaut pas le coup » n'appellent pas la meme action du joueur.
export const DOUTES = {
  rendementImpossible: 'le marché dit que cette donnée de recyclage est fausse',
  aubaineDouteuse:     'ordre très en dessous du prix réellement transigé',
  villeSansEchange:    "aucune transaction dans la ville où l'ordre est affiché",
  marcheTropEtroit:    'volume quotidien insuffisant',
  pasDeDonnees:        'recyclage inconnu pour cet artéfact',
  pasDeMatiere:        'aucun matériau échangeable à la sortie',
  silverInconnu:       'valeur de recyclage pas encore relevée en jeu',
};

// ---------------------------------------------------------------------------
//  Ce qui se transige vraiment.
//
//  `histo[id][lieu][1]` porte { vol, prixMoyen } par lieu, `vol` etant deja un
//  volume QUOTIDIEN (historique demande au pas de 24 h). Le volume s'additionne
//  sur les lieux, le prix se pondere par le volume : un lieu ou rien ne
//  s'echange ne doit pas peser sur la moyenne.
// ---------------------------------------------------------------------------
export function transige(histoItem, lieux) {
  let vol = 0, somme = 0;
  for (const lieu of lieux) {
    const h = ((histoItem || {})[lieu] || {})[1];
    if (!h || !(h.vol > 0) || !(h.prixMoyen > 0)) continue;
    vol += h.vol;
    somme += h.prixMoyen * h.vol;
  }
  return vol > 0 ? { prix: somme / vol, volJour: vol } : null;
}

const transigeLieu = (histoItem, lieu) => ((histoItem || {})[lieu] || {})[1] || null;

// ---------------------------------------------------------------------------
//  Prix d'achat retenu, et de quoi juger sa fiabilite.
//
//  Un prix manuel court-circuite tout : c'est ce que l'utilisateur a paye ou
//  compte payer, aucune statistique n'a a le contredire.
// ---------------------------------------------------------------------------
export function achat(id, ctx) {
  if (ctx.manuel && ctx.manuel[id] != null) {
    return { prix: ctx.manuel[id], lieu: 'manuel', manuel: true, affiche: null, transige: null, volJour: null, doute: null };
  }

  const hItem = (ctx.histo || {})[id];
  let affiche = null, lieu = null;
  for (const v of ctx.villesAchat) {
    const e = ((ctx.prix[id] || {})[v] || {})[1];
    if (!e || !(e.sell > 0)) continue;
    if (ctx.maxAgeH != null && e.ageH > ctx.maxAgeH) continue;
    if (affiche == null || e.sell < affiche) { affiche = e.sell; lieu = v; }
  }

  const t = transige(hItem, ctx.villesAchat);
  const reel = t ? t.prix : null;
  if (affiche == null && reel == null) return null;

  // Fiabilite de l'ordre le moins cher, jugee DANS SA VILLE : un ordre a
  // Caerleon ne se justifie pas par ce qui se transige a Lymhurst.
  const hLieu = lieu ? transigeLieu(hItem, lieu) : null;
  let doute = null;
  if (lieu && !hLieu) doute = DOUTES.villeSansEchange;
  else if (hLieu && ctx.volumeMinAchat > 0 && hLieu.vol < ctx.volumeMinAchat) doute = DOUTES.marcheTropEtroit;
  else if (hLieu && affiche < hLieu.prixMoyen * 0.5) doute = DOUTES.aubaineDouteuse;

  let prix;
  if (affiche == null) prix = reel;
  else if (reel == null) prix = affiche;
  else if (ctx.modeAchat === 'affiche') prix = affiche;
  else if (ctx.modeAchat === 'transige') prix = reel;
  else prix = Math.max(affiche, reel);         // prudent, par defaut

  return {
    prix, lieu, manuel: false,
    affiche, transige: reel,
    volJour: t ? t.volJour : null,
    volJourLieu: hLieu ? hLieu.vol : null,
    doute,
  };
}

// ---------------------------------------------------------------------------
//  Le prix BAS du marche : l'ordre de vente le moins cher, sans correction.
//
//  C'est la valeur a retenir pour la MATIERE recuperee, et le traitement est
//  volontairement l'oppose de celui de l'artefact. Sur l'artefact on achete, un
//  ordre anormalement bas GONFLERAIT le gain : on prend donc le prix prudent.
//  Sur la matiere on compare a ce qu'elle aurait coute, un ordre anormalement
//  bas REDUIT le gain du recyclage : le prix bas est donc le choix conservateur
//  des deux cotes. Deux regles opposees, une seule direction.
// ---------------------------------------------------------------------------
export function prixBas(id, ctx) {
  let bas = null, lieu = null;
  for (const v of ctx.villesAchat) {
    const e = ((ctx.prix[id] || {})[v] || {})[1];
    if (!e || !(e.sell > 0)) continue;
    if (ctx.maxAgeH != null && e.ageH > ctx.maxAgeH) continue;
    if (bas == null || e.sell < bas) { bas = e.sell; lieu = v; }
  }
  return bas == null ? null : { prix: bas, lieu };
}

// ---------------------------------------------------------------------------
//  Le rendu et le silver reellement retenus, surcharges comprises.
//
//  Le silver suit le bareme releve en jeu :
//     silver = base(materiau) x facteur(emplacement) x parTier^(tier - 4)
//  Le calcul est refait ici plutot que lu tel quel dans les donnees, pour que
//  modifier une base dans les Reglages se repercute sans regenerer le fichier.
// ---------------------------------------------------------------------------
export function racine(matiere) { return matiere ? matiere.replace(/^T\d_/, '') : null; }

export function silverDe(art, bareme) {
  if (!bareme || !art.emplacement) return null;
  const base = bareme.bases[racine(art.matiere)];
  const f = bareme.facteurs[art.emplacement];
  if (base == null || f == null) return null;
  return base * f * Math.pow(bareme.parTier || 2, art.tier - 4);
}

export function calibrage(art, ctx) {
  const r = racine(art.matiere);
  let unites = ctx.unites != null ? ctx.unites : UNITES_DEFAUT;
  if (ctx.unitesPar && ctx.unitesPar[r] != null) unites = ctx.unitesPar[r];

  let silver = silverDe(art, ctx.bareme);
  if (silver == null) silver = art.silver;          // valeur du fichier genere
  // Surcharge fine, du plus general au plus precis.
  for (const c of [r, r + '|' + art.tier, r + '|' + art.tier + '|' + art.emplacement]) {
    if (ctx.silverPar && ctx.silverPar[c] != null) silver = ctx.silverPar[c];
  }
  return { unites, silver };
}

// ---------------------------------------------------------------------------
//  Rendement implicite du marche.
//
//     R = (prix transige de l'artefact − silver) / prix transige du materiau
//
//  Si le marche arbitrait parfaitement, R vaudrait le rendu. En pratique R le
//  DEPASSE des que l'artefact vaut plus cher comme ingredient que comme
//  matiere premiere — c'est normal et frequent. Mais R ne peut pas etre
//  NEGATIF : cela voudrait dire que l'artefact se vend moins cher que le seul
//  silver qu'il rapporte, donc de l'argent gratuit qui persisterait des jours.
//
//  Releve du 11 aout 2026 : les groupes profonds se serrent entre 6,7 et 10,4
//  (Relique T6 : q1 7,9 / q3 12,4), mais l'Eclat d'Avalon T6 et T7 sort a 5,1
//  et 3,2 avec un PREMIER QUARTILE NEGATIF, et 19 artefacts s'y transigent sous
//  leur seul silver. Une des donnees de la famille Avalon est fausse — ou le
//  recyclage coute des frais de fonderie que le wiki ne mentionne pas. On ne
//  devine pas : on signale, et le verdict se met en doute tout seul.
// ---------------------------------------------------------------------------
export function rendementImplicite(art, ctx) {
  const { silver } = calibrage(art, ctx);
  const ta = transige((ctx.histo || {})[art.id], ctx.villesAchat);
  const tm = transige((ctx.histo || {})[art.matiere], ctx.villesAchat);
  if (!ta || !tm || !(tm.prix > 0)) return null;
  return (ta.prix - silver) / tm.prix;
}

// ---------------------------------------------------------------------------
//  Un groupe (materiau, tier) est douteux des qu'UN de ses artefacts affiche un
//  rendement implicite negatif. Le defaut porte sur la donnee du groupe — un
//  silver ou un rendu faux —, pas sur l'artefact qui le revele.
//
//  Memoise par contexte : la fonction est appelee une fois par bassin, et
//  chaque appel balaie les 725 artefacts.
// ---------------------------------------------------------------------------
export function groupeDouteux(matiere, catalogue, ctx) {
  if (!matiere) return false;
  const cle = matiere;
  const cache = ctx._groupes || (ctx._groupes = {});
  if (cache[cle] != null) return cache[cle];
  let douteux = false;
  for (const [id, art] of Object.entries(catalogue)) {
    if (art.matiere !== matiere) continue;
    const R = rendementImplicite({ ...art, id }, ctx);
    if (R != null && R < 0) { douteux = true; break; }
  }
  return (cache[cle] = douteux);
}

// ---------------------------------------------------------------------------
//  Recyclage d'un artefact. Deux lectures, et il faut les deux.
// ---------------------------------------------------------------------------
export function recyclage(art, ctx) {
  if (!art) return null;
  if (!art.matiere) return { doute: art.matiereWiki ? DOUTES.pasDeMatiere : DOUTES.pasDeDonnees };

  const { unites, silver } = calibrage(art, ctx);
  if (silver == null) return { doute: DOUTES.silverInconnu };

  const a = achat(art.id, ctx);
  if (!a) return null;

  // Le prix bas du marche : ce que la matiere aurait coute. Aucune taxe — on ne
  // vend rien, on evite un achat.
  const marche = prixBas(art.matiere, ctx);

  // ---- La formule de decision -------------------------------------------
  //   bilan = prix de l'artefact − silver rendu − (rendu × prix de la matiere)
  //   Negatif => bonne affaire. On expose l'oppose, pour que « plus grand »
  //   veuille dire « meilleur » partout ailleurs dans l'outil.
  const bilan = marche ? a.prix - silver - unites * marche.prix : null;
  const gain = bilan == null ? null : -bilan;

  // Second regard : si l'on revendait la matiere au lieu de s'en servir. Le
  // Black Market ne l'achete pas. Cette valeur EST taxee, l'autre non : les
  // confondre retirerait 4 a 6,5 % a une operation ou l'on n'a jamais vendu.
  const meilleur = debouchesDe(ctx.prix[art.matiere], (ctx.histo || {})[art.matiere], {
    villesVente: ctx.villesVente, qualite: 1, undercut: ctx.undercut,
    taxeOrdre: ctx.taxeOrdre, taxeInstant: ctx.taxeInstant,
    maxAgeH: ctx.maxAgeH, inclureBM: false,
  })[0] || null;
  const valeurRevente = meilleur ? unites * meilleur.net + silver : null;

  const coutMatiere = (a.prix - silver) / unites;
  const R = rendementImplicite(art, ctx);
  const doute = R != null && R < 0 ? DOUTES.rendementImpossible : a.doute;

  return {
    id: art.id, matiere: art.matiere, unites, silver, achat: a, doute,
    rendementImplicite: R,
    // La formule de Vigile, sans taxe : c'est elle qui decide.
    bilan, gain,
    marge: gain != null && a.prix > 0 ? gain / a.prix : null,
    coutMatiere,
    prixMarcheMatiere: marche ? marche.prix : null,
    lieuMatiere: marche ? marche.lieu : null,
    economieMatiere: marche ? marche.prix - coutMatiere : null,
    // Le second regard, taxe comprise.
    debouche: meilleur,
    valeurRevente,
    gainRevente: valeurRevente != null ? valeurRevente - a.prix : null,
  };
}

// ---------------------------------------------------------------------------
//  Revente seche : acheter l'artefact et le revendre sans rien en faire.
//
//  Ce n'est pas un remplissage. Releve du 11 aout :
//  T6_ARTEFACT_2H_DUALSCIMITAR_UNDEAD se demande 200 000 a Caerleon quand
//  Lymhurst en offre 240 243, avec 39 ventes par jour la-bas. C'est un
//  arbitrage entre VILLES, pas une anomalie de donnees — d'ou la mention du
//  trajet quand les deux villes different.
// ---------------------------------------------------------------------------
export function revente(art, ctx) {
  const a = achat(art.id, ctx);
  if (!a) return null;
  const meilleur = debouchesDe(ctx.prix[art.id], (ctx.histo || {})[art.id], {
    villesVente: ctx.villesVente, qualite: 1, undercut: ctx.undercut,
    taxeOrdre: ctx.taxeOrdre, taxeInstant: ctx.taxeInstant,
    maxAgeH: ctx.maxAgeH, inclureBM: false,
  })[0] || null;
  if (!meilleur) return null;
  return {
    debouche: meilleur,
    gain: meilleur.net - a.prix,
    marge: a.prix > 0 ? (meilleur.net - a.prix) / a.prix : null,
    trajet: a.lieu && a.lieu !== 'manuel' && a.lieu !== meilleur.lieu ? { de: a.lieu, vers: meilleur.lieu } : null,
  };
}

// ---------------------------------------------------------------------------
//  Esperance d'un bassin de fonte.
//
//  La moyenne seule ment. Sur le bassin Guerrier / T6 / Relique, l'esperance
//  vaut 3,1 fois la mediane parce qu'une seule piece porte tout, et le
//  coefficient de variation median des 60 bassins de branche est de 0,88 : il
//  faut environ 79 fontes pour que la moyenne observee approche l'esperance a
//  10 % pres. La mediane est ce qui ARRIVE, l'esperance ce qui arriverait a la
//  longue : on affiche les deux, mediane en tete.
//
//  Chaque tirage est valorise au prix TRANSIGE net de taxe — pas au carnet
//  d'ordres, trop creux (voir piege 2 en tete de fichier).
// ---------------------------------------------------------------------------
export function bassin(b, catalogue, ctx) {
  const coutU = prixBas(b.matiere, ctx);
  if (!coutU) return null;
  const cout = b.cout * coutU.prix;

  // Deuxieme source de matiere : la recycler soi-meme. C'est la pratique reelle
  // — on recycle des artefacts bon marche pour alimenter la fonderie, cinq
  // artefacts recycles faisant une fonte. Une fonte jugee perdante au prix du
  // marche peut devenir gagnante par cette voie.
  //
  // DEUX garde-fous, parce que la fonte MULTIPLIE PAR 50 l'erreur sur le cout
  // d'une unite :
  //
  //  • Le groupe (materiau, tier) doit etre propre. Le cout par recyclage vaut
  //    (prix − silver) / rendu : un silver SUREVALUE le fait paraitre bon
  //    marche. Or c'est exactement le defaut soupconne sur la famille Avalon.
  //    Sans cette regle, les bassins d'Avalon ressortaient en tete du
  //    classement — non parce qu'ils sont bons, mais parce que leur donnee est
  //    fausse. Le doute par artefact ne suffit pas : le defaut est une
  //    propriete du GROUPE.
  //  • La voie n'est proposee que si elle est effectivement moins chere que
  //    l'achat. Sinon ce n'est pas une option, c'est du bruit.
  let parRecyclage = null;
  if (!groupeDouteux(b.matiere, catalogue, ctx)) {
    for (const [id, art] of Object.entries(catalogue)) {
      if (art.matiere !== b.matiere) continue;
      const r = recyclage({ ...art, id }, ctx);
      if (!r || r.doute || !(r.coutMatiere > 0)) continue;
      if (r.coutMatiere >= coutU.prix) continue;
      if (!parRecyclage || r.coutMatiere < parRecyclage.coutU) {
        parRecyclage = { coutU: r.coutMatiere, via: id, cout: b.cout * r.coutMatiere };
      }
    }
  }

  const tirages = [];
  for (const id of b.artefacts) {
    const art = catalogue[id];
    if (!art) continue;
    const t = transige((ctx.histo || {})[id], ctx.villesVente);
    tirages.push({
      id,
      // Liquider un tirage, c'est vendre : la taxe s'applique. On retient la
      // vente immediate, la seule qui n'exige pas d'attendre un acheteur.
      valeur: t ? t.prix * (1 - ctx.taxeInstant) : null,
      volJour: t ? t.volJour : null,
    });
  }

  const valeurs = tirages.map(t => t.valeur).filter(v => v != null).sort((x, y) => x - y);
  const n = tirages.length;
  if (!valeurs.length) return { cout, parRecyclage, n, nLiquides: 0, tirages, esperance: null };

  // Les tirages sans prix comptent pour zero : le jeu nous les donnera quand
  // meme. Les ecarter gonflerait l'esperance de tout ce qu'on ne sait pas
  // vendre. Avec la valorisation au transige, ce cas est devenu rare (8 sur 725).
  const somme = valeurs.reduce((a, x) => a + x, 0);
  const esperance = somme / n;
  const m = valeurs.length;
  const mediane = m % 2 ? valeurs[(m - 1) / 2] : (valeurs[m / 2 - 1] + valeurs[m / 2]) / 2;
  const moyenne = somme / m;
  const ecartType = Math.sqrt(valeurs.reduce((a, x) => a + (x - moyenne) ** 2, 0) / m);

  return {
    cout, parRecyclage, n, nLiquides: m, tirages,
    esperance, mediane,
    meilleur: valeurs[m - 1],
    pire: valeurs[0],
    gain: esperance - cout,
    gainMedian: mediane - cout,
    // Le meme tirage, mais avec des runes recyclees plutot qu'achetees.
    gainMedianRecyclage: parRecyclage ? mediane - parRecyclage.cout : null,
    marge: cout > 0 ? (esperance - cout) / cout : null,
    // Combien de fontes avant que la moyenne observee veuille dire quelque
    // chose : (CV / 0,10)². En dessous de quelques dizaines, le pari est lisible.
    cv: moyenne > 0 ? ecartType / moyenne : null,
    fontesPourFiabilite: moyenne > 0 ? Math.ceil((ecartType / moyenne / 0.10) ** 2) : null,
    partMuette: (n - m) / n,
  };
}

// ---------------------------------------------------------------------------
//  Verdict : que faire de cet artefact ?
//
//  Cinq etats, pas quatre. « Rien » et « je ne sais pas » n'appellent pas la
//  meme action : le premier dit de passer son chemin, le second de verifier.
// ---------------------------------------------------------------------------
export function verdict({ rec, rev, fabrication }) {
  const options = [];
  // Le recyclage se juge sur la formule sans taxe : la matiere est gardee pour
  // refondre, elle n'est jamais vendue.
  if (rec && rec.gain != null && !rec.doute) {
    options.push({ voie: 'recycler', gain: rec.gain, marge: rec.marge });
  }
  if (rev) options.push({ voie: 'revendre', gain: rev.gain, marge: rev.marge });
  if (fabrication && fabrication.profit != null) {
    options.push({ voie: 'fabriquer', gain: fabrication.profit, marge: fabrication.marge, id: fabrication.id });
  }

  const positives = options.filter(o => o.gain > 0);
  if (positives.length) {
    const best = positives.reduce((a, b) => (b.gain > a.gain ? b : a));
    return { ...best, options };
  }
  // Aucune voie rentable : est-ce un constat, ou une ignorance ?
  if (rec && rec.doute) return { voie: 'doute', motif: rec.doute, gain: null, marge: null, options };
  return { voie: 'rien', gain: null, marge: null, options };
}

// ---------------------------------------------------------------------------
//  Ce qu'on peut REELLEMENT faire en une journee.
//
//  L'operation a DEUX jambes et elles n'ont pas le meme ordre de grandeur :
//  T6_RELIC s'echange 308 244 fois par jour quand l'artefact qui le rend
//  s'echange 50 fois. C'est presque toujours le carnet de l'ARTEFACT qui borne,
//  sauf sur les eclats de cristal T7/T8 (364 et 145 par jour) ou c'est la
//  matiere. On prend donc le minimum des deux, et on dit laquelle mord : sans
//  cela le classement met en tete les marches a deux pieces par jour.
// ---------------------------------------------------------------------------
export function realisable(gainUnitaire, { volArtefact, volMatiere, unites, partVolume }) {
  if (gainUnitaire == null) return null;
  const part = partVolume / 100;
  const parArtefact = volArtefact > 0 ? volArtefact * part : 0;
  const parMatiere = volMatiere > 0 && unites > 0 ? (volMatiere * part) / unites : Infinity;
  const qte = Math.min(parArtefact, parMatiere);
  if (!(qte > 0)) return null;
  return {
    qte,
    gain: gainUnitaire * qte,
    bride: parMatiere < parArtefact ? 'matiere' : 'artefact',
  };
}
