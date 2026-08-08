// ============================================================================
//  marche.js — donnees de marche (albion-online-data) et cache.
//
//  Descendant de market.js du calculateur Cuisine & Potions : meme gestion des
//  lots, meme backoff sur 429, meme lecture de l'age des prix. Quatre evolutions
//  imposees par la taille du catalogue d'equipement (~6 700 items contre 1 000).
//
//   1. IndexedDB au lieu de localStorage. Le quota de 5 Mo de localStorage ne
//      tient pas pour 6 700 items x 8 lieux x 5 qualites.
//   2. Lots de 50 ids au lieu de 100 : les ids d'equipement montent a 34
//      caracteres (T8_ARTEFACT_2H_SHAPESHIFTER_AVALON), 100 ids feraient une
//      URL de pres de 4 000 caracteres.
//   3. Le Black Market est un lieu comme un autre pour l'API, et `buy_price_max`
//      y est la donnee principale : c'est le prix auquel on VEND immediatement.
//      Le calculateur cuisine collectait ce champ sans jamais s'en servir.
//   4. Chargement en deux temps (voir plus bas).
//
//  Deux endpoints qui ne disent PAS la meme chose :
//   • /prices  -> le carnet d'ordres actuel. `sell_price_min` est le prix
//     DEMANDE le plus bas : un joueur isole peut y poster n'importe quoi.
//   • /history -> les transactions reellement conclues. C'est le juge de paix.
// ============================================================================

const BASE = 'https://europe.albion-online-data.com/api/v2/stats';

const TTL_PRIX = 30 * 60 * 1000;         // 30 min : le carnet d'ordres bouge vite
const TTL_HISTORIQUE = 6 * 60 * 60 * 1000; // 6 h : les volumes bougent lentement

// Taille des lots. L'historique renvoie une serie de points par item et par
// lieu : les reponses deviennent enormes bien avant que l'URL ne pose probleme.
const LOT_PRIX = 50;
const LOT_HISTORIQUE = 20;

// albion-online-data tolere 180 requetes/minute. Trois requetes en vol et une
// pause de 200 ms entre les vagues nous laissent tres en dessous.
const PARALLELE = 3;
const PAUSE_MS = 200;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
//  Cache IndexedDB
// ---------------------------------------------------------------------------
const DB_NOM = 'albion-equipement';
const DB_STORE = 'cache';
let dbPromise = null;

function ouvrirDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOM, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE, { keyPath: 'cle' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch(() => null);   // navigateur en navigation privee : on se passe de cache
  return dbPromise;
}

async function lireCache(cle, ttl, signature) {
  try {
    const db = await ouvrirDB();
    if (!db) return null;
    const o = await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(cle);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (!o) return null;
    if (o.signature !== signature) return null;   // perimetre change : invalide
    if (Date.now() - o.t > ttl) return null;
    return o.data;
  } catch { return null; }
}

