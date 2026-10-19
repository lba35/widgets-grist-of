# Widgets Grist — organisme de formation du CHU de Rennes

Trois widgets personnalisés pour le document de projection des ventes. Fichiers statiques,
sans dépendance ni build : on dépose le dossier sur une adresse en https et on colle les URL
dans Grist.

| Fichier | Ce qu'il fait |
|---|---|
| `index.html` | Page catalogue, qui affiche l'URL à coller pour chaque widget |
| `fiche.html` | Tout ce qui concerne une formation : définition, public, ressources, coût, projections, ventes intra, validation |
| `charge.html` | Vivier d'intervenants, profil par profil, et besoin de recrutement |
| `pilotage.html` | Les deux tableaux de bord : recrutement et projection pluriannuelle |
| `commun.css` | Jetons visuels et composants partagés |
| `commun.js` | Plomberie Grist, métadonnées de colonnes, éditeurs, écriture différée |
| `graphes.js` | Les graphiques du pilotage, dessinés en SVG, sans bibliothèque |

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

**Le curseur ne saute pas.** Après enregistrement, seules les valeurs calculées sont
rafraîchies ; le champ en cours de frappe garde le curseur et son contenu. Dans le tableau des
objectifs, où l'écran entier se redessine, la valeur part à la sortie du champ et le curseur
est rendu à la case qu'on venait de quitter.

**Aucune bibliothèque externe.** Les graphiques sont du SVG écrit à la main : une dépendance
de moins à charger depuis le réseau du CHU, et rien qui puisse disparaître d'un CDN.

## Les graphiques

Quatre figures dans l'onglet Projection, et une dans l'onglet Recrutement :

| Figure | Ce qu'elle montre |
|---|---|
| Recettes projetées par année | Les recettes en barres, l'objectif de l'année en trait pointillé sur la même échelle |
| Résultat sur coûts directs | Une barre par année, au-dessus ou au-dessous de la ligne de zéro |
| Recettes par domaine | La recette de chaque année décomposée par domaine, cinq teintes au plus |
| Remplissage des sessions inter | La courbe du taux de remplissage, sur une échelle de 0 à 100 % |
| Intervenants à recruter | Le besoin de recrutement par année, empilé par profil |

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
places et groupes saisis sur la même ligne. Et quand plusieurs lignes de vente portent la même
année et le même segment, la case le dit et passe en lecture seule plutôt que de n'en montrer
qu'une et de laisser les totaux paraître faux.

## Les objectifs

Un objectif ne se calcule pas, il se décide : c'est la seule chose que le pilotage écrit, dans
la table `Annees`, à côté du réalisé qui lui fait face. Quatre objectifs sont prévus — recettes,
résultat, sessions, heures stagiaires — et chacun n'apparaît que si la colonne de réalisé
correspondante existe. Si la colonne d'objectif manque, un bouton la crée dans le document,
en numérique, avec son libellé.

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
| `Alt` + `←` `→` | Formation précédente ou suivante |
| `/` | Place le curseur dans la recherche |

## Tables lues et écrites

Lues : `Annees`, `Formations`, `Projections`, `Ventes_inter`, `Ventes_intra`, `Segments`,
`Segments_categories`, `Domaines`, `Typologies`, `Gestionnaire`, `Metiers`, `Enjeux`,
`Obligations`, `Intervenants`, `Intervenants_formation`, `Vivier`, `Charge`, `Parametres`.

Écrites : `Formations` (définition), `Projections` et `Ventes_inter` (sessions et places),
`Intervenants_formation` (profils mobilisés), `Vivier` (vivier et départs), `Annees`
(objectifs seulement). Tout le reste de ce que montre le pilotage est en lecture seule.

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
