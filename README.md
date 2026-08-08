# ⚒️ Albion — Calculateur d'équipement

Page web (Vue 3) pour répondre à une seule question : **qu'est-ce qui vaut la peine
d'être fabriqué en ce moment ?**

Couvre les **6 677 recettes** d'équipement du jeu : armes, armes secondaires, armures
tête / poitrine / pieds sur les trois lignes (plaque, cuir, tissu), capes, équipement
de récolte, sacs et outils.

Chaque ressource peut être **achetée** ou **raffinée soi-même**, et l'arbitrage se
repose à chaque étage : `T8_PLANKS = 5× T8_WOOD + 1× T7_PLANKS`, et ainsi de suite
jusqu'au T2. Les artefacts peuvent être achetés ou **fondus depuis des runes**.

Serveur de jeu : **Europe**. Prix : **albion-online-data**.

---

## 🚀 Lancer

Le navigateur bloque les modules ES et `fetch()` sur les fichiers ouverts en `file://`,
il faut donc un petit serveur HTTP (rien à installer, Python suffit) :

- **Windows** : double-clique sur **`Lancer.bat`** → ouvre http://localhost:8767
- **Manuel** : `python -m http.server 8767` puis http://localhost:8767/index.html

Le port 8767 est choisi pour ne pas entrer en conflit avec les autres projets Albion
(8765 et 8766 sont déjà pris). Si la page affiche le mauvais projet, c'est qu'un
serveur tourne déjà sur ce port : change le numéro dans `Lancer.bat`.

Aucun `npm`, aucun build : Vue 3 est chargé par CDN.

---

## 🌐 En ligne (GitHub Pages)

👉 **https://kamema9907-avis.github.io/Calculateur_equipement/**

Utilisable depuis n'importe quel appareil : PC, tablette, smartphone (l'interface
bascule en cartes sur petit écran). Sur mobile, *Ajouter à l'écran d'accueil* donne un
accès en un tap.

Les appels à l'API de prix fonctionnent depuis Pages (CORS autorisé, tout en HTTPS).

Pages sert la branche `main` à la racine. Le développement se fait sur la branche de
version en cours (`version-5`) ; pour publier une amélioration :

```
git checkout main
git merge version-5
git push
git checkout version-5
```

Le site se met à jour tout seul 30 à 60 secondes après le push.

### Clore une version et ouvrir la suivante

```
git tag -a version-5 -m "Version 5 — description"
git branch version-6 refs/heads/version-5
git checkout version-6
git push origin refs/tags/version-5:refs/tags/version-5
git push -u origin refs/heads/version-6:refs/heads/version-6
```

⚠️ Les refspecs complets (`refs/heads/…`, `refs/tags/…`) sont **nécessaires** : chaque
version porte une branche et un tag de même nom, et `git branch version-6 version-5`
échoue alors avec *ambiguous object name*, tout comme `git push origin version-5`
échoue avec *src refspec matches more than one*.

---

## 🧭 Comment s'en servir

L'outil fonctionne **en deux temps**, et c'est délibéré.

### 1. Le balayage

Charge les prix en qualité Normale sur tout le périmètre filtré. Rapide (quelques
dizaines de requêtes). Donne un premier classement par marge.

⚠️ **Les marges du balayage ne sont pas fiables**, et la page le dit. Le carnet
d'ordres ne publie que le prix *demandé* : n'importe qui peut poster n'importe quoi.

### 2. L'analyse fine

Sur les 200 meilleurs candidats seulement (réglable) : les **5 qualités** et
l'**historique des transactions réellement conclues**. Environ 15 requêtes au lieu de
plus de 300 si on le faisait sur tout le catalogue.

C'est là que le tri se fait. Mesuré sur un vrai balayage d'armures de poitrine T6-T8 :

| | balayage | après analyse fine |
|---|---|---|
| Opportunités | 40 | **14** |
| Meilleure marge annoncée | 597,5 % | **21,6 %** |

