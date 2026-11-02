# Widgets Grist — organisme de formation du CHU de Rennes

Quatre widgets personnalisés pour le document de projection des ventes. Fichiers statiques,
sans dépendance ni build : on dépose le dossier sur une adresse en https et on colle les URL
dans Grist.

| Fichier | Ce qu'il fait |
|---|---|
| `index.html` | Page catalogue, qui affiche l'URL à coller pour chaque widget |
| `fiche.html` | Tout ce qui concerne une formation : définition, public, ressources, coût, projections, ventes intra, validation |
| `charge.html` | Les moyens à réunir, en trois volets : vivier d'intervenants, recrutement, occupation des salles |
| `pilotage.html` | La trajectoire commerciale pluriannuelle : recettes, résultat, hypothèses, scénarios, objectifs |
| `smartof.html` | La reprise du réalisé depuis l'API SmartOF, à la demande, sans CSV |
| `commun.css` | Jetons visuels et composants partagés |
| `commun.js` | Plomberie Grist, métadonnées de colonnes, éditeurs, écriture différée |
| `graphes.js` | Les graphiques du pilotage et de la charge, dessinés en SVG, sans bibliothèque |

Le partage entre les deux tableaux de bord suit une ligne simple : **le pilotage répond à
« combien allons-nous vendre ? », la charge répond à « avec quels moyens ? »**. Le recrutement
et les salles sont des moyens, donc ils sont dans la charge, à côté du vivier qui les produit.

## Mise en place

1. Déposer le dossier sur GitLab Pages, GitHub Pages ou votre serveur.
2. Dans le document Grist : **Ajouter → Page** (ou Widget) → **Personnalisé**, coller l'URL.
3. Régler sur **Accès complet au document**.

L'API Grist est chargée automatiquement depuis l'instance qui embarque le widget — déduite de
la page parente, avec `https://grist.numerique.gouv.fr` en repli. Rien à configurer, et rien à
changer si le document déménage d'instance.

Si quelque chose cloche, le widget n'affiche pas une page vide : il indique ce qui a échoué,
l'instance détectée, s'il est bien dans un cadre et si l'API a été chargée. C'est ce qu'il faut
lire en premier.

## Principes de construction

**Une seule source de vérité.** Aucune formule du document n'est réécrite en JavaScript.
Recettes, coûts, remplissage, interventions requises, besoin de recrutement : tout est lu
dans les colonnes formules. Les widgets affichent et saisissent, ils ne calculent pas. C'est
pour cela que les valeurs calculées arrivent *après* l'enregistrement et non pendant la
frappe — un délai assumé contre un risque de divergence écarté.

**Rien de ce que le document sait n'est redemandé.** Les segments visés viennent de la
formation, la catégorie tarifaire du segment quand `Segments_categories` n'en autorise
qu'une, les profils d'intervenants de `Intervenants_formation`, les choix des colonnes
`Choice` de leurs métadonnées.

**Ne jamais écrire une valeur du mauvais type.** Les éditeurs sont construits d'après le type
réel de chaque colonne, lu dans `_grist_Tables_column`. Si ces métadonnées ne sont pas
lisibles, la fiche passe en lecture seule plutôt que de risquer d'écrire du texte dans une
colonne de référence.

**Ne jamais remplacer une saisie sans le dire.** La reprise d'une année sur les suivantes
compte les valeurs qu'elle écraserait et demande confirmation en les nommant.

**Toute table écrite est relue.** La liste des tables à recharger après un enregistrement n'est
plus à la main de l'appelant : `appliquer` ajoute d'office celles que les actions touchent.
L'oublier redessinait l'écran depuis une copie périmée — la valeur partait bien dans le
document, mais la case réaffichait l'ancienne, et l'on croyait que rien ne s'enregistrait.

**Les listes se mettent à jour sur place.** Reconstruire le rail après chaque enregistrement
détruisait les boutons entre l'appui et le relâchement de la souris : le clic se perdait et la
formation ne changeait pas. Les éléments sont modifiés, jamais remplacés, tant que la liste
elle-même n'a pas changé.

**Chaque case a une clé d'écriture unique** — formation, année, segment, rôle. Deux cases de
même position partageant une clé, la seconde frappe annulait l'enregistrement de la première.
Ce qui attend encore part avant de quitter la fiche, de changer d'onglet ou de fermer la page.

**Le curseur ne saute pas.** Après enregistrement, seules les valeurs calculées sont
rafraîchies ; le champ en cours de frappe garde le curseur et son contenu. Dans le tableau des
objectifs, où l'écran entier se redessine, la valeur part à la sortie du champ et le curseur
est rendu à la case qu'on venait de quitter.

**Aucune bibliothèque externe.** Les graphiques sont du SVG écrit à la main : une dépendance
de moins à charger depuis le réseau du CHU, et rien qui puisse disparaître d'un CDN.

## Les graphiques

Cinq figures dans le pilotage, deux dans la charge :

