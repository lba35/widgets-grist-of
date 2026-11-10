/* =========================================================================
   Le moteur de reprise SmartOF — sans écran.

   Il est partagé par deux boutons : celui du widget SmartOF, qui montre le
   détail de la connexion et de la structure, et celui du pilotage, qui veut
   juste des chiffres à jour sans changer de page. Un seul moteur, donc une
   seule correction à faire quand l'API bouge.

   Il ne contient aucun secret : l'adresse et la clé vivent dans la table
   Parametres du document, jamais dans ce fichier, qui est public.
   ========================================================================= */
(function (racine) {
'use strict';

var TABLES = ['Parametres', 'Formations', 'Annees',
  'SmartOF_produits', 'SmartOF_sessions', 'SmartOF_commanditaires',
  'SmartOF_factures', 'Organisations_clientes'];
function relire() {
  return ['SmartOF_produits', 'SmartOF_sessions', 'SmartOF_commanditaires',
    'SmartOF_factures', 'SmartOF_suivis', 'Organisations_clientes']
    .map(vraiNom).concat(['Parametres']);
}

/* Les clés de configuration, dans Parametres. */
var CLE_BASE = 'smartof_base';
var CLE_JETON = 'smartof_cle';
var CLE_DERNIER = 'smartof_dernier_rafraichissement';
/* La date lisible sert à l'affichage ; celle-ci sert au filtre, et doit donc
   rester dans un format que l'API comprend. Deux clés valent mieux qu'un
   reformatage à l'envers d'un « 02/11/2026 à 23:45 ». */
var CLE_DERNIER_ISO = 'smartof_dernier_iso';

var enCours = false;

/* ------------------------------------------------- lecture des réglages -- */
function reglage(cle) {
  var p = OF.table('Parametres').filter(function (x) { return OF.texte(x.cle) === cle; })[0];
  if (!p) return '';
  /* Parametres porte `valeur` (numérique) et parfois `texte` : une adresse et
     une clé ne sont pas des nombres, on prend ce qui est lisible. */
  return OF.texte(p.texte) || OF.texte(p.description_valeur) || OF.texte(p.valeur) || '';
}
function ligneReglage(cle) {
  return OF.table('Parametres').filter(function (x) { return OF.texte(x.cle) === cle; })[0] || null;
}
function colonneTexteParametres() {
  var meta = OF.doc.colonnes.Parametres || {};
  return meta.texte ? 'texte' : null;
}
function ecrireReglage(cle, valeur) {
  var col = colonneTexteParametres();
  if (!col) {
    OF.signaler('La table Parametres n\'a pas de colonne texte : rien n\'a été enregistré', true);
    return Promise.resolve();
  }
  var l = ligneReglage(cle);
  var champs = { cle: cle };
  champs[col] = valeur;
  return OF.appliquer(
    [l ? ['UpdateRecord', 'Parametres', l.id, champs]
       : ['AddRecord', 'Parametres', null, champs]],
    ['Parametres'], function () { rendre(); });
}

function base() { return reglage(CLE_BASE).replace(/\/+$/, ''); }
function jeton() { return reglage(CLE_JETON).trim(); }
function configure() { return !!(base() && jeton()); }


/* ------------------------------------------------------- appels SmartOF -- */
/* Un seul endroit qui parle à SmartOF : tout le reste passe par ici, donc
   une erreur se diagnostique au même endroit quelle que soit la collection. */
function appeler(chemin, params) {
  var url = base() + chemin;
  var q = Object.keys(params || {}).map(function (k) {
    return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
  });
  if (q.length) url += (url.indexOf('?') >= 0 ? '&' : '?') + q.join('&');
  return fetch(url, { headers: { Authorization: 'Bearer ' + jeton() } })
    .then(function (r) {
      return r.text().then(function (txt) {
        var j = null;
        try { j = JSON.parse(txt); } catch (e) { /* pas du JSON */ }
        if (!r.ok) throw new Error(diagnostic(r.status, j, txt));
        return j;
      });
    }, function (e) {
      /* Le navigateur ne dit jamais « CORS » à JavaScript : il dit seulement
         que la requête a échoué. Autant nommer les deux causes possibles. */
      throw new Error('La requête n\'a pas abouti (' + (e && e.message ? e.message : e)
        + '). Soit l\'adresse est fausse, soit SmartOF refuse les appels venus '
        + 'de cette page.');
    });
}

function diagnostic(statut, j, txt) {
  var msg = (j && (j.message || j.error)) || txt.slice(0, 200) || '';
  if (statut === 400 && /token/i.test(msg)) {
    return 'SmartOF refuse le jeton (400) : « ' + msg + ' ». La clé attendue commence '
      + 'par smk_ et compte 43 caractères ensuite. Vérifiez aussi qu\'aucune espace '
      + 'ne s\'est glissée au collage.';
  }
  if (statut === 401 || statut === 403) {
    return 'SmartOF refuse l\'accès (' + statut + ') : « ' + msg + ' ». La clé est '
      + 'probablement révoquée, ou ne couvre pas cette collection.';
  }
  if (statut === 404) {
    return 'Collection inconnue (404) : « ' + msg + ' ». L\'adresse de base est '
      + 'peut-être incomplète — elle doit se terminer par /external/api.';
  }
  return 'SmartOF a répondu ' + statut + ' : ' + msg;
}

/* La clé du curseur n'est pas documentée : on prend celle que la réponse
   porte réellement, plutôt que d'en coder une en dur qui changerait un jour. */
var CLES_CURSEUR = ['nextCursor', 'endCursor', 'next', 'cursor', 'nextPageToken', 'pageToken'];
var CLES_ENCORE = ['hasNextPage', 'hasMore', 'more'];

function curseurDe(page) {
  var info = (page && page.pageInfo) || {};
  for (var i = 0; i < CLES_CURSEUR.length; i++) {
    var v = info[CLES_CURSEUR[i]];
    if (v) return { nom: CLES_CURSEUR[i], valeur: v };
  }
  return null;
}
function encoreDesPages(page, curseur) {
  var info = (page && page.pageInfo) || {};
  for (var i = 0; i < CLES_ENCORE.length; i++) {
    if (info[CLES_ENCORE[i]] === false) return false;
    if (info[CLES_ENCORE[i]] === true) return true;
  }
  return !!curseur;
}

/* Parcourt toutes les pages d'une collection. `avance` est rappelé à chaque
   page pour que l'écran montre où on en est : sans ça, un rapatriement de
   deux mille lignes ressemble à un écran figé. */
/* LE NOM DU PARAMÈTRE DE CURSEUR N'EST PAS CELUI DU CHAMP DE RÉPONSE
   La réponse porte `pageInfo.nextCursor`, mais la requête n'attend pas
   forcément `nextCursor=` — et la documentation ne le dit nulle part. Pris
   pour l'autre, le paramètre devient inconnu ; or cette API ignore les
   paramètres inconnus en silence et renvoie la première page. La boucle
   tourne alors sans avancer, indéfiniment. C'est exactement le piège que
   `filter[...]` nous avait déjà tendu.

   On le découvre donc : on redemande la page suivante sous chaque nom
   plausible, et on garde celui qui change réellement de contenu. */
var NOMS_PARAM_CURSEUR = ['cursor', 'after', 'startAfter', 'nextCursor', 'pageToken', 'next'];
var paramCurseur = null;

function signature(lignes) {
  var l = lignes && lignes[0];
  if (!l) return '(vide)';
  return String(l.sessionUid || l.commanditaireUid || l.factureUid
    || l.produitFormationUid || l.apprenantUid || l.uid || l.id || JSON.stringify(l).slice(0, 60));
}

function trouverParamCurseur(chemin, params, curseur, refSignature) {
  var reste = NOMS_PARAM_CURSEUR.slice();
  function essayer() {
    if (!reste.length) return Promise.resolve(null);
    var nom = reste.shift();
    var p = {};
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    p[nom] = curseur;
    return appeler(chemin, p).then(function (rep) {
      var lignes = (rep && rep.data) || [];
      /* avancer, c'est renvoyer autre chose que la page précédente */
      if (signature(lignes) !== refSignature) return { nom: nom, rep: rep };
      return essayer();
    }, function () { return essayer(); });
  }
  return essayer();
}

function parcourir(chemin, params, avance) {
  var tout = [], vues = 0, pages = 0, derniere = null;

  function absorber(rep) {
    var lignes = (rep && rep.data) || [];
    tout = tout.concat(lignes);
    vues += lignes.length;
    pages++;
    if (avance) avance(vues, pages);
    return lignes;
  }

  function page(curseur) {
    var p = {};
    Object.keys(params || {}).forEach(function (k) { p[k] = params[k]; });
    if (curseur) p[paramCurseur] = curseur;
    return appeler(chemin, p).then(function (rep) {
      var lignes = absorber(rep);
      return suite(rep, lignes);
    });
  }

  function suite(rep, lignes) {
    var sig = signature(lignes);
    /* Une page identique à la précédente veut dire que le curseur n'est pas
       pris en compte : on s'arrête tout de suite plutôt qu'au bout de 200
       tours, et on dit pourquoi. */
    if (derniere !== null && sig === derniere && lignes.length) {
      throw new Error('La pagination n\'avance pas : ' + chemin + ' renvoie deux fois la même '
        + 'page. Le paramètre de curseur « ' + paramCurseur + ' » n\'est pas celui attendu, et '
        + 'cette API ignore les paramètres qu\'elle ne connaît pas. Rien n\'a été écrit.');
    }
    derniere = sig;
    if (!lignes.length) return tout;
    if (pages > 500) {
      throw new Error('Plus de 500 pages sur ' + chemin + ' : rapatriement interrompu par '
        + 'précaution, rien n\'a été écrit. Restreignez la fenêtre relue.');
    }
    var c = curseurDe(rep);
    if (!c || !encoreDesPages(rep, c)) return tout;

    if (paramCurseur) return page(c.valeur);
    /* première pagination de la session : on cherche le bon nom une fois */
    return trouverParamCurseur(chemin, params, c.valeur, sig).then(function (trouve) {
      if (!trouve) {
        throw new Error('Aucun nom de paramètre de curseur n\'a fait avancer la pagination sur '
          + chemin + ' (essayés : ' + NOMS_PARAM_CURSEUR.join(', ') + '). La réponse annonce '
          + 'pourtant une suite. Rien n\'a été écrit — envoyez-moi la sortie du bouton '
          + '« Voir une session » et j\'épingle le bon nom.');
      }
      paramCurseur = trouve.nom;
      var l = absorber(trouve.rep);
      return suite(trouve.rep, l);
    });
  }

  return page(null);
}


var FENETRES = [
  { cle: 'depuis', libelle: 'Depuis la dernière reprise', incremental: true },
  { cle: '3', libelle: 'Les 3 derniers jours', jours: 3 },
  { cle: '30', libelle: 'Les 30 derniers jours', jours: 30 },
  { cle: '365', libelle: 'La dernière année', jours: 365 },
  { cle: 'tout', libelle: 'Tout, sans filtre de date', jours: 0 },
];

/* La borne basse du filtre, ou null pour tout reprendre.
   « Depuis la dernière reprise » n'a de sens que si une reprise a eu lieu :
   sans elle, on ne filtre rien plutôt que de filtrer sur une date inventée.
   Une reprise incomplète qui se croit complète est pire qu'une reprise
   longue. */
function depuis(fenetre) {
  var f = FENETRES.filter(function (x) { return x.cle === fenetre; })[0];
  if (!f) return null;
  if (f.incremental) {
    var iso = reglage(CLE_DERNIER_ISO).trim();
    /* on recule d'un jour : une session modifiée pendant la reprise
       précédente serait sinon manquée pour toujours */
    if (!/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
    var veille = new Date(Date.parse(iso) - 86400000);
    return isNaN(veille.getTime()) ? null : veille.toISOString().slice(0, 10);
  }
  if (!f.jours) return null;
  var d = new Date(Date.now() - f.jours * 86400000);
  return d.toISOString().slice(0, 10);
}

/* Y a-t-il de quoi faire une reprise incrémentale ? */
function repriseIncrementalePossible() {
  return /^\d{4}-\d{2}-\d{2}/.test(reglage(CLE_DERNIER_ISO).trim());
}

/* QUEL CHAMP DE DATE L'API ACCEPTE-T-ELLE ?
   `filter[updatedAt][gte]` a été refusé : « Champ de filtre non autorisé ».
   L'API tient donc une liste blanche, et elle n'est pas documentée ici. Plutôt
   que de deviner une fois pour toutes, on essaie les noms plausibles sur une
   requête d'une seule ligne, et on retient celui qui passe dans le document —
   la découverte n'a lieu qu'une fois.

   `aucun` est une réponse valable : si aucun champ n'est filtrable, la reprise
   incrémentale n'existe pas chez ce fournisseur, et il vaut mieux l'écrire que
   réessayer neuf appels à chaque fois. */
/* L'ADRESSE DE L'APPLICATION, QUI N'EST PAS CELLE DE L'API
   L'API répond sur une fonction cloud ; les humains, eux, ouvrent
   chu-rennes.smartof.app. On ne peut pas déduire l'une de l'autre, donc
   l'adresse de l'application est un réglage à part, avec une valeur par
   défaut qui couvre le cas du CHU. */
var CLE_APP = 'smartof_app';
var APP_DEFAUT = 'https://chu-rennes.smartof.app';

function app() {
  var v = reglage(CLE_APP).trim().replace(/\/+$/, '');
  return v || APP_DEFAUT;
}
/* Le lien vers une session dans SmartOF. Null si l'identifiant manque :
   mieux vaut pas de lien qu'un lien mort. */
function lienSession(uid) {
  var u = OF.texte(uid).trim();
  if (!u) return null;
  return app() + '/sessions-de-formation/' + encodeURIComponent(u) + '/info/parametres';
}
/* La fiche de l'entreprise : c'est elle qu'on ouvre pour reconnaître un
   établissement dont on n'a qu'un identifiant. */
function lienEntreprise(uid) {
  var u = OF.texte(uid).trim();
  if (!u) return null;
  return app() + '/entreprises/' + encodeURIComponent(u) + '/info';
}

var CLE_CHAMP_DATE = 'smartof_champ_date';
var CHAMPS_DATE = ['updatedAt', 'updated_at', 'lastModifiedAt', 'modifiedAt',
  'dateModification', 'date_modification', 'createdAt', 'created_at'];

function champDateRetenu() { return reglage(CLE_CHAMP_DATE).trim(); }

function trouverChampDate(borne, dire) {
  var connu = champDateRetenu();
  if (connu === 'aucun') return Promise.resolve(null);
  if (connu) return Promise.resolve(connu);

  var i = 0;
  function suivant() {
    if (i >= CHAMPS_DATE.length) {
      return ecrireReglage(CLE_CHAMP_DATE, 'aucun').then(function () { return null; });
    }
    var c = CHAMPS_DATE[i++];
    var essai = { limit: 1 };
    essai['filter[' + c + '][gte]'] = borne;
    dire('Recherche du champ de date accepté par l\'API : ' + c + '…');
    return appeler('/v2/session_formations', essai).then(function () {
      return ecrireReglage(CLE_CHAMP_DATE, c).then(function () { return c; });
    }).catch(function () { return suivant(); });
  }
  return suivant();
}

/* La syntaxe est `filter[champ][op]=valeur`. Un paramètre inconnu est ignoré
   en silence par l'API : écrire `updatedAt[gte]` au lieu de
   `filter[updatedAt][gte]` ne filtrerait rien et rapatrierait tout sans le
   dire. Un champ non autorisé, lui, fait une erreur 400 franche — ce qui est
   préférable, et ce qui a permis de s'en apercevoir. */
function parametresDeFenetre(fenetre, champDate) {
  var d = depuis(fenetre);
  var p = { limit: 200 };
  if (d && champDate) p['filter[' + champDate + '][gte]'] = d;
  return p;
}

/* Un filtre refusé ne doit jamais emporter la reprise : l'incrémental est une
   optimisation, pas la fonction. On repart sans filtre et on le dit. */
function filtreRefuse(e) {
  return /filtre|filter/i.test(e && e.message ? e.message : '');
}


function normaliser(code) {
  return String(code === null || code === undefined ? '' : code).trim().toUpperCase();
}
function codeGesform(instance, fiche) {
  var a = (instance && instance.custom_fields) || {};
  var b = (fiche && fiche.custom_fields) || {};
  return normaliser(a.custom_field_20 || b.custom_field_20 || '');
}

/* L'index du catalogue : le code Gesform peut être rangé dans `code`, ou
   dans une colonne dédiée si le document en a une. */
function indexCatalogue() {
  var idx = {};
  OF.table('Formations').forEach(function (f) {
    ['code_gesform', 'code'].forEach(function (col) {
      var c = normaliser(f[col]);
      if (c && !idx[c]) idx[c] = f.id;
    });
  });
  return idx;
}


/* ------------------------------------------------- correspondance Grist -- */
var SCHEMAS = {
  /* `Parametres` porte des nombres : une adresse et une clé n'en sont pas.
     Sans colonne texte, la configuration irait se perdre dans une colonne
     numérique — on le vérifie avant de proposer quoi que ce soit. */
  Parametres: [
    ['texte', 'Text', 'Valeur texte'],
  ],
  SmartOF_produits: [
    ['produit_uid', 'Text', 'Identifiant SmartOF du produit'],
    ['code_gesform', 'Text', 'Code Gesform'],
    ['nom', 'Text', 'Intitulé dans SmartOF'],
    ['formation', 'Ref:Formations', 'Formation du catalogue'],
  ],
  SmartOF_sessions: [
    ['uid', 'Text', 'Identifiant SmartOF'],
    ['custom_id', 'Text', 'Numéro de session'],
    ['nom', 'Text', 'Intitulé de la session'],
    ['date_debut', 'Date', 'Début'],
    ['date_fin', 'Date', 'Fin'],
    ['statut', 'Text', 'Statut'],
    ['lieu', 'Text', 'Lieu'],
    ['produit_uid', 'Text', 'Identifiant du produit'],
    ['produit_nom', 'Text', 'Produit de formation'],
    ['code_gesform', 'Text', 'Code Gesform'],
    ['archive', 'Bool', 'Archivée'],
    ['maj_le', 'Text', 'Modifiée le'],
  ],
  SmartOF_factures: [
    ['uid', 'Text', 'Identifiant SmartOF'],
    ['numero', 'Text', 'Numéro de facture'],
    ['session_uid', 'Text', 'Session'],
    ['commanditaire_uid', 'Text', 'Commanditaire'],
    ['destinataire', 'Text', 'Destinataire'],
    ['statut', 'Text', 'Statut'],
    ['date', 'Text', 'Émise le'],
    ['echeance', 'Text', 'Échéance'],
    ['montant_ht', 'Numeric', 'Montant HT'],
    ['montant_ttc', 'Numeric', 'Montant TTC'],
    ['avoirs', 'Numeric', 'Avoirs'],
    ['archive', 'Bool', 'Archivée'],
  ],
  /* UNE LIGNE PAR ENTREPRISE, PAS PAR SESSION
     SmartOF crée un commanditaire par session : le même établissement y
     revient à chaque fois. Le caractère interne ou externe d'une facturation,
     lui, est une propriété de l'établissement — on le pose une fois ici, et
     toutes ses sessions en héritent. C'est le lien un à plusieurs qui fait
     tout le travail.

     `facturation` est saisi à la main et n'est jamais réécrit par la synchro,
     exactement comme le rapprochement d'un produit au catalogue. */
  /* On n'exige que les deux colonnes qu'on ajoute : le libellé de
     l'organisation existe déjà dans le document, sous un nom qui lui est
     propre, et on le lit tel quel plutôt que d'en imposer un. */
  Organisations_clientes: [
    ['entreprise_uid', 'Text', 'Identifiant SmartOF de l\'entreprise'],
    ['facturation', 'Choice', 'Facturation'],
    ['categorie_tarifaire', 'Ref:Categories_tarifaires', 'Catégorie tarifaire'],
  ],
  /* LE SUIVI D'UN APPRENANT DANS UNE SESSION
     Une ligne par inscription : qui, chez quel commanditaire, dans quelle
     session, et ce que SmartOF en sait — statut réglementaire BPF, temps de
     présence, abandon éventuel.

     Le vocabulaire des statuts BPF n'est pas documenté dans l'API publique.
     On le stocke tel quel plutôt que de l'interpréter à l'écriture : c'est à
     l'écran de montrer les valeurs rencontrées et de laisser dire lesquelles
     comptent comme une absence. Une règle qu'on peut vérifier vaut mieux
     qu'une règle qu'on a devinée. */
  SmartOF_suivis: [
    ['uid', 'Text', 'Identifiant SmartOF du suivi'],
    ['apprenant_uid', 'Text', 'Apprenant'],
    ['commanditaire_uid', 'Text', 'Commanditaire'],
    ['session_uid', 'Text', 'Session'],
    ['type', 'Text', 'Type'],
    ['bpf_statut', 'Text', 'Statut BPF'],
    ['temps_present', 'Numeric', 'Temps de présence'],
    ['temps_prevu', 'Numeric', 'Temps prévu en fin d\'exercice'],
    ['abandon_statut', 'Text', 'Abandon'],
    ['abandon_date', 'Text', 'Date d\'abandon'],
    /* LES ÉMARGEMENTS, COMPTÉS PLUTÔT QUE STOCKÉS
       Un émargement par apprenant et par créneau : sur ce document, huit
       mille suivis feraient vite cinquante mille lignes. On garde le compte
       par inscription — c'est tout ce que l'assiduité demande, et la table
       reste lisible à l'œil comme au chargement. */
    ['creneaux', 'Int', 'Créneaux émargés'],
    ['presences', 'Int', 'Présences'],
    ['absences', 'Int', 'Absences'],
    ['en_attente', 'Int', 'Émargements en attente'],
    ['minutes_partielles', 'Int', 'Minutes d\'émargement partiel'],
  ],
  SmartOF_commanditaires: [
    ['uid', 'Text', 'Identifiant SmartOF'],
    ['session_uid', 'Text', 'Session'],
    ['entreprise_uid', 'Text', 'Entreprise'],
    ['entreprise_nom', 'Text', 'Organisation'],
    ['type', 'Text', 'Type'],
    ['nb_apprenants', 'Int', 'Apprenants inscrits'],
    ['budget', 'Numeric', 'Budget'],
    ['custom_id', 'Text', 'Référence'],
  ],
};

/* Grist dérive l'identifiant d'une table de son libellé : « SmartOF Produits »
   donne SmartOF_Produits, « SmartOF produits » donne SmartOF_produits. Exiger
   une casse exacte ferait déclarer absente une table qui est là, sous les
   yeux. On résout donc au plus proche, et on retient le nom réel. */
var NOMS_REELS = {};

function resoudreTables() {
  var connues = Object.keys(OF.doc.colonnes || {});
  NOMS_REELS = {};
  Object.keys(SCHEMAS).forEach(function (attendu) {
    if (connues.indexOf(attendu) >= 0) { NOMS_REELS[attendu] = attendu; return; }
    var bas = attendu.toLowerCase();
    var proche = connues.filter(function (t) { return t.toLowerCase() === bas; })[0];
    NOMS_REELS[attendu] = proche || null;
  });
  return NOMS_REELS;
}
function vraiNom(t) { return NOMS_REELS[t] || t; }

/* Les tables du document dont le nom évoque SmartOF : sert à montrer ce que
   le widget voit vraiment quand il ne trouve pas ce qu'il cherche. */
function tablesVoisines() {
  /* Les tables déjà reconnues ne sont pas des candidates : les citer ferait
     croire qu'il faut renommer celles qui marchent. */
  var prises = Object.keys(NOMS_REELS).map(function (t) { return NOMS_REELS[t]; });
  return Object.keys(OF.doc.colonnes || {})
    .filter(function (t) { return /smartof/i.test(t) && prises.indexOf(t) < 0; }).sort();
}

/* TOUT N'EST PAS INDISPENSABLE À LA REPRISE
   Les organisations servent à ventiler le facturé : c'est un enrichissement,
   pas le cœur du travail. Bloquer la reprise des sessions et des factures
   parce qu'une colonne d'enrichissement manque reviendrait à tout arrêter
   pour un supplément — la même erreur que le filtre de date qui faisait
   échouer la synchro entière.

   Les colonnes manquantes restent signalées et créables ; seules celles-ci
   empêchent de tourner. */
var TABLES_FACULTATIVES = { Organisations_clientes: true, SmartOF_suivis: true };
/* Certaines colonnes enrichissent une table indispensable sans l'être :
   le nom de l'entreprise sur un commanditaire sert à l'affichage, le
   facturé se ventile très bien sans lui. */
var COLONNES_FACULTATIVES = { entreprise_nom: true };
function colonnesIndispensables() {
  return colonnesManquantes().filter(function (m) {
    var t = nomAttendu(m[0]);
    if (TABLES_FACULTATIVES[m[0]] || TABLES_FACULTATIVES[t]) return false;
    return !(m[1] && COLONNES_FACULTATIVES[m[1][0]]);
  });
}
/* Retrouver le nom canonique derrière le nom réel d'une table. */
function nomAttendu(reel) {
  var trouve = null;
  Object.keys(NOMS_REELS).forEach(function (a) {
    if (NOMS_REELS[a] === reel) trouve = a;
  });
  return trouve || reel;
}

function colonnesManquantes() {
  var manque = [];
  resoudreTables();
  Object.keys(SCHEMAS).forEach(function (t) {
    var reel = NOMS_REELS[t];
    var meta = reel && OF.doc.colonnes[reel];
    if (!meta || !Object.keys(meta).length) { manque.push([t, null]); return; }
    SCHEMAS[t].forEach(function (c) { if (!meta[c[0]]) manque.push([reel, c]); });
  });
  return manque;
}


/* ------------------------------------------------------- transformation -- */
function jour(iso) {
  if (!iso) return null;
  var d = new Date(iso);
  return isNaN(d) ? null : Math.floor(d.getTime() / 1000);
}
function lieuDe(meta) {
  var l = (meta && meta.lieu) || {};
  return OF.texte(l.lieuLibre) || OF.texte(l.nom) || OF.texte(l.typeLieu) || '';
}

function sessionVersGrist(s, fiches) {
  var pi = s.produitInstance || {};
  var meta = s.meta || {};
  return {
    uid: s.sessionUid || '',
    custom_id: String(s.customId === null || s.customId === undefined ? '' : s.customId),
    nom: OF.texte(meta.nom),
    date_debut: jour(meta.dateDebut),
    date_fin: jour(meta.dateFin),
    statut: OF.texte(meta.status),
    lieu: lieuDe(meta),
    produit_uid: pi.produitFormationUid || '',
    produit_nom: OF.texte(pi.meta && pi.meta.nom),
    code_gesform: codeGesform(pi, fiches[pi.produitFormationUid]),
    archive: archiveVrai(s.archive),
    maj_le: OF.texte(s.updatedAt),
  };
}

/* UNE FACTURE ARCHIVÉE RESTE UNE FACTURE
   Première version : les factures archivées étaient exclues du facturé,
   comme les sessions archivées le sont du vendu. C'était faux. Chez SmartOF,
   archiver une facture la range, ne l'annule pas — elle reste due et payée.
   Les exclure retirait du chiffre d'affaires réel, en silence, et le
   « facturé » affiché était un minimum sans que rien ne le dise.

   La règle est donc : une facture compte, sauf si elle est annulée. Un avoir
   n'annule pas non plus — il se déduit, ce qui est déjà fait.

   Le vocabulaire exact des statuts n'est pas documenté ici : l'écran affiche
   donc le facturé statut par statut, pour que la règle se vérifie au lieu de
   se croire. */
var STATUTS_ANNULES = ['annule', 'annulee', 'annulées', 'cancelled', 'canceled',
  'void', 'abandonne', 'abandonnee', 'supprimee', 'supprime'];
function sansAccentSync(t) {
  return String(t === null || t === undefined ? '' : t)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}
function statutAnnule(v) {
  var t = sansAccentSync(v);
  if (!t) return false;
  return STATUTS_ANNULES.some(function (x) { return sansAccentSync(x) === t; });
}
/* La seule porte d'entrée pour décider qu'une facture compte. */
function factureCompte(f) {
  return !statutAnnule(f && f.statut);
}

/* ARCHIVÉ OU NON : NE PAS SE FIER À `!!`
   `!!s.archive` paraissait sûr. Il ne l'est pas : si l'API renvoie la chaîne
   « false », une date, ou n'importe quel libellé, `!!` répond vrai — et toutes
   les sessions se retrouvent archivées. Le pilotage les exclut alors des
   totaux, qui tombent à zéro pendant que le détail, lui, affiche les montants.
   On ne marque donc archivé que ce qui se lit comme tel. */
function archiveVrai(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v === 1;
  if (typeof v === 'string') {
    var t = v.trim().toLowerCase();
    return t === 'true' || t === 'oui' || t === 'vrai' || t === '1'
      || t === 'y' || t === 'yes';
  }
  return false;
}

/* LES MONTANTS D'UNE FACTURE
   La documentation nomme `priceDetails` et `avoirsSummary` sans dire ce
   qu'ils contiennent. Plutôt que de parier sur `totalHT`, on cherche la
   première valeur numérique dont le nom de champ correspond — et le bouton
   « Voir une facture » permet de vérifier sur un cas réel. Ce qui n'est pas
   trouvé vaut zéro et se voit, plutôt que de faire échouer la reprise. */
/* Les noms de champ sont en camelCase (`totalHT`) ou en serpent (`total_ht`) :
   un motif qui exigerait un séparateur avant « HT » raterait le premier, et
   un motif insensible à la casse confondrait `totalTVA` avec `totalHT`. D'où
   un test par nom plutôt qu'une expression unique. */
function estHT(k) {
  var bas = k.toLowerCase();
  return /HT$/.test(k) || /(^|_)ht$/.test(bas) || /horstaxe|hors_taxe/.test(bas)
    || /excl/.test(bas);
}
function estTTC(k) {
  var bas = k.toLowerCase();
  return /TTC$/.test(k) || /(^|_)ttc$/.test(bas) || /toutestaxes/.test(bas)
    || /incl/.test(bas);
}
function estTVA(k) {
  var bas = k.toLowerCase();
  return /TVA$/.test(k) || /(^|_)tva$/.test(bas) || /\bvat\b/.test(bas) || /taxe?s?$/.test(bas);
}

function montant(objet, test, profondeur) {
  if (!objet || typeof objet !== 'object') return null;
  var cles = Object.keys(objet);
  for (var i = 0; i < cles.length; i++) {
    var v = objet[cles[i]];
    if (typeof v === 'number' && test(cles[i])) return v;
  }
  if ((profondeur || 0) >= 2) return null;
  for (var j = 0; j < cles.length; j++) {
    var sous = montant(objet[cles[j]], test, (profondeur || 0) + 1);
    if (sous !== null) return sous;
  }
  return null;
}

/* Si le HT n'est pas publié mais que TTC et TVA le sont, il se déduit —
   mieux vaut une soustraction exacte qu'un zéro qui se lira « rien ». */
/* LA DOCUMENTATION NE DIT NI LE TYPE DE `budget` NI LA FORME DE `priceDetails`
   Et `budget` n'est même pas filtrable, ce qui trahit un type composé. Il peut
   donc être un nombre, un objet, ou une liste de lignes de tarif. On accepte
   les trois plutôt que de parier — et quand rien n'est reconnu, le rapport
   montre la forme réelle au lieu d'afficher un zéro muet. */
function toujours() { return true; }

/* ============================ LA FORME EXACTE, D'APRÈS LE SCHÉMA DE L'API ==
   `budget` (commanditaire) et `priceDetails` (facture) sont des LISTES de
   lignes tarifaires, de la même forme :
       { libelle, quantite, unite, prixUnitaireHT, tva, … }
   Le montant HT d'une ligne vaut donc quantite × prixUnitaireHT, et rien
   d'autre. Lire « le premier nombre rencontré » donnerait le prix unitaire
   d'une seule ligne — juste assez plausible pour ne pas se voir.

   `avoirsSummary` donne ses totaux en CENTIMES : totalHTCts, totalTTCCts.
   Pris pour des euros, ils seraient faux d'un facteur cent.

   Ces lectures-ci sont explicites. La lecture tolérante qui suit ne sert plus
   que de filet, si SmartOF change la forme de ses réponses. */

function lignesTarifaires(liste) {
  if (!Array.isArray(liste) || !liste.length) return null;
  var ht = 0, ttc = 0, vu = false;
  liste.forEach(function (l) {
    if (!l || typeof l !== 'object' || typeof l.prixUnitaireHT !== 'number') return;
    var q = typeof l.quantite === 'number' ? l.quantite : 1;
    var montantLigne = l.prixUnitaireHT * q;
    /* `tva` peut être un taux (0,2) ou un pourcentage (20) : au-delà de 1,
       c'est forcément un pourcentage — aucune TVA ne vaut 2000 %. */
    var tva = typeof l.tva === 'number' ? (l.tva > 1 ? l.tva / 100 : l.tva) : 0;
    ht += montantLigne;
    ttc += montantLigne * (1 + tva);
    vu = true;
  });
  return vu ? { ht: ht, ttc: ttc } : null;
}

function centimes(v) { return typeof v === 'number' ? v / 100 : null; }

function avoirsDe(f) {
  var a = f.avoirsSummary;
  if (!a || typeof a !== 'object') return 0;
  var c = centimes(a.totalHTCts);
  if (c !== null) return c;
  /* filet : une somme des avoirs détaillés, eux aussi en centimes */
  if (Array.isArray(a.avoirs) && a.avoirs.length) {
    var t = 0, vu = false;
    a.avoirs.forEach(function (x) {
      var v = centimes(x && x.totalHTCts);
      if (v !== null) { t += v; vu = true; }
    });
    if (vu) return t;
  }
  return 0;
}

function nombreSouple(t) {
  /* « 1 200,50 » est un montant : les espaces fines et la virgule décimale
     ne doivent pas le réduire à 1. */
  var n = parseFloat(String(t).replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  return isNaN(n) ? null : n;
}

function ligneMontant(x, test) {
  if (typeof x === 'number') return x;
  if (typeof x === 'string') return nombreSouple(x);
  if (!x || typeof x !== 'object') return null;
  /* On cherche la quantité AVANT le reste : un prix unitaire pris seul
     sous-compterait la ligne d'un facteur égal au nombre d'inscrits. */
  var q = montant(x, function (k) {
    return /quantit|qty|nombre|^nb|participant|effectif|places?$/i.test(k);
  }, 0);
  var pu = montant(x, function (k) {
    return /prix|price|unitaire|tarif/i.test(k);
  }, 0);
  if (pu !== null && q) return pu * q;
  var direct = montant(x, test, 0);
  if (direct !== null) return direct;
  return pu;
}

function sommeMontants(v, test) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return nombreSouple(v);
  if (Array.isArray(v)) {
    var t = 0, vu = false;
    v.forEach(function (x) {
      var m = ligneMontant(x, test || toujours);
      if (m !== null) { t += m; vu = true; }
    });
    return vu ? t : null;
  }
  if (typeof v === 'object') {
    /* Avec un critère précis — HT, TTC, TVA — on vise d'abord le champ
       nommé : un total publié vaut mieux qu'une somme de lignes recalculée.
       Sans critère, c'est l'inverse : la somme des lignes vaut mieux que la
       première valeur numérique rencontrée en descendant. */
    if (test && test !== toujours) {
      var vise = montant(v, test, 0);
      if (vise !== null) return vise;
    }
    var cles = Object.keys(v);
    for (var i = 0; i < cles.length; i++) {
      if (Array.isArray(v[cles[i]]) && v[cles[i]].length) {
        var s2 = sommeMontants(v[cles[i]], test);
        if (s2 !== null) return s2;
      }
    }
    return montant(v, test || toujours, 0);
  }
  return null;
}

function montantHT(f) {
  var exact = lignesTarifaires(f.priceDetails);
  if (exact) return exact.ht;
  var ht = sommeMontants(f.priceDetails, estHT);
  if (ht !== null) return ht;
  var ttc = sommeMontants(f.priceDetails, estTTC);
  var tva = sommeMontants(f.priceDetails, estTVA);
  if (ttc !== null && tva !== null) return ttc - tva;
  /* aucun nom reconnu : on prend ce qu'on trouve plutôt que rien */
  var brut = sommeMontants(f.priceDetails, toujours);
  return brut === null ? 0 : brut;
}

function factureVersGrist(f) {
  var a = f.association || {};
  var m = f.meta || {};
  return {
    uid: f.factureUid || '',
    numero: OF.texte(f.factureNumber),
    session_uid: a.sessionUid || '',
    commanditaire_uid: a.commanditaireUid || '',
    destinataire: OF.texte(m.nomDuDestinataire),
    statut: OF.texte(m.internalStatus),
    date: OF.texte(f.createdAt),
    echeance: OF.texte(f.dateEcheance),
    montant_ht: montantHT(f),
    montant_ttc: (lignesTarifaires(f.priceDetails) || {}).ttc
      || sommeMontants(f.priceDetails, estTTC)
      || sommeMontants(f.priceDetails, toujours) || 0,
    avoirs: avoirsDe(f),
    archive: archiveVrai(f.archived),
  };
}

/* Le nom lisible d'une entreprise commanditaire. SmartOF le place selon les
   cas dans `nom`, dans `entreprise.nom` ou dans `meta.nom` : on prend le
   premier qui existe plutôt que de parier sur une forme. */
function nomEntreprise(c) {
  if (!c) return '';
  var pistes = [c.nom, c.entrepriseNom, c.raisonSociale,
    c.entreprise && c.entreprise.nom,
    c.entreprise && c.entreprise.raisonSociale,
    c.entreprise && c.entreprise.meta && c.entreprise.meta.nom,
    c.entreprise && c.entreprise.meta && c.entreprise.meta.raisonSociale,
    c.meta && c.meta.nom,
    c.meta && c.meta.raisonSociale,
    c.meta && c.meta.nomDuCommanditaire,
    c.meta && c.meta.nomDuDestinataire,
    c.organisation && c.organisation.nom,
    c.client && c.client.nom];
  for (var i = 0; i < pistes.length; i++) {
    var v = OF.texte(pistes[i]).trim();
    if (v) return v;
  }
  return '';
}

/* Les entreprises rencontrées, dédoublonnées par leur identifiant SmartOF.
   Un même établissement commandite plusieurs sessions : c'est tout l'intérêt
   de la table. */
function entreprisesDe(commanditaires) {
  var par = {};
  (commanditaires || []).forEach(function (c) {
    var u = OF.texte(c.entrepriseUid).trim();
    if (!u) return;
    var n = nomEntreprise(c);
    /* le premier nom non vide gagne : certaines lignes ne le portent pas */
    if (!par[u]) par[u] = { entreprise_uid: u, nom: n };
    else if (!par[u].nom && n) par[u].nom = n;
  });
  return Object.keys(par).map(function (k) { return par[k]; });
}

/* LE LIBELLÉ D'UNE ORGANISATION, SOUS LE NOM QUE LE DOCUMENT LUI DONNE
   La table existait avant ce widget : sa colonne de libellé s'appelle
   `organisation` et non `nom`. On la cherche plutôt que de l'imposer —
   renommer la colonne d'un document déjà rempli serait une mauvaise façon
   de se présenter. */
var COLS_NOM_ORG = ['organisation', 'nom', 'intitule', 'libelle', 'raison_sociale'];
function colonneNomOrg() {
  var T = vraiNom('Organisations_clientes');
  var meta = (OF.doc.colonnes || {})[T] || {};
  for (var i = 0; i < COLS_NOM_ORG.length; i++) {
    if (meta[COLS_NOM_ORG[i]]) return COLS_NOM_ORG[i];
  }
  var l = OF.table(T)[0];
  if (l) {
    for (var k = 0; k < COLS_NOM_ORG.length; k++) {
      if (COLS_NOM_ORG[k] in l) return COLS_NOM_ORG[k];
    }
  }
  return null;
}
function nomOrganisation(l) {
  var c = colonneNomOrg();
  return c ? OF.texte(l[c]) : '';
}

/* RAPPROCHER SANS DUPLIQUER — ET SANS DEVINER
   Le document contient déjà les organisations, saisies à la main et sans
   identifiant SmartOF. Créer une ligne par entreprise rencontrée doublerait
   la table ; on rapproche donc par le nom.

   Mais seulement par une égalité franche, une fois mis de côté les accents,
   la casse, la ponctuation et les espaces. J'avais d'abord ajouté un
   dépliage des sigles — CH, CHU, GHT — pour attraper plus de cas : c'était
   une erreur. « CH Saint-Malo » et « CHU Saint-Malo » ne sont pas le même
   établissement, et un rapprochement faux est pire qu'un rapprochement
   manquant : il attache un identifiant à la mauvaise ligne, et tout le
   facturé part ensuite dans le mauvais panier, en silence.

   Ce qui ne correspond pas exactement devient une ligne neuve, signalée.
   Fusionner deux lignes est l'affaire d'une minute ; retrouver un ventilé
   faussé est l'affaire d'un après-midi. */
function clefNom(t) {
  return String(t === null || t === undefined ? '' : t)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/* Les actions à appliquer sur la table des organisations : compléter les
   lignes existantes, n'ajouter que le reste. */
function organisationsPretes() {
  var T = NOMS_REELS.Organisations_clientes;
  if (!T) return false;
  var meta = (OF.doc.colonnes || {})[T] || {};
  return !!meta.entreprise_uid;
}

function rapprocherOrganisations(commanditaires, bilan) {
  if (!organisationsPretes()) {
    bilan.avertissements.push('Les organisations clientes n\'ont pas été mises à jour : '
      + 'la table Organisations_clientes ou sa colonne entreprise_uid manque. Le bouton '
      + '« créer les colonnes » la prépare ; sans elle, le facturé ne peut pas être '
      + 'ventilé entre interne et externe.');
    return [];
  }
  var T = vraiNom('Organisations_clientes');
  var lignes = OF.table(T);
  var colNom = colonneNomOrg();
  var parUid = {}, parNom = {};
  lignes.forEach(function (l) {
    var u = OF.texte(l.entreprise_uid).trim();
    if (u) parUid[u] = l;
    var k = clefNom(nomOrganisation(l));
    if (k && !parNom[k]) parNom[k] = l;
  });

  var actions = [], ajoutees = 0, rattachees = 0, sansNom = 0;
  entreprisesDe(commanditaires).forEach(function (e) {
    if (parUid[e.entreprise_uid]) { bilan.inchangees++; return; }
    var deja = e.nom ? parNom[clefNom(e.nom)] : null;
    if (deja) {
      /* la ligne existe sous ce nom : on lui pose l'identifiant, et on ne
         touche à rien d'autre — surtout pas à ce qui a été saisi à la main */
      actions.push(['UpdateRecord', T, deja.id,
        restreindre(T, { entreprise_uid: e.entreprise_uid }, bilan)]);
      parUid[e.entreprise_uid] = deja;
      rattachees++;
      return;
    }
    /* SANS NOM, ON N'AJOUTE RIEN
       Une ligne qui ne porte qu'un identifiant n'est pas une organisation :
       c'est une ligne vide avec un UUID dedans. En créer deux cents a rendu
       la table illisible et l'écran incompréhensible — des UUID partout là
       où on attend des noms d'hôpitaux. Ces entreprises-là se rattachent à
       la main, dans la section de rapprochement, où elles sont présentées
       avec leur facturé et le destinataire de leurs factures. */
    if (!e.nom) { sansNom++; return; }
    var neuf = { entreprise_uid: e.entreprise_uid };
    if (colNom) neuf[colNom] = e.nom;
    actions.push(['AddRecord', T, null, restreindre(T, neuf, bilan)]);
    ajoutees++;
  });

  if (rattachees) {
    bilan.avertissements.push(OF.plur(rattachees, 'organisation') + ' du document '
      + OF.accord(rattachees, 'a été rattachée', 'ont été rattachées')
      + ' à son identifiant SmartOF par son nom. À vérifier une fois, dans '
      + T + '.');
  }
  if (ajoutees) {
    bilan.avertissements.push(OF.plur(ajoutees, 'organisation') + ' '
      + OF.accord(ajoutees, 'a été ajoutée', 'ont été ajoutées') + ' à ' + T
      + ' : aucun nom du document ne correspondait exactement. Si l\'une d\'elles '
      + 'existe déjà sous une autre orthographe, fusionnez les deux lignes — le '
      + 'rapprochement automatique ne devine pas, pour ne pas ventiler le facturé '
      + 'sur le mauvais établissement. Leur facturation reste à qualifier.');
  }
  if (sansNom) {
    bilan.avertissements.push(OF.plur(sansNom, 'entreprise') + ' de SmartOF '
      + OF.accord(sansNom, 'n\'a', 'n\'ont') + ' pas de nom exploitable dans l\'API : '
      + OF.accord(sansNom, 'elle n\'a', 'elles n\'ont') + ' pas été '
      + OF.accord(sansNom, 'ajoutée', 'ajoutées') + ' pour ne pas remplir ' + T
      + ' de lignes sans intitulé. Elles se rattachent dans la section '
      + '« Rapprocher les organisations », où leur facturé et le destinataire de leurs '
      + 'factures permettent de les reconnaître.');
  }
  bilan.ajoutees += ajoutees;
  bilan.corrigees += rattachees;
  return actions;
}

/* Un chemin pointé, lu sans supposer que les niveaux existent. */
function creux(o, chemin) {
  var p = chemin.split('.');
  var v = o;
  for (var i = 0; i < p.length; i++) {
    if (v === null || v === undefined || typeof v !== 'object') return undefined;
    v = v[p[i]];
  }
  return v;
}
function nombreOuNul(v) {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/* LE STATUT D'UN ÉMARGEMENT SE LIT DANS SON DERNIER LOG
   L'API le dit : « un émargement n'a pas de champ statut de premier niveau ».
   L'état courant est celui du log le plus récent de `history`, trié par
   `createdAt` décroissant. Prendre le premier élément du tableau sans
   regarder la date reviendrait à lire un état au hasard. */
function dernierLog(e) {
  var h = (e && e.history) || [];
  if (!Array.isArray(h) || !h.length) return null;
  var mieux = null, quand = null;
  h.forEach(function (l) {
    var t = Date.parse(OF.texte(l && l.createdAt));
    if (mieux === null || (!isNaN(t) && (quand === null || isNaN(quand) || t > quand))) {
      mieux = l; quand = t;
    }
  });
  return mieux;
}

/* Trois états possibles — Présent, Absent, En attente — et le troisième
   n'est pas une absence : c'est une feuille non signée. Les confondre
   gonflerait l'absentéisme de tout ce qui n'a pas encore été émargé. */
function etatEmargement(e) {
  var l = dernierLog(e);
  var st = sansAccentSync(creux(l || {}, 'logInfo.status'));
  if (st === 'present') return 'present';
  if (st === 'absent') return 'absent';
  return 'attente';
}
function minutesPartielles(e) {
  var l = dernierLog(e);
  var m = creux(l || {}, 'logInfo.emargementPartiel');
  return typeof m === 'number' && isFinite(m) ? m : 0;
}

/* LES ÉMARGEMENTS SE LISENT SESSION PAR SESSION
   L'API n'offre aucun filtre de date dessus : le seul chemin documenté est
   `filter[sessionUid][eq]`, une requête par session. C'est long sur une
   reprise complète — mais sur une reprise incrémentale, la fenêtre a déjà
   réduit la liste des sessions, et les émargements suivent sans effort.

   Une session qui échoue n'emporte pas les autres : on compte les ratées et
   on le dit. Un taux de présence calculé sur un échantillon muet vaudrait
   moins que pas de taux du tout. */
function lireEmargements(sessions, dire, bilan) {
  var uids = [];
  (sessions || []).forEach(function (s) {
    var u = OF.texte(s && s.sessionUid).trim();
    if (u) uids.push(u);
  });
  if (!uids.length) return Promise.resolve([]);

  var tout = [], rates = 0, i = 0;
  function suivante() {
    if (i >= uids.length) return Promise.resolve(tout);
    var u = uids[i++];
    dire('Émargements : ' + i + ' session(s) sur ' + uids.length + '…');
    var p = { limit: 1000 };
    p['filter[sessionUid][eq]'] = u;
    return parcourir('/v2/emargements', p, function () {})
      .then(function (liste) { tout = tout.concat(liste); })
      .catch(function () { rates++; })
      .then(suivante);
  }
  return suivante().then(function () {
    if (rates) {
      bilan.avertissements.push(OF.plur(rates, 'session') + ' sur ' + uids.length
        + ' n\'a pas rendu ses émargements : l\'assiduité de '
        + OF.accord(rates, 'celle-là est incomplète', 'celles-là est incomplète') + '.');
    }
    bilan.emargements = tout.length;
    return tout;
  });
}

/* Les émargements ramenés à un compte par inscription : la clé est le
   couple session + apprenant, qui est aussi ce qui identifie un suivi. */
function compterEmargements(emargements) {
  var par = {};
  (emargements || []).forEach(function (e) {
    if (!e) return;
    var cle = OF.texte(e.sessionUid) + '|' + OF.texte(e.userUid);
    var c = par[cle] = par[cle]
      || { creneaux: 0, presences: 0, absences: 0, en_attente: 0, minutes_partielles: 0 };
    c.creneaux++;
    var etat = etatEmargement(e);
    if (etat === 'present') c.presences++;
    else if (etat === 'absent') c.absences++;
    else c.en_attente++;
    c.minutes_partielles += minutesPartielles(e);
  });
  return par;
}

function suiviVersGrist(s) {
  return {
    uid: s.suiviApprenantUid || s.uid || '',
    apprenant_uid: OF.texte(s.apprenantUid),
    commanditaire_uid: OF.texte(s.commanditaireUid),
    session_uid: OF.texte(s.sessionUid),
    type: OF.texte(s.type),
    bpf_statut: OF.texte(creux(s, 'metaBPF.status')),
    temps_present: nombreOuNul(creux(s, 'metaBPF.tempsPresent')),
    temps_prevu: nombreOuNul(creux(s, 'metaBPF.tempsPresentExerciceFin')),
    abandon_statut: OF.texte(creux(s, 'abandonInfo.status')),
    abandon_date: OF.texte(creux(s, 'abandonInfo.dateAbandon')),
  };
}

/* Le suivi, augmenté de ses émargements quand on les a. Sans eux, on ne
   touche pas aux compteurs : les écraser avec des zéros effacerait la
   reprise précédente à chaque rafraîchissement incrémental. */
function suiviAvecEmargements(s, comptes) {
  var l = suiviVersGrist(s);
  if (!comptes) return l;
  var c = comptes[OF.texte(s.sessionUid) + '|' + OF.texte(s.apprenantUid)];
  if (!c) return l;
  l.creneaux = c.creneaux;
  l.presences = c.presences;
  l.absences = c.absences;
  l.en_attente = c.en_attente;
  l.minutes_partielles = Math.round(c.minutes_partielles);
  return l;
}

function commanditaireVersGrist(c) {
  return {
    uid: c.commanditaireUid || '',
    session_uid: c.sessionUid || '',
    entreprise_uid: c.entrepriseUid || '',
    entreprise_nom: nomEntreprise(c),
    type: OF.texte(c.type),
    nb_apprenants: (c.apprenantUids || []).length,
    budget: (lignesTarifaires(c.budget) || {}).ht
      || sommeMontants(c.budget, toujours) || 0,
    custom_id: String(c.customId === null || c.customId === undefined ? '' : c.customId),
  };
}


/* ---------------------------------------------------------- écriture --- */
/* Comparaison champ à champ avant d'écrire : réécrire une ligne identique
   ferait un historique de modifications illisible dans Grist, et donnerait
   un rapport où tout paraît avoir changé à chaque passage. */
function different(ligne, voulu) {
  return Object.keys(voulu).some(function (k) {
    var a = ligne[k], b = voulu[k];
    if (a === null || a === undefined) a = '';
    if (b === null || b === undefined) b = '';
    if (typeof b === 'boolean') return !!a !== b;
    if (typeof b === 'number') return Math.abs((a || 0) - b) > 0.0001;
    return String(a) !== String(b);
  });
}

/* ÉCRIRE SEULEMENT DANS LES COLONNES QUI EXISTENT
   Une colonne absente faisait échouer l'écriture entière, donc la reprise.
   C'est la même erreur que le filtre de date qui emportait la synchro : un
   supplément ne doit jamais faire tomber l'essentiel. On retire les champs
   sans colonne, et on dit une fois lesquels — pour qu'un champ qui
   n'arrive jamais ne passe pas inaperçu. */
function restreindre(table, objet, bilan) {
  var meta = (OF.doc.colonnes || {})[table];
  if (!meta || !Object.keys(meta).length) return objet;
  var out = {}, retires = [];
  Object.keys(objet).forEach(function (k) {
    if (meta[k]) out[k] = objet[k];
    else retires.push(k);
  });
  if (retires.length && bilan) {
    bilan.champsIgnores = bilan.champsIgnores || {};
    retires.forEach(function (k) { bilan.champsIgnores[table + '.' + k] = true; });
  }
  return out;
}

function fusionner(table, voulus, cle, bilan) {
  var parCle = {};
  OF.table(table).forEach(function (l) {
    var k = OF.texte(l[cle]);
    if (k && !parCle[k]) parCle[k] = l;
  });
  var actions = [];
  voulus.forEach(function (v) {
    var k = OF.texte(v[cle]);
    if (!k) { bilan.avertissements.push(table + ' : un enregistrement sans identifiant a été ignoré'); return; }
    var r = restreindre(table, v, bilan);
    var l = parCle[k];
    if (!l) { actions.push(['AddRecord', table, null, r]); bilan.ajoutees++; return; }
    if (different(l, r)) { actions.push(['UpdateRecord', table, l.id, r]); bilan.corrigees++; }
    else bilan.inchangees++;
  });
  return actions;
}

/* Les noms de collection ne suivent pas les adresses de la documentation :
   la page « sessions-de-formation » expose /v2/session_formations. On essaie
   donc les formes plausibles — et surtout, un échec ici n'interrompt rien.
   Les fiches produit ne servent qu'à retrouver le code Gesform quand
   l'instance ne le porte pas : sans elles, on continue avec ce qu'on a, et
   on le dit. */
var COLLECTIONS_PRODUITS = [
  '/v2/produit_formations', '/v2/produits_formations',
  '/v2/produit_formation', '/v2/produits-de-formation',
];

function lireProduits(dire, bilan) {
  var reste = COLLECTIONS_PRODUITS.slice();
  function suivant() {
    if (!reste.length) {
      bilan.avertissements.push('Aucune collection de produits de formation n\'a répondu ('
        + COLLECTIONS_PRODUITS.join(', ') + '). Le code Gesform n\'a été cherché que sur '
        + 'l\'instance du produit portée par chaque session. Si des produits ressortent sans '
        + 'code, c\'est de là que ça vient — dites-moi le vrai nom de la collection.');
      return Promise.resolve([]);
    }
    var chemin = reste.shift();
    return parcourir(chemin, { limit: 200 }, function (n) {
      dire('Produits de formation : ' + n + ' lus…');
    }).then(function (liste) {
      if (chemin !== COLLECTIONS_PRODUITS[0]) {
        bilan.avertissements.push('Les produits de formation ont répondu sur ' + chemin
          + ' et non sur ' + COLLECTIONS_PRODUITS[0] + '.');
      }
      return liste;
    }).catch(function (e) {
      if (/404|inconnue/i.test(e.message)) return suivant();
      /* Les fiches produit sont un complément : une pagination qui coince de
         leur côté ne doit pas emporter le vendu, pas plus qu'un 404. */
      bilan.avertissements.push('Produits de formation non repris (' + e.message
        + '). Le code Gesform n\'a été cherché que sur l\'instance portée par chaque session.');
      return [];
    });
  }
  return suivant();
}


/* LE RAFRAÎCHISSEMENT, SANS ÉCRAN
   Le même moteur sert deux boutons : celui du widget SmartOF et celui du
   pilotage. Il ne touche donc aucun élément de page — il annonce où il en est
   par `dire`, et rend son bilan en promesse. Dupliquer sept cents lignes pour
   un second bouton aurait garanti que les deux divergent au premier correctif.

   options = { fenetre: '7' | '30' | '90' | 'tout', dire: fonction }
   La promesse rend le bilan, ou la rejette avec le message à afficher. */
function rafraichir(options) {
  options = options || {};
  var fenetre = options.fenetre || 'tout';
  var dire = options.dire || function () {};

  if (enCours) return Promise.reject(new Error('Un rafraîchissement est déjà en cours'));
  if (!configure()) {
    return Promise.reject(new Error('L\'adresse et la clé SmartOF ne sont pas renseignées : '
      + 'elles se saisissent dans le widget SmartOF, et vivent dans la table Parametres.'));
  }
  var manque = colonnesIndispensables();
  if (manque.length) {
    return Promise.reject(new Error('Des colonnes manquent dans le document : '
      + manque.slice(0, 4).map(function (m) {
          return m[1] ? m[0] + '.' + m[1][0] : 'la table ' + m[0];
        }).join(', ')
      + (manque.length > 4 ? '…' : '')
      + '. Le widget SmartOF propose de les créer.'));
  }

  enCours = true;
  var bilan = { lues: 0, pages: 0, ajoutees: 0, corrigees: 0, inchangees: 0,
    avertissements: [], fenetre: fenetre, borne: depuis(fenetre) };
  if (fenetre === 'depuis' && !bilan.borne) {
    bilan.avertissements.push('Aucune reprise précédente n\'est enregistrée : tout a été '
      + 'repris, sans filtre de date. Les prochaines reprises pourront partir de celle-ci.');
  }

  var sessions = [], commanditaires = [], factures = [], suivis = [], emargements = [],
    fiches = {};

  var params = { limit: 200 };
  var prepare = bilan.borne
    ? trouverChampDate(bilan.borne, dire).then(function (champ) {
        if (champ) {
          bilan.champDate = champ;
          params = parametresDeFenetre(fenetre, champ);
        } else {
          bilan.borne = null;
          bilan.avertissements.push('L\'API n\'accepte de filtre de date sur aucun des noms '
            + 'connus : la reprise a porté sur tout, sans filtre. C\'est plus long, mais rien '
            + 'n\'est oublié.');
        }
      })
    : Promise.resolve();

  return prepare.then(function () {
    dire('Lecture des produits de formation…');
    return lireProduits(dire, bilan);
  }).then(function (liste) {
    liste.forEach(function (p) {
      if (p.produitFormationUid) fiches[p.produitFormationUid] = p;
    });
    dire('Lecture des sessions…');
    return parcourir('/v2/session_formations', params, function (n, p) {
      bilan.pages = p; dire('Sessions : ' + n + ' lues sur ' + p + ' page(s)…');
    });
  }).then(function (liste) {
    sessions = liste;
    bilan.lues += liste.length;
    dire('Lecture des commanditaires…');
    return parcourir('/v2/commanditaires', params, function (n) {
      dire('Commanditaires : ' + n + ' lus…');
    });
  }).then(function (liste) {
    commanditaires = liste;
    bilan.lues += liste.length;
    dire('Lecture des factures…');
    return parcourir('/v2/factures', params, function (n) {
      dire('Factures : ' + n + ' lues…');
    }).catch(function (e) {
      /* le facturé est un complément : son absence ne doit pas emporter le vendu */
      bilan.avertissements.push('Factures non reprises : ' + e.message);
      return [];
    });
  }).then(function (liste) {
    factures = liste;
    bilan.lues += liste.length;
    dire('Lecture des suivis apprenants…');
    /* L'assiduité est un complément : si la collection n'existe pas sur
       cette instance, ou si le droit manque, la reprise des ventes ne doit
       pas tomber avec elle. */
    return parcourir('/v2/suivi_apprenants', params, function (n) {
      dire('Suivis apprenants : ' + n + ' lus…');
    }).catch(function (e) {
      bilan.avertissements.push('Suivis apprenants non repris : ' + e.message
        + '. L\'assiduité restera vide ; le reste de la reprise est complet.');
      return [];
    });
  }).then(function (liste) {
    suivis = liste;
    bilan.lues += liste.length;
    /* Les émargements ne se lisent que si l'on a des suivis à enrichir :
       sans eux, les compteurs n'auraient nulle part où se poser. */
    if (!suivis.length) return [];
    dire('Lecture des émargements…');
    return lireEmargements(sessions, dire, bilan).catch(function (e) {
      bilan.avertissements.push('Émargements non repris : ' + e.message
        + '. Les présences et absences resteront à leur valeur précédente.');
      return [];
    });
  }).then(function (liste) {
    emargements = liste;
    bilan.lues += liste.length;
    dire('Écriture dans le document…');

    /* les produits rencontrés, et leur rapprochement au catalogue */
    var idx = indexCatalogue();
    var produits = {}, sansCode = 0, sansFormation = [];
    sessions.forEach(function (s) {
      var pi = s.produitInstance || {};
      var uid = pi.produitFormationUid;
      if (!uid || produits[uid]) return;
      var code = codeGesform(pi, fiches[uid]);
      produits[uid] = {
        produit_uid: uid,
        code_gesform: code,
        nom: OF.texte(pi.meta && pi.meta.nom),
        formation: idx[code] || 0,
      };
      if (!code) sansCode++;
      else if (!idx[code]) sansFormation.push(code + ' — ' + produits[uid].nom);
    });

    var actions = []
      .concat(fusionner(vraiNom('SmartOF_produits'), Object.keys(produits).map(function (k) {
        var p = produits[k];
        /* on ne réécrit jamais un rapprochement fait à la main : si la ligne
           existe déjà avec une formation, on laisse le choix de l'utilisateur */
        var deja = OF.table(vraiNom('SmartOF_produits')).filter(function (l) {
          return OF.texte(l.produit_uid) === p.produit_uid;
        })[0];
        if (deja && deja.formation) { var c = {}; Object.keys(p).forEach(function (k2) { c[k2] = p[k2]; }); c.formation = deja.formation; return c; }
        return p;
      }), 'produit_uid', bilan))
      .concat(fusionner(vraiNom('SmartOF_sessions'),
        sessions.map(function (s) { return sessionVersGrist(s, fiches); }), 'uid', bilan))
      .concat(fusionner(vraiNom('SmartOF_commanditaires'),
        commanditaires.map(commanditaireVersGrist), 'uid', bilan))
      /* Les organisations : on rattache par le nom ce qui existe déjà, on
         n'ajoute que le reste, et on ne touche jamais à `facturation` —
         c'est une décision humaine, et une synchro ne défait pas une
         décision humaine. */
      .concat(fusionner(vraiNom('SmartOF_suivis'),
        (function () {
          var comptes = emargements.length ? compterEmargements(emargements) : null;
          return suivis.map(function (x) { return suiviAvecEmargements(x, comptes); });
        }()), 'uid', bilan))
      .concat(rapprocherOrganisations(commanditaires, bilan))
      .concat(factures.length
        ? fusionner(vraiNom('SmartOF_factures'), factures.map(factureVersGrist), 'uid', bilan)
        : []);

    /* Un montant à zéro sur toutes les factures veut dire que la forme de
       priceDetails n'est pas celle qu'on cherche : mieux vaut le dire que
       laisser lire « 0 € facturé ». */
    if (factures.length) {
      var avecHT = factures.filter(function (f) { return factureVersGrist(f).montant_ht; }).length;
      if (!avecHT) {
        bilan.avertissements.push('Aucun montant n\'a pu être lu dans priceDetails sur '
          + OF.plur(factures.length, 'facture') + '. Le bouton « Voir une facture » montre la '
          + 'structure réelle : dites-moi le nom des champs de montant et je les épingle.');
      }
    }

    if (sansCode) {
      bilan.avertissements.push(OF.plur(sansCode, 'produit') + ' sans code Gesform dans '
        + 'custom_field_20 : ' + OF.accord(sansCode, 'il n\'a', 'ils n\'ont')
        + ' pas pu être rapproché' + (sansCode > 1 ? 's' : '') + ' du catalogue.');
    }
    if (sansFormation.length) {
      bilan.avertissements.push(OF.plur(sansFormation.length, 'code') + ' sans formation '
        + 'correspondante dans le catalogue : ' + sansFormation.slice(0, 6).join(' · ')
        + (sansFormation.length > 6 ? ' …' : '')
        + '. À rapprocher à la main dans SmartOF_produits.');
    }
    if (!actions.length) {
      bilan.quand = quandMaintenant();
      enCours = false; dire('');
      return bilan;
    }
    return OF.appliquer(actions, relire(), function () {}).then(function () {
      bilan.quand = quandMaintenant();
      return ecrireReglage(CLE_DERNIER, bilan.quand);
    }).then(function () {
      return ecrireReglage(CLE_DERNIER_ISO, new Date().toISOString());
    }).then(function () {
      direChampsIgnores(bilan);
      enCours = false; dire(''); return bilan;
    });
  }).catch(function (e) {
    enCours = false;
    /* Le filtre a été refusé malgré la découverte — le champ retenu a pu
       cesser d'être autorisé. On l'oublie et on reprend tout : mieux vaut
       une reprise longue qu'une reprise qui échoue. */
    if (filtreRefuse(e) && bilan.borne && !options.__sansFiltre) {
      dire('Filtre de date refusé — reprise complète…');
      return ecrireReglage(CLE_CHAMP_DATE, '').then(function () {
        return rafraichir({ fenetre: 'tout', dire: dire, __sansFiltre: true });
      }).then(function (b) {
        b.avertissements.unshift('Le filtre de date a été refusé par l\'API (' + e.message
          + ') : tout a été repris, sans filtre.');
        return b;
      });
    }
    dire('');
    bilan.quand = quandMaintenant();
    bilan.avertissements.push('Interrompu : ' + e.message);
    bilan.ajoutees = bilan.corrigees = 0;
    bilan.erreur = e.message;
    return bilan;
  });
}

/* Les champs qu'on n'a pas pu écrire, dits une fois et non à chaque ligne. */
function direChampsIgnores(bilan) {
  var l = Object.keys(bilan.champsIgnores || {});
  if (!l.length) return;
  bilan.avertissements.push(OF.plur(l.length, 'colonne') + ' '
    + OF.accord(l.length, 'n\'existe pas', 'n\'existent pas') + ' dans le document et '
    + OF.accord(l.length, 'n\'a', 'n\'ont') + ' donc pas été '
    + OF.accord(l.length, 'remplie', 'remplies') + ' : ' + l.slice(0, 6).join(', ')
    + (l.length > 6 ? '…' : '') + '. Le reste de la reprise est complet ; le bouton '
    + '« créer les colonnes » les ajoute.');
}

function quandMaintenant() {
  var d = new Date();
  return d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR').slice(0, 5);
}


racine.SmartOFSync = {
  /* réglages */
  CLE_BASE: CLE_BASE, CLE_JETON: CLE_JETON, CLE_DERNIER: CLE_DERNIER,
  CLE_DERNIER_ISO: CLE_DERNIER_ISO,
  repriseIncrementalePossible: repriseIncrementalePossible,
  CLE_CHAMP_DATE: CLE_CHAMP_DATE, champDateRetenu: champDateRetenu,
  CLE_APP: CLE_APP, APP_DEFAUT: APP_DEFAUT, app: app, lienSession: lienSession,
  lienEntreprise: lienEntreprise,
  colonneNomOrg: colonneNomOrg, nomOrganisation: nomOrganisation, clefNom: clefNom,
  factureCompte: factureCompte, statutAnnule: statutAnnule,
  CHAMPS_DATE: CHAMPS_DATE,
  reglage: reglage, ecrireReglage: ecrireReglage, colonneTexteParametres: colonneTexteParametres,
  base: base, jeton: jeton, configure: configure,
  /* API */
  appeler: appeler, parcourir: parcourir, FENETRES: FENETRES, depuis: depuis,
  curseurDe: curseurDe, parametresDeFenetre: parametresDeFenetre,
  paramCurseur: function () { return paramCurseur; },
  /* structure du document */
  TABLES: TABLES, relire: relire, SCHEMAS: SCHEMAS, resoudreTables: resoudreTables,
  colonnesIndispensables: colonnesIndispensables, organisationsPretes: organisationsPretes,
  vraiNom: vraiNom, tablesVoisines: tablesVoisines, colonnesManquantes: colonnesManquantes,
  nomsReels: function () { return NOMS_REELS; },
  NOMS_REELS: NOMS_REELS,
  /* catalogue */
  indexCatalogue: indexCatalogue, codeGesform: codeGesform, normaliser: normaliser,
  /* le parcours complet */
  rafraichir: rafraichir, quandMaintenant: quandMaintenant,
  enCours: function () { return enCours; }
};
}(window));
