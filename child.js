// Fill: resum d'una pantalla i vistes de secció (spec 2026-11-17-panell-mobil) amb les seccions d'edició remota (spec 2026-09-27 §3):
// Ajustos, Premis demanats, Monedes, Missatge i Expedicions. Cada acció en viu (`RemoteAction`, spec §1.1)
// s'afegeix a `control/<id>.json` amb un id únic; el PC l'aplica un cop i ho marca a `actionsApplied`.

import { explain, putControl } from './api.js';
import { actionId, ago, confirmButton, dateWithMonth, h, shortDate } from './util.js';
import { SECTIONS, accuracy, routeHash } from './view.js';

export const ISLANDS = ['mat', 'ca', 'es'];
const PACES = [
  ['reforç', 'Reforç'],
  ['normal', 'Normal'],
  ['repte', 'Repte'],
];
const SLOTS = [
  ['mat', 'Mates'],
  ['ca', 'Català'],
  ['es', 'Castellà'],
  ['llengua', 'Llengua (alterna)'],
  ['lliure', 'Lliure'],
];
const STATUS_TEXT = { locked: 'tancada', open: 'oberta', completed: 'completada', mastered: 'dominada', jumped: 'saltada' };
const FOCUS_FIELDS = [
  ['nivellsCurts', 'Reptes curts', 'El repte final és de 5 exercicis en comptes de 8.'],
  ['pausesMoviment', 'Pauses de moviment', 'S’ofereix una pausa de 30 segons cada dos nivells; mai s’imposa.'],
  ['senseTemps', 'Sense comptadors', 'Cap exercici mostra temps ni compte enrere.'],
  ['exploracioPartida', 'Expedició partida', 'L’exploració d’una illa es fa en dues sortides més curtes.'],
];
const MILESTONE_PERCENTS = [25, 50, 75, 100];
const REQUEST_STATUS_TEXT = { pendent: 'Pendent', entregat: 'Entregat', 'cancel·lat': 'Cancel·lat' };
const EXPLORATION_TEXT = { pending: 'Expedició pendent', in_progress: 'Expedició a mitges', done: 'Illa explorada' };
/** Temes que el PC sap entrenar (TOPIC_REGIONS del motor). Fix aquí: el panell no llegeix el contingut de l'app. */
const TOPICS = [
  ['es.acentos', 'Acentuación'],
  ['es.bv', 'b/v'],
  ['es.h', 'La h y sus homófonos'],
  ['es.gj', 'g/j'],
  ['es.lly', 'll/y'],
  ['es.czx', 'c/z/qu/k y x/s'],
  ['es.homofonos', 'Juntas o separadas'],
  ['es.puntuacion', 'Puntuación y mayúsculas'],
];
const TOPIC_OUTCOME = { superado: 'superat', terminado: 'acabat', cambiado: 'canviat' };

/** El PC encara no puja els camps nous (spec §1.3, build antic): avisem i no trenquem res. */
function supportsRemote(status) {
  return Array.isArray(status.actionsApplied);
}

// ---------------------------------------------------------------- control pendent i cua d'accions

/** El `control/<id>.json` sencer si encara no l'ha aplicat el PC (comparant instants, no text). */
function pendingControl(full, status) {
  if (!full) return null;
  if (!status.controlApplied) return full;
  const applied = Date.parse(status.controlApplied);
  if (Number.isNaN(applied)) return full;
  return Date.parse(full.updatedAt) > applied ? full : null;
}

/** Camps de configuració del `pending` actual, sense metadades ni cues. */
function pendingSettings(pending) {
  if (!pending) return {};
  const { version: _v, updatedAt: _u, gifts: _g, actions: _a, ...rest } = pending;
  return rest;
}

/** Afegeix una acció a la cua acumulativa i conserva els regals i la configuració encara pendent d'aplicar
 *  (spec: «en desar es conserva sempre la cua actions i els gifts, i els camps pendents no aplicats»). */
function withAction(full, status, action) {
  const pending = pendingControl(full, status);
  const control = { version: 1, updatedAt: new Date().toISOString(), ...pendingSettings(pending), actions: [...(full?.actions ?? []), action] };
  if (full?.gifts?.length) control.gifts = full.gifts;
  return control;
}

/** L'acció encara no aplicada (segons `status.actionsApplied`) que compleixi `matches`, si n'hi ha. */
function findPendingAction(full, status, matches) {
  const applied = new Set(status.actionsApplied ?? []);
  const actions = full?.actions ?? [];
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const a = actions[i];
    if (!applied.has(a.id) && matches(a)) return a;
  }
  return null;
}

async function runAction(id, status, control, sha, action, commitMessage, note, refresh, button) {
  if (button) button.disabled = true;
  note.textContent = 'Desant…';
  try {
    await putControl(`control/${id}.json`, control, sha, (full) => withAction(full, status, action), commitMessage);
    note.textContent = 'Desat.';
    await refresh();
  } catch (err) {
    note.textContent = explain(err);
    if (button) button.disabled = false;
  }
}

// ---------------------------------------------------------------- valors efectius (status + pendent)

/** Valors actuals: el que diu el PC, amb el control pendent a sobre (encara no aplicat). */
function effective(status, pending) {
  const difficulty = {};
  for (const i of ISLANDS) for (const r of status.islands[i].regions) difficulty[r.id] = r.difficulty;
  Object.assign(difficulty, pending?.difficulty ?? {});
  const enabled = Object.fromEntries(ISLANDS.map((i) => [i, pending?.islandsEnabled?.[i] ?? status.islands[i].enabled]));
  const focus = { nivellsCurts: false, pausesMoviment: false, senseTemps: false, exploracioPartida: false, ...(status.focus ?? {}), ...(pending?.focus ?? {}) };
  const milestonePrizes = {};
  for (const i of ISLANDS) milestonePrizes[i] = pending?.milestonePrizes?.[i] ?? status.milestonePrizes?.[i] ?? ['', '', '', ''];
  return {
    pace: Object.fromEntries(ISLANDS.map((i) => [i, pending?.pace?.[i] ?? status.pace?.[i] ?? 'normal'])),
    planTemplate: pending?.planTemplate ?? status.planTemplate,
    dailyGoalMinutes: pending?.dailyGoalMinutes ?? status.dailyGoalMinutes,
    balancedProgress: pending?.balancedProgress ?? status.balancedProgress,
    islandsEnabled: enabled,
    difficulty,
    focus,
    rewardsPerWeek: pending?.rewardsPerWeek ?? status.rewardsPerWeek ?? 2,
    milestonePrizes,
    extension: pending?.extension ?? status.extension ?? false,
  };
}