Sept des douze meilleures « occasions » du balayage étaient de la fiction. Le cas
d'école : une armure de tissu Morgana T6 affichée **622 222** à Caerleon, ville où
elle ne s'échange jamais, alors qu'elle se vend 90 000 partout ailleurs et que le
Black Market l'achète 102 483.

---

## 🎒 L'onglet « Ma banque »

Répond à une autre question que le reste de l'outil : non pas « quel objet a la
meilleure marge » mais **« j'ai ça en banque, qu'est-ce que j'en fais ? »**

Tu saisis ton stock, brut et raffiné, par niveau et par enchantement. Tout est
mémorisé. Le solveur sort un plan : quoi fabriquer, en quelle quantité, où le vendre,
ce qu'il reste à acheter, et ce qui dort encore en banque.

### Le stock est valorisé au prix de rachat du marché, pas à zéro

Posséder 500 barres n'est pas gratuit : tu pourrais les revendre. Les compter à zéro
ferait fondre des barres T8 en objets qui valent moins que les barres, sans le signaler.

Conséquence heureuse : **le coût d'un objet ne dépend pas de ce que tu possèdes**. La
banque ne change pas la valeur des choses, elle réduit le silver à sortir. Le moteur de
coût reste donc le même, et l'onglet n'ajoute qu'une couche d'allocation.

### Ce que le plan optimise

Avec un stock fini, la marge n'est plus le bon critère. Une hache à 40 % de marge
consomme 20 barres, un casque à 25 % n'en consomme que 8 : avec 1 000 barres tu fais
50 haches ou 125 casques, et c'est le profit **par barre** qui décide.

Sauf qu'il y a **deux ressources rares** — ta banque et ton silver — et qu'aucun ratio
unique ne sert les deux. Le solveur exécute donc les deux allocations et garde celle
qui rapporte le plus. Le plan indique laquelle a gagné.

### Quatre bornes sur chaque quantité

| Borne | Pourquoi |
|---|---|
| Ce que la banque permet | directement, ou après raffinage de ta matière brute |
| 10 % du volume quotidien, par marché | tu ne peux pas écouler plus que le marché n'absorbe |
| Silver disponible | couvre les achats **et les frais de station** |
| Focus disponible | budgété au raffinage, où le coût est connu |

### Les filtres agissent avant la résolution, pas sur l'affichage

Tu peux restreindre le plan par **ville de vente, niveau et enchantement**. Ces filtres
ne masquent pas des lignes : ils écartent les recettes **avant** que le solveur ne
travaille, si bien que ta banque et ton silver se reportent sur ce qui reste.

L'écart n'est pas théorique. Sur un stock T5-T7 avec un capital serré, passer de « tous
niveaux » à « T6 seul » fait monter la production T6 de **4 à 170 unités** : le capital
qui partait en T5 et T7 revient au T6. Un filtrage d'affichage aurait continué d'afficher
4, avec des totaux qui ne correspondaient plus aux lignes visibles.

Élargir un filtre après un calcul fait entrer des recettes jamais tarifées. La page le
signale plutôt que de les écarter en silence.

### Le garde-fou qui rend l'onglet utile

Une ligne qui ne prend **rien** dans ta banque en est écartée par défaut. Sans ce
filtre, le solveur dépense tout ton silver sur l'objet le plus rentable du jeu et laisse
ton stock intact : sur un test réel, il achetait 5 M de sceaux royaux pendant que 99 %
de la banque dormait. C'est le travail de l'onglet Tableau, pas de celui-ci. La case
« Seulement ce qui consomme ma banque » permet de relâcher la contrainte.

### Le focus

Budgété **au raffinage seulement**, où le coût est publié (164 points pour une barre T6,
×1,75 par tier et par enchantement, ×2 pour la pierre ; l'efficacité divise par deux
tous les 10 000 points). Le raffinage continue **sans focus** une fois la réserve
épuisée, à taux de base — comme en jeu.