| Figure | Où | Ce qu'elle montre |
|---|---|---|
| Recettes projetées par année | Pilotage | Les recettes en barres, l'objectif de l'année en trait pointillé sur la même échelle |
| Résultat sur coûts directs | Pilotage | Une barre par année, au-dessus ou au-dessous de la ligne de zéro |
| Recettes par domaine | Pilotage | La recette de chaque année décomposée par domaine, cinq teintes au plus |
| Ce qui est ferme, ce qui reste à vendre | Pilotage | La part contractée et la part encore à vendre, année par année |
| Fourchette basse et haute | Pilotage | La recette projetée entre hypothèse pessimiste et optimiste, le projeté marqué sur le trait |
| Intervenants à recruter | Charge | Le besoin de recrutement par année, empilé par profil |
| Jours de salle requis | Charge | Les jours requis par année, empilés par type de salle |

Les règles tenues, qui ne sont pas des questions de goût : jamais deux échelles sur un même
graphique ; une série garde sa couleur quand on filtre, les teintes sont attribuées dans un
ordre fixe et jamais recyclées ; au-delà de cinq domaines, les plus petits se regroupent en
« Autres » plutôt que de recevoir une sixième teinte indiscernable ; les cinq teintes ont été
vérifiées deux à deux pour les trois daltonismes et pour la vision normale, sur le fond clair
puis sur le fond sombre ; les valeurs sont écrites en couleur de texte, jamais en couleur de
série ; une légende apparaît dès qu'il y a deux séries et nomme chaque série avec son chiffre
de l'année pilotée, pour que l'identité ne repose jamais sur la seule couleur ; et chaque
figure est doublée d'un tableau « Les chiffres », qui se lit sans voir le dessin.

Le mode sombre n'est pas un simple inversement : chaque teinte y est reprise un cran plus loin
dans sa rampe, puis revérifiée sur le fond sombre. Les deux jeux sont dans `commun.css`.

## Les ventes au groupe

Une ligne de `Ventes_inter` facturée « Groupe / jour » porte un nombre de groupes. Pour que ces
groupes occupent des sièges, le document a besoin d'une taille de groupe : la colonne
`participants_par_groupe`, symétrique de `participants_par_session` sur `Ventes_intra`, et
d'une colonne `places` qui vaut `nb_groupes × participants_par_groupe` au groupe et `nb_places`
sinon. Le script `groupes_inter_grist.js` les crée et bascule tous les compteurs de places du
document sur `places`. Sans lui, un groupe compte zéro siège et le remplissage est faux.

Dans la fiche, une ligne au groupe affiche alors deux champs — `1 × 8` — et le second prend
l'effectif maximum de la formation quand on le laisse vide, comme le fait déjà l'intra.

La colonne `alerte` que le document calcule sur chaque ligne de vente est reprise sous la case
concernée et en toutes lettres dans le détail : catégorie tarifaire à choisir, tarif introuvable,
places et groupes saisis sur la même ligne.

## Les doublons

La grille des projections n'a qu'une case par année et par segment. Quand le document porte
deux lignes pour la même case, elle ne peut pas en montrer une au hasard : elle les additionne,
passe en lecture seule et le dit. Deux tableaux dépliables sous la grille — `Le détail des
lignes de session` et `Le détail des lignes de vente inter` — listent toutes les lignes de la
formation, année par année, et permettent de les modifier, d'en ajouter et d'en retirer. C'est
là que se corrige un doublon, et là que se voit une ligne portée par un segment que la
formation ne vise plus, invisible dans la grille.

Le marqueur « 2 lignes » de la grille est cliquable : il ouvre le tableau et s'y rend. Le
bouton « Retirer » demande confirmation, et l'écran garde sa place après l'opération.

## Supprimer une formation

En bas de la fiche. Le widget n'écrit pas en dur la liste de ce qui dépend d'une formation —
elle vieillirait : il interroge les métadonnées du document et retient toute colonne de type
`Ref:Formations` qui n'est pas une formule. Les colonnes calculées qui désignent une formation
sont donc ignorées, à juste titre, et une table liée que le widget ne charge même pas est
trouvée quand même.

L'inventaire compte les lignes table par table et les nomme avant de proposer quoi que ce soit.
La confirmation porte le total. Les lignes rattachées partent d'abord, la formation ensuite,
dans une seule opération : aucune référence ne reste pendante. `Ctrl + Z` dans Grist annule le
tout tant que la page n'a pas été rechargée.

## Rentabilité et point mort

Dans ce document, animation et support sont facturés **par session** : `cout_session` ne dépend
ni du nombre de sessions ni du nombre d'inscrits, et `Projections.cout` vaut
`nb_sessions × cout_session`. Le signe du résultat d'une formation ne change donc jamais avec le
volume — ouvrir des sessions multiplie le résultat d'une session, quel qu'en soit le signe. Il
n'existe pas de nombre de sessions à partir duquel une formation devient rentable.

Le seuil existe ailleurs : **en places vendues par session**.

```
places au point mort = coût d'une session ÷ prix d'une place
                     = effectif_max × tarif_plancher_jour ÷ prix_jour
```