// ---------------------------------------------------------------- resum d'una pantalla i vistes de secció (spec 2026-11-17)

const SECTION_TITLES = {
  ajusta: 'Ajusta',
  errors: 'Errors',
  premis: 'Premis demanats',
  monedes: 'Monedes',
  missatge: 'Missatge',
  expedicions: 'Expedicions',
  entrenament: 'Entrenament',
  vela: '⛵ Illa de la Vela',
};

/** Seccions que té sentit oferir per a aquest `status` (mateixes condicions que abans de les pestanyes). */
export function childAvailableSections(status) {
  const remote = supportsRemote(status);
  return SECTIONS.filter((s) => {
    if (['premis', 'monedes', 'missatge', 'expedicions'].includes(s)) return remote;
    if (s === 'entrenament') return 'topic' in status;
    if (s === 'vela') return 'vela' in status;
    return true;
  });
}

/** Una pista curta al botó de la secció, només quan surt de franc del `status`. */
function sectionHint(section, status) {
  if (section === 'premis') {
    const n = (status.rewardRequests ?? []).filter((r) => r.status === 'pendent').length;
    return n ? `${n} pendent${n > 1 ? 's' : ''}` : '';
  }
  if (section === 'monedes' && typeof status.coins === 'number') return `${status.coins} monedes`;
  if (section === 'entrenament') return status.topic?.title ?? 'cap';
  return '';
}

function pendingNotice(status, pending) {
  return pending ? h('p', { class: 'pending' }, `Canvis desats ${ago(pending.updatedAt)}: s’aplicaran quan ${status.name} obri l’aplicació.`) : null;
}

export function childSummary({ id, status, control }) {
  const pending = pendingControl(control, status);
  const sections = childAvailableSections(status);
  return h(
    'article',
    { class: 'card child' },
    h(
      'header',
      { class: 'child-head' },
      h('h2', {}, status.name),
      h('span', { class: 'muted small' }, `actualitzat ${ago(status.generatedAt)}`, status.build ? ` · build ${status.build}` : ''),
    ),
    pendingNotice(status, pending),
    statsSection(status),
    daysChart(status.days, status.dailyGoalMinutes),
    h('div', { class: 'islands' }, ISLANDS.map((i) => islandBlock(status.islands[i], pending?.pace?.[i] ?? status.pace?.[i] ?? 'normal'))),
    topErrors(status),
    !supportsRemote(status)
      ? h(
          'p',
          { class: 'notice' },
          `Actualitza l’app d’aquest ordinador per veure i editar la concentració, els premis per setmana, les fites, l’extensió i les accions en viu de ${status.name} (premis demanats, monedes, missatges i expedicions).`,
        )
      : null,
    h(
      'nav',
      { class: 'section-nav', 'aria-label': `Seccions de ${status.name}` },
      sections.map((s) => {
        const hint = sectionHint(s, status);
        return h(
          'a',
          { class: 'section-link', href: routeHash(id, s) },
          h('span', { class: 'section-name' }, SECTION_TITLES[s]),
          hint ? h('span', { class: 'muted small' }, hint) : null,
          h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'),
        );
      }),
    ),
  );
}

/** Una secció a pantalla sencera: capçalera per tornar i el contingut de sempre, obert. `null` si no hi és. */
export function childSection({ id, status, control, sha }, section, refresh) {
  if (!childAvailableSections(status).includes(section)) return null;
  const pending = pendingControl(control, status);
  const builders = {
    ajusta: () => settingsSection(id, status, control, pending, sha, refresh),
    errors: () => errorsPage(status),
    premis: () => rewardsSection(id, status, control, sha, refresh),
    monedes: () => coinsSection(id, status, control, sha, refresh),
    missatge: () => messageSection(id, status, control, sha, refresh),
    expedicions: () => explorationsSection(id, status, control, sha, refresh),
    entrenament: () => topicSection(id, status, control, sha, refresh),
    vela: () => velaSection(id, status, control, sha, refresh),
  };
  const body = builders[section]();
  if (body.tagName === 'DETAILS') {
    body.open = true;
    body.classList.add('as-page');
  }
  return h(
    'article',
    { class: 'card child section-page' },
    h('header', { class: 'section-head' }, h('a', { class: 'back', href: routeHash(id) }, `‹ ${status.name}`), h('h2', {}, SECTION_TITLES[section])),
    pendingNotice(status, pending),
    body,
  );
}

/** `YYYY-MM-DD` del dia local, com `status.today` del PC. */
function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function stat(label, value, hint, tone) {
  return h(
    'div',
    { class: tone ? `stat tone-${tone}` : 'stat' },
    h('span', { class: 'stat-label' }, label),
    h('strong', { class: 'stat-value' }, value),
    hint ? h('span', { class: 'stat-hint' }, hint) : null,
  );
}

function statsSection(status) {
  const goal = status.dailyGoalMinutes;
  const today = status.days.find((d) => d.date === status.today) ?? { exercises: 0, correct: 0 };
  const acc = accuracy(today.correct, today.exercises);
  const perWeek = status.settings?.family?.daysPerWeek;
  // Si el PC no ha pujat res avui, el «dia» del status és un altre: no l'anomenem «avui».
  const isToday = status.today === localDate(new Date());
  const dayLabel = isToday ? 'Avui' : dateWithMonth(status.today);
  return h(
    'div',
    { class: 'stats' },
    stat(dayLabel, `${status.minutesToday}/${goal} min`, status.minutesToday >= goal ? '✅ complert' : `falten ${goal - status.minutesToday} min`),
    stat(isToday ? 'Encerts avui' : 'Encerts', acc.pct === null ? '—' : `${acc.pct} %`, today.exercises ? `${today.correct} de ${today.exercises}` : 'cap exercici', acc.tone),
    stat('Setmana', `${status.activeDaysWeek}${perWeek ? `/${perWeek}` : ''} dies`, `${status.minutesWeek} min · ${status.levelsWeek} nivells`),
  );
}

