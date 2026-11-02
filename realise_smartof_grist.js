/* =========================================================================
   OF du CHU — raccrocher le réalisé SmartOF au pilotage

   À COLLER DANS LA CONSOLE DU NAVIGATEUR, sur la page du document Grist.
   (Chrome refuse le premier collage : taper d'abord  allow pasting  puis
   Entrée. Si un widget est à l'écran, vérifier que le sélecteur de contexte
   de la console est bien sur « top ».)

   À LANCER APRÈS un premier rafraîchissement réussi du widget SmartOF :
   les tables SmartOF_sessions, SmartOF_commanditaires et SmartOF_factures
   doivent exister et contenir des lignes.

   CE QUE FAIT LE SCRIPT
   Les lignes rapatriées de SmartOF sont des enregistrements plats : une
   session, un commanditaire, une facture. Elles ne savent pas encore à
   quelle année ni à quelle formation du catalogue elles se rattachent. Ce
   script pose ce raccrochage, puis les totaux qui en découlent.

   1. Sur SmartOF_sessions : `annee` (d'après la date de début) et
      `formation` (par la table de correspondance des produits), puis les
      places vendues, le vendu et le facturé net de cette session.
   2. Sur SmartOF_commanditaires et SmartOF_factures : la même année et la
      même formation, reprises de leur session.
   3. Sur Annees : sessions, places, vendu et facturé réalisés, et l'écart
      à la projection.
   4. Sur Formations : les mêmes, pour l'année pilotée.

   VENDU ET FACTURÉ NE SONT PAS LA MÊME CHOSE
   Le vendu est la somme des budgets des commanditaires : ce qui a été
   engagé. Le facturé est la somme des factures émises, nette des avoirs :
   ce qui est parti au client. L'écart entre les deux est ce qui reste à
   facturer, et il ne se verra que s'ils restent distincts.

   UNE PRÉCAUTION SUR LA COMPARAISON
   Le réalisé ne couvre que ce que le widget a rapatrié. Comparé à une
   projection complète, un réalisé partiel ressemble à une catastrophe. Le
   pilotage affiche la période réellement chargée ; ces colonnes, elles,
   ne savent pas ce qui leur manque.

   CE QU'IL NE FAIT PAS
   Il ne touche ni aux projections, ni aux ventes, ni aux tarifs, ni aux
   tables SmartOF elles-mêmes — seulement des colonnes calculées en plus.

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
      'Basculer le menu de contexte de la console sur « top », puis recoller.',
      'Page actuelle : ' + location.href,
    ]);
    return;
  }

  const docId = trouverDocId();
  const surGrist = /\/(o\/[^/]+\/)?docs?\//.test(location.pathname)
    || /grist/i.test(location.hostname);
  if (!docId || !surGrist) {
    refuser("Ce n'est pas la page d'un document Grist.", ['Page actuelle : ' + location.href]);
    return;
  }

  const BASE = location.origin + '/api/docs/' + docId;
  const journal = [];
  const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
  const PAUSE = 150;
  const REPRISES = [3000, 9000, 20000];
  const estUnPareFeu = (s, t) => (s === 403 || s === 503)
    && /_Incapsula_Resource|<html|NOINDEX|Request unsuccessful/i.test(t);

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
        console.warn(`    [pare-feu] coupure — reprise dans ${REPRISES[essai] / 1000} s`);
        await attendre(REPRISES[essai]);
        continue;
      }
      if (estUnPareFeu(r.status, txt)) {
        throw new Error("Le pare-feu de l'instance bloque les appels. Attendre une minute,\n"
          + "   recharger la page et relancer : le script reprend où il s'est arrêté.");
      }
      throw new Error(methode + ' ' + chemin + ' → ' + r.status + ' ' + txt.slice(0, 300));
    }
  }

  const tables = async () => (await api('GET', '/tables', null, false)).tables.map(t => t.id);
  const colonnes = async t => (await api('GET', `/tables/${t}/columns`, null, false)).columns;

  async function poser(table, colId, champs) {
    const liste = await colonnes(table);
    const c = liste.find(x => x.id === colId);
    if (!c) {
      await api('POST', `/tables/${table}/columns`, { columns: [{ id: colId, fields: champs }] });
      console.log(`    [créée]    ${table}.${colId}`);
      return true;
    }
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

  /* ------------------------------------------------- les tables attendues */
  const existantes = await tables();
  const NECESSAIRES = ['SmartOF_sessions', 'SmartOF_commanditaires', 'SmartOF_factures',
    'SmartOF_produits', 'Annees', 'Formations'];
  const absentes = NECESSAIRES.filter(t => !existantes.includes(t));
  if (absentes.length) {
    refuser('Tables manquantes : ' + absentes.join(', '), [
      'Ce script raccroche le réalisé déjà rapatrié : lancez d\'abord un',
      'rafraîchissement depuis le widget SmartOF, qui crée et remplit ces tables.',
    ]);
    return;
  }
  console.log('Document : ' + docId);

  /* ========================================= 1. l'année et la formation */
  console.log('\n1. SmartOF_sessions — année et formation');

  /* GRIST REFUSE DEUX IDENTIFIANTS QUI NE DIFFÈRENT QUE PAR LA CASSE
     Une table qui porte déjà `Annee` fait créer `annee2` à la place de
     `annee` — et toutes les formules qui écrivent `lookupRecords(annee=...)`
     cherchent alors une colonne qui n'existe pas. Le script repère donc les
     colonnes déjà là, s'en sert, et n'en crée pas de doublon. */
  function resoudre(liste, attendu) {
    const exact = liste.find(c => c.id === attendu);
    if (exact) return exact.id;
    const bas = attendu.toLowerCase();
    const proche = liste.find(c => c.id.toLowerCase() === bas);
    return proche ? proche.id : null;
  }

  const colsSessions = await colonnes('SmartOF_sessions');
  const COL_ANNEE = resoudre(colsSessions, 'annee') || 'annee';
  const COL_FORMATION = resoudre(colsSessions, 'formation') || 'formation';
  const existaitAnnee = !!resoudre(colsSessions, 'annee');
  const existaitFormation = !!resoudre(colsSessions, 'formation');

  if (existaitAnnee || existaitFormation) {
    console.log('    [existante] ' + [existaitAnnee ? COL_ANNEE : null,
      existaitFormation ? COL_FORMATION : null].filter(Boolean).join(', ')
      + ' — réutilisée telle quelle, sa formule n\'est pas touchée');
  }
  const doublons = colsSessions.filter(c => /^(annee|formation)\d+$/i.test(c.id)).map(c => c.id);

  /* La date de début peut être une vraie date ou un texte ISO selon la façon
     dont la colonne a été créée : on accepte les deux plutôt que d'imposer. */
  const ANNEE_DE = [
    'import datetime',
    'd = $date_debut',
    'an = 0',
    'if hasattr(d, "year"):',
    '  an = d.year',
    'elif isinstance(d, (int, float)) and d > 1000000000:',
    '  # colonne numerique : horodatage en secondes',
    '  an = datetime.datetime.utcfromtimestamp(d).year',
    'elif d:',
    '  try:',
    '    an = int(str(d)[:4])',
    '  except Exception:',
    '    an = 0',
    'if an < 1990 or an > 2100:',
    '  an = 0',
  ];

  /* Une colonne déjà là porte peut-être votre propre logique : on ne
     l'écrase pas, on s'en sert. */
  if (!existaitAnnee) {
    await poser('SmartOF_sessions', COL_ANNEE, F('Année', [
      ...ANNEE_DE,
      'if not an:',
      '  return None',
      'return Annees.lookupOne(annee=an) or None',
    ], 'Ref:Annees'));
  } else {
    console.log(`    [conservée] SmartOF_sessions.${COL_ANNEE}`);
  }

  if (!existaitFormation) {
    await poser('SmartOF_sessions', COL_FORMATION, F('Formation', [
      'if not $produit_uid:',
      '  return None',
      'p = SmartOF_produits.lookupOne(produit_uid=$produit_uid)',
      'return (p.formation or None) if p else None',
    ], 'Ref:Formations'));
  } else {
    console.log(`    [conservée] SmartOF_sessions.${COL_FORMATION}`);
  }

  /* --------------------------------- 2. ce que porte chaque session */
  console.log('\n2. SmartOF_sessions — places, vendu, facturé');

  const COMMANDITAIRES = 'SmartOF_commanditaires.lookupRecords(session_uid=$uid)';
  const FACTURES = 'SmartOF_factures.lookupRecords(session_uid=$uid)';

  await poser('SmartOF_sessions', 'places_vendues', F('Places vendues',
    `sum(c.nb_apprenants or 0 for c in ${COMMANDITAIRES})`));
  await poser('SmartOF_sessions', 'vendu', F('Vendu',
    `sum(c.budget or 0 for c in ${COMMANDITAIRES})`));
  await poser('SmartOF_sessions', 'facture_ht', F('Facturé HT, net d\'avoirs',
    `sum((f.montant_ht or 0) - (f.avoirs or 0) for f in ${FACTURES} if not f.archive)`));
  await poser('SmartOF_sessions', 'reste_a_facturer', F('Reste à facturer',
    'return ($vendu or 0) - ($facture_ht or 0)'));

  /* -------------------- 3. les deux autres tables suivent leur session */
  console.log('\n3. Commanditaires et factures — année et formation de leur session');

  const DE_LA_SESSION = [
    'if not $session_uid:',
    '  return None',
    's = SmartOF_sessions.lookupOne(uid=$session_uid)',
  ];
  for (const t of ['SmartOF_commanditaires', 'SmartOF_factures']) {
    const cols = await colonnes(t);
    const ca = resoudre(cols, 'annee') || 'annee';
    const cf = resoudre(cols, 'formation') || 'formation';
    await poser(t, ca, F('Année',
      [...DE_LA_SESSION, `return (s.${COL_ANNEE} or None) if s else None`], 'Ref:Annees'));
    await poser(t, cf, F('Formation',
      [...DE_LA_SESSION, `return (s.${COL_FORMATION} or None) if s else None`], 'Ref:Formations'));
  }
  await poser('SmartOF_factures', 'net_ht', F('Net HT, après avoirs',
    'return ($montant_ht or 0) - ($avoirs or 0)'));

  /* ====================================== 4. les totaux de chaque année */
  console.log("\n4. Annees — le réalisé, et son écart au projeté");

  const SESSIONS_ANNEE = `SmartOF_sessions.lookupRecords(${COL_ANNEE}=$id)`;

  await poser('Annees', 'realise_sessions', F('Sessions réalisées',
    `len([s for s in ${SESSIONS_ANNEE} if not s.archive])`, 'Int'));
  await poser('Annees', 'realise_places', F('Places vendues (réalisé)',
    `sum(s.places_vendues or 0 for s in ${SESSIONS_ANNEE} if not s.archive)`));
  await poser('Annees', 'realise_vendu', F('Vendu (réalisé)',
    `sum(s.vendu or 0 for s in ${SESSIONS_ANNEE} if not s.archive)`));
  await poser('Annees', 'realise_facture', F('Facturé HT (réalisé)',
    `sum(s.facture_ht or 0 for s in ${SESSIONS_ANNEE} if not s.archive)`));
  await poser('Annees', 'reste_a_facturer', F('Reste à facturer',
    'return ($realise_vendu or 0) - ($realise_facture or 0)'));

  /* L'écart ne vaut que si l'année porte une projection : sans elle, un
     réalisé seul n'est pas « en retard », il est hors périmètre de comparaison. */
  await poser('Annees', 'ecart_vendu', F('Écart vendu − projeté', [
    'if not $recettes:',
    '  return 0',
    'return ($realise_vendu or 0) - ($recettes or 0)',
  ]));
  await poser('Annees', 'taux_realisation', F('Taux de réalisation', [
    'if not $recettes:',
    '  return 0',
    'return ($realise_vendu or 0) / $recettes',
  ]));

  /* ================================ 5. le réalisé formation par formation */
  console.log("\n5. Formations — le réalisé de l'année pilotée");

  const ANNEE_PILOTEE = [
    'A = next((a for a in Annees.all if a.annee_pilotee), None)',
    'if not A:',
    '  return 0',
    `S = [s for s in SmartOF_sessions.lookupRecords(${COL_FORMATION}=$id, ${COL_ANNEE}=A.id) if not s.archive]`,
  ];

  await poser('Formations', 'realise_sessions_annee', F('Sessions réalisées (année pilotée)',
    [...ANNEE_PILOTEE, 'return len(S)'], 'Int'));
  await poser('Formations', 'realise_places_annee', F('Places vendues (année pilotée)',
    [...ANNEE_PILOTEE, 'return sum(s.places_vendues or 0 for s in S)']));
  await poser('Formations', 'realise_vendu_annee', F('Vendu (année pilotée)',
    [...ANNEE_PILOTEE, 'return sum(s.vendu or 0 for s in S)']));
  await poser('Formations', 'realise_facture_annee', F('Facturé HT (année pilotée)',
    [...ANNEE_PILOTEE, 'return sum(s.facture_ht or 0 for s in S)']));

  /* ------------------------------------------------------------ bilan --- */
  console.log('\n' + '='.repeat(70));
  if (ESSAI_A_BLANC) {
    console.log("ESSAI À BLANC — rien n'a été écrit.");
    console.log(`${journal.length} appels seraient faits.`);
    console.log('Repasser ESSAI_A_BLANC à false pour appliquer.');
  } else {
    console.log(`Appliqué. ${journal.length} appels.`);
    console.log('\nÀ VÉRIFIER ENSUITE :');
    console.log('  1. Dans SmartOF_sessions, la colonne « Année » : les sessions dont');
    console.log('     l\'année n\'existe pas dans la table Annees restent vides. Créez');
    console.log('     ces années si vous voulez les voir dans le pilotage.');
    console.log('  2. La colonne « Formation » : vide signifie que le produit SmartOF');
    console.log('     n\'est pas rapproché. Le widget SmartOF le montre et permet de');
    console.log('     trancher à la main.');
    console.log('  3. Le réalisé ne couvre que ce qui a été rapatrié. Avant de lire');
    console.log('     un écart au projeté, lancez une reprise « Tout, sans filtre de');
    console.log('     date » — sinon vous comparez un partiel à un complet.');
    console.log('  4. Mettre les widgets à jour (v31 ou plus récent) : le pilotage');
    console.log('     affiche alors le réalisé face au projeté.');
    if (doublons.length) {
      console.warn(`  5. ⚠ Colonnes en double à supprimer : ${doublons.join(', ')}.`);
      console.warn('     Elles viennent d\'un passage précédent du script, quand il ne');
      console.warn(`     voyait pas vos colonnes ${COL_ANNEE} et ${COL_FORMATION} déjà là.`);
      console.warn('     Plus rien ne les lit.');
    }
  }
  console.log('='.repeat(70));
})();