Le coût en focus de la **fabrication** n'est publié nulle part. Le plan la calcule donc
sans focus, et le bénéfice annoncé est un **plancher**.

---

## 🔎 L'onglet « Fiche objet »

Tape un objet, obtiens tout ce qu'on peut en dire. Cinq requêtes, environ trois
secondes.

### Les 5 enchantements côte à côte

Coût, retour de ressources, revenu net, profit, marge, volume et meilleur débouché,
en colonnes. C'est l'information la plus rentable de la page : savoir que le .2 rapporte
trois fois le .0 change la décision immédiatement. L'arbre de coût détaillé s'affiche
pour la colonne sélectionnée.

### Où fabriquer, en deux lectures

Le piège : **la ville qui bonifie la fabrication d'un objet ne raffine ses matières que
dans 17 % des cas**. S'installer là veut donc presque toujours dire renoncer aux +40 du
raffinage. D'où deux colonnes distinctes :

- **Coût et Retour** mesurent le seul effet du bonus de la ville, achats autorisés
  partout. Part **structurelle**, stable, celle sur laquelle on décide de s'installer.
- **Marché local** montre ce qu'on gagnerait en n'achetant que sur place, et compte les
  matières sans ordre frais. Part **volatile**, qui bouge toutes les demi-heures.

Le revenu est séparé en **sur place** et **Black Market**, jamais leur maximum : ce sont
deux décisions logistiques différentes, et le Black Market donne le même prix depuis
n'importe où. Le **tarif de station est réglable ville par ville**, parce qu'il est fixé
par le propriétaire du bâtiment et que c'est une des raisons de s'installer quelque part.

⚠️ **Caerleon et Brécilien ne raffinent rien** et leurs lignes le signalent.

### Mes propres valeurs

Prix de chaque ingrédient, prix de vente, taux de retour (fabrication et raffinage
séparément), tarif de station par ville, quantité à produire.

Pour le prix de vente, **deux modes obligatoires** : « prix affiché » subit taxe, frais
d'ordre et undercut par-dessus ; « net encaissé » est ce que tu touches vraiment. Il y a
**9,5 points d'écart** entre les deux.

Un prix d'ingrédient saisi s'applique dans toutes les villes : la ligne correspondante du
tableau perd alors sa dimension géographique, et une pastille le signale.

### La quantité

Liste de courses complète, avec les quantités après retour de ressources.

⚠️ **Les frais de station se paient à chaque étage**, pas seulement au craft final. Sur
une hache T6, le total réel est de **1 925 silver contre 922** pour le seul assemblage :
la chaîne de raffinage double les frais. Les additionner à la main sous-estimait la
dépense, la page déduit donc les frais du coût total exact du moteur.

Deux avertissements s'allument : quand la quantité dépasse un jour du volume échangé, et
quand le raffinage demanderait plus que les 30 000 points de focus du jeu.

### La fiche technique

Item Power pour les 25 combinaisons enchantement × qualité, et caractéristiques de
combat. Le wiki ne publie ces dernières **qu'au niveau .0 en qualité Normale** : elles ne
sont donc pas extrapolées.

---

## 🧮 Comment fonctionne le calcul

### Coût d'un ingrédient

Le moins cher entre :

- **Acheter** — meilleur prix de vente parmi les villes cochées, la ville est affichée.
- **Raffiner** — récursivement, jusqu'à la matière brute. Utilise le taux de retour
  **du raffinage**, avec sa ville et son focus propres.
- **Fabriquer** — pour les sous-composants qui en sont.
- **Fondre des runes** — pour les artefacts : `runeQty × prix de la rune`.

Le produit fini, lui, est **toujours valorisé à son coût de fabrication**, jamais à son
prix d'achat : sinon on mesurerait la marge d'un revendeur, pas celle d'un artisan.

