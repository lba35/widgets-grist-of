/* =========================================================================
   OF du CHU — les groupes vendus en inter comptent enfin des places

   À COLLER DANS LA CONSOLE DU NAVIGATEUR, sur la page du document Grist.
   (Chrome refuse le premier collage : taper d'abord  allow pasting  puis
   Entrée.)

   LE PROBLÈME
   Une ligne de Ventes_inter facturée « Groupe / jour » porte un nombre de
   groupes, mais aucune taille de groupe. Or tout ce qui compte des places
   dans le document lit `nb_places` — qui reste à zéro sur ces lignes. Un
   groupe de 8 et un groupe de 15 y sont la même chose, et aucun des deux
   n'occupe le moindre siège : remplissage faux, heures stagiaires fausses,
   indicateurs annuels faux. Seule la recette était juste, parce qu'elle est
   la seule formule à regarder `nb_groupes`.

   CE QUE FAIT LE SCRIPT
   1. Ajoute sur Ventes_inter la colonne de saisie `participants_par_groupe`,
      symétrique de `participants_par_session` qui existe déjà sur
      Ventes_intra — même idée, même repli sur l'effectif maximum de la
      formation quand elle n'est pas renseignée.
   2. Ajoute `au_groupe` (vrai dès que la base commence par « Groupe ») et
      `places`, qui vaut `nb_groupes × participants_par_groupe` au groupe et
      `nb_places` sinon. C'est le pivot : une seule colonne qui dit combien de
      sièges la ligne occupe, quelle que soit la façon dont elle est facturée.
   3. Remplace partout `v.nb_places` par `v.places` dans les formules du
      document — remplissage des années, des projections, du tableau de bord,
      des indicateurs annuels, et les textes de synthèse des formations.
      Le script cherche l'occurrence exacte : s'il ne la trouve pas dans une
      colonne, il ne touche à rien et le dit.
   4. Généralise `recette` pour qu'une base « Groupe / session » éventuelle
      soit facturée au groupe et non aux places. Aujourd'hui, seule
      « Groupe / jour » est reconnue : toute autre base au groupe retomberait
      sur `nb_places` et facturerait zéro, en silence.
   5. Étoffe `alerte` : taille de groupe manquante, places saisies sur une
      ligne facturée au groupe (elles ne sont pas facturées), groupes saisis
      sur une ligne individuelle.

   CE QU'IL NE FAIT PAS
   Il ne touche à aucune donnée saisie, à aucune autre formule, et ne crée ni
   page ni widget. Les lignes existantes gardent leurs valeurs : une ligne au
   groupe sans taille renseignée prend l'effectif maximum de la formation,
   comme le fait déjà l'intra.

   Démarre en essai à blanc. Passer ESSAI_A_BLANC à false pour appliquer.
   Idempotent : relancé, il voit que c'est déjà fait et ne refait rien.
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
  const docId = trouverDocId();
  if (!docId) {
    console.error("Document introuvable dans l'URL. Relancer depuis la page du document.");
    return;
  }
  const BASE = location.origin + '/api/docs/' + docId;
  const journal = [];

  async function api(methode, chemin, corps, ecriture = true) {
    if (ecriture && ESSAI_A_BLANC) { journal.push(methode + ' ' + chemin); return {}; }
    const r = await fetch(BASE + chemin, {
      method: methode,
      credentials: 'same-origin',
      headers: corps ? { 'Content-Type': 'application/json' } : {},
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(methode + ' ' + chemin + ' → ' + r.status + ' ' + txt.slice(0, 400));
    if (ecriture) journal.push(methode + ' ' + chemin);
    return txt ? JSON.parse(txt) : {};
  }
  const tables = async () => (await api('GET', '/tables', null, false)).tables.map(t => t.id);
  const colonnes = async t => (await api('GET', `/tables/${t}/columns`, null, false)).columns;

  async function ajouter(table, colId, champs) {
    const dejaLa = (await colonnes(table)).some(c => c.id === colId);
    if (dejaLa) { console.log(`    [déjà là] ${table}.${colId}`); return false; }
    await api('POST', `/tables/${table}/columns`, { columns: [{ id: colId, fields: champs }] });
    console.log(`    [créée]   ${table}.${colId}`);
    return true;
  }
  async function poserFormule(table, colId, formule) {
    const c = (await colonnes(table)).find(x => x.id === colId);
    if (!c) { console.warn(`    [absente] ${table}.${colId} — rien fait`); return false; }
    if ((c.fields.formula || '').trim() === formule.trim()) {
      console.log(`    [déjà là] ${table}.${colId}`); return false;
    }
    await api('PATCH', `/tables/${table}/columns`,
      { columns: [{ id: colId, fields: { formula: formule, isFormula: true } }] });
    console.log(`    [réécrite] ${table}.${colId}`);
    return true;
  }

  /* ------------------------------------------- 1. les colonnes d'appui --- */
  console.log('\n1. Ventes_inter — la taille des groupes');

  await ajouter('Ventes_inter', 'participants_par_groupe', {
    label: 'Participants par groupe', type: 'Int', isFormula: false, formula: '',
  });

  await ajouter('Ventes_inter', 'au_groupe', {
    label: 'Facturé au groupe', type: 'Bool', isFormula: true,
    formula: 'return (rec.base or "").startswith("Groupe")',
  });

  /* Le repli sur l'effectif maximum reprend exactement ce que fait déjà
     Ventes_intra.places : un groupe dont on ne dit pas la taille remplit la
     session. Mieux vaut cette hypothèse lisible qu'un zéro silencieux. */
  await ajouter('Ventes_inter', 'places', {
    label: 'Places occupées', type: 'Int', isFormula: true,
    formula: [
      'if rec.au_groupe:',
      '  return (rec.nb_groupes or 0) * (rec.participants_par_groupe or rec.formation.effectif_max or 0)',
      'return rec.nb_places or 0',
    ].join('\n'),
  });

  /* ----------------------------------- 2. les formules de Ventes_inter --- */
  console.log('\n2. Ventes_inter — recette, heures stagiaires, alerte');

  /* Même résultat qu'avant pour les trois bases en service, mais la règle est
     écrite une fois : la quantité suit l'unité, le prix suit « / jour ». */
  await poserFormule('Ventes_inter', 'recette', [
    'jours = rec.formation.nb_jours or 0',
    'quantite = (rec.nb_groupes or 0) if rec.au_groupe else (rec.nb_places or 0)',
    'par_jour = (rec.base or "").endswith("jour")',
    'return quantite * rec.prix_unitaire * (jours if par_jour else 1)',
  ].join('\n'));

  await poserFormule('Ventes_inter', 'heures_stagiaires',
    'return rec.places * (rec.formation.duree_h or 0)');

  await poserFormule('Ventes_inter', 'alerte', [
    'if not (rec.formation and rec.annee):',
    '  return "Formation et année à renseigner"',
    'if not rec.segment:',
    '  return "Segment à renseigner"',
    'if not rec.segment.actif:',
    '  return "Segment inactif : requalifier le segment de marché"',
    'autorisees = [c.id for c in rec.segment.categories_autorisees]',
    'if not rec.categorie_appliquee:',
    '  if len(autorisees) > 1:',
    '    return "Choisir une catégorie tarifaire : ce segment en autorise plusieurs"',
    '  return "Segment sans catégorie tarifaire (table Segments_categories)"',
    'if autorisees and rec.categorie_appliquee.id not in autorisees:',
    '  return "Catégorie non prévue pour ce segment"',
    'if not rec.prix_unitaire:',
    '  return "Pas de tarif pour cette combinaison"',
    'if rec.au_groupe:',
    '  if not rec.nb_groupes:',
    '    return "Nombre de groupes à renseigner"',
    '  if rec.nb_places:',
    '    return "Des places sont saisies alors que la ligne est facturée au groupe : elles ne sont pas facturées"',
    '  if not rec.places:',
    '    return "Taille du groupe à renseigner : ce groupe n\'occupe aucune place"',
    'elif rec.nb_groupes:',
    '  return "Des groupes sont saisis alors que la ligne est facturée à la place : ils ne sont pas facturés"',
    'if not [p for p in Projections.lookupRecords(formation=rec.formation.id, annee=rec.annee.id) if p.nb_sessions]:',
    '  return "Aucune session inter prévue pour cette formation cette année"',
    'return ""',
  ].join('\n'));

  /* -------------------------- 3. tous les compteurs de places du doc --- */
  /* `v.nb_places` ne désigne jamais autre chose qu'une ligne de Ventes_inter :
     Ventes_intra n'a pas cette colonne, et à l'intérieur de Ventes_inter la
     variable est `rec`. La substitution est donc sûre, et exhaustive. */
  console.log('\n3. Remplacement de v.nb_places par v.places dans les formules');

  let touchees = 0, vues = 0;
  for (const t of await tables()) {
    for (const c of await colonnes(t)) {
      const f = c.fields.formula || '';
      if (!c.fields.isFormula || !f.includes('v.nb_places')) continue;
      vues++;
      const nouvelle = f.split('v.nb_places').join('v.places');
      await api('PATCH', `/tables/${t}/columns`,
        { columns: [{ id: c.id, fields: { formula: nouvelle } }] });
      const n = f.split('v.nb_places').length - 1;
      console.log(`    ${t}.${c.id} — ${n} occurrence${n > 1 ? 's' : ''}`);
      touchees++;
    }
  }
  if (!vues) {
    console.log('    aucune occurrence : soit c\'est déjà fait, soit les formules ont changé');
  }

  /* ------------------------------------------------------------ bilan --- */
  console.log('\n' + '='.repeat(66));
  if (ESSAI_A_BLANC) {
    console.log('ESSAI À BLANC — rien n\'a été écrit.');
    console.log(`${journal.length} appels seraient faits, dont ${touchees} formules réécrites.`);
    console.log('Repasser ESSAI_A_BLANC à false pour appliquer.');
  } else {
    console.log(`Appliqué. ${journal.length} appels, ${touchees} formules réécrites.`);
    console.log('\nÀ FAIRE ENSUITE, à la main :');
    console.log('  · Sur les lignes de Ventes_inter facturées au groupe, renseigner');
    console.log('    « Participants par groupe ». Laissé vide, le groupe prend');
    console.log('    l\'effectif maximum de la formation.');
    console.log('  · Vérifier la colonne « alerte » de Ventes_inter : elle signale');
    console.log('    maintenant les lignes qui portent à la fois des places et des');
    console.log('    groupes — ce sont celles dont le remplissage était faux.');
  }
  console.log('='.repeat(66));
})();
