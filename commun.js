/* =========================================================================
   Widgets Grist de l'organisme de formation du CHU — couche commune.

   Tout ce que les trois widgets partagent : la plomberie Grist, la lecture
   des métadonnées de colonnes (types, choix, libellés), les éditeurs de
   champs, l'écriture différée et le formatage français.

   Rien ici ne recalcule ce que le document sait faire : les recettes, les
   coûts, les besoins en intervenants sont lus dans les colonnes formules,
   jamais réécrits en JavaScript. Une seule source de vérité.
   ========================================================================= */
'use strict';

var OF = (function () {

  /* ----------------------------------------------------------- outils -- */
  function $(id) { return document.getElementById(id); }
  function texte(v) { return (v === null || v === undefined) ? '' : String(v); }
  function nombre(v) {
    var n = parseFloat(texte(v).replace(',', '.').replace(/\s/g, ''));
    return isFinite(n) ? n : 0;
  }
  function eur(v) {
    return Math.round(v || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' €';
  }
  function ent(v) {
    return Math.round(v || 0).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  }
  function dec(v) {
    var n = Math.round((v || 0) * 10) / 10;
    return (n % 1 === 0 ? String(n) : n.toFixed(1).replace('.', ','));
  }
  function pourcent(num, den) {
    if (!den) return '—';
    return Math.round(100 * num / den) + ' %';
  }
  function echappe(s) {
    return texte(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  /* fetchTable renvoie des colonnes ; les widgets raisonnent en lignes */
  function enLignes(t) {
    if (!t || !t.id) return [];
    var cols = Object.keys(t), n = t.id.length, out = [], i, c;
    for (i = 0; i < n; i++) {
      var o = {};
      for (c = 0; c < cols.length; c++) o[cols[c]] = t[cols[c]][i];
      out.push(o);
    }
    return out;
  }
  /* une liste de références arrive sous la forme ['L', 3, 7] */
  function refs(v) { return Array.isArray(v) ? v.slice(1) : []; }
  function versRefList(ids) { return ids.length ? ['L'].concat(ids) : null; }
  function parId(lignes) {
    var m = {};
    lignes.forEach(function (l) { m[l.id] = l; });
    return m;
  }
  function trierPar(lignes, champ) {
    return lignes.slice().sort(function (a, b) {
      return texte(a[champ]).localeCompare(texte(b[champ]), 'fr');
    });
  }

  /* --------------------------------------------------------- document -- */
  var doc = { tables: {}, colonnes: {}, metaOk: false };

  /* Une table absente du document donne une liste vide, c'est normal : tous
     les widgets ne s'en servent pas. En revanche, si TOUTES échouent, le
     problème n'est pas la table mais l'accès — et il faut le dire. */
  function charger(noms) {
    var echecs = [];
    return Promise.all(noms.map(function (n) {
      return grist.docApi.fetchTable(n).then(enLignes).catch(function (e) {
        echecs.push(n + ' (' + (e && e.message ? e.message : e) + ')');
        return [];
      });
    })).then(function (res) {
      if (noms.length && echecs.length === noms.length) {
        throw new Error('Aucune table n\'a pu être lue : ' + echecs[0]
          + '. C\'est en général que le widget n\'a pas l\'accès complet au document.');
      }
      noms.forEach(function (n, i) { doc.tables[n] = res[i]; });
      return doc.tables;
    });
  }
  function table(nom) { return doc.tables[nom] || []; }

  /* Métadonnées : type, libellé et choix de chaque colonne. Permet de
     construire le bon éditeur sans coder en dur les listes de choix. */
  function chargerColonnes() {
    return Promise.all([
      grist.docApi.fetchTable('_grist_Tables').then(enLignes),
      grist.docApi.fetchTable('_grist_Tables_column').then(enLignes)
    ]).then(function (r) {
      var nomDe = {};
      r[0].forEach(function (t) { nomDe[t.id] = t.tableId; });
      r[1].forEach(function (c) {
        var t = nomDe[c.parentId];
        if (!t) return;
        var opts = {};
        try { opts = JSON.parse(c.widgetOptions || '{}'); } catch (e) { opts = {}; }
        (doc.colonnes[t] = doc.colonnes[t] || {})[c.colId] = {
          type: texte(c.type), libelle: texte(c.label) || c.colId,
          choix: Array.isArray(opts.choices) ? opts.choices : null,
          formule: !!c.isFormula && !!c.formula
        };
      });
      doc.metaOk = Object.keys(doc.colonnes).length > 0;
      return doc.colonnes;
    }).catch(function () { return doc.colonnes; });   // non bloquant
  }
  /* Sans type connu, on ne propose pas d'éditeur : écrire du texte dans une
     colonne de référence abîmerait la donnée. On préfère ne rien montrer. */
  function typeConnu(t, c) { return !!colonne(t, c).type; }
  function colonne(t, c) {
    return (doc.colonnes[t] && doc.colonnes[t][c]) || { type: '', libelle: c, choix: null };
  }
  /* à défaut de métadonnées, on propose les valeurs déjà présentes */
  function choixDe(t, c) {
    var meta = colonne(t, c);
    if (meta.choix && meta.choix.length) return meta.choix;
    var vus = {};
    table(t).forEach(function (l) { if (texte(l[c])) vus[l[c]] = 1; });
    return Object.keys(vus);
  }

  /* --------------------------------------------------------- écriture -- */
  var differes = {};

  function signaler(message, rate) {
    var el = $('sauve');
    if (!el) return;
    el.textContent = message;
    el.className = 'etat-sauve visible' + (rate ? ' rate' : '');
    if (!rate) {
      clearTimeout(signaler._t);
      signaler._t = setTimeout(function () { el.className = 'etat-sauve'; }, 2200);
    }
  }

  /* `apres` est rappelée une fois le document relu, pour rafraîchir l'écran */
  function appliquer(actions, tablesARelire, apres) {
    if (!actions || !actions.length) return Promise.resolve();
    signaler('Enregistrement…');
    return grist.docApi.applyUserActions(actions)
      .then(function () { return charger(tablesARelire || []); })
      .then(function () {
        var h = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
        signaler('Enregistré à ' + h);
        if (apres) apres();
      })
      .catch(function (e) {
        signaler('Échec de l\'enregistrement : ' + (e && e.message ? e.message : e), true);
        throw e;
      });
  }

  function differer(cle, fn, delai) {
    clearTimeout(differes[cle]);
    differes[cle] = setTimeout(function () { delete differes[cle]; fn(); }, delai || 700);
  }
  function forcer(cle) {
    if (!differes[cle]) return false;
    clearTimeout(differes[cle]);
    delete differes[cle];
    return true;
  }

  /* ---------------------------------------------------- éditeurs de champ */
  /* Construit l'éditeur qui convient au type de la colonne, et enregistre
     tout seul. `options.manquant` colore le champ quand la valeur attendue
     n'est pas là. */
  function editeur(conf) {
    var meta = colonne(conf.table, conf.colonne);
    var type = conf.type || meta.type;
    var valeur = conf.ligne ? conf.ligne[conf.colonne] : null;
    var bloc = document.createElement('div');
    bloc.className = 'bloc';

    var etiquette = document.createElement('label');
    etiquette.textContent = conf.libelle || meta.libelle;
    etiquette.htmlFor = 'f-' + conf.table + '-' + conf.colonne;
    bloc.appendChild(etiquette);

    var saisir = function (v) {
      if (!conf.ligne || !conf.ligne.id) return;
      var champs = {};
      champs[conf.colonne] = v;
      appliquer([['UpdateRecord', conf.table, conf.ligne.id, champs]],
        conf.relire || [conf.table], conf.apres);
    };

    var el;
    if (type.indexOf('RefList:') === 0) {
      el = etiquettesMultiples(type.slice(8), refs(valeur), function (ids) {
        saisir(versRefList(ids));
      });
    } else if (type.indexOf('Ref:') === 0) {
      el = listeDeroulante(optionsRef(type.slice(4)), valeur, saisir, true);
    } else if (type === 'Choice') {
      var choix = choixDe(conf.table, conf.colonne).map(function (c) {
        return { id: c, nom: c };
      });
      el = listeDeroulante(choix, valeur, saisir, true);
    } else if (type === 'Bool') {
      el = document.createElement('input');
      el.type = 'checkbox';
      el.checked = !!valeur;
      el.addEventListener('change', function () { saisir(el.checked); });
    } else if (conf.multiligne) {
      el = document.createElement('textarea');
      el.className = 'saisie';
      el.value = texte(valeur);
      brancherTexte(el, valeur, saisir, conf);
    } else {
      el = document.createElement('input');
      el.className = 'saisie';
      var numerique = (type === 'Numeric' || type === 'Int');
      if (numerique) { el.inputMode = 'decimal'; el.style.textAlign = 'right'; }
      el.value = numerique ? (valeur || valeur === 0 ? dec(valeur) : '') : texte(valeur);
      brancherTexte(el, valeur, function (v) {
        saisir(numerique ? (texte(v).trim() === '' ? null : nombre(v)) : v);
      }, conf);
    }
    el.id = etiquette.htmlFor;
    if (conf.manquant) el.classList.add('manquant');
    if (meta.formule) { el.disabled = true; el.title = 'Calculé par le document'; }
    bloc.appendChild(el);
    return bloc;
  }

  function brancherTexte(el, origine, saisir, conf) {
    var cle = conf.table + ':' + (conf.ligne && conf.ligne.id) + ':' + conf.colonne;
    el.addEventListener('input', function () {
      el.classList.remove('erreur');
      differer(cle, function () { saisir(el.value); });
    });
    el.addEventListener('blur', function () {
      if (forcer(cle)) saisir(el.value);
    });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { el.value = texte(origine); el.blur(); }
    });
  }

  function optionsRef(nomTable) {
    var champ = ['intitule', 'nom', 'libelle', 'code', 'annee'].filter(function (c) {
      return table(nomTable).some(function (l) { return l[c] !== undefined; });
    })[0] || 'id';
    return trierPar(table(nomTable).map(function (l) {
      return { id: l.id, nom: texte(l[champ]) || ('#' + l.id) };
    }), 'nom');
  }

  function listeDeroulante(options, valeur, auChangement, avecVide) {
    var sel = document.createElement('select');
    sel.className = 'saisie';
    if (avecVide) sel.appendChild(new Option('—', ''));
    options.forEach(function (o) { sel.appendChild(new Option(o.nom, o.id)); });
    sel.value = texte(valeur);
    sel.addEventListener('change', function () {
      var v = sel.value;
      auChangement(v === '' ? null : (isFinite(+v) && options.length && typeof options[0].id === 'number' ? +v : v));
    });
    return sel;
  }

  function etiquettesMultiples(nomTable, choisis, auChangement) {
    var zone = document.createElement('div');
    zone.className = 'etiquettes';
    var actifs = choisis.slice();
    optionsRef(nomTable).forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'etiq';
      b.textContent = o.nom;
      b.setAttribute('aria-pressed', actifs.indexOf(o.id) >= 0 ? 'true' : 'false');
      b.addEventListener('click', function () {
        var i = actifs.indexOf(o.id);
        if (i >= 0) actifs.splice(i, 1); else actifs.push(o.id);
        b.setAttribute('aria-pressed', i >= 0 ? 'false' : 'true');
        auChangement(actifs.slice());
      });
      zone.appendChild(b);
    });
    if (!zone.children.length) {
      zone.innerHTML = '<span class="note">La table ' + echappe(nomTable) + ' est vide.</span>';
    }
    return zone;
  }

  /* ------------------------------------------------- sous-table éditable */
  /* Les lignes rattachées à une formation — intervenants mobilisés, besoins
     en salles, ventes intra — se saisissent toutes de la même façon : un
     tableau où l'on ajoute, modifie et retire des lignes, avec des colonnes
     calculées en lecture seule à droite. Un seul composant pour les trois.

     conf = { table, lignes, colonnes, nouveau, relire, apres, libelleAjout,
              vide }  où chaque colonne est
       { col, libelle, type: 'ref'|'choice'|'num'|'texte'|'calcul',
         ref: 'NomTable', format: fn, placeholder, large: bool } */
  function sousTable(conf) {
    var zone = document.createElement('div');
    var t = document.createElement('table');
    t.className = 'matrice';
    var premierCalcul = conf.colonnes.findIndex(function (c) { return c.type === 'calcul'; });

    t.innerHTML = '<thead><tr>' + conf.colonnes.map(function (c, i) {
      return '<th class="' + (c.type === 'calcul' ? '' : 'gauche')
        + (i === premierCalcul ? ' calcule' : '') + '">' + echappe(c.libelle) + '</th>';
    }).join('') + '<th></th></tr></thead>';

    var corps = document.createElement('tbody');
    conf.lignes.forEach(function (ligne, iLigne) {
      var tr = document.createElement('tr');
      conf.colonnes.forEach(function (c, iCol) {
        var td = document.createElement('td');
        if (iCol === premierCalcul) td.className = 'calcule';
        if (c.type === 'calcul') {
          td.className += ' calcul';
          var v = ligne[c.col];
          td.textContent = (v || v === 0) ? (c.format || dec)(v) : '—';
        } else if (c.type === 'ref' || c.type === 'choice') {
          td.className += ' gauche';
          var options = c.type === 'ref' ? optionsRef(c.ref)
            : choixDe(conf.table, c.col).map(function (x) { return { id: x, nom: x }; });
          td.appendChild(listeDeroulante(options, ligne[c.col], function (val) {
            ecrireCellule(conf, ligne, c.col, val);
          }, true));
        } else {
          td.className += ' gauche';
          td.appendChild(celluleLibre(conf, ligne, c, iLigne, iCol));
        }
        tr.appendChild(td);
      });
      var tdX = document.createElement('td');
      var x = document.createElement('button');
      x.type = 'button';
      x.className = 'lieu';
      x.textContent = 'Retirer';
      var arme = false, minuteur = null;
      x.addEventListener('click', function () {
        if (!arme) {                       // un retrait ne se fait pas par mégarde
          arme = true;
          x.textContent = 'Confirmer';
          x.classList.add('attention');
          minuteur = setTimeout(function () {
            arme = false; x.textContent = 'Retirer'; x.classList.remove('attention');
          }, 5000);
          return;
        }
        clearTimeout(minuteur);
        appliquer([['RemoveRecord', conf.table, ligne.id]], conf.relire, conf.apres);
      });
      tdX.appendChild(x);
      tr.appendChild(tdX);
      corps.appendChild(tr);
    });
    t.appendChild(corps);
    if (conf.lignes.length) zone.appendChild(t);

    var ajouter = document.createElement('button');
    ajouter.type = 'button';
    ajouter.className = 'outil';
    if (conf.lignes.length) ajouter.style.marginTop = '12px';
    ajouter.textContent = conf.libelleAjout || 'Ajouter une ligne';
    ajouter.addEventListener('click', function () {
      appliquer([['AddRecord', conf.table, null, conf.nouveau]], conf.relire, conf.apres);
    });
    zone.appendChild(ajouter);

    if (!conf.lignes.length && conf.vide) {
      var n = document.createElement('p');
      n.className = 'note';
      n.style.marginTop = '10px';
      n.textContent = conf.vide;
      zone.appendChild(n);
    }
    return zone;
  }

  function ecrireCellule(conf, ligne, colonne, valeur) {
    var champs = {};
    champs[colonne] = valeur;
    return appliquer([['UpdateRecord', conf.table, ligne.id, champs]], conf.relire, conf.apres);
  }

  function celluleLibre(conf, ligne, c, iLigne, iCol) {
    var el = document.createElement('input');
    var numerique = c.type !== 'texte';
    el.className = 'champ' + (numerique ? '' : ' saisie');
    if (!numerique) { el.style.width = c.large ? '100%' : '200px'; el.style.textAlign = 'left'; }
    if (numerique) el.inputMode = 'decimal';
    el.placeholder = c.placeholder || '—';
    var v = ligne[c.col];
    el.value = (v || v === 0) ? (numerique ? dec(v) : texte(v)) : '';
    el.dataset.ligne = iLigne;
    el.dataset.col = iCol;
    el.setAttribute('aria-label', c.libelle);
    var origine = el.value;
    var cle = conf.table + ':' + ligne.id + ':' + c.col;
    var enregistrer = function () {
      var val = el.value.trim() === '' ? null : (numerique ? nombre(el.value) : el.value);
      if (numerique && val !== null && val < 0) {
        el.classList.add('erreur');
        signaler('Un nombre négatif n\'a pas de sens ici', true);
        return;
      }
      ecrireCellule(conf, ligne, c.col, val).catch(function () { el.classList.add('erreur'); });
    };
    el.addEventListener('input', function () {
      el.classList.remove('erreur');
      differer(cle, enregistrer);
    });
    el.addEventListener('blur', function () { if (forcer(cle)) enregistrer(); });
    el.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') { el.value = origine; el.blur(); }
    });
    return el;
  }

  /* ------------------------------------------- chargement de l'API Grist */
  /* L'adresse de l'instance n'est pas écrite en dur : on la déduit de la page
     qui nous embarque. Si le widget déménage d'instance, rien à modifier. */
  var INSTANCE_PAR_DEFAUT = 'https://grist.numerique.gouv.fr';

  function origineGrist() {
    try {
      if (window.location.ancestorOrigins && window.location.ancestorOrigins.length) {
        return window.location.ancestorOrigins[0];
      }
    } catch (e) { /* non géré par tous les navigateurs */ }
    try {
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (e) { /* référent masqué */ }
    return INSTANCE_PAR_DEFAUT;
  }

  /* Le script de l'API dialogue avec la page parente par messages : il n'est
     pas lié à une instance, et celui de docs.getgrist.com fonctionne aussi
     bien sur une instance auto-hébergée. On essaie donc l'instance d'abord,
     puis ce repli — certaines installations ne servent pas ce fichier. */
  function urlsApi() {
    var essais = [origineGrist() + '/grist-plugin-api.js'];
    [INSTANCE_PAR_DEFAUT, 'https://docs.getgrist.com'].forEach(function (o) {
      var u = o + '/grist-plugin-api.js';
      if (essais.indexOf(u) < 0) essais.push(u);
    });
    return essais;
  }
  var essayees = [];

  function chargerApi() {
    if (typeof grist !== 'undefined') return Promise.resolve();
    var urls = urlsApi();
    essayees = [];
    var suivant = function (i) {
      if (i >= urls.length) {
        return Promise.reject(new Error("L'API Grist n'a pu être chargée depuis aucune de ces "
          + 'adresses : ' + essayees.join(', ') + '.'));
      }
      return charger1(urls[i]).catch(function () { return suivant(i + 1); });
    };
    return suivant(0);
  }

  function charger1(url) {
    essayees.push(url);
    return new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = url;
      s.onload = function () {
        if (typeof grist !== 'undefined') ok();
        else ko(new Error('chargé sans fournir l\'objet grist'));
      };
      s.onerror = function () { ko(new Error('introuvable')); };
      document.head.appendChild(s);
    });
  }

  /* Un écran qui dit ce qui s'est passé, plutôt qu'une page vide. */
  function diagnostic(erreur) {
    var faits = [
      ['Page embarquée dans', (window.top !== window.self) ? 'un cadre' : 'aucun cadre : '
        + 'ouverte directement dans le navigateur'],
      ['Instance détectée', origineGrist()],
      ['API Grist', typeof grist !== 'undefined' ? 'chargée' : 'absente'],
      ['Adresses essayées', essayees.length ? essayees.join('  ·  ') : 'aucune'],
      ['Adresse de cette page', location.href]
    ];
    var cible = $('page') || $('fiche') || document.body;
    cible.innerHTML = '<div class="vide">'
      + '<p><strong>' + echappe(erreur && erreur.message ? erreur.message : String(erreur))
      + '</strong></p>'
      + '<p>Si vous lisez ceci dans Grist : vérifiez que le widget a bien reçu l\'accès complet '
      + 'au document — bouton à trois points du widget, « Options du widget », section '
      + 'PERSONNALISÉ, puis confirmer la demande d\'accès.</p>'
      + '<table class="matrice" style="margin-top:16px">' + faits.map(function (f) {
        return '<tr><td class="gauche second">' + echappe(f[0]) + '</td>'
          + '<td class="gauche libelle">' + echappe(f[1]) + '</td></tr>';
      }).join('') + '</table></div>';
    var app = $('app');
    if (app) app.setAttribute('aria-busy', 'false');
  }

  /* ------------------------------------------------------------ départ -- */
  function echouer(message) {
    var cible = $('page') || $('fiche') || document.body;
    cible.innerHTML = '<div class="vide"><p>' + echappe(message) + '</p></div>';
    var app = $('app');
    if (app) app.setAttribute('aria-busy', 'false');
  }

  /* Prépare le widget : accès complet, chargement des tables et des
     métadonnées, puis appel de `demarrer`. Les erreurs sont affichées
     plutôt que laissées dans la console. */
  function initialiser(tables, demarrer) {
    chargerApi()
      .then(function () {
        grist.ready({ requiredAccess: 'full' });
        return chargerColonnes();
      })
      .then(function () { return charger(tables); })
      .then(function () {
        var app = $('app');
        if (app) app.setAttribute('aria-busy', 'false');
        demarrer();
      })
      .catch(diagnostic);
  }

  /* L'année de travail : celle qui porte annee_pilotee, sinon la première. */
  function anneePilotee() {
    var a = table('Annees').filter(function (x) { return x.annee_pilotee; })[0];
    return a || anneesTriees()[0] || null;
  }
  function anneesTriees() {
    return table('Annees').filter(function (a) { return a.annee; })
      .sort(function (a, b) { return a.annee - b.annee; });
  }
  function formationsTriees() {
    return trierPar(table('Formations').filter(function (f) {
      return texte(f.intitule).trim();
    }), 'intitule');
  }

  function feu(critique, tendu) { return critique ? '🔴' : (tendu ? '🟠' : '🟢'); }

  /* « 1 intervenant », « 2 intervenants » : les (s) entre parenthèses sont une
     facilité de développeur, pas une façon d'écrire le français. */
  function plur(n, mot, pluriel) {
    var q = Math.round(n || 0);
    return ent(q) + ' ' + (Math.abs(q) >= 2 ? (pluriel || (mot + 's')) : mot);
  }
  function accord(n, singulier, pluriel) {
    return Math.abs(Math.round(n || 0)) >= 2 ? pluriel : singulier;
  }

  return {
    $: $, texte: texte, nombre: nombre, eur: eur, ent: ent, dec: dec, pourcent: pourcent,
    echappe: echappe, enLignes: enLignes, refs: refs, versRefList: versRefList,
    parId: parId, trierPar: trierPar,
    doc: doc, charger: charger, table: table, colonne: colonne, choixDe: choixDe,
    chargerColonnes: chargerColonnes, typeConnu: typeConnu,
    signaler: signaler, appliquer: appliquer, differer: differer, forcer: forcer,
    editeur: editeur, optionsRef: optionsRef, listeDeroulante: listeDeroulante,
    sousTable: sousTable,
    echouer: echouer, initialiser: initialiser,
    anneePilotee: anneePilotee, anneesTriees: anneesTriees, formationsTriees: formationsTriees,
    feu: feu, plur: plur, accord: accord
  };
})();