### Retour de ressources

```
RRR = B / (1 + B)
B   = 0,18 (base)  +  spécialité de ville  +  événement (0 / 0,10 / 0,20)  +  0,59 (focus)
```

**La spécialité de ville ne vaut pas la même chose selon l'activité** :

| | Bonus de spécialité |
|---|---|
| Raffinage | **+0,40** |
| Fabrication | **+0,15** |

Valeurs de référence :

| Situation | RRR |
|---|---|
| Base seule, n'importe où | 15,25 % |
| **Raffinage** en ville spécialisée | **36,71 %** |
| **Raffinage** en ville spécialisée + focus | **53,92 %** |
| **Fabrication** en ville spécialisée | **24,81 %** |
| **Fabrication** en ville spécialisée + focus | 47,92 % |

L'écart entre 40 et 15 est loin d'être un détail : il fait basculer l'arbitrage
acheter-vs-raffiner sur une grande partie du catalogue. Sur un test réel, le tissu
somptueux T6 passait de « acheter 3 546 contre raffiner 3 557 » à
« raffiner 2 861 », et la part des ingrédients raffinés soi-même monte à 34 %.

Raffinage et fabrication ont **chacun leur ville et leur focus**, réglables séparément.
Les artefacts sont exclus du retour (`excludeFromRRR`).

### Le raffinage, pas à pas

Raffiner n'est pas « transformer de la fibre en tissu ». Chaque tier consomme la
matière brute de son tier **plus le produit raffiné du tier inférieur** :

```
T6_CLOTH (Tissu somptueux) = 4× T6_FIBER (Coton feuille d'ambre) + 1× T5_CLOTH
T5_CLOTH (Tissu ouvragé)   = 3× T5_FIBER (Vanillier de Cayenne)  + 1× T4_CLOTH
T4_CLOTH (Tissu délicat)   = 2× T4_FIBER (Chanvre)               + 1× T3_CLOTH
T3_CLOTH (Tissu propre)    = 2× T3_FIBER (Lin)                   + 1× T2_CLOTH
T2_CLOTH (Morceau de tissu)= 1× T2_FIBER (Coton)
```

C'est pourquoi la question **acheter ou raffiner se repose à chaque étage** : le tissu
T5 qui entre dans le T6 peut lui-même être acheté ou raffiné.

Déroulé complet sur un relevé de prix réel (le tissu se raffine à Lymhurst, donc
`B = 0,18 + 0,40 = 0,58` et `1 − RRR = 63,29 %`) :

| Tier | Fibre | + tissu inférieur | Frais | **Raffiner** | Acheter | Retenu |
|---|---|---|---|---|---|---|
| T2 | 1×27×0,633 = 17,09 | — | 0 | 17,09 | **17** | acheter |
| T3 | 2×95×0,633 = 120,25 | 17×0,633 = 10,76 | 3,60 | **134,61** | 162 | raffiner |
| T4 | 2×131×0,633 = 165,82 | 134,61×0,633 = 85,20 | 7,20 | **258,22** | 325 | raffiner |
| T5 | 3×311×0,633 = 590,51 | 258,22×0,633 = 163,43 | 14,40 | **768,34** | 1 179 | raffiner |
| T6 | 4×904×0,633 = 2 288,61 | 768,34×0,633 = 486,29 | 28,80 | **2 803,70** | 3 558 | raffiner |

*Prix relevés à un instant donné, pas des constantes.* Regarde le T2 : 17,09 contre 17
à l'achat. L'arbitrage bascule sur quelques silver, et il se décide bien tier par tier
et non une fois pour toute la chaîne.

**Trois hypothèses de modélisation, confirmées par Vigile en jeu :**

1. **Le retour porte sur tous les intrants** — les 4 fibres *et* le tissu T5. Aucun
   n'est marqué comme exclu dans les fichiers du jeu.
