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
  'SmartOF_sessions', 'SmartOF_commanditaires', 'SmartOF_factures'];
function relire() {
  return ['SmartOF_produits', 'SmartOF_sessions', 'SmartOF_commanditaires', 'SmartOF_factures']
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
  SmartOF_commanditaires: [
    ['uid', 'Text', 'Identifiant SmartOF'],
    ['session_uid', 'Text', 'Session'],
    ['entreprise_uid', 'Text', 'Entreprise'],
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

function commanditaireVersGrist(c) {
  return {
    uid: c.commanditaireUid || '',
    session_uid: c.sessionUid || '',
    entreprise_uid: c.entrepriseUid || '',
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
    var l = parCle[k];
    if (!l) { actions.push(['AddRecord', table, null, v]); bilan.ajoutees++; return; }
    if (different(l, v)) { actions.push(['UpdateRecord', table, l.id, v]); bilan.corrigees++; }
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
  var manque = colonnesManquantes();
  if (manque.length) {
    return Promise.reject(new Error('Des colonnes manquent dans le document : '
      + manque.slice(0, 4).map(function (c) { return c.table + '.' + c.colonne; }).join(', ')
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

  var sessions = [], commanditaires = [], factures = [], fiches = {};

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
    }).then(function () { enCours = false; dire(''); return bilan; });
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
  CHAMPS_DATE: CHAMPS_DATE,
  reglage: reglage, ecrireReglage: ecrireReglage, colonneTexteParametres: colonneTexteParametres,
  base: base, jeton: jeton, configure: configure,
  /* API */
  appeler: appeler, parcourir: parcourir, FENETRES: FENETRES, depuis: depuis,
  curseurDe: curseurDe, parametresDeFenetre: parametresDeFenetre,
  paramCurseur: function () { return paramCurseur; },
  /* structure du document */
  TABLES: TABLES, relire: relire, SCHEMAS: SCHEMAS, resoudreTables: resoudreTables,
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