/** Últims 14 dies: barra de minuts i, a sota, el % d'encerts del dia (buit si no va jugar). */
function daysChart(days, goal) {
  const max = Math.max(goal, ...days.map((d) => d.minutes), 1);
  const bars = days.map((d) =>
    h(
      'div',
      { class: 'bar', title: `${shortDate(d.date)}: ${d.minutes} min · ${d.levels} nivells` },
      h('span', { class: d.minutes >= goal ? 'fill met' : 'fill', style: `height:${Math.round((d.minutes / max) * 100)}%` }),
    ),
  );
  const pcts = days.map((d) => {
    const acc = accuracy(d.correct, d.exercises);
    return h('span', { class: `pct tone-${acc.tone}` }, acc.pct === null ? '' : `${acc.pct}`);
  });
  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', {}, 'Minuts i encerts per dia'),
    h(
      'tbody',
      {},
      days.map((d) => {
        const acc = accuracy(d.correct, d.exercises);
        return h('tr', {}, h('th', { scope: 'row' }, shortDate(d.date)), h('td', {}, `${d.minutes} min`), h('td', {}, acc.pct === null ? '—' : `${acc.pct} % d’encerts`));
      }),
    ),
  );
  return h(
    'figure',
    { class: 'chart' },
    h('div', { class: 'bars', 'aria-hidden': 'true' }, h('span', { class: 'goal', style: `bottom:${Math.round((goal / max) * 100)}%` }), bars),
    h('div', { class: 'pcts', 'aria-hidden': 'true' }, pcts),
    h('figcaption', { class: 'muted' }, `Minuts (línia: objectiu de ${goal}) i % d’encerts, últims 14 dies`),
    table,
  );
}

function islandBlock(island, pace) {
  const current = island.regions.find((r) => r.id === island.current);
  return h(
    'div',
    { class: island.enabled ? 'island' : 'island off' },
    h('div', { class: 'island-head' }, h('strong', {}, island.name), h('span', { class: 'chip' }, island.enabled ? `${island.treasure} % · ${pace}` : 'desactivada')),
    h('div', { class: 'meter', role: 'img', 'aria-label': `Tresor ${island.treasure}%` }, h('span', { style: `width:${island.treasure}%` })),
    current ? h('div', { class: 'muted small island-now' }, `ara: ${current.emoji} ${current.title} (dificultat ${current.difficulty})`) : null,
  );
}

function rulesList(rules) {
  return h('ol', { class: 'rules' }, rules.map((r) => h('li', {}, h('span', {}, r.label), h('span', { class: 'count' }, `${r.count}`))));
}

function topErrors(status) {
  if (!status.topRules.length) return h('p', { class: 'muted small' }, 'Cap error en els últims 30 dies.');
  return h('div', {}, h('h3', {}, 'Errors més freqüents'), rulesList(status.topRules.slice(0, 3)));
}

function errorsPage(status) {
  const top = status.topRules.length ? rulesList(status.topRules) : h('p', { class: 'muted' }, 'Cap error en els últims 30 dies.');
  const last = status.recentErrors.length
    ? h(
        'ul',
        { class: 'errors' },
        status.recentErrors.map((e) => h('li', {}, h('span', { class: 'muted small' }, `${shortDate(e.date)} · ${e.label}`), h('span', {}, e.prompt))),
      )
    : null;
  return h('div', {}, h('h3', {}, 'Errors més freqüents'), top, last ? h('h3', {}, `Últims ${status.recentErrors.length} errors`) : null, last);
}

// ---------------------------------------------------------------- Ajustos

function select(name, options, value, label) {
  return h(
    'label',
    {},
    label,
    h(
      'select',
      { name },
      options.map(([v, text]) => h('option', { value: v, selected: v === String(value) }, text)),
    ),
  );
}

function checkBlock(name, checked, label, hint) {
  return h(
    'div',
    { class: 'check-block' },
    h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked }), label),
    hint ? h('p', { class: 'muted small hint' }, hint) : null,
  );
}

function buildSettingsPatch(data, status, pending) {
  const patch = {};
  const keep = (key, value, current) => {
    if (JSON.stringify(value) !== JSON.stringify(current) || pending?.[key] !== undefined) patch[key] = value;
  };

  const pace = {};
  for (const i of ISLANDS) {
    const v = data.get(`pace:${i}`);
    if (v !== (status.pace?.[i] ?? 'normal') || pending?.pace?.[i] !== undefined) pace[i] = v;
  }
  if (Object.keys(pace).length) patch.pace = pace;

  const plan = [0, 1, 2, 3].map((i) => data.get(`slot${i}`)).filter(Boolean);
  keep('planTemplate', plan, status.planTemplate);
  keep('dailyGoalMinutes', Number(data.get('minutes')), status.dailyGoalMinutes);
  keep('balancedProgress', data.get('balanced') === 'on', status.balancedProgress);

  const enabled = {};
  for (const i of ISLANDS) {
    const v = data.get(`on:${i}`) === 'on';
    if (v !== status.islands[i].enabled || pending?.islandsEnabled?.[i] !== undefined) enabled[i] = v;
  }
  if (Object.keys(enabled).length) patch.islandsEnabled = enabled;

  const difficulty = {};
  for (const i of ISLANDS) {
    for (const r of status.islands[i].regions) {
      const v = data.get(`d:${r.id}`);
      if (v === null) continue;
      if (Number(v) !== r.difficulty || pending?.difficulty?.[r.id] !== undefined) difficulty[r.id] = Number(v);
    }
  }
  if (Object.keys(difficulty).length) patch.difficulty = difficulty;

  const focus = {};
  for (const [key] of FOCUS_FIELDS) {
    const v = data.get(`focus:${key}`) === 'on';
    const curVal = status.focus?.[key] ?? false;
    if (v !== curVal || pending?.focus?.[key] !== undefined) focus[key] = v;
  }
  if (Object.keys(focus).length) patch.focus = focus;

  keep('rewardsPerWeek', Number(data.get('rewardsPerWeek')), status.rewardsPerWeek ?? 2);

  const milestonePrizes = {};
  for (const i of ISLANDS) {
    const values = MILESTONE_PERCENTS.map((_p, idx) => String(data.get(`prize:${i}:${idx}`) ?? '').trim());
    const curVal = status.milestonePrizes?.[i] ?? ['', '', '', ''];
    if (JSON.stringify(values) !== JSON.stringify(curVal) || pending?.milestonePrizes?.[i] !== undefined) milestonePrizes[i] = values;
  }
  if (Object.keys(milestonePrizes).length) patch.milestonePrizes = milestonePrizes;

  keep('extension', data.get('extension') === 'on', status.extension ?? false);

  return patch;
}