La fiche l'affiche sous le coût de revient, avec une jauge graduée jusqu'au plus grand des
trois — capacité, point mort, moyenne vendue — pour qu'un point mort hors capacité ne paraisse
pas atteignable. Le prix de la place est celui réellement projeté quand des ventes existent,
sinon le tarif de référence du document ; la phrase dit lequel. Les écarts en euros se calculent
sur la moyenne réelle et non sur le seuil arrondi : ils retombent exactement sur le `resultat`
par session que calcule le document.

Le pilotage compte les formations qui couvrent leurs coûts directs et celles qui ne les couvrent
pas, sur l'année pilotée, et les classe en barres horizontales de part et d'autre de zéro.

## Le réalisé dans le pilotage

Une fois le réalisé rapatrié, il reste à le raccrocher : les lignes venues de SmartOF sont
plates et ne savent pas à quelle année ni à quelle formation elles appartiennent. Le script
`realise_smartof_grist.js` pose ce raccrochage, puis les totaux qui en découlent.

| Table | Ce que le script y ajoute |
|---|---|
| `SmartOF_sessions` | `annee` (d'après la date de début), `formation` (par la correspondance des produits), places vendues, vendu, facturé net, reste à facturer |
| `SmartOF_commanditaires`, `SmartOF_factures` | l'année et la formation de leur session ; le net HT après avoirs |
| `Annees` | sessions, places, vendu et facturé réalisés, reste à facturer, écart au projeté, taux de réalisation |
| `Formations` | les mêmes, pour l'année pilotée |

La date de début peut arriver en date Grist, en texte ISO ou en horodatage numérique selon la
façon dont la colonne a été créée : les trois sont acceptées, et une année hors de 1990–2100
est traitée comme absente plutôt que de polluer la table `Annees`.

### Le piège que cette section doit empêcher

Le projeté couvre l'année entière ; le réalisé ne couvre que ce que le widget a rapatrié.
Comparés tels quels, un import de trente jours face à une projection annuelle ressemble à un
effondrement commercial. La section **« Ce qui s'est vraiment vendu »** annonce donc, avant tout
chiffre, **la période réellement chargée** — nombre de sessions, première et dernière date.
Avant de lire un écart, faites une reprise « Tout, sans filtre de date ».

Deux autres silences sont rompus : les sessions dont l'année n'existe pas dans `Annees`, et
celles dont le produit n'est pas rapproché au catalogue, sont comptées et annoncées. Elles ne
figurent dans aucun total, et il vaut mieux le savoir.

### Le graphique

La hauteur de chaque barre est le **vendu**, décomposé en facturé et reste à facturer —
l'empilement est exact, puisque les deux s'additionnent. Le **projeté** n'est pas une troisième
part : il ne s'additionne à rien, c'est un repère en trait pointillé sur la même échelle, le
même idiome que l'objectif plus haut dans l'écran. Quand le repère et le total se croisent, le
total passe au-dessus du repère pour rester lisible.

## Reprendre le réalisé depuis SmartOF

Le prévisionnel vit dans Grist, le réalisé vit dans SmartOF. Les rapprocher demandait
d'exporter un CSV et de le réimporter à la main, à chaque fois. `smartof.html` va le chercher
directement, à la demande — pas de job nocturne, pas de serveur à tenir.

### Où vit la clé, et pourquoi là

Dans la table `Parametres` du document, sous les clés `smartof_base` et `smartof_cle`. **Jamais
dans le code du widget** : il est servi depuis un dépôt public, n'importe qui peut le lire. Dans
le document, la clé n'est lisible que par les personnes qui y ont déjà accès.

Ce n'est pas un coffre-fort, et c'est pourquoi **la clé doit être en lecture seule**. L'écran ne
fait que des `GET` sur SmartOF, il n'a jamais besoin de plus. Si cette exposition n'est pas
acceptable, il faut un relais sur un serveur que vous tenez — mais c'est un service à héberger
et à maintenir.

Côté Grist, rien à configurer : l'écran écrit par **votre propre session**, le même mécanisme
que la saisie d'une fiche. Aucune clé d'API Grist n'est nécessaire, et il ne peut rien écrire
que vous ne pourriez écrire à la main.

### Ce que l'API a appris

| Point | Valeur |
|---|---|
| Authentification | en-tête `Authorization: Bearer <clé>` |
| Format de clé | `smk_` + 43 caractères base64url |
| Chemins | `/v2/<collection>` — sans le `/v2`, une route héritée répond `400 Invalid token format` |
| Enveloppe | `{ data, pageInfo }` |
| Pagination | la réponse porte `pageInfo.nextCursor` et `pageInfo.hasMore` ; **le paramètre de requête ne s'appelle pas pareil** |
| Filtres | `filter[champ][op]=valeur` — **un paramètre inconnu est ignoré en silence** |

Les deux derniers points sont le même piège, et il a mordu deux fois.

Écrire `updatedAt[gte]=…` au lieu de `filter[updatedAt][gte]=…` renvoie bien `200`, mais sans
filtrer : chaque rafraîchissement rapatrierait toute la base sans le dire.

Et le nom du champ de curseur dans la **réponse** (`nextCursor`) n'est pas celui du paramètre
dans la **requête**. Passé tel quel, il devient un paramètre inconnu — donc ignoré — et l'API
renvoie éternellement la première page. Le widget découvre donc le bon nom : il redemande la
page suivante sous chaque nom plausible (`cursor`, `after`, `startAfter`, `nextCursor`,
`pageToken`, `next`) et garde celui dont le contenu change réellement. Si aucun ne fait
avancer, il s'arrête en six appels et le dit, au lieu de tourner en rond.

### La liaison avec le catalogue

Le `customId` d'une session est un numéro de session, il ne raccroche à rien. Ce qui identifie
la formation, c'est le **produit de formation**, et c'est son `custom_field_20` qui porte le
code Gesform.

Plutôt qu'un rapprochement calculé à la volée — qui perd en silence tout ce qu'il ne sait pas
rapprocher — une table `SmartOF_produits` garde une ligne par produit rencontré : son code, son
intitulé, et une référence vers `Formations`. Le widget la remplit, rapproche automatiquement
quand le code tombe sur un `Formations.code_gesform` ou un `Formations.code`, et **laisse
visibles les produits non rapprochés** avec une liste déroulante pour trancher. Un choix fait à
la main n'est jamais écrasé par un rafraîchissement ultérieur.

### La fenêtre glissante

On relit les enregistrements modifiés depuis N jours — 30 par défaut — plutôt que « depuis la
dernière fois ». Un rafraîchissement manqué ou une coupure au milieu laisserait sinon un trou
qu'on ne voit jamais. Le recouvrement est sans effet : chaque enregistrement est reconnu à son
identifiant SmartOF, rien n'est dupliqué, **rien n'est jamais effacé**.

Le rapport de fin distingue ce qui a été ajouté, corrigé et laissé tel quel. Un second passage
immédiat doit donner « 0 ajoutée, 0 corrigée » : si ce n'est pas le cas, c'est que la
comparaison champ à champ a trouvé une vraie différence.

### Ce qu'il écrit

| Table | Clé | Ce qu'elle porte |
|---|---|---|
| `SmartOF_produits` | `produit_uid` | code Gesform, intitulé, et la formation du catalogue |
| `SmartOF_sessions` | `uid` | dates, statut, lieu, produit, code Gesform |
| `SmartOF_commanditaires` | `uid` | session, entreprise, type, **nombre d'apprenants**, **budget** |
| `SmartOF_factures` | `uid` | numéro, session, commanditaire, statut, dates, **HT**, **TTC**, avoirs |

C'est le commanditaire qui porte le **vendu** : c'est par lui que les apprenants sont inscrits,
et c'est lui qui porte le budget. La facture porte le **facturé**, et les deux ne coïncident
pas — l'écart entre budget vendu et montant facturé, c'est ce qui reste à facturer.

Les montants d'une facture vivent dans `priceDetails` et `avoirsSummary`, dont la documentation
ne donne pas la forme. L'extraction cherche donc le champ par son nom — `totalHT`, `total_ht`,
`amountExcludingTax` — et déduit le HT du TTC moins la TVA quand il n'est pas publié. Si rien
n'est reconnu, le rapport le dit au lieu de laisser lire « 0 € facturé ».

Les colonnes manquantes sont listées à l'écran, avec un bouton qui les crée. Les tables
absentes, elles, sont signalées sans être créées : ajouter une table est une décision de
structure, pas un effet de bord d'un widget.

## Interne et externe

Toutes les formations ne sont pas vendues. Certaines ne servent que le personnel du CHU, et
mêlées aux autres elles faussaient deux lectures : la recette, en y mélangeant de la
refacturation interne, et la rentabilité, en faisant passer une mission de service pour un
échec commercial.

**La marque se pose sur le segment, pas sur la formation.** Chaque ligne de vente — inter
comme intra — porte déjà un segment : une case `interne` sur la table `Segments` suffit, et le
partage tombe alors euro par euro. Une formation vendue aux deux publics n'a rien de
particulier, ses lignes se répartissent d'elles-mêmes. Posée sur la formation, la marque aurait
obligé à ranger une formation mixte d'un côté ou de l'autre, et les recettes seraient restées
indivises.

**Condition préalable** : un segment qui mélange les deux publics — « CHU et GHT », où le CHU
est interne et le GHT est client — doit être coupé en deux. Le script le signale, dans la
console et dans une colonne `alerte_perimetre`, mais ne le fait pas : découper un segment
déplace des lignes de vente, cela ne se décide pas dans un script.

**Le périmètre d'une formation se déduit** de ses segments visés : `Externe`, `Interne`,
`Mixte`, ou `À qualifier` quand aucun segment n'est renseigné. Une colonne de forçage permet
de corriger les cas que les segments n'expriment pas ; laissée vide, le déduit s'applique. La
fiche affiche le périmètre et d'où il vient, pour qu'un périmètre surprenant se corrige à sa
source plutôt qu'en le forçant.

Attention à la nuance : **« À qualifier » n'est pas « interne »**. Une formation sans segment
visé est une fiche à compléter, pas une décision de ne pas la vendre. Elle ne compte dans
aucun panier, et le pilotage le dit.

### Deux découpages, deux tableaux

| Ce qui se partage | Par quoi | Combien de paniers |
|---|---|---|
| Recettes, places | le **segment** de chaque ligne de vente | 2 — exact |
| Sessions, coûts, nombre de formations | le **périmètre** de la formation | 3 — dont les mixtes |

Les réunir dans une seule grille ferait lire la recette interne comme « la recette des
formations internes », ce qu'elle n'est pas : une partie vient des formations mixtes. D'où deux
tableaux séparés dans la section « Pour qui » du pilotage, et aucun prorata inventé sur les
sessions.

### Effet sur la rentabilité

Les formations purement internes sortent du classement de rentabilité : elles ne sont pas
vendues, leur résultat n'aurait pas de sens, et les compter parmi les déficitaires ferait
passer une mission de service pour un échec. Une tuile dit combien ont été mises de côté et ce
qu'elles coûtent ; leurs coûts restent comptés dans la section « Pour qui ».

### Retrouver les formations par périmètre

La fiche porte, au-dessus de son rail, un filtre à cinq paniers avec le nombre de formations
dans chacun :

| Panier | Ce qu'il retient |
|---|---|
| Toutes les formations | tout le catalogue |
| Vendables à l'extérieur | périmètre `Externe` ou `Mixte` |
| Plan de formation du CHU | périmètre `Interne` ou `Mixte` |
| Les deux publics | périmètre `Mixte` |
| Périmètre à qualifier | aucun segment visé |

Les deux paniers du milieu **se recouvrent volontairement** : une formation qui vise les deux
publics appartient aux deux, et c'est ce qu'elle est. Une ligne sous le filtre dit combien de
formations sont dans ce cas, plutôt que de laisser croire à une partition.

Le filtre se combine à la recherche par intitulé ou par code, et les raccourcis `Alt` + `←` `→`
circulent dans la liste filtrée. Sur un document où la colonne `perimetre` n'existe pas encore,
le filtre ne s'affiche pas du tout : il n'offrirait que des paniers vides.

### Passer à ce modèle

Le script `perimetre_interne_grist.js`, collé dans la console du navigateur sur la page du
document. Tant qu'il n'a pas tourné, la section « Pour qui » le dit et n'affiche rien.
Après, il reste à cocher « Public interne au CHU » sur les segments concernés : tant que rien
n'est coché, tout est externe et la séparation ne montre rien.

## Le vivier se tient par profil

Un formateur GSU est habilité au GSU, pas à « GSU 2 - Etudiants - 3j ». Jusqu'à la v21, le
vivier se saisissait sur la ligne formation × profil : une seule population répartie sur
autant de lignes que de formations, et aucune répartition n'était juste.

Écrire le vrai nombre sur chaque ligne — 40 formateurs GSU, les mêmes personnes — faisait
croire au document qu'il disposait de 8 × 40 × la capacité d'un intervenant, soit trois fois
la capacité réelle : il concluait « vivier suffisant » là où il manquait 157 recrues. Le
répartir, cinq par formation, enfermait chaque formation dans sa part et interdisait à un
formateur de la réactualisation d'aller animer un GSU initial.

Tant que les viviers restaient à zéro l'erreur dormait : la somme ligne à ligne (240 pour le
GSU en 2027) était presque celle du profil (237). Elle se réveillait à la première saisie.

