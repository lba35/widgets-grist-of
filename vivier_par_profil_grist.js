/* =========================================================================
   OF du CHU — le vivier remonte au profil

   À COLLER DANS LA CONSOLE DU NAVIGATEUR, sur la page du document Grist.
   (Chrome refuse le premier collage : taper d'abord  allow pasting  puis
   Entrée.)

   LE PROBLÈME
   La table `Vivier` porte une ligne par formation × profil × année, et c'est
   sur cette ligne qu'on saisit « combien d'intervenants de ce profil ». Or un
   formateur GSU n'est pas habilité à « GSU 2 - Etudiants - 3j » : il est
   habilité au GSU. Une seule population se retrouve répartie sur huit lignes,
   et il n'existe aucune façon correcte de la saisir :

     · écrire le vrai nombre (40) sur chaque ligne → le document croit voir
       8 × 40 × capacité d'intervenant, soit trois fois la capacité réelle,
       et conclut « vivier suffisant » alors qu'il manque 157 recrues ;
     · le répartir (5 par ligne) → chaque formation est enfermée dans sa
       part, et un formateur de la réactualisation ne peut plus aller
       animer un GSU initial.

   Tant que les viviers sont à zéro l'erreur dort : la somme ligne à ligne
   (240 pour le GSU en 2027) est presque celle du profil (237). Elle se
   réveille à la première saisie. Deux autres symptômes en découlent : les
   « 31 vivier non saisi » sont 31 couples formation × profil pour une dizaine
   de profils réels, et le seuil « aucune formation ne doit reposer sur un
   seul formateur » s'applique huit fois au GSU au lieu d'une.

   CE QUE FAIT LE SCRIPT
   1. Crée la table `Vivier_profils` — une ligne par année × profil. C'est là
      que se saisissent désormais le vivier actuel et les départs connus.
   2. La remplit à partir des lignes de `Vivier` existantes, en reprenant la
      plus grande valeur rencontrée dans chaque groupe (les mêmes personnes
      ayant pu être comptées plusieurs fois). Les écarts sont listés pour
      vérification.
   3. Compte la capacité en HEURES par an et non en sessions. Vos formations
      GSU vont de 0,5 à 3 jours : une capacité en sessions traiterait une
      demi-journée comme trois jours. Nouveau paramètre
      `heures_par_intervenant_an`.
   4. Transforme les colonnes de saisie de `Vivier` en colonnes de lecture :
      elles affichent la situation du profil, elles ne la pilotent plus. Les
      colonnes de recrutement y deviennent une IMPUTATION au prorata des
      heures — la somme sur toutes les formations redonne exactement le
      besoin du profil, sans double compte.
   5. Réécrit les agrégats de `Annees`, `Formations` et `Intervenants` pour
      qu'ils lisent `Vivier_profils` là où ils comptaient des personnes.

   CE QU'IL NE FAIT PAS
   Il ne supprime aucune colonne ni aucune ligne, ne touche pas aux
   projections, aux ventes ni aux tarifs, et ne crée ni page ni widget.

   Démarre en essai à blanc. Passer ESSAI_A_BLANC à false pour appliquer.
   Idempotent : relancé, il voit ce qui est déjà fait et ne le refait pas.
   ========================================================================= */