function settingsSection(id, status, full, pending, sha, refresh) {
  const cur = effective(status, pending);
  const slotOptions = [['', '—'], ...SLOTS];
  const plan = [0, 1, 2, 3].map((i) => select(`slot${i}`, i < 1 ? SLOTS : slotOptions, cur.planTemplate[i] ?? '', `Casella ${i + 1}`));
  const regions = ISLANDS.map((i) =>
    h(
      'fieldset',
      { class: 'regions' },
      h('legend', {}, status.islands[i].name),
      status.islands[i].regions.every((r) => r.status === 'locked') ? h('p', { class: 'muted small' }, 'Encara no hi ha cap regió oberta.') : null,
      status.islands[i].regions
        .filter((r) => r.status !== 'locked' || cur.difficulty[r.id] !== r.difficulty)
        .map((r) =>
          select(
            `d:${r.id}`,
            [
              ['1', '1'],
              ['2', '2'],
              ['3', '3'],
            ],
            cur.difficulty[r.id],
            `${r.emoji} ${r.title} (${STATUS_TEXT[r.status] ?? r.status})`,
          ),
        ),
    ),
  );
  const prizes = ISLANDS.map((i) =>
    h(
      'fieldset',
      {},
      h('legend', {}, status.islands[i].name),
      h(
        'div',
        { class: 'grid2' },
        MILESTONE_PERCENTS.map((pct, idx) =>
          h('label', {}, `Al ${pct} %`, h('input', { type: 'text', name: `prize:${i}:${idx}`, maxlength: '80', value: cur.milestonePrizes[i][idx] ?? '', placeholder: 'Sense premi' })),
        ),
      ),
    ),
  );
  const note = h('p', { class: 'muted small', role: 'status' });
  const form = h(
    'form',
    { class: 'control' },
    h('fieldset', {}, h('legend', {}, 'Ritme per illa'), h('div', { class: 'grid3' }, ISLANDS.map((i) => select(`pace:${i}`, PACES, cur.pace[i], status.islands[i].name)))),
    h('fieldset', {}, h('legend', {}, 'Pla del dia'), h('div', { class: 'grid2' }, plan)),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Dia a dia'),
      select(
        'minutes',
        [
          ['10', '10 minuts'],
          ['15', '15 minuts'],
          ['20', '20 minuts'],
        ],
        cur.dailyGoalMinutes,
        'Objectiu diari',
      ),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'balanced', checked: cur.balancedProgress }), 'Avanç equilibrat entre illes'),
      h(
        'div',
        { class: 'grid3' },
        ISLANDS.map((i) =>
          h(
            'div',
            { class: 'island-toggle' },
            h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `on:${i}`, checked: cur.islandsEnabled[i] }), `${status.islands[i].name} activa`),
            i === 'mat' ? h('label', { class: 'check sub' }, h('input', { type: 'checkbox', name: 'extension', checked: cur.extension }), 'Amb extensió (múltiples, divisors)') : null,
          ),
        ),
      ),
    ),
    h('details', {}, h('summary', {}, 'Dificultat per regió'), h('p', { class: 'muted small' }, 'Canviar-la reinicia el recompte d’encerts recents de la regió.'), regions),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Concentració'),
      h('p', { class: 'muted small' }, 'Pensat per a sessions curtes i sense pressa.'),
      FOCUS_FIELDS.map(([key, label, hint]) => checkBlock(`focus:${key}`, cur.focus[key], label, hint)),
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Premis de fita del tresor'),
      h('p', { class: 'muted small' }, 'Text opcional en arribar al 25, 50, 75 i 100 % del tresor de cada illa.'),
      prizes,
    ),
    h(
      'fieldset',
      {},
      h('legend', {}, 'Premis reals'),
      h('label', {}, 'Límit de premis per setmana', h('input', { type: 'number', name: 'rewardsPerWeek', min: '0', max: '7', value: String(cur.rewardsPerWeek) })),
      h('p', { class: 'muted small' }, '0 desactiva la botiga de premis reals.'),
    ),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Desa els canvis')),
    note,
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    if (ISLANDS.every((i) => data.get(`on:${i}`) !== 'on')) {
      note.textContent = 'Cal deixar almenys una illa activa.';
      return;
    }
    const patch = buildSettingsPatch(data, status, pending);
    if (Object.keys(patch).length === 0) {
      note.textContent = 'No has canviat res.';
      return;
    }
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    note.textContent = 'Desant…';
    try {
      await putControl(
        `control/${id}.json`,
        full,
        sha,
        (freshFull) => {
          const p = pendingControl(freshFull, status);
          const control = { version: 1, updatedAt: new Date().toISOString(), ...pendingSettings(p), ...patch };
          if (freshFull?.gifts?.length) control.gifts = freshFull.gifts;
          if (freshFull?.actions?.length) control.actions = freshFull.actions;
          return control;
        },
        `panell: control de ${id}`,
      );
      note.textContent = 'Desat.';
      await refresh();
    } catch (err) {
      note.textContent = explain(err);
      button.disabled = false;
    }
  });
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Ajusta'), form, resetDayBlock(id, status, full, sha, refresh), timeGoalBlock(id, status, full, sha, refresh), minAnswerBlock(id, status, full, sha, refresh));
}

/** L'app entén l'acció `resetDay` des de la build 17 (2026-11-20). */
const RESET_DAY_BUILD = 17;

/** Data d'avui a l'hora local del navegador (la de l'ordinador del nen, si som a casa). */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «Reinicia el dia d'avui»: per si ha respost a l'atzar; el pla torna a començar i els minuts tornen a comptar. */
function resetDayBlock(id, status, control, sha, refresh) {
  const title = h('h3', {}, 'Reinicia el dia d’avui');
  const help = h(
    'p',
    { class: 'muted small' },
    `Per si ha respost a l’atzar: el pla d’avui torna a començar i els ${status.dailyGoalMinutes} minuts de l’objectiu tornen a comptar des de zero (amb l’objectiu per temps). El que ha fet avui es queda al registre; el cofre ja obert no es torna a donar. Si l’app està oberta, s’aplica en uns 3 minuts.`,
  );
  if (!(status.build >= RESET_DAY_BUILD)) {
    return h('div', {}, title, help, h('p', { class: 'muted small' }, `Cal que l’ordinador de ${status.name} tingui la versió ${RESET_DAY_BUILD} de l’app o posterior (ara té la ${status.build ?? '?'}). S’actualitza sola en obrir-la.`));
  }
  const note = h('p', { class: 'muted small', role: 'status' });
  const date = localToday();
  const queued = findPendingAction(control, status, (a) => a.type === 'resetDay' && a.date === date);
  if (queued) return h('div', {}, title, help, h('span', { class: 'chip' }, 'pendent: es reiniciarà quan l’app el rebi'));
  const button = confirmButton({
    label: 'Reinicia el dia',
    confirmLabel: 'Sí, reinicia’l',
    onConfirm: () => runAction(id, status, control, sha, { id: actionId('reset-day'), type: 'resetDay', date }, `panell: reinicia el dia ${date} de ${id}`, note, refresh),
  });
  return h('div', {}, title, help, h('div', { class: 'row' }, button), note);
}