Depuis la v22, deux grains cohabitent :

| Table | Grain | Ce qu'elle porte |
|---|---|---|
| `Vivier` | formation × profil × année | la **demande**, calculée : sessions, interventions, heures |
| `Vivier_profils` | profil × année | le **vivier**, saisi : autorisés, départs, heures par intervenant — et tout le recrutement |

Le recrutement se décide au niveau du profil, le seul où « combien de personnes » a un sens.
Sur la ligne de formation, il n'apparaît plus que comme une **imputation au prorata des
heures** : additionnée sur toutes les formations d'un profil, elle redonne exactement le
besoin de ce profil, jamais davantage.

### La capacité se compte en heures

Les formations vont de la demi-journée à trois jours. Une capacité en sessions par an les
traiterait toutes pareil. Le paramètre est donc `heures_par_intervenant_an`, minoré de
`indisponibilite_intervenants`, et remplaçable profil par profil. C'est l'hypothèse la plus
structurante du calcul : elle décide à elle seule du nombre de recrues.

### Le seuil de robustesse a changé de portée

`vivier_minimum` s'applique désormais par profil et non par formation. La règle « aucune
formation ne repose sur une seule personne » ne se lit plus dans ce document : elle relève du
registre des habilitations.

### Passer à ce modèle

Le script `vivier_par_profil_grist.js` crée la table, reprend les viviers déjà saisis en
retenant la plus grande valeur de chaque groupe (et signale les écarts), bascule la capacité
en heures, transforme les colonnes de saisie de `Vivier` en lectures, et réécrit les agrégats
de `Annees`, `Formations` et `Intervenants`. Il se colle dans la console du navigateur sur la
page du document et démarre en essai à blanc. Tant qu'il n'a pas tourné, l'onglet Vivier le
dit et ne propose aucune saisie.

