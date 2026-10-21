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

## L'onglet Projection

Cinq sections, dans l'ordre où l'on raisonne : **La trajectoire** (recettes face aux objectifs,
résultat, tableau complet), **De quoi elle est faite** (par domaine, puis la rentabilité
formation par formation), **Ce qui peut encore bouger** (part des places déjà affectée, puis
les hypothèses), **Scénarios**, **Ce que l'on vise** (les objectifs).

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

## Les objectifs

Un objectif ne se calcule pas, il se décide : c'est la seule chose que le pilotage écrit, dans
la table `Annees`, à côté du réalisé qui lui fait face. Quatre objectifs sont prévus — recettes,
résultat, sessions, heures stagiaires — et chacun n'apparaît que si la colonne de réalisé
correspondante existe. Si la colonne d'objectif manque, un bouton la crée dans le document,
en numérique, avec son libellé.

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