/** L'app entén l'acció `minAnswer` des de la build 16 (2026-11-20). */
const MIN_ANSWER_BUILD = 16;
const MIN_ANSWER_OPTIONS = [0, 3, 5, 8, 10];

/** «Temps mínim per pregunta»: el botó «Comprova» queda bloquejat uns segons a cada pregunta. */
function minAnswerBlock(id, status, control, sha, refresh) {
  const title = h('h3', {}, 'Temps mínim per pregunta');
  const help = h('p', { class: 'muted small' }, 'El botó «Comprova» queda bloquejat aquests segons a cada pregunta i a cada intent. Per a qui respon a l’atzar.');
  if (!(status.build >= MIN_ANSWER_BUILD)) {
    return h('div', {}, title, help, h('p', { class: 'muted small' }, `Cal que l’ordinador de ${status.name} tingui la versió ${MIN_ANSWER_BUILD} de l’app o posterior (ara té la ${status.build ?? '?'}). S’actualitza sola en obrir-la.`));
  }
  const note = h('p', { class: 'muted small', role: 'status' });
  const cur = Number(status.minAnswerSeconds ?? 0);
  const queued = findPendingAction(control, status, (a) => a.type === 'minAnswer');
  const label = (s) => (s === 0 ? 'Sense mínim' : `${s} segons`);
  const state = h('p', {}, `Ara: ${label(cur)}`);
  if (queued) return h('div', {}, title, help, state, h('span', { class: 'chip' }, `pendent: ${label(queued.seconds)}`));
  const picker = h('select', { name: 'minAnswer', 'aria-label': 'Temps mínim per pregunta' }, MIN_ANSWER_OPTIONS.map((s) => h('option', { value: String(s), selected: s === cur }, label(s))));
  const save = h(
    'button',
    {
      type: 'button',
      onclick: (ev) => {
        const seconds = Number(picker.value);
        if (seconds === cur) {
          note.textContent = 'No has canviat res.';
          return;
        }
        runAction(id, status, control, sha, { id: actionId('min-answer'), type: 'minAnswer', seconds }, `panell: mínim de ${seconds} s per pregunta per a ${id}`, note, refresh, ev.currentTarget);
      },
    },
    'Desa',
  );
  return h('div', {}, title, help, state, h('div', { class: 'row' }, picker, save), note);
}

/** L'app entén l'acció `timeGoal` des de la build 15 (2026-11-20); una build anterior rebutjaria tot el fitxer. */
const TIME_GOAL_BUILD = 15;

/** «Objectiu per temps»: el dia es completa pels minuts, no per les caselles (el Martí responia de pressa per acabar). */
function timeGoalBlock(id, status, control, sha, refresh) {
  const title = h('h3', {}, 'Objectiu per temps');
  const help = h(
    'p',
    { class: 'muted small' },
    `El dia només es completa quan arriba als minuts de l’objectiu (ara ${status.dailyGoalMinutes}), no amb 3 nivells. Quan acaba les caselles del pla, n’hi apareixen més, d’una en una, fins arribar als minuts.`,
  );
  if (!(status.build >= TIME_GOAL_BUILD)) {
    return h('div', {}, title, help, h('p', { class: 'muted small' }, `Cal que l’ordinador de ${status.name} tingui la versió ${TIME_GOAL_BUILD} de l’app o posterior (ara té la ${status.build ?? '?'}). S’actualitza sola en obrir-la.`));
  }
  const note = h('p', { class: 'muted small', role: 'status' });
  const on = status.timeGoal === true;
  const queued = findPendingAction(control, status, (a) => a.type === 'timeGoal');
  const state = h('p', {}, on ? 'Ara: ✓ activat' : 'Ara: desactivat (el dia es completa amb el pla o amb 3 nivells)');
  const toggle = queued
    ? h('span', { class: 'chip' }, `pendent: ${queued.enabled ? 'activa' : 'desactiva'}`)
    : h(
        'button',
        {
          type: 'button',
          onclick: (ev) =>
            runAction(id, status, control, sha, { id: actionId('time-goal'), type: 'timeGoal', enabled: !on }, `panell: objectiu per temps ${!on ? 'activat' : 'desactivat'} per a ${id}`, note, refresh, ev.currentTarget),
        },
        on ? 'Desactiva' : 'Activa',
      );
  return h('div', {}, title, help, state, h('div', { class: 'row' }, toggle), note);
}

// ---------------------------------------------------------------- Premis demanats

function rewardRow(id, status, control, sha, request, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  if (request.status !== 'pendent') {
    return h(
      'li',
      { class: 'request done' },
      h('div', {}, h('strong', {}, request.title), h('span', { class: 'requestMeta muted small' }, ` · ${shortDate(request.date)} · ${request.cost} monedes`)),
      h('span', { class: 'chip' }, REQUEST_STATUS_TEXT[request.status] ?? request.status),
    );
  }
  const queued = findPendingAction(control, status, (a) => a.type === 'rewardStatus' && a.requestId === request.id);
  const actions = queued
    ? h('span', { class: 'chip' }, `pendent: ${REQUEST_STATUS_TEXT[queued.status] ?? queued.status}`)
    : h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            type: 'button',
            onclick: (ev) =>
              runAction(id, status, control, sha, { id: actionId('reward'), type: 'rewardStatus', requestId: request.id, status: 'entregat' }, `panell: entregat premi de ${id}`, note, refresh, ev.currentTarget),
          },
          'Lliurat',
        ),
        confirmButton({
          label: 'Cancel·la',
          confirmLabel: 'Sí, cancel·la',
          onConfirm: () =>
            runAction(id, status, control, sha, { id: actionId('reward'), type: 'rewardStatus', requestId: request.id, status: 'cancel·lat' }, `panell: cancel·la premi de ${id}`, note, refresh),
        }),
      );
  return h(
    'li',
    { class: 'request' },
    h('div', {}, h('strong', {}, request.title), h('span', { class: 'requestMeta muted small' }, ` · ${shortDate(request.date)} · ${request.cost} monedes (es tornen si es cancel·la)`)),
    actions,
    note,
  );
}