## Le plan de charge, en trois volets

`charge.html` porte désormais tout ce qui relève des moyens, sous trois onglets.

**Vivier** — la grille profil par profil : une ligne par profil, et le bouton qui complète les
lignes manquantes d'après les intervenants décrits sur les formations. Cliquer sur un profil
ouvre sa page : la saisie, la dérivation pas à pas du nombre de recrues, et le détail des
formations qui composent son besoin, en lecture seule.

**Recrutement** — le verdict de l'année, la couverture par profil, les priorités classées, les
dépendances à une personne, et la trajectoire du besoin sur plusieurs années. Il a changé
d'écran parce qu'il répond à « avec quels moyens ? », pas à « combien allons-nous vendre ? ».

**Salles** — la projection d'occupation, type de salle par type de salle. Les jours requis
viennent de `Besoins_salles` par l'intermédiaire des projections ; les jours disponibles se
saisissent ici, année par année et type par type, et sont la seule donnée que cet onglet écrit.
Le document en déduit la capacité théorique, le nombre de salles que la projection suppose
(`salles_necessaires`) face au nombre détenu, le taux d'occupation et l'alerte. Trois tuiles en
tête : les jours à couvrir, les types en dépassement, et ceux au-delà de 85 % d'occupation.
Un type dont ni les jours disponibles ni les salles détenues ne sont renseignés n'a pas de
capacité calculable : il est compté à part, sous « Capacité inconnue », plutôt que d'être
affiché à 0 % comme s'il était vide.

