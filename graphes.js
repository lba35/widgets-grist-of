/* =========================================================================
   graphes.js — les graphiques du pilotage, dessinés en SVG.

   Pas de bibliothèque : une dépendance de moins à charger depuis le réseau
   du CHU, et des couleurs qui suivent les jetons de commun.css — donc le
   mode sombre gratuitement, sans palette en double dans le JavaScript.

   Aucun chiffre n'est calculé ici : on reçoit des séries déjà lues dans les
   colonnes formules du document, on les met en forme. Un graphique qui
   recalculerait ses propres totaux pourrait contredire le tableau juste
   au-dessous ; celui-ci ne peut pas.

   Règles tenues : un seul axe (jamais deux échelles), une série = une
   couleur assignée dans un ordre fixe et jamais recyclée, des marques fines
   à extrémité arrondie posées sur la ligne de base, 2 px de respiration
   entre deux aplats, une légende dès qu'il y a deux séries, des valeurs
   écrites en couleur de texte et non en couleur de série, une infobulle
   partout et un tableau de chiffres sous chaque figure.
   ========================================================================= */
'use strict';

var G = (function () {

  var NS = 'http://www.w3.org/2000/svg';
  var aRedessiner = [];

  /* ------------------------------------------------------------ outils -- */
  function el(nom, attrs) {
    var e = document.createElementNS(NS, nom), k;
    if (attrs) {
      for (k in attrs) {
        if (attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, String(attrs[k]));
      }
    }
    return e;
  }
  function txt(x, y, contenu, o) {
    o = o || {};
    var t = el('text', {
      x: x, y: y,
      'font-size': o.taille || 11,
      'font-weight': o.gras || null,
      fill: o.couleur || 'var(--sourd)',
      'text-anchor': o.ancre || 'start',
      'font-variant-numeric': 'tabular-nums'
    });
    t.textContent = contenu;
    return t;
  }
  function titreSvg(parent, contenu) {
    var t = el('title');
    t.textContent = contenu;
    parent.appendChild(t);
  }

  /* un pas d'axe qui tombe juste : 1, 2, 2,5, 5 ou 10 fois une puissance de 10 */
  function pas(brut) {
    if (!(brut > 0)) return 1;
    var p = Math.pow(10, Math.floor(Math.log(brut) / Math.LN10));
    var n = brut / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function echelle(min, max, cible) {
    min = Math.min(0, min);
    if (max <= min) max = min + 1;
    var st = pas((max - min) / (cible || 4));
    var bas = Math.floor(min / st) * st, haut = Math.ceil(max / st) * st;
    var ticks = [], v;
    for (v = bas; v <= haut + st / 1000; v += st) ticks.push(Math.round(v * 1e6) / 1e6);
    return { bas: bas, haut: haut, ticks: ticks };
  }

  /* les montants en entier sur un axe sont illisibles : 250 k plutôt que 250 000 */
  function compact(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (Math.round(v / 1e5) / 10).toLocaleString('fr-FR') + ' M';
    if (a >= 1e4) return Math.round(v / 1e3).toLocaleString('fr-FR') + ' k';
    return Math.round(v).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
  }

  /* une barre fine à extrémité arrondie, toujours ancrée sur la ligne de base */
  function cheminBarre(x, larg, yBase, yVal, r) {
    var h = Math.abs(yVal - yBase);
    r = Math.max(0, Math.min(r === undefined ? 4 : r, larg / 2, h));
    var l = larg - 2 * r;
    if (yVal <= yBase) {
      return 'M' + x + ',' + yBase + 'V' + (yVal + r) + 'q0,' + (-r) + ' ' + r + ',' + (-r)
        + 'h' + l + 'q' + r + ',0 ' + r + ',' + r + 'V' + yBase + 'Z';
    }
    return 'M' + x + ',' + yBase + 'V' + (yVal - r) + 'q0,' + r + ' ' + r + ',' + r
      + 'h' + l + 'q' + r + ',0 ' + r + ',' + (-r) + 'V' + yBase + 'Z';
  }

  /* ---------------------------------------------------------- infobulle -- */
  /* Un graphique dans une page est interactif par nature : on survole, on lit
     le chiffre exact. La cible de survol couvre toute la bande, pas seulement
     la barre — on ne demande pas à viser. */
  function bulle() {
    var b = document.getElementById('infobulle');
    if (!b) {
      b = document.createElement('div');
      b.id = 'infobulle';
      b.className = 'infobulle';
      b.setAttribute('role', 'status');
      document.body.appendChild(b);
    }
    return b;
  }
  function survol(cible, contenu) {
    var montrer = function (ev) {
      var b = bulle();
      b.innerHTML = contenu;
      b.classList.add('visible');
      placer(b, ev);
    };
    var placer = function (b, ev) {
      var larg = b.offsetWidth, haut = b.offsetHeight;
      var x = ev.clientX + 14, y = ev.clientY - haut - 10;
      if (x + larg > window.innerWidth - 8) x = ev.clientX - larg - 14;
      if (y < 8) y = ev.clientY + 18;
      b.style.left = Math.max(8, x) + 'px';
      b.style.top = y + 'px';
    };
    cible.addEventListener('mouseenter', montrer);
    cible.addEventListener('mousemove', function (ev) { placer(bulle(), ev); });
    cible.addEventListener('mouseleave', function () { bulle().classList.remove('visible'); });
  }

  /* -------------------------------------------------------------- cadre -- */
  /* grille en retrait, étiquettes en couleur de texte, ligne du zéro marquée */
  function axes(conf) {
    var m = { g: conf.margeG || 50, d: 12, h: conf.margeH || 20, b: 26 };
    var pw = Math.max(40, conf.larg - m.g - m.d);
    var ph = Math.max(40, conf.haut - m.h - m.b);
    var e = conf.echelle;
    var y = function (v) {
      return m.h + ph - (v - e.bas) / (e.haut - e.bas) * ph;
    };
    var svg = el('svg', {
      width: conf.larg, height: conf.haut, viewBox: '0 0 ' + conf.larg + ' ' + conf.haut,
      role: 'img', 'aria-label': conf.description || ''
    });

    e.ticks.forEach(function (v) {
      var yy = Math.round(y(v)) + 0.5;
      svg.appendChild(el('line', {
        x1: m.g, x2: m.g + pw, y1: yy, y2: yy,
        stroke: v === 0 ? 'var(--trait-fort)' : 'var(--grille)', 'stroke-width': 1
      }));
      svg.appendChild(txt(m.g - 8, y(v) + 4, conf.formatY(v), { ancre: 'end' }));
    });
    if (conf.unite) svg.appendChild(txt(0, 10, conf.unite, { taille: 10.5 }));

    var n = Math.max(1, conf.n);
    var bande = pw / n;
    return {
      svg: svg, m: m, pw: pw, ph: ph, y: y, bande: bande,
      bx: function (i) { return m.g + bande * i; },
      etiquetteX: function (i, libelle) {
        svg.appendChild(txt(m.g + bande * (i + 0.5), conf.haut - 8, libelle,
          { ancre: 'middle', couleur: 'var(--encre)', taille: 11.5 }));
      }
    };
  }

  /* ------------------------------------------------- barres simples ----- */
  /* conf = { larg, haut, valeurs:[{libelle, valeur, objectif, bulle}],
             formatY, formatVal, unite, polarite, couleur, description } */
  function barres(conf) {
    var vals = conf.valeurs;
    var hauts = vals.map(function (d) { return d.valeur || 0; })
      .concat(vals.map(function (d) { return d.objectif || 0; }));
    var e = echelle(Math.min.apply(null, hauts.concat([0])),
      Math.max.apply(null, hauts.concat([0])), 4);
    var a = axes({
      larg: conf.larg, haut: conf.haut, echelle: e, n: vals.length,
      formatY: conf.formatY || compact, unite: conf.unite, description: conf.description
    });
    var larg = Math.min(64, Math.max(10, a.bande - 18));
    var yZero = a.y(0);

    vals.forEach(function (d, i) {
      var v = d.valeur || 0;
      var x = a.bx(i) + (a.bande - larg) / 2;
      var g = el('g');
      var couleur = conf.polarite
        ? (v < 0 ? 'var(--neg)' : 'var(--pos)')
        : (conf.couleur || 'var(--serie-1)');

      if (d.valeur || d.valeur === 0) {
        g.appendChild(el('path', { d: cheminBarre(x, larg, yZero, a.y(v), 4), fill: couleur }));
      }

      /* l'objectif est un repère sur la même échelle, pas une seconde série.
         Il passe souvent sur la barre : un liseré de fond le détache. */
      if (d.objectif) {
        var yo = a.y(d.objectif);
        g.appendChild(el('line', {
          x1: x - 6, x2: x + larg + 6, y1: yo, y2: yo,
          stroke: 'var(--papier)', 'stroke-width': 5
        }));
        g.appendChild(el('line', {
          x1: x - 5, x2: x + larg + 5, y1: yo, y2: yo,
          stroke: 'var(--encre)', 'stroke-width': 2, 'stroke-dasharray': '3 3',
          'stroke-linecap': 'round'
        }));
      }

      /* la valeur, posée au-dessus de la plus haute des deux marques, en
         couleur de texte — jamais en couleur de série */
      if (d.valeur || d.valeur === 0) {
        var haut = d.objectif ? Math.min(a.y(v), a.y(d.objectif)) : a.y(v);
        g.appendChild(txt(x + larg / 2, v < 0 ? a.y(v) + 14 : haut - 9,
          (conf.formatVal || compact)(v),
          { ancre: 'middle', couleur: 'var(--encre)', gras: 600, taille: 11.5 }));
      } else {
        g.appendChild(txt(x + larg / 2, yZero - 7, '—', { ancre: 'middle' }));
      }

      a.etiquetteX(i, d.libelle);
      var cible = el('rect', {
        x: a.bx(i), y: a.m.h, width: a.bande, height: a.ph, fill: 'transparent'
      });
      titreSvg(cible, d.titre || (d.libelle + ' : ' + (conf.formatVal || compact)(v)));
      if (d.bulle) survol(cible, d.bulle);
      g.appendChild(cible);
      a.svg.appendChild(g);
    });
    return a.svg;
  }

  /* ------------------------------------------------ barres empilées ----- */
  /* conf = { larg, haut, groupes:[{libelle, parts:[…], bulle}], series:[{nom}],
             formatY, formatVal, unite, total:bool } */
  function empilees(conf) {
    var totaux = conf.groupes.map(function (g) {
      return g.parts.reduce(function (n, v) { return n + (v || 0); }, 0);
    });
    var e = echelle(0, Math.max.apply(null, totaux.concat([0])), 4);
    var a = axes({
      larg: conf.larg, haut: conf.haut, echelle: e, n: conf.groupes.length,
      formatY: conf.formatY || compact, unite: conf.unite, description: conf.description
    });
    var larg = Math.min(64, Math.max(10, a.bande - 18));
    var yZero = a.y(0);

    conf.groupes.forEach(function (gr, i) {
      var x = a.bx(i) + (a.bande - larg) / 2;
      var g = el('g');
      var cumul = 0;
      var dernier = -1;
      gr.parts.forEach(function (v, s) { if (v) dernier = s; });

      gr.parts.forEach(function (v, s) {
        if (!v) return;
        var bas = a.y(cumul), haut = a.y(cumul + v);
        cumul += v;
        /* 2 px de surface entre deux aplats : les segments restent distincts
           même quand deux domaines ont des teintes voisines */
        var basDessin = (s === 0) ? bas : bas - (bas - haut > 4 ? 2 : 0);
        g.appendChild(el('path', {
          d: cheminBarre(x, larg, basDessin, haut, s === dernier ? 4 : 0),
          fill: 'var(--serie-' + ((s % 5) + 1) + ')'
        }));
      });

      if (conf.total && totaux[i]) {
        g.appendChild(txt(x + larg / 2, a.y(totaux[i]) - 7,
          (conf.formatVal || compact)(totaux[i]),
          { ancre: 'middle', couleur: 'var(--encre)', gras: 600, taille: 11.5 }));
      }
      a.etiquetteX(i, gr.libelle);

      var cible = el('rect', {
        x: a.bx(i), y: a.m.h, width: a.bande, height: a.ph, fill: 'transparent'
      });
      titreSvg(cible, gr.libelle + ' : ' + (conf.formatVal || compact)(totaux[i]));
      if (gr.bulle) survol(cible, gr.bulle);
      g.appendChild(cible);
      a.svg.appendChild(g);
    });
    return a.svg;
  }

  /* ------------------------------------------- barres horizontales ------ */
  /* Des catégories nommées — des formations — se classent et se lisent en
     lignes : le nom tient à gauche sans basculer à 45°, et l'ordre est
     l'information. conf = { larg, valeurs:[{libelle, valeur, bulle}],
     formatVal, polarite, largLibelle } */
  function barresHorizontales(conf) {
    var vals = conf.valeurs;
    var hLigne = 26, hBarre = 13;
    var mg = Math.min(conf.largLibelle || 230, Math.round(conf.larg * 0.38));
    var md = 78, mh = 6;
    var pw = Math.max(40, conf.larg - mg - md);
    var haut = mh * 2 + hLigne * vals.length;

    var bornes = vals.map(function (d) { return d.valeur || 0; }).concat([0]);
    var min = Math.min.apply(null, bornes), max = Math.max.apply(null, bornes);
    if (max === min) max = min + 1;
    var x = function (v) { return mg + (v - min) / (max - min) * pw; };
    var x0 = x(0);

    var svg = el('svg', {
      width: conf.larg, height: haut, viewBox: '0 0 ' + conf.larg + ' ' + haut,
      role: 'img', 'aria-label': conf.description || ''
    });
    svg.appendChild(el('line', {
      x1: Math.round(x0) + 0.5, x2: Math.round(x0) + 0.5, y1: mh, y2: haut - mh,
      stroke: 'var(--trait-fort)', 'stroke-width': 1
    }));

    vals.forEach(function (d, i) {
      var v = d.valeur || 0;
      var yc = mh + hLigne * i + hLigne / 2;
      var g = el('g');
      var couleur = conf.polarite
        ? (v < 0 ? 'var(--neg)' : 'var(--pos)')
        : (conf.couleur || 'var(--serie-1)');

      /* la barre part de zéro et s'arrondit du côté de la valeur */
      var xv = x(v), gauche = Math.min(x0, xv), larg = Math.abs(xv - x0);
      var r = Math.min(4, larg);
      if (larg > 0.5) {
        g.appendChild(el('path', {
          d: v >= 0
            ? 'M' + gauche + ',' + (yc - hBarre / 2) + 'h' + (larg - r)
              + 'q' + r + ',0 ' + r + ',' + r + 'v' + (hBarre - 2 * r)
              + 'q0,' + r + ' ' + (-r) + ',' + r + 'H' + gauche + 'Z'
            : 'M' + (gauche + r) + ',' + (yc - hBarre / 2) + 'h' + (larg - r)
              + 'v' + hBarre + 'H' + (gauche + r)
              + 'q' + (-r) + ',0 ' + (-r) + ',' + (-r) + 'v' + (-(hBarre - 2 * r))
              + 'q0,' + (-r) + ' ' + r + ',' + (-r) + 'Z',
          fill: couleur
        }));
      }

      /* un nom trop long déborderait sur les barres : on le coupe, et le nom
         entier reste dans l'infobulle de la ligne */
      var place = Math.max(6, Math.floor((mg - 14) / 6.3));
      var court = d.libelle.length > place ? d.libelle.slice(0, place - 1) + '…' : d.libelle;
      g.appendChild(txt(mg - 10, yc + 4, court, { ancre: 'end', couleur: 'var(--encre)' }));
      g.appendChild(txt(conf.larg - 6, yc + 4, (conf.formatVal || compact)(v),
        { ancre: 'end', couleur: 'var(--encre)', gras: 600, taille: 11.5 }));

      var cible = el('rect', { x: 0, y: mh + hLigne * i, width: conf.larg, height: hLigne,
        fill: 'transparent' });
      titreSvg(cible, d.libelle + ' : ' + (conf.formatVal || compact)(v));
      if (d.bulle) survol(cible, d.bulle);
      g.appendChild(cible);
      svg.appendChild(g);
    });
    return svg;
  }

  /* -------------------------------------------------------- ligne ------- */
  /* conf = { larg, haut, valeurs:[{libelle, valeur, bulle}], formatY, formatVal } */
  function ligne(conf) {
    var vals = conf.valeurs;
    var connus = vals.filter(function (d) { return d.valeur || d.valeur === 0; });
    var e = conf.echelleFixe || echelle(0,
      Math.max.apply(null, connus.map(function (d) { return d.valeur; }).concat([0])), 4);
    var a = axes({
      larg: conf.larg, haut: conf.haut, echelle: e, n: vals.length,
      formatY: conf.formatY || compact, unite: conf.unite, description: conf.description
    });

    var pts = vals.map(function (d, i) {
      return (d.valeur || d.valeur === 0)
        ? { x: a.bx(i) + a.bande / 2, y: a.y(d.valeur), v: d.valeur, i: i } : null;
    });

    /* une année sans chiffre coupe le trait : on ne relie pas par-dessus un trou */
    var segment = [];
    pts.concat([null]).forEach(function (p) {
      if (p) { segment.push(p); return; }
      if (segment.length > 1) {
        a.svg.appendChild(el('path', {
          d: 'M' + segment.map(function (q) { return q.x + ',' + q.y; }).join('L'),
          fill: 'none', stroke: 'var(--serie-1)', 'stroke-width': 2,
          'stroke-linejoin': 'round', 'stroke-linecap': 'round'
        }));
      }
      segment = [];
    });

    /* valeurs écrites sur le premier, le dernier et le maximum — pas sur tous */
    var max = connus.length ? Math.max.apply(null, connus.map(function (d) { return d.valeur; })) : 0;
    var aEcrire = {};
    if (pts.filter(Boolean).length) {
      var presents = pts.filter(Boolean);
      aEcrire[presents[0].i] = 1;
      aEcrire[presents[presents.length - 1].i] = 1;
      presents.forEach(function (p) { if (p.v === max) aEcrire[p.i] = 1; });
    }

    pts.forEach(function (p, i) {
      a.etiquetteX(i, vals[i].libelle);
      if (!p) return;
      a.svg.appendChild(el('circle', {
        cx: p.x, cy: p.y, r: 5, fill: 'var(--serie-1)',
        stroke: 'var(--surface)', 'stroke-width': 2
      }));
      if (aEcrire[i]) {
        a.svg.appendChild(txt(p.x, p.y - 12, (conf.formatVal || compact)(p.v),
          { ancre: 'middle', couleur: 'var(--encre)', gras: 600, taille: 11.5 }));
      }
    });

    vals.forEach(function (d, i) {
      var cible = el('rect', {
        x: a.bx(i), y: a.m.h, width: a.bande, height: a.ph, fill: 'transparent'
      });
      titreSvg(cible, d.libelle + ' : '
        + ((d.valeur || d.valeur === 0) ? (conf.formatVal || compact)(d.valeur) : 'non renseigné'));
      if (d.bulle) survol(cible, d.bulle);
      a.svg.appendChild(cible);
    });
    return a.svg;
  }

  /* ------------------------------------------------------- composition -- */
  /* Une figure : un titre qui nomme la série, une zone de dessin qui se
     remesure, une légende dès deux séries, et les chiffres en dessous. */
  function figure(parent, conf) {
    var f = document.createElement('figure');
    f.className = 'figure';

    var cap = document.createElement('figcaption');
    cap.className = 'figure-titre';
    cap.innerHTML = OF.echappe(conf.titre)
      + (conf.sous ? '<span class="figure-sous">' + conf.sous + '</span>' : '');
    f.appendChild(cap);

    var zone = document.createElement('div');
    zone.className = 'figure-zone';
    f.appendChild(zone);

    if (conf.series && conf.series.length > 1) f.appendChild(legende(conf.series));
    if (conf.chiffres) f.appendChild(conf.chiffres);
    parent.appendChild(f);

    var dessiner = function () {
      var larg = zone.clientWidth || f.clientWidth || parent.clientWidth || 620;
      zone.innerHTML = '';
      zone.appendChild(conf.dessin(Math.max(280, Math.round(larg)), conf.haut || 210));
    };
    aRedessiner.push(dessiner);
    dessiner();
    return f;
  }

  /* L'identité d'une série ne repose jamais sur la seule couleur : son nom est
     écrit, et son chiffre de l'année pilotée avec lui. */
  function legende(series) {
    var l = document.createElement('div');
    l.className = 'legende';
    series.forEach(function (s, i) {
      var e = document.createElement('span');
      e.innerHTML = '<i class="puce" style="background:var(--serie-' + ((i % 5) + 1) + ')"></i>'
        + OF.echappe(s.nom)
        + (s.valeur ? ' <b>' + OF.echappe(s.valeur) + '</b>' : '');
      l.appendChild(e);
    });
    return l;
  }

  /* Le tableau sous la figure : toute figure doit pouvoir être lue sans
     distinguer les couleurs, ni même voir le dessin. */
  function chiffres(libelle, entetes, lignes) {
    var d = document.createElement('details');
    d.className = 'chiffres';
    var s = document.createElement('summary');
    s.textContent = libelle || 'Les chiffres';
    d.appendChild(s);
    var cadre = document.createElement('div');
    cadre.className = 'defilant';
    d.appendChild(cadre);
    var t = document.createElement('table');
    t.className = 'matrice';
    t.innerHTML = '<thead><tr>' + entetes.map(function (h, i) {
      return '<th class="' + (i ? '' : 'gauche') + '">' + OF.echappe(h) + '</th>';
    }).join('') + '</tr></thead><tbody>' + lignes.map(function (L) {
      return '<tr>' + L.map(function (c, i) {
        return '<td class="' + (i ? 'calcul' : 'gauche libelle') + '">' + OF.echappe(c) + '</td>';
      }).join('') + '</tr>';
    }).join('') + '</tbody>';
    cadre.appendChild(t);
    return d;
  }

  /* La largeur n'est connue qu'une fois la page posée dans le document, et
     elle change quand on redimensionne le widget. */
  function oublier() { aRedessiner = []; }
  function redessiner() { aRedessiner.forEach(function (f) { f(); }); }

  var minuteur = null;
  window.addEventListener('resize', function () {
    clearTimeout(minuteur);
    minuteur = setTimeout(redessiner, 150);
  });

  return {
    barres: barres, empilees: empilees, ligne: ligne,
    barresHorizontales: barresHorizontales,
    figure: figure, legende: legende, chiffres: chiffres,
    compact: compact, echelle: echelle,
    oublier: oublier, redessiner: redessiner
  };
})();