2. **Les frais de station ne sont pas réduits par le retour.** Le retour rend de la
   matière, pas des frais : pour sortir N unités on fait N raffinages et on paie N
   fois. D'où `matières × 0,633` mais frais à plein tarif.
3. **La matière rendue est remise dans la production.** C'est ce qui autorise le
   facteur `1 − RRR` : engager Q donne `Q + Q·RRR + Q·RRR² + … = Q/(1−RRR)` unités au
   total, donc il faut `Q × (1 − RRR)` par unité produite, soit exactement `1/(1+B)`.
   Si l'on revendait les retours au lieu de les recycler, il faudrait les valoriser au
   prix de vente et l'écart des ordres rognerait le gain.

### Frais de station

**`frais = nutrition × tarif`**, où `nutrition` est un champ de chaque recette qui
porte la valeur d'objet exacte du jeu (facteur 0,1125 déjà appliqué, exprimée pour 100).

C'est exact, y compris pour les recettes à artefact dont la valeur d'objet ne suit pas
`2^tier`, et ça reproduit gratuitement la gratuité des stations sous T4 (`nutrition = 0`).
*Le calculateur Cuisine & Potions approximait ce poste par une somme de `2^tier − 2` ;
la formule ici est vérifiée sur 2 739 recettes.*

Le **tarif** reste à calibrer sur la station que tu utilises.

### Où vendre — quatre débouchés

| Débouché | Prix retenu | Taxe |
|---|---|---|
| Black Market, immédiat | son ordre d'achat | **4 %** |
| Ville, immédiat | l'ordre d'achat de la ville | **4 %** |
| Black Market, ordre de vente | son prix de vente − undercut | 6,5 % |
| Ville, ordre de vente | prix de vente − undercut | 6,5 % |

Vendre **dans un ordre d'achat déjà posté** ne paie pas les 2,5 % de frais de mise en
vente. Ces 2,5 points décident souvent du meilleur débouché, et le Black Market
n'accepte pratiquement que ce mode. L'undercut ne s'applique qu'aux ordres de vente :
pour vendre immédiatement, on n'a personne à sous-coter.

### Les trois garde-fous sur le prix de vente

1. **Jamais au-dessus du prix réellement transigé** : `min(affiché, moyenne pondérée
   par le volume sur 7 jours)`. Les lignes corrigées sont signalées.
2. **Un lieu sans aucune transaction n'est pas un débouché.** C'est le cas le plus
   dangereux, pas le plus anodin : sans transaction, la règle 1 n'a rien à quoi se
   comparer et laisserait passer l'ordre fantaisiste tel quel.
3. **Volume quotidien minimal** (3/jour par défaut). Une marge de 200 % sur un objet
   qui se vend une fois par semaine ne rapporte rien.

Les règles 2 et 3 ne s'activent qu'après l'analyse fine, faute d'historique avant.

### Qualités