(async () => {
  const ESSAI_A_BLANC = true;   // ← passer à false pour appliquer

  /* Heures qu'un intervenant peut animer dans l'année, avant abattement
     d'indisponibilité. 42 h = l'équivalent des 6 sessions de 7 h du paramètre
     actuel ; à ajuster une fois le registre des intervenants consolidé. */
  const HEURES_PAR_INTERVENANT_AN = 42;

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
  const lire = async t => (await api('GET', `/tables/${t}/records`, null, false)).records || [];

  async function ajouter(table, colId, champs) {
    const dejaLa = (await colonnes(table)).some(c => c.id === colId);
    if (dejaLa) { console.log(`    [déjà là]  ${table}.${colId}`); return false; }
    await api('POST', `/tables/${table}/columns`, { columns: [{ id: colId, fields: champs }] });
    console.log(`    [créée]    ${table}.${colId}`);
    return true;
  }
  async function poser(table, colId, champs) {
    const c = (await colonnes(table)).find(x => x.id === colId);
    if (!c) {
      /* la colonne n'existe pas : on la crée plutôt que de ne rien faire */
      return ajouter(table, colId, champs);
    }
    const memeFormule = (c.fields.formula || '').trim() === (champs.formula || '').trim();
    const memeLabel = !champs.label || c.fields.label === champs.label;
    if (memeFormule && memeLabel) { console.log(`    [déjà là]  ${table}.${colId}`); return false; }
    await api('PATCH', `/tables/${table}/columns`, { columns: [{ id: colId, fields: champs }] });
    console.log(`    [réécrite] ${table}.${colId}`);
    return true;
  }
  const F = (label, lignes, type) => ({
    label, type: type || 'Numeric', isFormula: true,
    formula: Array.isArray(lignes) ? lignes.join('\n') : lignes,
  });
  const S = (label, type) => ({ label, type: type || 'Int', isFormula: false, formula: '' });

  const existantes = await tables();

  /* ================================================ 0. le paramètre heures */
  console.log('\n0. Paramètre de capacité en heures');
  {
    const P = await lire('Parametres');
    const deja = P.find(p => p.fields.cle === 'heures_par_intervenant_an');
    if (deja) {
      console.log(`    [déjà là]  heures_par_intervenant_an = ${deja.fields.valeur}`);
    } else {
      await api('POST', '/tables/Parametres/records', {
        records: [{ fields: {
          cle: 'heures_par_intervenant_an',
          valeur: HEURES_PAR_INTERVENANT_AN,
          description: "Heures d'animation qu'un intervenant peut assurer dans l'année, "
            + "avant abattement d'indisponibilité. Remplace sessions_par_intervenant_an "
            + "pour le calcul du vivier : les formations ne durent pas toutes autant, "
            + "une capacité en sessions traiterait une demi-journée comme trois jours. "
            + "Remplaçable profil par profil dans la table Vivier_profils.",
        } }],
      });
      console.log(`    [créé]     heures_par_intervenant_an = ${HEURES_PAR_INTERVENANT_AN}`);
    }
  }

  /* ========================================== 1. la table Vivier_profils */
  console.log('\n1. Table Vivier_profils — une ligne par année × profil');

  /* Les formules lisent Vivier par (annee, ressource) : la demande reste
     décrite formation par formation, c'est le vivier qui remonte. */
  const LIGNES = 'Vivier.lookupRecords(annee=$annee, ressource=$ressource)';

  const colonnesProfils = [
    ['annee', { label: 'Année', type: 'Ref:Annees', isFormula: false, formula: '' }],
    ['ressource', { label: "Profil d'intervenant", type: 'Ref:Intervenants', isFormula: false, formula: '' }],
    ['vivier_actuel', S('Vivier actuel (intervenants autorisés)')],
    ['departs_connus', S('Départs connus')],
    ['heures_par_intervenant', S('Heures / an par intervenant (vide = défaut)', 'Numeric')],
    ['commentaire', S('Commentaire', 'Text')],

    ['formations_concernees', F('Formations concernées',
      `len([v for v in ${LIGNES} if v.interventions_requises])`, 'Int')],
    ['sessions_concernees', F('Sessions concernées',
      `sum(v.nb_sessions or 0 for v in ${LIGNES})`)],
    ['interventions_requises', F('Interventions à assurer',
      `sum(v.interventions_requises or 0 for v in ${LIGNES})`)],
    ['heures_requises', F("Heures d'animation à couvrir",
      `sum(v.heures_animation or 0 for v in ${LIGNES})`)],

    ['capacite_intervenant', F("Capacité d'un intervenant (h/an)", [
      'P = Parametres.lookupOne(cle="heures_par_intervenant_an")',
      'I = Parametres.lookupOne(cle="indisponibilite_intervenants")',
      'base = $heures_par_intervenant or (P.valeur if P else 0) or 0',
      'return base * (1 - ((I.valeur if I else 0) or 0))',
    ])],
    ['vivier_net', F('Vivier net', [
      'T = Parametres.lookupOne(cle="turnover_vivier")',
      't = (T.valeur if T else 0) or 0',
      'v = $vivier_actuel or 0',
      'return max(0, v - max($departs_connus or 0, v * t))',
    ])],
    ['heures_couvertes', F('Heures couvertes par le vivier',
      'min($heures_requises or 0, ($vivier_net or 0) * ($capacite_intervenant or 0))')],
    ['heures_manquantes', F('Heures manquantes',
      'max(0, ($heures_requises or 0) - ($heures_couvertes or 0))')],
    ['taux_couverture', F('Taux de couverture',
      'return ($heures_couvertes or 0) / $heures_requises if $heures_requises else 0')],

    /* Combien il en faudrait en tout, indépendamment de ce qu'on a déjà :
       le repère qui manquait le plus, parce qu'il se lit sans arithmétique. */
    ['vivier_cible', F('Vivier nécessaire au total', [
      'c = $capacite_intervenant or 0',
      'return math.ceil(($heures_requises or 0) / c) if c else 0',
    ], 'Int')],

    ['a_recruter', F('Intervenants à recruter', [
      'C = Parametres.lookupOne(cle="capacite_nouvel_intervenant")',
      'S = Parametres.lookupOne(cle="vivier_minimum")',
      'k = ($capacite_intervenant or 0) * ((C.valeur if C else 0) or 0)',
      'par_charge = math.ceil(($heures_manquantes or 0) / k) if k else 0',
      'seuil = (S.valeur if S else 0) or 0',
      'par_seuil = math.ceil(seuil - ($vivier_net or 0)) if ($heures_requises or 0) and seuil > ($vivier_net or 0) else 0',
      'return int(max(0, par_charge, par_seuil))',
    ], 'Int')],
    ['candidats_a_rechercher', F('Candidats à rechercher', [
      'S = Parametres.lookupOne(cle="taux_selection_candidats")',
      's = (S.valeur if S else 0) or 0',
      'return int(math.ceil(($a_recruter or 0) / s)) if s else 0',
    ], 'Int')],

    ['situation', F('Situation', [
      'M = Parametres.lookupOne(cle="marge_vivier_cible")',
      'm = (M.valeur if M else 0) or 1',
      'if not $heures_requises:',
      '  return "Sans objet"',
      'if not $vivier_actuel:',
      '  return "Vivier à renseigner"',
      'if $a_recruter:',
      '  return "À recruter"',
      'if ($vivier_net or 0) * ($capacite_intervenant or 0) < ($heures_requises or 0) * m:',
      '  return "Marge faible"',
      'return "Couvert"',
    ], 'Text')],

    ['lecture', F('Lecture', [
      'def n(x):',
      '  return "{:,.0f}".format(x or 0).replace(",", " ")',
      'if not $heures_requises:',
      '  return "Aucune formation ne mobilise ce profil cette annee"',
      'if not $vivier_actuel:',
      '  return ("Vivier a renseigner : %s heures a couvrir sur %s formation(s), "',
      '          "soit %s intervenant(s) au total" % (n($heures_requises),',
      '          n($formations_concernees), n($vivier_cible)))',
      'if $a_recruter:',
      '  return ("Recruter %s intervenant(s) : %s heures non couvertes sur %s, "',
      '          "environ %s candidat(s) a rechercher" % (n($a_recruter),',
      '          n($heures_manquantes), n($heures_requises), n($candidats_a_rechercher)))',
      'return ("Vivier suffisant : %s heures couvertes sur %s, avec %s intervenant(s) nets"',
      '        % (n($heures_couvertes), n($heures_requises), n($vivier_net)))',
    ], 'Text')],

    ['alerte', F('Alerte', [
      'if not ($annee and $ressource):',
      '  return "Annee et profil a renseigner"',
      'jumelles = [p for p in Vivier_profils.lookupRecords(annee=$annee, ressource=$ressource)',
      '            if p.id != $id]',
      'if jumelles:',
      '  return "Ligne en double pour ce profil et cette annee"',
      'if $departs_connus and $vivier_actuel and $departs_connus > $vivier_actuel:',
      '  return "Plus de departs que d\'intervenants autorises"',
      'return ""',
    ], 'Text')],
  ];

  if (existantes.includes('Vivier_profils')) {
    console.log('    [déjà là]  la table existe — mise à jour des colonnes');
    for (const [id, champs] of colonnesProfils) await poser('Vivier_profils', id, champs);
  } else {
    await api('POST', '/tables', {
      tables: [{ id: 'Vivier_profils', columns: colonnesProfils.map(([id, fields]) => ({ id, fields })) }],
    });
    console.log(`    [créée]    Vivier_profils (${colonnesProfils.length} colonnes)`);
  }

  /* ============================================= 2. reprise des saisies */
  console.log('\n2. Reprise des viviers saisis sur les lignes par formation');

  const vivier = await lire('Vivier');
  const groupes = new Map();
  for (const v of vivier) {
    const a = v.fields.annee, r = v.fields.ressource;
    if (!a || !r) continue;
    const cle = a + ':' + r;
    const g = groupes.get(cle) || { annee: a, ressource: r, viviers: [], departs: [], lignes: 0 };
    g.lignes++;
    if (v.fields.vivier_actuel) g.viviers.push(v.fields.vivier_actuel);
    if (v.fields.departs_connus) g.departs.push(v.fields.departs_connus);
    groupes.set(cle, g);
  }

  const dejaProfils = existantes.includes('Vivier_profils') ? await lire('Vivier_profils') : [];
  const connues = new Set(dejaProfils.map(p => p.fields.annee + ':' + p.fields.ressource));

  const aCreer = [];
  const ecarts = [];
  for (const [cle, g] of groupes) {
    if (connues.has(cle)) continue;
    const distincts = [...new Set(g.viviers)];
    /* Plusieurs valeurs différentes dans un même profil : ce sont les mêmes
       personnes comptées différemment selon la formation. On retient la plus
       grande — la seule qui ne perde personne — et on le signale. */
    const v = g.viviers.length ? Math.max(...g.viviers) : 0;
    const d = g.departs.length ? Math.max(...g.departs) : 0;
    if (distincts.length > 1) ecarts.push({ cle, valeurs: distincts, retenu: v, lignes: g.lignes });
    aCreer.push({ fields: { annee: g.annee, ressource: g.ressource, vivier_actuel: v, departs_connus: d } });
  }

  console.log(`    ${groupes.size} couple(s) année × profil dans Vivier`);
  console.log(`    ${vivier.length} ligne(s) par formation — soit ${vivier.length - groupes.size} saisies de moins`);
  if (aCreer.length) {
    await api('POST', '/tables/Vivier_profils/records', { records: aCreer });
    console.log(`    [créées]   ${aCreer.length} ligne(s) de profil`);
  } else {
    console.log('    [déjà là]  rien à reprendre');
  }
  if (ecarts.length) {
    console.warn(`    ⚠ ${ecarts.length} profil(s) portaient des viviers différents selon la formation :`);
    ecarts.forEach(e => console.warn(`        ${e.cle} — valeurs ${e.valeurs.join(', ')} sur ${e.lignes} ligne(s), retenu ${e.retenu}`));
    console.warn('      À vérifier dans Vivier_profils : ce sont probablement les mêmes personnes.');
  }

  /* ================================= 3. Vivier passe en lecture seule */
  console.log('\n3. Vivier — les colonnes de saisie deviennent des lectures');

  const PROFIL = 'P = Vivier_profils.lookupOne(annee=$annee, ressource=$ressource)';

  await poser('Vivier', 'vivier_actuel', F('Vivier du profil (lecture)',
    [PROFIL, 'return (P.vivier_actuel or 0) if P else 0'], 'Int'));
  await poser('Vivier', 'departs_connus', F('Départs du profil (lecture)',
    [PROFIL, 'return (P.departs_connus or 0) if P else 0'], 'Int'));
  await poser('Vivier', 'vivier_net', F('Vivier net du profil (lecture)',
    [PROFIL, 'return (P.vivier_net or 0) if P else 0']));
  await poser('Vivier', 'capacite_intervenant', F("Capacité d'un intervenant (h/an)",
    [PROFIL, 'return (P.capacite_intervenant or 0) if P else 0']));

  /* La part du profil que cette formation représente, en heures. C'est elle
     qui rend l'imputation honnête : additionnée sur toutes les formations
     d'un profil, elle fait exactement 1. */
  await poser('Vivier', 'part_du_profil', F('Part du besoin du profil',
    [PROFIL, 'if not P or not P.heures_requises:', '  return 0',
      'return ($heures_animation or 0) / P.heures_requises']));

  /* Le vivier est fongible : une heure vaut une heure. La couverture de cette
     formation est donc le taux de couverture du profil, pas un calcul propre. */
  await poser('Vivier', 'heures_couvertes', F('Heures couvertes (prorata du profil)',
    [PROFIL, 'return ($heures_animation or 0) * (P.taux_couverture or 0) if P else 0']));
  await poser('Vivier', 'heures_manquantes', F('Heures manquantes (prorata du profil)',
    'max(0, ($heures_animation or 0) - ($heures_couvertes or 0))'));
  await poser('Vivier', 'interventions_couvertes', F('Interventions couvertes (prorata du profil)',
    [PROFIL, 'return ($interventions_requises or 0) * (P.taux_couverture or 0) if P else 0']));
  await poser('Vivier', 'interventions_manquantes', F('Interventions manquantes (prorata du profil)',
    'max(0, ($interventions_requises or 0) - ($interventions_couvertes or 0))'));

  /* Recrues imputées, et non « à recruter » : le recrutement se décide par
     profil. Sommée sur les formations d'un profil, l'imputation redonne
     exactement le nombre de recrues de ce profil — jamais davantage. */
  await poser('Vivier', 'recrues_imputees', F('Recrues imputées à cette formation',
    [PROFIL, 'return (P.a_recruter or 0) * ($part_du_profil or 0) if P else 0']));
  await poser('Vivier', 'a_recruter', F('— se décide au niveau du profil',
    'return 0', 'Int'));
  await poser('Vivier', 'candidats_a_rechercher', F('— se décide au niveau du profil',
    'return 0', 'Int'));

  await poser('Vivier', 'situation', F('Situation du profil (lecture)',
    [PROFIL, 'return (P.situation or "") if P else "Profil sans ligne de vivier"'], 'Text'));
  await poser('Vivier', 'lecture', F('Lecture', [
    'def n(x):',
    '  return "{:,.0f}".format(x or 0).replace(",", " ")',
    PROFIL,
    'if not $interventions_requises:',
    '  return "Aucune session prevue"',
    'if not P:',
    '  return "Aucune ligne de vivier pour ce profil cette annee"',
    'return ("%s interventions et %s heures a assurer, soit %s %% du besoin du profil"',
    '        % (n($interventions_requises), n($heures_animation),',
    '           n(100 * ($part_du_profil or 0))))',
  ], 'Text'));

  /* `sessions_par_intervenant` servait à corriger la capacité formation par
     formation. En heures, la correction n'a plus lieu d'être : une formation
     longue consomme mécaniquement plus d'heures. La colonne reste, vidée de
     son rôle, pour ne pas casser une vue qui l'afficherait. */
  await poser('Vivier', 'sessions_par_intervenant',
    F('— sans objet : la capacité se compte en heures', 'return 0'));

  /* ====================================== 4. les agrégats du document */
  console.log('\n4. Agrégats — Annees, Formations, Intervenants');

  const PROFILS_ANNEE = 'Vivier_profils.lookupRecords(annee=$id)';

  await poser('Annees', 'vivier_net_cumule', F('Vivier net (profils)',
    `sum(p.vivier_net or 0 for p in ${PROFILS_ANNEE})`));
  await poser('Annees', 'intervenants_a_recruter', F('Intervenants à recruter',
    `sum(p.a_recruter or 0 for p in ${PROFILS_ANNEE})`));
  await poser('Annees', 'candidats_a_rechercher', F('Candidats à rechercher',
    `sum(p.candidats_a_rechercher or 0 for p in ${PROFILS_ANNEE})`));
  await poser('Annees', 'profils_a_recruter', F('Profils à renforcer',
    `len([p for p in ${PROFILS_ANNEE} if p.a_recruter])`, 'Int'));
  await poser('Annees', 'vivier_cible_cumule', F('Vivier nécessaire au total',
    `sum(p.vivier_cible or 0 for p in ${PROFILS_ANNEE})`, 'Int'));
  await poser('Annees', 'formations_a_renforcer', F('Formations touchées par un manque',
    'len([v for v in Vivier.lookupRecords(annee=$id) if (v.interventions_manquantes or 0) > 0.01])', 'Int'));

  const ANNEE_PILOTEE = [
    'A = next((a for a in Annees.all if a.annee_pilotee), None)',
    'if not A:',
    '  return 0',
  ];

  /* Le vivier d'une formation n'est plus un cumul : c'est le maillon le plus
     faible parmi les profils qu'elle mobilise. Une formation qui a besoin
     d'un médecin et d'un formateur GSU ne tient pas mieux que le plus rare
     des deux. */
  await poser('Formations', 'vivier_annee', F('Vivier net du profil le plus rare', [
    ...ANNEE_PILOTEE,
    'nets = []',
    'for v in Vivier.lookupRecords(formation=$id, annee=A.id):',
    '  if not v.interventions_requises:',
    '    continue',
    '  P = Vivier_profils.lookupOne(annee=A.id, ressource=v.ressource)',
    '  nets.append((P.vivier_net or 0) if P else 0)',
    'return min(nets) if nets else 0',
  ]));
  await poser('Formations', 'a_recruter_annee', F('Recrues imputées (année pilotée)', [
    ...ANNEE_PILOTEE,
    'return sum(v.recrues_imputees or 0 for v in Vivier.lookupRecords(formation=$id, annee=A.id))',
  ]));
  await poser('Formations', 'profils_sous_tension', F('Profils sous tension', [
    ...ANNEE_PILOTEE,
    'n = 0',
    'for v in Vivier.lookupRecords(formation=$id, annee=A.id):',
    '  if not v.interventions_requises:',
    '    continue',
    '  P = Vivier_profils.lookupOne(annee=A.id, ressource=v.ressource)',
    '  if P and P.a_recruter:',
    '    n += 1',
    'return n',
  ], 'Int'));

  const PROFIL_PILOTE = [
    'A = next((a for a in Annees.all if a.annee_pilotee), None)',
    'if not A:',
    '  return 0',
    'P = Vivier_profils.lookupOne(annee=A.id, ressource=$id)',
  ];

  await poser('Intervenants', 'vivier_profil', F('Vivier net (année pilotée)',
    [...PROFIL_PILOTE, 'return (P.vivier_net or 0) if P else 0']));
  await poser('Intervenants', 'a_recruter_profil', F('À recruter (année pilotée)',
    [...PROFIL_PILOTE, 'return (P.a_recruter or 0) if P else 0'], 'Int'));
  await poser('Intervenants', 'heures_a_assurer', F("Heures d'animation (année pilotée)",
    [...PROFIL_PILOTE, 'return (P.heures_requises or 0) if P else 0']));
  await poser('Intervenants', 'vivier_cible_profil', F('Vivier nécessaire (année pilotée)',
    [...PROFIL_PILOTE, 'return (P.vivier_cible or 0) if P else 0'], 'Int'));
  await poser('Intervenants', 'formations_a_renforcer_profil', F('Formations touchées', [
    'A = next((a for a in Annees.all if a.annee_pilotee), None)',
    'if not A:',
    '  return 0',
    'return len([v for v in Vivier.lookupRecords(ressource=$id, annee=A.id)',
    '            if (v.interventions_manquantes or 0) > 0.01])',
  ], 'Int'));

  /* ------------------------------------------------------------ bilan --- */
  console.log('\n' + '='.repeat(70));
  if (ESSAI_A_BLANC) {
    console.log("ESSAI À BLANC — rien n'a été écrit.");
    console.log(`${journal.length} appels seraient faits.`);
    console.log(`${groupes.size} ligne(s) de profil créées à partir de ${vivier.length} lignes de Vivier.`);
    console.log('Repasser ESSAI_A_BLANC à false pour appliquer.');
  } else {
    console.log(`Appliqué. ${journal.length} appels.`);
    console.log('\nÀ FAIRE ENSUITE :');
    console.log('  1. Régler « heures_par_intervenant_an » dans Parametres.');
    console.log(`     Posé à ${HEURES_PAR_INTERVENANT_AN} h, l'équivalent des 6 sessions de 7 h`);
    console.log("     du paramètre précédent. C'est l'hypothèse la plus structurante");
    console.log('     du calcul : elle décide à elle seule du nombre de recrues.');
    console.log('  2. Saisir le vivier dans Vivier_profils — une ligne par profil,');
    console.log('     plus une par formation. Les valeurs reprises des anciennes');
    console.log('     lignes sont à vérifier.');
    console.log('  3. Mettre le widget Charge à jour (v22 ou plus récent) : il lit');
    console.log('     désormais Vivier_profils et saisit à ce niveau.');
    console.log('  4. Le seuil « vivier_minimum » (2) s\'applique maintenant par');
    console.log('     profil et non par formation. Si vous teniez à la règle');
    console.log('     « aucune formation ne repose sur une seule personne », elle');
    console.log('     ne se lit plus ici : elle relève du registre des habilitations.');
  }
  console.log('='.repeat(70));
})();
