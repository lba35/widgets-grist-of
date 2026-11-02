/* =========================================================================
   OF du CHU — séparer ce qui est vendu à l'extérieur de ce qui est interne

   À COLLER DANS LA CONSOLE DU NAVIGATEUR, sur la page du document Grist.
   (Chrome refuse le premier collage : taper d'abord  allow pasting  puis
   Entrée. Si un widget est à l'écran, vérifier que le sélecteur de contexte
   de la console est bien sur « top ».)

   LE BESOIN
   Voir le volume porté par les formations vendues à l'extérieur, séparé de
   celui des formations purement internes au CHU.

   OÙ SE POSE LA MARQUE
   Sur le SEGMENT, pas sur la formation. Chaque ligne de vente — inter comme
   intra — porte déjà un segment : la séparation tombe alors euro par euro,
   et une formation vendue à la fois en interne et à l'extérieur n'a rien de
   particulier, ses lignes se répartissent d'elles-mêmes. Posée sur la
   formation, la marque aurait obligé à ranger une formation mixte dans une
   seule case, et les recettes seraient restées indivises.

   Attention : un segment qui mélange les deux publics — « CHU et GHT », où
   le CHU est interne et le GHT est client — doit être coupé en deux segments
   pour que la séparation ait un sens. Le script le signale sans le faire :
   découper un segment déplace des lignes de vente, cela ne se décide pas
   dans un script.

   CE QUE FAIT LE SCRIPT
   1. Ajoute `interne` sur Segments — la seule saisie, deux à cinq cases.
   2. Déduit le périmètre de chaque formation de ses segments : Externe,
      Mixte, Interne, ou « À qualifier » quand aucun segment n'est visé.
      Une colonne de forçage permet de corriger les cas que les segments
      n'expriment pas ; laissée vide, le déduit s'applique.
   3. Marque chaque ligne de vente, inter et intra.
   4. Ventile les recettes et les places de chaque projection.
   5. Ajoute à Annees les totaux par périmètre : recettes, places, sessions,
      coûts et nombre de formations — en distinguant les trois paniers.

   POURQUOI TROIS PANIERS ET NON DEUX
   Les recettes et les places portent un segment : elles se séparent
   exactement. Les sessions et les coûts sont portés par la formation, qui
   peut être mixte : les répartir au prorata inventerait une précision qui
   n'existe pas. Les formations mixtes forment donc leur propre panier,
   plutôt que d'être rangées d'un côté ou de l'autre.

   CE QU'IL NE FAIT PAS
   Il ne supprime rien, ne découpe aucun segment, ne touche ni aux tarifs ni
   aux projections, et ne crée ni page ni widget.

   Démarre en essai à blanc. Passer ESSAI_A_BLANC à false pour appliquer.
   Idempotent : relancé, il voit ce qui est fait et ne le refait pas.
   ========================================================================= */