## Le pilotage : une synthèse, et une page par année

Deux questions distinctes, deux écrans. La **Synthèse** répond « où va-t-on ? » sur plusieurs
années : trajectoire, composition, hypothèses, scénarios, lecture d'ensemble des objectifs.
Chaque **onglet d'année** répond « où en est-on ? » sur une seule, et cela se juge autrement —
au rythme écoulé, pas à la trajectoire.

### L'onglet d'une année, dans l'ordre où l'on se pose les questions

Quatre sections, et cet ordre n'est pas décoratif :

1. **Visé, projeté, vendu, facturé** — les quatre montants sur une même échelle, l'objectif
   dessiné en **trait pointillé** et non en cinquième barre : c'est un seuil à franchir, pas
   un résultat de plus à comparer. La table de chiffres sous la figure donne deux
   pourcentages distincts, *part de l'objectif* et *part du projeté*, parce que ce sont deux
   questions différentes — tenir sa promesse, et tenir son plan. Une année peut faire l'un
   sans l'autre.
2. **Est-ce qu'on est à l'heure** — les trois taux au rythme de l'année utile (ci-dessous).
3. **Qui porte, qui décroche** — le détail formation par formation.
4. **Les objectifs de l'année** — la saisie, à côté de ce qu'elle juge.

Le reste à facturer est annoncé pour ce qu'il est : **un délai d'émission, pas un manque de
ventes**. Sans cette phrase il se lit comme une perte.

Une année future qui porte déjà du vendu ne s'annonce plus « rien à réaliser » : les sessions
se commandent à l'avance, et affirmer le contraire devant 481 846 € déjà engagés
décrédibiliserait le reste de la page.

### Le rythme attendu, sur l'année utile

L'organisme ne forme pas l'été : son année utile fait dix mois. La page d'année compare donc
trois taux sur une même échelle — l'**attendu**, le **vendu**, le **facturé** — où l'attendu
est la part des **jours utiles écoulés**, juillet et août non comptés.

Ce n'est pas un repère systématiquement plus indulgent, c'est un repère juste :

| Au | Année civile | Année utile |
|---|---:|---:|
| 30 juin | 49 % | **59 %** |
| 1er novembre | 83 % | **80 %** |

Au 30 juin, six des dix mois utiles sont faits : juger sur 49 % flatterait le vendu de dix
points. Au 1er novembre, c'est l'inverse, parce que les deux mois sautés sont déjà derrière.
Les mois exclus se règlent dans `Parametres`, sous `mois_sans_activite` (par défaut `7,8`).

Deux précautions de lecture sont câblées dans l'écran. L'attendu est dessiné en **trame** et
non en aplat : c'est un repère, pas une mesure, et une teinte de plus se lirait comme une
série. Et **seul le vendu est jugé** sur ce repère — le facturé suit le vendu avec un décalage
normal, l'alarmer sur la même cible ferait passer un délai d'émission pour un retard
commercial ; il est donc rapporté au vendu, pas au calendrier.

Ce calcul-là est le seul du pilotage à être fait dans le widget et non dans le document : il ne
lit aucune donnée métier, seulement le calendrier et la date du jour.

## La synthèse, en sept sections