function rewardsSection(id, status, control, sha, refresh) {
  const requests = status.rewardRequests ?? [];
  const list = requests.length
    ? h(
        'ul',
        { class: 'requests' },
        requests
          .slice()
          .reverse()
          .map((r) => rewardRow(id, status, control, sha, r, refresh)),
      )
    : h('p', { class: 'muted small' }, 'Cap petició de premi en les últimes vuit setmanes.');
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Premis demanats'), list);
}

// ---------------------------------------------------------------- Monedes

function coinsHistory(control, status) {
  const applied = new Set(status.actionsApplied ?? []);
  const receivedGifts = new Set(status.giftsReceived ?? []);
  const gifts = (control?.gifts ?? []).map((g) => ({ id: g.id, amount: g.coins, note: g.note, applied: receivedGifts.has(g.id) }));
  const moves = (control?.actions ?? [])
    .filter((a) => a.type === 'coins')
    .map((a) => ({ id: a.id, amount: a.amount, note: a.note, applied: applied.has(a.id) }));
  return [...gifts, ...moves].slice(-8).reverse();
}

function coinsSection(id, status, control, sha, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const history = coinsHistory(control, status);
  const list = history.length
    ? h(
        'ul',
        { class: 'moves' },
        history.map((m) =>
          h(
            'li',
            {},
            h('span', { class: m.amount >= 0 ? 'amount up' : 'amount down' }, `${m.amount > 0 ? '+' : ''}${m.amount} monedes`),
            m.note ? ` · ${m.note}` : '',
            ' — ',
            h('span', { class: m.applied ? 'chip ok' : 'chip' }, m.applied ? 'aplicat' : 'pendent'),
          ),
        ),
      )
    : h('p', { class: 'muted small' }, 'Encara no s’ha regalat ni tret cap moneda.');
  const amountInput = h('input', { type: 'number', name: 'amount', min: '-1000', max: '1000', step: '1', value: '20', required: true });
  const noteInput = h('input', { type: 'text', name: 'note', maxlength: '80', placeholder: 'Per l’esforç d’aquesta setmana' });
  const form = h(
    'form',
    { class: 'control' },
    h('label', {}, 'Monedes (negatiu per treure’n)', amountInput),
    h('label', {}, 'Motiu (opcional)', noteInput),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Desa el moviment')),
    note,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const amount = Math.round(Number(amountInput.value));
    if (!Number.isFinite(amount) || amount === 0 || amount < -1000 || amount > 1000) {
      note.textContent = 'Entre -1000 i 1000 monedes, sense ser zero.';
      return;
    }
    const text = noteInput.value.trim().slice(0, 80);
    const action = { id: actionId('coins'), type: 'coins', amount, ...(text ? { note: text } : {}) };
    void runAction(id, status, control, sha, action, `panell: ${amount > 0 ? 'regal' : 'resta'} de monedes de ${id}`, note, refresh, form.querySelector('button[type=submit]'));
  });
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Monedes'), list, form);
}

// ---------------------------------------------------------------- Missatge

function messageSection(id, status, control, sha, refresh) {
  const applied = new Set(status.actionsApplied ?? []);
  const queued = (control?.actions ?? []).filter((a) => a.type === 'message' && !applied.has(a.id));
  const sent = (status.messages ?? []).slice().reverse();
  const note = h('p', { class: 'muted small', role: 'status' });
  const textarea = h('textarea', { name: 'text', maxlength: '280', rows: '3', placeholder: 'Escriu un missatge curt…' });
  const counter = h('span', { class: 'muted small' }, '0 / 280');
  textarea.addEventListener('input', () => {
    counter.textContent = `${textarea.value.length} / 280`;
  });
  const form = h(
    'form',
    { class: 'control' },
    h('label', {}, 'Missatge', textarea),
    counter,
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Envia')),
    note,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const text = textarea.value.trim();
    if (!text) {
      note.textContent = 'Escriu algun text.';
      return;
    }
    if (text.length > 280) {
      note.textContent = 'Màxim 280 caràcters.';
      return;
    }
    void runAction(id, status, control, sha, { id: actionId('msg'), type: 'message', text }, `panell: missatge a ${id}`, note, refresh, form.querySelector('button[type=submit]')).then(() => {
      textarea.value = '';
      counter.textContent = '0 / 280';
    });
  });
  const queuedList = queued.length
    ? h(
        'ul',
        { class: 'msg-list' },
        queued.map((a) => h('li', {}, h('span', { class: 'chip' }, 'pendent d’enviar'), ` ${a.text}`)),
      )
    : null;
  const sentList = sent.length
    ? h(
        'ul',
        { class: 'msg-list' },
        sent
          .slice(0, 10)
          .map((m) =>
            h(
              'li',
              {},
              h('span', { class: m.readAt ? 'chip ok' : 'chip' }, m.readAt ? `llegit ${ago(m.readAt)}` : 'no llegit'),
              ` ${m.text}`,
              h('span', { class: 'muted small' }, ` · ${shortDate(m.date)}`),
            ),
          ),
      )
    : h('p', { class: 'muted small' }, 'Encara no s’ha enviat cap missatge.');
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Missatge'), queuedList, sentList, form);
}

// ---------------------------------------------------------------- Expedicions

function explorationsSection(id, status, control, sha, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const rows = ISLANDS.map((island) => {
    // L'app hi posa l'estat com a text (`done`); s'accepta també la forma `{ status, part }`.
    const raw = status.explorations?.[island];
    const st = typeof raw === 'string' ? { status: raw } : raw;
    const label = st ? (EXPLORATION_TEXT[st.status] ?? st.status) + (st.status === 'in_progress' && st.part ? ` (part ${st.part})` : '') : '—';
    const queued = findPendingAction(control, status, (a) => a.type === 'relaunchExploration' && a.island === island);
    const action = queued
      ? h('span', { class: 'chip' }, 'pendent de reiniciar')
      : confirmButton({
          label: 'Torna a explorar',
          confirmLabel: 'Sí, reinicia',
          onConfirm: () =>
            runAction(id, status, control, sha, { id: actionId('explore'), type: 'relaunchExploration', island }, `panell: reinicia expedició ${island} de ${id}`, note, refresh),
        });
    return h('div', { class: 'island-row' }, h('strong', {}, status.islands[island].name), h('span', { class: 'muted small' }, label), action);
  });
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Expedicions'), rows, note, openRegionBlock(id, status, control, sha, refresh));
}