async function ecrireCache(cle, signature, data) {
  try {
    const db = await ouvrirDB();
    if (!db) return;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put({ cle, t: Date.now(), signature, data });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* quota : on se passe de cache, ce n'est pas bloquant */ }
}

export async function viderCache() {
  try {
    const db = await ouvrirDB();
    if (!db) return;
    await new Promise(resolve => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch { /* rien a faire */ }
}

export async function ageCache(cle) {
  try {
    const db = await ouvrirDB();
    if (!db) return null;
    const o = await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(cle);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return o ? Date.now() - o.t : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
//  Reseau
// ---------------------------------------------------------------------------
async function getJSON(url) {
  for (let essai = 0; essai < 3; essai++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      if (res.status === 429) { await sleep(2000 * (essai + 1)); continue; }
      throw new Error('HTTP ' + res.status);
    } catch (e) {
      if (essai === 2) throw e;
      await sleep(1000 * (essai + 1));
    }
  }
  return null;
}

async function enParallele(taches, n, onProgress) {
  const out = [];
  let faites = 0;
  for (let i = 0; i < taches.length; i += n) {
    const lot = taches.slice(i, i + n);
    // Une requete qui echoue apres ses 3 tentatives ne doit pas faire tomber
    // les 300 autres : on la compte comme vide et on continue.
    const res = await Promise.all(lot.map(t => t().catch(() => null)));
    out.push(...res);
    faites += lot.length;
    if (onProgress) onProgress(faites, taches.length);
    if (i + n < taches.length) await sleep(PAUSE_MS);
  }
  return out;
}

function lots(ids, taille) {
  const out = [];
  for (let i = 0; i < ids.length; i += taille) out.push(ids.slice(i, i + taille));
  return out;
}

// Age d'un relevé en heures. L'API renvoie une date a zero quand l'objet n'a
// jamais ete vu dans cette ville : `Infinity` la rend inutilisable par le filtre
// de fraicheur, ce qui est exactement le comportement voulu.
function ageEnHeures(date, maintenant) {
  if (!date || date[0] === '0') return Infinity;
  // Les horodatages sont en UTC et peuvent devancer l'horloge locale de quelques
  // minutes. Un age negatif ferait passer le prix pour infiniment frais dans un
  // sens et casserait les comparaisons dans l'autre : on le ramene a zero.
  return Math.max(0, (maintenant - new Date(date + 'Z').getTime()) / 3600e3);
}

// ---------------------------------------------------------------------------
//  Signature de cache
//
//  Elle doit distinguer DEUX APPELS QUI NE DEMANDENT PAS LA MEME CHOSE. Compter
//  les identifiants ne suffit pas : les 1 437 objets du catalogue se repartissent
//  sur 39 tailles de chaine seulement, et 99,9 % partagent la leur avec un autre
//  objet. Le plus gros groupe compte 95 objets — le bouclier tour Mort-vivant,
//  le bouclier Demon et le bouclier a pointes Morgane ont exactement la meme
//  taille de chaine.
//
//  Sans le condense ci-dessous, consulter l'un puis l'autre dans les 30 minutes
//  rendait les prix du PREMIER, sans aucun signe visible : cout de revient,
//  marge et debouches tous faux, et parfaitement credibles.
//
//  djb2 sur les identifiants tries. Ce n'est pas de la cryptographie, juste de
//  quoi separer deux listes differentes de meme longueur.
// ---------------------------------------------------------------------------
function condense(ids) {
  let h = 5381;
  const s = ids.slice().sort().join(',');
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ---------------------------------------------------------------------------
//  Prix du carnet d'ordres
//
//  Retourne { itemId: { lieu: { qualite: { sell, buy, ageVente, ageAchat } } } }
//
//  Chargement en deux temps, c'est ce qui rend les 5 qualites praticables :
//   • Balayage : qualites = [1] sur tout le perimetre. Les ressources, runes et
//     artefacts n'existent de toute facon qu'en qualite Normale.
//   • Analyse fine : les 5 qualites, mais seulement sur les meilleurs candidats.
// ---------------------------------------------------------------------------
export async function chargerPrix(ids, lieux, { qualites = [1], onProgress, forcer, cle = 'prix' } = {}) {
  const signature = [lieux.join(','), qualites.join(','), ids.length, condense(ids)].join('|');
  if (!forcer) {
    const cache = await lireCache(cle, TTL_PRIX, signature);
    if (cache) return { data: cache, depuisCache: true };
  }

  const loc = encodeURIComponent(lieux.join(','));
  const qual = qualites.join(',');
  const maintenant = Date.now();
  const out = {};

  const reponses = await enParallele(
    lots(ids, LOT_PRIX).map(lot => () =>
      getJSON(`${BASE}/prices/${lot.join(',')}?locations=${loc}&qualities=${qual}`)),
    PARALLELE, onProgress);

  for (const arr of reponses) {
    for (const row of arr || []) {
      const q = row.quality || 1;
      const e = {
        sell: row.sell_price_min || 0,
        buy: row.buy_price_max || 0,
        ageH: ageEnHeures(row.sell_price_min_date, maintenant),
        ageAchatH: ageEnHeures(row.buy_price_max_date, maintenant),
      };
      const parLieu = out[row.item_id] || (out[row.item_id] = {});
      const parQ = parLieu[row.city] || (parLieu[row.city] = {});
      const cur = parQ[q];
      // L'API renvoie parfois plusieurs lignes pour le meme couple : on garde
      // l'offre de vente la plus basse, et la meilleure offre d'achat.
      if (!cur) parQ[q] = e;
      else {
        if (e.sell > 0 && (cur.sell === 0 || e.sell < cur.sell)) { cur.sell = e.sell; cur.ageH = e.ageH; }
        if (e.buy > cur.buy) { cur.buy = e.buy; cur.ageAchatH = e.ageAchatH; }
      }
    }
  }

  await ecrireCache(cle, signature, out);
  return { data: out, depuisCache: false };
}

// ---------------------------------------------------------------------------
//  Historique des transactions
//
//  Retourne { itemId: { lieu: { qualite: { vol, prixMoyen } } } }
//   • vol       = volume moyen par jour sur la fenetre
//   • prixMoyen = prix moyen PONDERE PAR LE VOLUME sur cette fenetre.
//     La ponderation compte : une journee a 2 ventes ne doit pas peser autant
//     qu'une journee a 2 000 dans la moyenne.
// ---------------------------------------------------------------------------
export async function chargerHistorique(ids, lieux, { qualites = [1], jours = 7, onProgress, forcer, cle = 'historique' } = {}) {
  const signature = [lieux.join(','), qualites.join(','), ids.length, jours, condense(ids)].join('|');
  if (!forcer) {
    const cache = await lireCache(cle, TTL_HISTORIQUE, signature);
    if (cache) return { data: cache, depuisCache: true };
  }

  const loc = encodeURIComponent(lieux.join(','));
  const qual = qualites.join(',');
  const out = {};

  const reponses = await enParallele(
    lots(ids, LOT_HISTORIQUE).map(lot => () =>
      getJSON(`${BASE}/history/${lot.join(',')}?locations=${loc}&time-scale=24&qualities=${qual}`)),
    PARALLELE, onProgress);

  for (const arr of reponses) {
    for (const serie of arr || []) {
      const pts = (serie.data || []).slice(-jours);
      if (!pts.length) continue;
      const volTotal = pts.reduce((a, p) => a + p.item_count, 0);
      if (volTotal <= 0) continue;
      const q = serie.quality || 1;
      const parLieu = out[serie.item_id] || (out[serie.item_id] = {});
      const parQ = parLieu[serie.location] || (parLieu[serie.location] = {});
      parQ[q] = {
        vol: volTotal / pts.length,
        prixMoyen: pts.reduce((a, p) => a + p.avg_price * p.item_count, 0) / volTotal,
      };
    }
  }

  await ecrireCache(cle, signature, out);
  return { data: out, depuisCache: false };
}

// Nombre de requetes que couterait un chargement : sert a prevenir l'utilisateur
// AVANT de lancer une analyse de plusieurs minutes.
export const coutRequetes = {
  prix: n => Math.ceil(n / LOT_PRIX),
  historique: n => Math.ceil(n / LOT_HISTORIQUE),
  // ~0,35 s par vague de PARALLELE requetes, pause comprise.
  secondes: nbReq => Math.round(nbReq / PARALLELE * 0.55),
};