Sept sections, dans l'ordre où l'on raisonne : **La trajectoire** (recettes face aux objectifs,
résultat, tableau complet), **De quoi elle est faite** (par domaine, puis la rentabilité
formation par formation), **Ce qui s'est vraiment vendu** (le réalisé SmartOF face au projeté),
**Pour qui** (ce que portent les formations vendues à l'extérieur,
et ce que portent celles qui ne servent que le CHU), **Ce qui peut encore bouger** (part des
places déjà affectée, puis les hypothèses), **Scénarios**, **Ce que l'on vise** (objectif,
projeté, vendu et facturé côte à côte, toutes années — en lecture seule, l'année étant un
lien vers son onglet).

Le taux que le document appelle `remplissage_inter` est affiché comme ce qu'il est : la **part
des places ouvertes déjà affectée** à un segment. Les places étant attribuées comme si tout se
vendait, ce n'est pas une prévision de ventes mais l'avancement de la projection. Les deux
notions portent des noms distincts dans l'écran, pour ne plus être confondues.

## Scénarios

Affecter les places formation par formation pour chaque année à venir est long, et prématuré
tant qu'on ne sait pas si l'année tient la route. Un scénario part d'une année réellement
projetée et lui applique une progression annuelle : sessions, places, recettes et coûts
croissent ensemble, puisque dans ce document la recette suit les places et le coût suit les
sessions.

Les années déjà projetées gardent leurs chiffres réels — un scénario ne les écrase pas, et
n'écrit rien dans le document. Les années simulées sont marquées comme telles. Pour transformer
un scénario en projection saisie, c'est le « Reprendre » de chaque fiche qui le fait, avec le
même calcul.

## Hypothèses de réalisation

Deux taux, posés dans le pilotage et enregistrés dans `Parametres` sous les clés
`remplissage_pessimiste` et `remplissage_optimiste` : tout le document en dispose, pas seulement
cet écran. Le tableau donne les trois colonnes — basse, projeté, haute — et la fourchette se
lit par année en bandes, le trait marquant le remplissage projeté.

Ce qui varie et ce qui ne varie pas, d'après les formules du document :

| Ce que le taux fait varier | Ce qu'il laisse intact |
|---|---|
| Ventes inter à la place : `nb_places × prix × jours` | Ventes inter au groupe : le groupe est acheté entier |
| | Ventes intra : un groupe vendu à un établissement |
| | Les coûts : engagés par les sessions ouvertes, pas par les inscrits |

Les sièges déjà pris par les ventes au groupe sont **retirés de la capacité** avant d'appliquer
le taux. Sans cette soustraction, l'hypothèse haute revendrait des places déjà vendues.

Deux garde-fous : le total recalculé est confronté à la recette du document, et l'écart est
signalé — une fourchette assise sur une assiette incomplète ne vaut rien ; et si le remplissage
projeté tombe hors de la fourchette, l'écran le dit, car elle n'encadre alors plus rien.

## Les objectifs : saisis dans l'onglet de leur année

Un objectif ne se calcule pas, il se décide : c'est la seule chose que le pilotage écrit, dans
la table `Annees`, à côté du réalisé qui lui fait face. Quatre objectifs sont prévus — recettes,
résultat, sessions, heures stagiaires — et chacun n'apparaît que si la colonne de réalisé
correspondante existe. Si la colonne d'objectif manque, un bouton la crée dans le document,
en numérique, avec son libellé.

**La saisie vit dans l'onglet de chaque année.** Elle se faisait auparavant dans un tableau de
la synthèse, toutes années mêlées : pour remplir une case il fallait trouver sa ligne parmi
huit, et l'objectif se saisissait loin du réalisé qu'il juge. La synthèse garde ce qu'elle fait
mieux — les mettre toutes côte à côte, en lecture — et l'onglet porte la main.

## Pourquoi le total par année se fait dans le widget

C'est la seule entorse assumée à la règle « rien n'est recalculé ici », et elle a une cause
précise. Les colonnes d'agrégat de `Annees` (`realise_vendu` et compagnie) **répondaient zéro**
alors que les colonnes de session, elles, calculaient juste : le même écran affichait
« 0 € vendu » en tuile et 481 846 € dans le tableau trois centimètres plus bas. Une formule
d'agrégat qui ne remonte rien est **indétectable à l'œil** — elle rend un zéro, pas une erreur.

Additionner dans le widget les valeurs que le document a calculées session par session n'est
pas recalculer : les montants, l'année et la formation viennent tous du document, et c'est déjà
ce que faisait le tableau « formation par formation » depuis le début. On ne fait que
**grouper**. Le pilotage n'exige donc plus aucune colonne d'agrégat dans `Annees` ; il lui faut
seulement que chaque session sache son année et son montant.

### Les sessions archivées : exclues, jamais en silence

C'est la cause réelle des zéros, et elle a résisté longtemps parce qu'elle était cohérente :
le total d'une année excluait les sessions archivées, le tableau par formation juste en dessous
ne les excluait pas. La même page affichait « 0 € vendu » en tuile et 481 846 € trois
centimètres plus bas. Les formules d'agrégat de Grist, qui excluaient elles aussi, étaient donc
justes — c'est la donnée qui était fausse.

