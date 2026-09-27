// Targeta d'un fill: resum (com ara) i totes les seccions d'edició remota (spec 2026-09-27 §3):
// Ajustos, Premis demanats, Monedes, Missatge i Expedicions. Cada acció en viu (`RemoteAction`, spec §1.1)
// s'afegeix a `control/<id>.json` amb un id únic; el PC l'aplica un cop i ho marca a `actionsApplied`.

import { explain, putControl } from './api.js';
import { actionId, ago, confirmButton, h, shortDate } from './util.js';

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

// ---------------------------------------------------------------- targeta sencera

export function childCard({ id, status, control, sha }, refresh) {
  const pending = pendingControl(control, status);
  const remote = supportsRemote(status);
  return h(
    'article',
    { class: 'card child' },
    h(
      'header',
      { class: 'child-head' },
      h('h2', {}, status.name),
      h('span', { class: 'muted small' }, `actualitzat ${ago(status.generatedAt)}`, status.build ? ` · build ${status.build}` : ''),
    ),
    pending ? h('p', { class: 'pending' }, `Canvis desats ${ago(pending.updatedAt)}: s’aplicaran quan ${status.name} obri l’aplicació.`) : null,
    statsSection(status),
    daysChart(status.days, status.dailyGoalMinutes),
    h('div', { class: 'islands' }, ISLANDS.map((i) => islandBlock(status.islands[i], (pending?.pace?.[i] ?? status.pace?.[i] ?? 'normal')))),
    errorsBlock(status),
    !remote
      ? h(
          'p',
          { class: 'notice' },
          `Actualitza l’app d’aquest ordinador per veure i editar la concentració, els premis per setmana, les fites, l’extensió i les accions en viu de ${status.name} (premis demanats, monedes, missatges i expedicions).`,
        )
      : null,
    settingsSection(id, status, control, pending, sha, refresh),
    remote ? rewardsSection(id, status, control, sha, refresh) : null,
    remote ? coinsSection(id, status, control, sha, refresh) : null,
    remote ? messageSection(id, status, control, sha, refresh) : null,
    remote ? explorationsSection(id, status, control, sha, refresh) : null,
  );
}

// ---------------------------------------------------------------- resum (com abans)

function stat(label, value, hint) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('strong', { class: 'stat-value' }, value), hint ? h('span', { class: 'stat-hint' }, hint) : null);
}

function statsSection(status) {
  return h(
    'div',
    { class: 'stats' },
    stat('Avui', `${status.minutesToday} min`, `objectiu ${status.dailyGoalMinutes} min`),
    stat('Setmana', `${status.minutesWeek} min`, `${status.activeDaysWeek} dies actius`),
    stat('Nivells', `${status.levelsWeek}`, 'aquesta setmana'),
  );
}

/** Minuts dels últims 14 dies: una barra per dia, amb el valor al títol i una taula per a lectors de pantalla. */
function daysChart(days, goal) {
  const max = Math.max(goal, ...days.map((d) => d.minutes), 1);
  const bars = days.map((d) =>
    h(
      'div',
      { class: 'bar', title: `${shortDate(d.date)}: ${d.minutes} min · ${d.levels} nivells` },
      h('span', { class: d.minutes >= goal ? 'fill met' : 'fill', style: `height:${Math.round((d.minutes / max) * 100)}%` }),
    ),
  );
  const table = h(
    'table',
    { class: 'sr-only' },
    h('caption', {}, 'Minuts per dia'),
    h('tbody', {}, days.map((d) => h('tr', {}, h('th', { scope: 'row' }, shortDate(d.date)), h('td', {}, `${d.minutes} min`)))),
  );
  return h(
    'figure',
    { class: 'chart' },
    h('div', { class: 'bars', 'aria-hidden': 'true' }, h('span', { class: 'goal', style: `bottom:${Math.round((goal / max) * 100)}%` }), bars),
    h('figcaption', { class: 'muted' }, `Minuts dels últims 14 dies (línia: objectiu de ${goal} min)`),
    table,
  );
}

function islandBlock(island, pace) {
  const current = island.regions.find((r) => r.id === island.current);
  return h(
    'div',
    { class: island.enabled ? 'island' : 'island off' },
    h('div', { class: 'island-head' }, h('strong', {}, island.name), h('span', { class: 'chip' }, island.enabled ? `ritme: ${pace}` : 'desactivada')),
    h('div', { class: 'meter', role: 'img', 'aria-label': `Tresor ${island.treasure}%` }, h('span', { style: `width:${island.treasure}%` })),
    h('div', { class: 'muted small' }, `Tresor ${island.treasure}%`, current ? ` · ara: ${current.emoji} ${current.title} (dificultat ${current.difficulty})` : ''),
  );
}

function errorsBlock(status) {
  const top = status.topRules.length
    ? h('ol', { class: 'rules' }, status.topRules.map((r) => h('li', {}, h('span', {}, r.label), h('span', { class: 'count' }, `${r.count}`))))
    : h('p', { class: 'muted' }, 'Cap error en els últims 30 dies.');
  const last = h(
    'details',
    {},
    h('summary', {}, `Últims ${status.recentErrors.length} errors`),
    h(
      'ul',
      { class: 'errors' },
      status.recentErrors.map((e) => h('li', {}, h('span', { class: 'muted small' }, `${shortDate(e.date)} · ${e.label}`), h('span', {}, e.prompt))),
    ),
  );
  return h('div', {}, h('h3', {}, 'Errors més freqüents'), top, status.recentErrors.length ? last : null);
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
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Ajusta'), form);
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
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Expedicions'), rows, note);
}