/** L'app entén l'acció `openRegion` des de la build 13 (2026-11-18); una build anterior rebutjaria tot el fitxer. */
const OPEN_REGION_BUILD = 13;

/** «Obre ara una regió»: per quan l'expedició va donar per sabuda una base que no ho és (el Martí i les taules). */
function openRegionBlock(id, status, control, sha, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const title = h('h3', {}, 'Obre ara una regió');
  const help = h('p', { class: 'muted small' }, 'La regió s’obre com a prioritat, a dificultat 1, i el pla del dia la posa davant de les altres. El que ja ha fet a les altres regions es manté.');
  if (!(status.build >= OPEN_REGION_BUILD)) {
    return h('div', {}, title, h('p', { class: 'muted small' }, `Cal que l’ordinador de ${status.name} tingui la versió ${OPEN_REGION_BUILD} de l’app o posterior (ara té la ${status.build ?? '?'}). S’actualitza sola en obrir-la.`));
  }
  const applied = new Set(status.actionsApplied ?? []);
  const queued = (control?.actions ?? []).filter((a) => a.type === 'openRegion' && !applied.has(a.id));
  const queuedIds = new Set(queued.map((a) => a.region));
  const regionTitle = (rid) => {
    for (const i of ISLANDS) {
      const r = status.islands[i].regions.find((x) => x.id === rid);
      if (r) return `${r.emoji} ${r.title}`;
    }
    return rid;
  };
  const pendingList = queued.length
    ? h('ul', { class: 'msg-list' }, queued.map((a) => h('li', {}, h('span', { class: 'chip' }, 'pendent'), ` ${regionTitle(a.region)}`)))
    : null;
  const groups = ISLANDS.map((i) => {
    const locked = status.islands[i].regions.filter((r) => r.status === 'locked' && !queuedIds.has(r.id));
    return locked.length ? h('optgroup', { label: status.islands[i].name }, locked.map((r) => h('option', { value: r.id }, `${r.emoji} ${r.title}`))) : null;
  }).filter(Boolean);
  if (!groups.length) return h('div', {}, title, pendingList, h('p', { class: 'muted small' }, 'No hi ha cap regió tancada.'));
  const picker = h('select', { name: 'openRegion', 'aria-label': 'Regió per obrir' }, groups);
  const button = confirmButton({
    label: 'Obre-la ara',
    confirmLabel: 'Sí, obre-la',
    onConfirm: () =>
      runAction(id, status, control, sha, { id: actionId('open'), type: 'openRegion', region: picker.value }, `panell: obre ${picker.value} per a ${id}`, note, refresh),
  });
  return h('div', {}, title, help, pendingList, h('div', { class: 'row' }, picker, button), note);
}

// ---------------------------------------------------------------- Entrenament d'una norma (spec 2026-09-28 §5.2)

function pct(correct, total) {
  return total > 0 ? Math.round((correct / total) * 100) : 0;
}

function topicTests(t) {
  if (!t.tests.length) return h('p', { class: 'muted small' }, 'Encara no ha fet la prova inicial.');
  return h(
    'ol',
    { class: 'topic-tests' },
    t.tests.map((x) => h('li', {}, `${dateWithMonth(x.date)} · ${x.kind === 'initial' ? 'inicial' : 'periòdica'} · `, h('strong', {}, `${x.correct}/${x.total} (${pct(x.correct, x.total)} %)`))),
  );
}

function topicRules(t) {
  const last = t.tests[t.tests.length - 1];
  if (!last) return null;
  return h(
    'ul',
    { class: 'topic-rules' },
    Object.entries(last.byRule).map(([rule, s]) => {
      const p = pct(s.correct, s.total);
      return h('li', { class: p >= 80 ? 'ok' : p < 50 ? 'bad' : '' }, h('span', {}, t.labels[rule] ?? rule), h('strong', {}, `${p} %`));
    }),
  );
}