Fabriquer ne produit pas que de la qualité Normale. Tu règles la répartition attendue
(Normale / Bonne / Exceptionnelle / Excellente / Chef-d'œuvre) et chaque qualité est
vendue là où elle rapporte le plus — on peut très bien écouler la Normale au Black
Market et la Bonne en ville.

Une qualité **sans acheteur est écartée du calcul**, pas comptée à zéro : sinon régler
« 10 % de Chef-d'œuvre » ferait chuter le revenu de 10 % alors qu'en pratique on garde
la pièce ou on la vend ailleurs.

---

## 🏙️ La table des bonus de ville

Table issue du wiki officiel, recoupée avec ce qui a été vérifié en jeu. Elle vit dans
[js/villes.js](js/villes.js), reste éditable depuis l'onglet Réglages, et tes
corrections sont mémorisées.

### Raffinage — les cinq ressources de base

| Transformation | Ville |
|---|---|
| Minerai → Lingot | Thetford |
| Fibre → Tissu | Lymhurst |
| Peau → Cuir | Martlock |
| Bois → Planches | Fort Sterling |
| Pierre → Blocs | Bridgewatch |

### Fabrication — pièce par pièce, pas par atelier

⚠️ **C'est le piège de cette mécanique.** Le bonus ne suit pas l'atelier qui produit
l'objet : les trois pièces d'une même armure dépendent de **trois villes différentes**.

| Ville | Ce qu'elle bonifie |
|---|---|
| **Martlock** | Haches · Bâtons de combat · Bâtons de glace · **Bottes de plaque** · Toutes les armes secondaires |
| **Bridgewatch** | Arbalètes · Dagues · Bâtons maudits · **Plastrons de plaque** · Chaussures de tissu |
| **Lymhurst** | Épées · Arcs · Bâtons arcaniques · Casques de cuir · Bottes de cuir |
| **Fort Sterling** | Marteaux · Lances · Bâtons sacrés · **Casques de plaque** · Robes de tissu |
| **Thetford** | Masses · Bâtons de la nature · Bâtons de feu · Vestes de cuir · Capuches de tissu |
| **Caerleon** | Gants de guerre · Bâtons métamorphes · Équipement de récolte · Outils |
| **Brécilien** | Capes · Sacs |

Deux conséquences pratiques :

- Les **armes secondaires** vont toutes à Martlock, qu'il s'agisse d'un bouclier de la
  Forge, d'un tome de la Tour des Mages ou d'une torche de la Loge.
- Une panoplie complète ne se fabrique **jamais** dans une seule ville au bonus maximum.

La catégorie de chaque recette est résolue une fois à la génération des données, par
jointure sur la fiche objet du wiki, et stockée dans le champ `bonusCategorie`. Le
générateur **échoue** si une recette n'en trouve pas : un objet sans catégorie
recevrait le taux de base sans que rien ne le signale.

---

## 📁 Structure

```
index.html               HTML, CSS et les trois vues
js/catalogue.js          Vocabulaire de l'interface, formatage FR
js/villes.js             Villes et table des bonus, éditable et persistée
js/moteur.js             Coût récursif : acheter / raffiner / fabriquer / fondre
js/marche.js             API prix et historique, cache IndexedDB
js/debouches.js          Les quatre canaux de vente, garde-fous, pondération qualité
js/inventaire.js         Le stock : saisie, persistance, focus, puisage
js/solveur.js            Allocation sous contraintes de l'onglet Ma banque
js/app.js                État, filtres, vues
data/equipment-data.json Données générées (3,4 Mo)
data/fiches.json         Item Power et caractéristiques (511 Ko)
scripts/build-data.js    Générateur depuis la librairie voisine
Lancer.bat               Lance serveur + navigateur (Windows)
.nojekyll                Désactive Jekyll sur GitHub Pages
```

Modules ES natifs, aucun build.

### Les trois vues

- **Repérage** — une grille tier × enchantement par catégorie, colorée par marge.
  Répond d'un coup d'œil à « quel créneau est rentable ». Clic sur une case → filtre
  le tableau. La rampe de couleur est à une seule teinte, validée pour l'écart de
  clarté entre marches et le contraste sur le panneau.
- **Tableau** — trié, avec le meilleur débouché de chaque objet. Affiche les 100
  premières lignes, extensible : on cherche les meilleures occasions, pas à parcourir
  6 000 lignes.
- **Détail** — panneau latéral : bilan, comparaison des quatre débouchés, revenu par
  qualité, et l'**arbre de coût** dépliable où chaque étage montre les voies possibles
  avec leur prix. Clique une voie pour la forcer. Un écart de moins de 5 % avec la voie
  suivante est signalé : le choix bascule au moindre mouvement de prix.

---

## 🔄 Régénérer les données après un patch

```
node scripts/build-data.js
```

**Deux sources, complémentaires :**

| Source | Ce qu'elle apporte |
|---|---|
| `../Albion_librairie_des_recettes_du_jeu` (dumps, juin 2026) | Les recettes, leurs identifiants machine et leur nutrition |
| `../Albion_Analyse_site_web` (wiki, août 2026) | La catégorie de bonus de ville, et les objets absents des dumps |

Les dumps de juin ne connaissaient ni la ligne **Royale** ni une partie des artefacts
**Crystal** : 575 recettes que le générateur va chercher dans le wiki et fusionne. Le
wiki ne publiant aucun identifiant machine, la résolution passe par `noms_items.json`.
Ces recettes portent `source: "wiki"` pour rester traçables.

Le rapport du générateur annonce la répartition par ville bonifiante, ce qui permet de
voir d'un coup d'œil qu'aucune ville n'est anormalement chargée.

---

## ⚠️ Limites assumées

- **Coût en focus** : dépend de ta spécialisation par recette, donnée absente des
  fichiers du jeu. Le focus est modélisé par son effet sur le retour de ressources,
  pas par sa consommation. Le pool de focus est fini, l'outil l'ignore.
- **Répartition des qualités** : les valeurs par défaut (68,9 / 25 / 5 / 1,1 / 0,1 %)
  sont le tirage de base à **1 jet, sans bonus**. Le focus et la nourriture de craft
  ajoutent des jets dont seul le meilleur compte : ta production réelle sort meilleure.
  C'est donc un plancher, et un réglage, pas une prédiction.
- **Valeur d'objet à T2** : traitée comme nulle, donc frais de station nuls sur
  16 objets. Le wiki leur donne une valeur, mais elle représente quelques silver sur
  des objets sans marché.
- **Artefacts avaloniens** : leur valeur d'objet diffère du wiki de 0,3 à 0,6 %
  (30 objets), ce qui ne bouge que les frais de station.
- **Capacité de craft** : la mécanique anti-monopole (un craft consomme 50 % de l'item
  value du bâtiment, régénération sur 24 h) n'est pas modélisée. Elle ne mord que sur
  de la production de masse, où il faut répartir sur plusieurs bâtiments.
- **Profondeur du carnet d'ordres** : l'API ne publie que le prix de la première
  unité. Acheter en masse fera glisser ton prix d'achat au-delà de ce qui est annoncé.
- **Frais et délais du Black Market** : non modélisés. Un ordre d'achat peut être
  consommé par quelqu'un d'autre avant toi.
- **Bonus de hideout et Power Cores** : non modélisés. En zone noire ils remplacent le
  bonus de ville (15 en raffinage, 1 à 26 en craft, jusqu'à +30 supplémentaires).
- **Journaux de laboureurs** : fabriquer remplit des journaux qui valent du silver.
  Ce revenu annexe n'est pas compté — il demanderait la renommée d'artisanat par
  recette, absente des données.
- **Le tableau « où fabriquer » ne chiffre pas le transport** : il compare les bonus,
  pas les trajets. Caerleon et Brécilien n'ont aucun bonus de raffinage.
- **250 produits n'ont pas d'Item Power** dans les données du wiki, et les
  caractéristiques de combat n'existent qu'au niveau .0 en qualité Normale.
- **Le forçage d'une voie n'agit qu'au premier étage** de l'arbre : forcer en profondeur
  change l'affichage du nœud sans changer le total du parent. L'arbre de la fiche est
  donc en lecture seule, le forçage restant dans le panneau de détail.
- **Transport et risque** entre villes : non chiffrés, à gérer par la sélection des
  villes. Le cas est courant dans la chaîne de raffinage : la fibre T6 la moins chère
  peut être à Bridgewatch alors que le raffinage bonifié se fait à Lymhurst. L'outil
  additionne les deux sans compter le trajet.
- **Concurrence** : albion-online-data est public. Les marchés liquides sont scrutés
  par beaucoup de joueurs avec exactement les mêmes chiffres.