Deux corrections, l'une sur la lecture, l'autre sur l'écriture :

- **Un seul filtre.** Les totaux et le détail passent par la même fonction. Les deux lectures
  d'une même page ne peuvent plus se contredire, et le nombre de sessions écartées est affiché
  dès qu'il y en a — avec une alerte explicite quand elles le sont toutes.
- **`!!` n'est pas un test de booléen.** Le widget SmartOF écrivait `archive: !!s.archive`.
  Si l'API renvoie la chaîne `"false"`, une date ou un libellé, `!!` répond **vrai** : toutes
  les sessions se retrouvent archivées. Un `archiveVrai()` ne retient désormais que ce qui se
  lit comme archivé. Relancer le rafraîchissement SmartOF réécrit la colonne et les totaux
  reviennent.

Une cellule en erreur, elle, ne vaut pas zéro : Grist la renvoie sous la forme
`['E', 'TypeDErreur', …]`, le widget la reconnaît, et **l'annonce sur les deux écrans** — la
synthèse comme l'onglet d'année. Un zéro faux ne se voit pas ; il faut le dire là où il
s'affiche, pas seulement sur l'écran d'à côté.

## L'état d'une fiche

La pastille d'une formation dans la liste de gauche, et les trois compteurs du bandeau, ne
dépendent que des **deux validations du bas de fiche** : `validation_definition` et
`validation_projections`. Les deux validées, la pastille est verte ; une seule, ocre ; aucune,
grise. Remplir n'est pas valider : le widget ne décide plus qu'une fiche est complète parce que
ses cases sont remplies — c'est vous qui le dites.

Ce qui manque encore se dit ailleurs, section par section, par le point ocre du sommaire. La
section Validation rappelle d'où vient la pastille, pour qu'on sache sur quoi agir.

## Le sommaire de la fiche

La fiche est longue : un sommaire collant en haut permet de sauter directement aux
projections ou au coût, repère la section en cours de lecture, et marque d'un point ocre les
sections où il manque encore une information — définition incomplète selon le document,
aucun segment visé, intervenants ou salles non décrits, places manquantes sur une année qui
porte des sessions.

## Raccourcis clavier

| Touche | Effet |
|---|---|
| `↑` `↓` | Année précédente ou suivante, dans la même colonne |
| `Entrée` | Descend d'une ligne |
| `Échap` | Annule la frappe en cours |
| `Alt` + `←` `→` | Formation précédente ou suivante, **dans la liste filtrée** |
| `/` | Place le curseur dans la recherche |

## Tables lues et écrites

Lues : `Annees`, `Formations`, `Projections`, `Ventes_inter`, `Ventes_intra`, `Segments`,
`Segments_categories`, `Domaines`, `Typologies`, `Gestionnaire`, `Metiers`, `Enjeux`,
`Obligations`, `Intervenants`, `Intervenants_formation`, `Vivier`, `Vivier_profils`, `Charge`, `Salles`,
`Types_salles`, `Besoins_salles`, `Tarifs`, `Categories_tarifaires`, `Parametres`.

Écrites : `SmartOF_produits`, `SmartOF_sessions`, `SmartOF_commanditaires` (reprise du
réalisé), `Formations` (définition, périmètre forcé), `Projections` et `Ventes_inter` (sessions et places),
`Besoins_salles` (type de salle, nombre, jours), `Intervenants_formation` (profils mobilisés),
`Vivier_profils` (vivier, départs, heures par intervenant), `Salles` (jours disponibles par
type et par année), `Annees`
(objectifs seulement), `Parametres` (taux de réalisation et scénarios). Tout le reste de ce que
montrent les tableaux de bord est en lecture seule.

## Ce que couvre la fiche formation

Sept sections, dans l'ordre où l'on décrit une formation :

1. **Définition** — code, intitulé, domaine, typologie, durée, effectif, modalité, statut,
   gestionnaire, programme, commentaire.
2. **Public visé** — segments de marché, métiers, enjeux, obligations réglementaires, en
   étiquettes cliquables.
3. **Ressources mobilisées par session** — qui anime (profil, heures, nombre) et dans quelle
   salle (type, nombre, jours). Ce sont les deux entrées du coût.
4. **Coût de revient d'une session** — animation, support et gestion, total, par jour, par
   heure, et les deux tarifs planchers. Toutes ces valeurs sont des colonnes formules du
   document, affichées pendant qu'on décrit les ressources pour que la construction du coût
   soit lisible.
5. **Projections** — sessions et places vendues par segment, année par année, avec reprise
   d'une année sur les suivantes.
6. **Ventes intra** — les groupes vendus à un établissement, qui se comptent en sessions et
   non en places ouvertes.
7. **Validation** — l'état que le document calcule (complétude, état des projections) et les
   deux champs de validation à poser.

## Ce qui n'y est pas

Les parcours et la grille tarifaire restent dans leurs tables : ce sont des référentiels, pas
de la saisie par formation.