function topicSection(id, status, control, sha, refresh) {
  const t = status.topic;
  const note = h('p', { class: 'muted small', role: 'status' });
  const queuedAssign = findPendingAction(control, status, (a) => a.type === 'topic');
  const queuedStop = findPendingAction(control, status, (a) => a.type === 'topicStop');

  const picker = h(
    'select',
    { name: 'topic', 'aria-label': 'Tema de l’entrenament' },
    TOPICS.map(([value, label]) => h('option', { value, selected: (t?.topic ?? TOPICS[0][0]) === value }, label)),
  );
  // Canviar de tema amb un entrenament en curs arxiva la sessió actual com a «cambiado»: cal confirmar-ho
  // igual que «Acaba l'entrenament» (mateix mecanisme de dos passos, sense diàleg natiu). Assignar quan no
  // n'hi ha cap en curs continua sent d'un sol clic.
  const assignWrap = h('span', { class: 'confirm' });
  const doAssign = (topic, button) =>
    runAction(id, status, control, sha, { id: actionId('topic'), type: 'topic', topic }, `panell: entrenament ${topic} per a ${id}`, note, refresh, button);
  const showAssignIdle = () => {
    const btn = h('button', { type: 'button' }, t ? 'Canvia al tema triat' : 'Comença');
    btn.addEventListener('click', () => {
      const topic = picker.value;
      if (t && t.topic === topic) {
        note.textContent = 'Ja està entrenant aquest tema.';
        return;
      }
      if (t) showAssignConfirm(topic);
      else void doAssign(topic, btn);
    });
    assignWrap.replaceChildren(btn);
  };
  const showAssignConfirm = (topic) => {
    const confirmBtn = h('button', { type: 'button' }, 'Sí, canvia');
    confirmBtn.addEventListener('click', () => void doAssign(topic, confirmBtn));
    assignWrap.replaceChildren(
      h('span', { class: 'muted small' }, 'Segur? L’entrenament actual es desarà com a canviat.'),
      confirmBtn,
      h('button', { type: 'button', class: 'ghost', onclick: showAssignIdle }, 'Cancel·la'),
    );
  };
  showAssignIdle();
  // si canvia el tema triat amb la confirmació oberta, torna al pas inicial (com el panell local)
  picker.addEventListener('change', showAssignIdle);

  const current = t
    ? h(
        'div',
        { class: 'topic-current' },
        h('p', {}, h('strong', {}, `En curs: ${t.title}`), h('span', { class: 'muted small' }, ` · des del ${dateWithMonth(t.assignedAt.slice(0, 10))} · sessions des de l’última prova: ${Math.min(t.sessionsSinceTest, 3)} de 3`)),
        t.stalled ? h('p', { class: 'notice' }, 'Porta 4 proves sense millorar. Potser val la pena repassar-ho junts o canviar de tema.') : null,
        t.redRules.length ? h('p', { class: 'notice' }, `Normes per sota del 50 %: ${t.redRules.map((r) => t.labels[r] ?? r).join(', ')}`) : null,
        topicTests(t),
        topicRules(t),
        queuedStop
          ? h('span', { class: 'chip' }, 'pendent d’acabar')
          : confirmButton({
              label: 'Acaba l’entrenament',
              confirmLabel: 'Sí, acaba',
              onConfirm: () => runAction(id, status, control, sha, { id: actionId('topic-stop'), type: 'topicStop' }, `panell: acaba l’entrenament de ${id}`, note, refresh),
            }),
      )
    : h('p', { class: 'muted small' }, 'Ara no té cap entrenament.');

  const queued = queuedAssign ? h('p', {}, h('span', { class: 'chip' }, 'pendent d’aplicar'), ` ${TOPICS.find(([v]) => v === queuedAssign.topic)?.[1] ?? queuedAssign.topic}`) : null;

  const history = (status.topicHistory ?? []).slice().reverse();
  const historyList = history.length
    ? h(
        'ul',
        { class: 'msg-list' },
        history.slice(0, 10).map((r) => {
          const last = r.tests[r.tests.length - 1];
          return h('li', {}, h('span', { class: r.outcome === 'superado' ? 'chip ok' : 'chip' }, TOPIC_OUTCOME[r.outcome] ?? r.outcome), ` ${r.title} · ${dateWithMonth(r.endedAt.slice(0, 10))}`, last ? ` · ${last.correct}/${last.total}` : '');
        }),
      )
    : null;

  return h(
    'details',
    { class: 'control-wrap' },
    h('summary', {}, 'Entrenament'),
    current,
    queued,
    h('div', { class: 'row' }, picker, queuedAssign ? null : assignWrap),
    note,
    historyList ? h('p', { class: 'muted small' }, 'Historial') : null,
    historyList,
  );
}

// ---------------------------------------------------------------- Illa de la Vela (spec 2026-09-29 §5)

/** Nombre de preguntes de cada examen (`VELA_EXAM_SIZE` a `src/engine/vela.ts`). */
const VELA_EXAM_SIZE = 12;
/** Índex (0-based) del primer capítol de Feva: `velaChapterIndex('feva-parts')` a `src/engine/vela.ts`.
 *  Obrir-lo exigeix tenir aprovat l'examen d'Optimist. */
const VELA_FIRST_FEVA = 11;
const VELA_BLOCK_LABELS = { optimist: 'Optimist', feva: 'Feva' };

function velaExamLine(block, exams) {
  const e = exams[block];
  const label = VELA_BLOCK_LABELS[block];
  if (!e.lastTry) return h('p', { class: 'muted small' }, `Examen ${label}: encara no fet.`);
  const result = `${e.best}/${VELA_EXAM_SIZE}`;
  const status = e.passedAt ? `aprovat el ${dateWithMonth(e.passedAt)}` : `no aprovat (últim intent ${dateWithMonth(e.lastTry)})`;
  return h('p', {}, `Examen ${label}: `, h('strong', {}, result), ` · ${status}`);
}

/** Mateix motiu que el motor (`unlockNextChapter`) perquè el botó surti desactivat quan tocaria fallar. */
function velaUnlockReason(v) {
  if (v.unlocked >= v.total) return 'Ja ha obert tots els capítols.';
  if (v.unlocked === VELA_FIRST_FEVA && !v.exams.optimist.passedAt) return "Cal aprovar l'examen d'Optimist abans d'obrir Feva.";
  return null;
}

function velaUnlockRow(id, status, control, sha, v, note, refresh) {
  const queued = findPendingAction(control, status, (a) => a.type === 'velaUnlock');
  if (queued) return h('p', {}, h('span', { class: 'chip' }, 'pendent d’obrir'));
  const reason = velaUnlockReason(v);
  const btn = h(
    'button',
    {
      type: 'button',
      disabled: !!reason,
      onclick: (ev) =>
        runAction(id, status, control, sha, { id: actionId('vela-unlock'), type: 'velaUnlock' }, `panell: obre capítol de vela de ${id}`, note, refresh, ev.currentTarget),
    },
    'Obre el següent capítol',
  );
  return h('div', {}, h('div', { class: 'row' }, btn), reason ? h('p', { class: 'muted small' }, reason) : null);
}

function velaSection(id, status, control, sha, refresh) {
  const v = status.vela;
  const note = h('p', { class: 'muted small', role: 'status' });
  const queuedToggle = findPendingAction(control, status, (a) => a.type === 'vela');
  const toggle = queuedToggle
    ? h('span', { class: 'chip' }, `pendent: ${queuedToggle.enabled ? 'activa' : 'desactiva'}`)
    : h(
        'button',
        {
          type: 'button',
          onclick: (ev) =>
            runAction(
              id,
              status,
              control,
              sha,
              { id: actionId('vela'), type: 'vela', enabled: !v.enabled },
              `panell: vela ${!v.enabled ? 'activada' : 'desactivada'} per a ${id}`,
              note,
              refresh,
              ev.currentTarget,
            ),
        },
        v.enabled ? 'Desactiva' : 'Activa',
      );

  const progress = v.enabled
    ? h(
        'div',
        {},
        h('p', {}, `Capítols: ${v.unlocked} de ${v.total} oberts, ${v.done} completats`),
        v.next ? h('p', {}, `Següent: ${v.next}`) : null,
        velaExamLine('optimist', v.exams),
        v.unlocked > VELA_FIRST_FEVA ? velaExamLine('feva', v.exams) : null,
        v.titles.length ? h('p', {}, `Títols: ${v.titles.join(', ')}`) : null,
        velaUnlockRow(id, status, control, sha, v, note, refresh),
      )
    : null;

  return h('details', { class: 'control-wrap' }, h('summary', {}, '⛵ Illa de la Vela'), h('div', { class: 'row' }, toggle), progress, note);
}