(async () => {
  const ESSAI_A_BLANC = true;   // ← passer à false pour appliquer

  /* ----------------------------------------------------------- plomberie --- */
  function trouverDocId() {
    const p = location.pathname.split('/').filter(Boolean);
    const i = p.indexOf('doc');
    if (i >= 0 && p[i + 1]) return p[i + 1];
    if (p[0] === 'o' && p[2]) return p[2];
    if (p[0] && p[0].length >= 10) return p[0];
    return null;
  }
  function refuser(titre, lignes) {
    console.error('✗ ' + titre);
    lignes.forEach((l) => console.log('   ' + l));
  }

  if (window.top !== window.self) {
    refuser('La console parle au cadre du widget, pas à la page Grist.', [
      'Dans la console de Chrome, en haut, un menu déroulant indique le',
      'contexte (il affiche sans doute « ' + location.hostname + ' »).',
      'Le basculer sur « top », puis recoller le script.',
      '',
      'Page actuelle : ' + location.href,
    ]);
    return;
  }

  const docId = trouverDocId();
  const surGrist = /\/(o\/[^/]+\/)?docs?\//.test(location.pathname)
    || /grist/i.test(location.hostname);
  if (!docId || !surGrist) {
    refuser("Ce n'est pas la page d'un document Grist.", [
      'Page actuelle : ' + location.href,
      '',
      'Ouvrir le document dans un onglet — une adresse de la forme',
      'https://grist.numerique.gouv.fr/o/docs/<identifiant>/<page>',
      '— puis coller le script dans la console de CET onglet.',
    ]);
    return;
  }

  const BASE = location.origin + '/api/docs/' + docId;
  const journal = [];
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

  /* Le pare-feu de l'instance coupe les rafales : on espace, et on reprend. */
  const PAUSE = 150;
  const REPRISES = [3000, 9000, 20000];
  function estUnPareFeu(statut, txt) {
    return (statut === 403 || statut === 503)
      && /_Incapsula_Resource|<html|NOINDEX|Request unsuccessful/i.test(txt);
  }

  async function api(methode, chemin, corps, ecriture = true) {
    if (ecriture && ESSAI_A_BLANC) { journal.push(methode + ' ' + chemin); return {}; }
    for (let essai = 0; ; essai++) {
      if (ecriture) await attendre(PAUSE);
      const r = await fetch(BASE + chemin, {
        method: methode,
        credentials: 'same-origin',
        headers: corps ? { 'Content-Type': 'application/json' } : {},
        body: corps ? JSON.stringify(corps) : undefined,
      });
      const txt = await r.text();
      if (r.ok) {
        if (ecriture) journal.push(methode + ' ' + chemin);
        return txt ? JSON.parse(txt) : {};
      }
      if (estUnPareFeu(r.status, txt) && essai < REPRISES.length) {
        const d = REPRISES[essai];
        console.warn(`    [pare-feu] coupure sur ${methode} ${chemin} — reprise dans ${d / 1000} s`);
        await attendre(d);
        continue;
      }
      if (estUnPareFeu(r.status, txt)) {
        throw new Error("Le pare-feu de l'instance bloque les appels (" + r.status + ").\n"
          + "   Ce n'est pas un refus de Grist : la réponse est une page de défi.\n"
          + '   Attendre une minute, recharger la page, et relancer le script :\n'
          + "   il reprend là où il s'est arrêté, sans refaire ce qui est fait.");
      }
      throw new Error(methode + ' ' + chemin + ' → ' + r.status + ' ' + txt.slice(0, 400));
    }
  }

  try {
    const sonde = await fetch(BASE + '/tables', { credentials: 'same-origin' });
    if (!sonde.ok) {
      const txt = (await sonde.text()).slice(0, 200);
      refuser("L'API Grist ne répond pas pour ce document (" + sonde.status + ').', [
        "Identifiant déduit de l'URL : " + docId,
        'Adresse interrogée : ' + BASE + '/tables',
        '',
        /^\s*<!DOCTYPE/i.test(txt)
          ? "La réponse est une page HTML : cet hôte n'est pas une instance Grist."
          : txt,
      ]);
      return;
    }
  } catch (e) {
    refuser("L'API Grist est injoignable depuis cette page.", [
      String(e && e.message ? e.message : e),
    ]);
    return;
  }
  console.log('Document : ' + docId + ' sur ' + location.origin);

  const colonnes = async t => (await api('GET', `/tables/${t}/columns`, null, false)).columns;
  const lire = async t => (await api('GET', `/tables/${t}/records`, null, false)).records || [];

  async function ajouter(table, colId, champs) {
    if ((await colonnes(table)).some(c => c.id === colId)) {
      console.log(`    [déjà là]  ${table}.${colId}`); return false;
    }
    await api('POST', `/tables/${table}/columns`, { columns: [{ id: colId, fields: champs }] });
    console.log(`    [créée]    ${table}.${colId}`);
    return true;
  }
  async function poser(table, colId, champs) {
    const c = (await colonnes(table)).find(x => x.id === colId);
    if (!c) return ajouter(table, colId, champs);
    if ((c.fields.formula || '').trim() === (champs.formula || '').trim()
        && (!champs.label || c.fields.label === champs.label)) {
      console.log(`    [déjà là]  ${table}.${colId}`); return false;
    }
    await api('PATCH', `/tables/${table}/columns`, { columns: [{ id: colId, fields: champs }] });
    console.log(`    [réécrite] ${table}.${colId}`);
    return true;
  }
  const F = (label, lignes, type) => ({
    label, type: type || 'Numeric', isFormula: true,
    formula: Array.isArray(lignes) ? lignes.join('\n') : lignes,
  });

  /* ================================================ 1. la marque, sur le segment */
  console.log('\n1. Segments — la seule saisie de tout le script');

  await ajouter('Segments', 'interne', {
    label: 'Public interne au CHU', type: 'Bool', isFormula: false, formula: '',
  });

  /* Un segment dont l'intitulé mélange visiblement les deux publics mérite
     d'être coupé : tant qu'il ne l'est pas, ses recettes tombent toutes du
     même côté, et c'est forcément faux pour une partie d'entre elles. */
  await poser('Segments', 'alerte_perimetre', F('Alerte périmètre', [
    'nom = ($intitule or "").upper()',
    'melange = [m for m in ("GHT", "EXTERNE", "PRIVE", "PRIVÉ", "LIBERAL", "LIBÉRAL")',
    '           if m in nom]',
    'if $interne and melange:',
    '  return ("Segment marque interne mais son intitule evoque aussi un public exterieur "',
    '          "(%s) : le couper en deux segments, sinon ses recettes tombent toutes "',
    '          "du cote interne" % ", ".join(melange))',
    'if not $interne and "CHU" in nom and melange:',
    '  return ("Segment melangeant le CHU et un public exterieur (%s) : le couper en deux, "',
    '          "sinon ses recettes tombent toutes du cote externe" % ", ".join(melange))',
    'return ""',
  ], 'Text'));

  /* =========================================== 2. le périmètre d'une formation */
  console.log('\n2. Formations — périmètre déduit, et forçable');

  await ajouter('Formations', 'perimetre_force', {
    label: 'Périmètre forcé (vide = déduit)', type: 'Choice', isFormula: false, formula: '',
    widgetOptions: JSON.stringify({ choices: ['Externe', 'Mixte', 'Interne'] }),
  });

  await poser('Formations', 'perimetre_deduit', F('Périmètre déduit des segments', [
    'segs = list($segments)',
    'if not segs:',
    '  return "À qualifier"',
    'internes = [s for s in segs if s.interne]',
    'if len(internes) == len(segs):',
    '  return "Interne"',
    'if not internes:',
    '  return "Externe"',
    'return "Mixte"',
  ], 'Text'));

  await poser('Formations', 'perimetre', {
    label: 'Périmètre', type: 'Choice', isFormula: true,
    widgetOptions: JSON.stringify({ choices: ['Externe', 'Mixte', 'Interne', 'À qualifier'] }),
    formula: 'return $perimetre_force or $perimetre_deduit',
  });

  await poser('Formations', 'vendue_externe', F('Vendue à l\'extérieur',
    'return $perimetre in ("Externe", "Mixte")', 'Bool'));

  /* ====================================== 3. la marque sur les lignes de vente */
  console.log('\n3. Ventes_inter et Ventes_intra — chaque ligne sait de quel côté elle tombe');

  for (const t of ['Ventes_inter', 'Ventes_intra']) {
    await poser(t, 'interne', F('Vente interne',
      'return bool($segment and $segment.interne)', 'Bool'));
  }

  /* ======================================= 4. la ventilation des projections */
  console.log('\n4. Projections — recettes et places ventilées');

  /* `places` vient du script des groupes ; sur un document qui ne l'a pas
     encore, on retombe sur nb_places plutôt que de planter. */
  const PLACES_LIGNE = 'getattr(v, "places", None) or v.nb_places or 0';

  await poser('Projections', 'perimetre', F('Périmètre',
    'return $formation.perimetre if $formation else ""', 'Text'));

  const VENTES = 'Ventes_inter.lookupRecords(formation=$formation, annee=$annee)';
  for (const [col, test, libelle] of [
    ['recette_externe', 'not v.interne', 'Recette externe'],
    ['recette_interne', 'v.interne', 'Recette interne'],
  ]) {
    await poser('Projections', col, F(libelle, [
      'if not ($formation and $annee):',
      '  return 0',
      `return sum(v.recette or 0 for v in ${VENTES} if ${test})`,
    ]));
  }
  for (const [col, test, libelle] of [
    ['places_externes', 'not v.interne', 'Places externes'],
    ['places_internes', 'v.interne', 'Places internes'],
  ]) {
    await poser('Projections', col, F(libelle, [
      'if not ($formation and $annee):',
      '  return 0',
      't = 0',
      `for v in ${VENTES}:`,
      `  if ${test}:`,
      `    t += ${PLACES_LIGNE}`,
      'return t',
    ]));
  }

  /* ============================================ 5. les totaux de l'année */
  console.log("\n5. Annees — le volume de chaque panier");

  /* Recettes et places portent un segment : séparation exacte, deux colonnes. */
  for (const [col, test, libelle] of [
    ['recettes_externes', 'not v.interne', 'Recettes externes'],
    ['recettes_internes', 'v.interne', 'Recettes internes'],
  ]) {
    await poser('Annees', col, F(libelle, [
      't = 0',
      'for v in Ventes_inter.lookupRecords(annee=$id):',
      `  if ${test}:`,
      '    t += v.recette or 0',
      'for v in Ventes_intra.lookupRecords(annee=$id):',
      `  if ${test}:`,
      '    t += v.recette or 0',
      'return t',
    ]));
  }
  for (const [col, test, libelle] of [
    ['places_externes', 'not v.interne', 'Places externes'],
    ['places_internes', 'v.interne', 'Places internes'],
  ]) {
    await poser('Annees', col, F(libelle, [
      't = 0',
      'for v in Ventes_inter.lookupRecords(annee=$id):',
      `  if ${test}:`,
      `    t += ${PLACES_LIGNE}`,
      'return t',
    ]));
  }
  await poser('Annees', 'part_externe', F('Part externe des recettes', [
    'tout = ($recettes_externes or 0) + ($recettes_internes or 0)',
    'return ($recettes_externes or 0) / tout if tout else 0',
  ]));

  /* Sessions, coûts et formations sont portés par la formation, qui peut être
     mixte : trois paniers, pas deux, et aucun prorata inventé. */
  for (const panier of ['Externe', 'Mixte', 'Interne']) {
    const suffixe = panier.toLowerCase() + 's';
    await poser('Annees', 'sessions_' + suffixe, F('Sessions — ' + panier.toLowerCase(), [
      'n = 0',
      'for p in Projections.lookupRecords(annee=$id):',
      `  if p.formation and p.formation.perimetre == "${panier}":`,
      '    n += p.nb_sessions or 0',
      'for v in Ventes_intra.lookupRecords(annee=$id):',
      `  if v.formation and v.formation.perimetre == "${panier}":`,
      '    n += v.nb_sessions or 0',
      'return n',
    ]));
    await poser('Annees', 'couts_' + suffixe, F('Coûts — ' + panier.toLowerCase(), [
      't = 0',
      'for p in Projections.lookupRecords(annee=$id):',
      `  if p.formation and p.formation.perimetre == "${panier}":`,
      '    t += getattr(p, "cout", 0) or 0',
      'return t',
    ]));
    await poser('Annees', 'formations_' + suffixe, F('Formations — ' + panier.toLowerCase(), [
      'vues = set()',
      'for p in Projections.lookupRecords(annee=$id):',
      `  if p.nb_sessions and p.formation and p.formation.perimetre == "${panier}":`,
      '    vues.add(p.formation.id)',
      'for v in Ventes_intra.lookupRecords(annee=$id):',
      `  if v.nb_sessions and v.formation and v.formation.perimetre == "${panier}":`,
      '    vues.add(v.formation.id)',
      'return len(vues)',
    ], 'Int'));
  }

  /* -------------------------------------------- ce qui reste à faire à la main */
  console.log('\n6. Ce qui reste à régler');
  const segments = await lire('Segments');
  const suspects = segments.filter(s => {
    const n = (s.fields.intitule || '').toUpperCase();
    return /CHU/.test(n) && /(GHT|EXTERNE|PRIV|LIB)/.test(n);
  });
  console.log(`    ${segments.length} segment(s) dans le document :`);
  segments.forEach(s => console.log(
    `        ${s.fields.interne ? '[interne]' : '[       ]'} ${s.fields.intitule}`));
  if (suspects.length) {
    console.warn(`    ⚠ ${suspects.length} segment(s) mélangent visiblement les deux publics :`);
    suspects.forEach(s => console.warn(`        « ${s.fields.intitule} »`));
    console.warn('      Les couper en deux segments, puis répartir leurs lignes de vente.');
    console.warn('      Tant que ce n\'est pas fait, leurs recettes tombent toutes du même côté.');
  }

  /* ------------------------------------------------------------ bilan --- */
  console.log('\n' + '='.repeat(70));
  if (ESSAI_A_BLANC) {
    console.log("ESSAI À BLANC — rien n'a été écrit.");
    console.log(`${journal.length} appels seraient faits.`);
    console.log('Repasser ESSAI_A_BLANC à false pour appliquer.');
  } else {
    console.log(`Appliqué. ${journal.length} appels.`);
    console.log('\nÀ FAIRE ENSUITE :');
    console.log('  1. Cocher « Public interne au CHU » sur les segments concernés.');
    console.log('     Tant que rien n\'est coché, tout est externe et la séparation');
    console.log('     ne montre rien.');
    console.log('  2. Couper les segments qui mélangent les deux publics, s\'il y en a');
    console.log('     (la colonne « Alerte périmètre » les signale), puis réaffecter');
    console.log('     leurs lignes de vente au bon segment.');
    console.log('  3. Vérifier la colonne « Périmètre » des formations. Celles sans');
    console.log('     segment visé ressortent « À qualifier » : ce sont des fiches à');
    console.log('     compléter, pas des formations internes.');
    console.log('  4. Mettre les widgets à jour (v23 ou plus récent) : le pilotage');
    console.log('     compare alors les trois paniers.');
  }
  console.log('='.repeat(70));
})();
