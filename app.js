// Panell web d'Escola: llegeix `status/<id>.json` del repositori de dades i escriu `control/<id>.json`
// (spec 2026-09-27, §3.5 i §5). Sense dades a la pàgina: tot surt del repositori amb el token del pare.
// Tot el text del repositori s'insereix amb textContent, mai com a HTML.

const DEFAULT_REPO = 'davidherrerosd-ai/escola-dades';
const KEY_TOKEN = 'escola.token';
const KEY_REPO = 'escola.repo';
// `?api=http://127.0.0.1:port` per provar contra scripts/dev-sync-server.mjs
const API = new URLSearchParams(location.search).get('api') || 'https://api.github.com';

const ISLANDS = ['mat', 'ca', 'es'];
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

// ---------------------------------------------------------------- utilitats

function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* navegador sense emmagatzematge: caldrà tornar a enganxar el token */
  }
}

function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `h('p', { class: 'x' }, 'text', fill)`: crea elements sense passar mai per innerHTML. */
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function encodeBase64(text) {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'ara mateix';
  if (min < 60) return `fa ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `fa ${hours} h`;
  return new Date(t).toLocaleString('ca-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function shortDate(date) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------- API Contents de GitHub

class ApiError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

function session() {
  return { token: load(KEY_TOKEN), repo: load(KEY_REPO) || DEFAULT_REPO };
}

async function api(path, init = {}) {
  const { token, repo } = session();
  const res = await fetch(`${API}/repos/${repo}/contents/${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(res.status);
  return res.json();
}

async function readJson(path) {
  const file = await api(path);
  if (!file) return null;
  return { sha: file.sha, json: JSON.parse(decodeBase64(file.content)) };
}

function explain(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'El token no és vàlid o ha caducat.';
    if (err.status === 403) return 'El token no té permís sobre el repositori de dades.';
    if (err.status === 409) return 'Algú altre ha canviat la configuració mentrestant. Torna-ho a provar després d’actualitzar.';
    return `Error del servidor (${err.message}).`;
  }
  if (err instanceof SyntaxError) return 'Hi ha un fitxer malmès al repositori de dades.';
  return 'No s’ha pogut connectar. Comprova la connexió.';
}

// ---------------------------------------------------------------- estat de la pàgina

const $ = (id) => document.getElementById(id);

function message(text, tone = 'info') {
  const el = $('message');
  el.hidden = !text;
  el.textContent = text || '';
  el.dataset.tone = tone;
}

function showLogin(show) {
  $('login').hidden = !show;
  $('reload').hidden = show;
  $('settings').hidden = show;
  $('token').value = load(KEY_TOKEN) || '';
  $('repo').value = session().repo;
}

async function refresh() {
  if (!session().token) {
    showLogin(true);
    return;
  }
  showLogin(false);
  message('Carregant…');
  const root = $('children');
  try {
    const listing = await api('status');
    if (!listing || !Array.isArray(listing)) {
      root.replaceChildren();
      message('Encara no hi ha dades: s’hi afegiran quan els nens facin la primera activitat.');
      return;
    }
    const ids = listing.filter((f) => f.type === 'file' && f.name.endsWith('.json')).map((f) => f.name.slice(0, -5));
    const children = await Promise.all(
      ids.map(async (id) => {
        const [status, control] = await Promise.all([readJson(`status/${id}.json`), readJson(`control/${id}.json`)]);
        return { id, status: status?.json, control: control?.json ?? null, sha: control?.sha ?? null };
      }),
    );
    root.replaceChildren(...children.filter((c) => c.status).map(childCard));
    message('');
  } catch (err) {
    message(explain(err), 'warn');
    if (err instanceof ApiError && err.status === 401) showLogin(true);
  }
}

// ---------------------------------------------------------------- targeta per nen

function stat(label, value, hint) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('strong', { class: 'stat-value' }, value), hint ? h('span', { class: 'stat-hint' }, hint) : null);
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

function childCard({ id, status, control, sha }) {
  const pending = control && (!status.controlApplied || Date.parse(control.updatedAt) > Date.parse(status.controlApplied)) ? control : null;
  const pace = (island) => pending?.pace?.[island] ?? status.pace?.[island] ?? 'normal';
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
    h(
      'div',
      { class: 'stats' },
      stat('Avui', `${status.minutesToday} min`, `objectiu ${status.dailyGoalMinutes} min`),
      stat('Setmana', `${status.minutesWeek} min`, `${status.activeDaysWeek} dies actius`),
      stat('Nivells', `${status.levelsWeek}`, 'aquesta setmana'),
    ),
    daysChart(status.days, status.dailyGoalMinutes),
    h('div', { class: 'islands' }, ISLANDS.map((i) => islandBlock(status.islands[i], pace(i)))),
    errorsBlock(status),
    controlForm(id, status, pending, sha),
  );
}

// ---------------------------------------------------------------- formulari de control

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

/** Valors actuals: el que diu el PC, amb el control pendent a sobre (encara no aplicat). */
function effective(status, pending) {
  const difficulty = {};
  for (const i of ISLANDS) for (const r of status.islands[i].regions) difficulty[r.id] = r.difficulty;
  Object.assign(difficulty, pending?.difficulty ?? {});
  const enabled = Object.fromEntries(ISLANDS.map((i) => [i, pending?.islandsEnabled?.[i] ?? status.islands[i].enabled]));
  return {
    pace: Object.fromEntries(ISLANDS.map((i) => [i, pending?.pace?.[i] ?? status.pace?.[i] ?? 'normal'])),
    planTemplate: pending?.planTemplate ?? status.planTemplate,
    dailyGoalMinutes: pending?.dailyGoalMinutes ?? status.dailyGoalMinutes,
    balancedProgress: pending?.balancedProgress ?? status.balancedProgress,
    islandsEnabled: enabled,
    difficulty,
  };
}

function controlForm(id, status, pending, sha) {
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
      ISLANDS.map((i) => h('label', { class: 'check' }, h('input', { type: 'checkbox', name: `on:${i}`, checked: cur.islandsEnabled[i] }), `${status.islands[i].name} activa`)),
    ),
    h('details', {}, h('summary', {}, 'Dificultat per regió'), h('p', { class: 'muted small' }, 'Canviar-la reinicia el recompte d’encerts recents de la regió.'), regions),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Desa els canvis')),
    note,
  );
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const control = buildControl(new FormData(form), status, pending);
    if (!control) {
      note.textContent = 'No has canviat res.';
      return;
    }
    if (control.error) {
      note.textContent = control.error;
      return;
    }
    const button = form.querySelector('button[type=submit]');
    button.disabled = true;
    note.textContent = 'Desant…';
    try {
      await api(`control/${id}.json`, {
        method: 'PUT',
        body: JSON.stringify({ message: `panell: control de ${id}`, content: encodeBase64(JSON.stringify(control, null, 2) + '\n'), ...(sha ? { sha } : {}) }),
      });
      note.textContent = 'Desat.';
      await refresh();
    } catch (err) {
      note.textContent = explain(err);
      button.disabled = false;
    }
  });
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Ajusta'), form);
}

/**
 * Només hi van els camps que difereixen del que diu el PC; el control pendent (encara no aplicat) es conserva.
 * La dificultat només inclou les regions canviades: aplicar-la reinicia els encerts recents.
 */
function buildControl(data, status, pending) {
  const control = { version: 1, updatedAt: new Date().toISOString() };
  const keep = (key, value, current) => {
    if (JSON.stringify(value) !== JSON.stringify(current) || pending?.[key] !== undefined) control[key] = value;
  };

  const pace = {};
  for (const i of ISLANDS) {
    const v = data.get(`pace:${i}`);
    if (v !== (status.pace?.[i] ?? 'normal') || pending?.pace?.[i] !== undefined) pace[i] = v;
  }
  if (Object.keys(pace).length) control.pace = pace;

  const plan = [0, 1, 2, 3].map((i) => data.get(`slot${i}`)).filter(Boolean);
  keep('planTemplate', plan, status.planTemplate);
  keep('dailyGoalMinutes', Number(data.get('minutes')), status.dailyGoalMinutes);
  keep('balancedProgress', data.get('balanced') === 'on', status.balancedProgress);

  const enabled = {};
  for (const i of ISLANDS) {
    const v = data.get(`on:${i}`) === 'on';
    if (v !== status.islands[i].enabled || pending?.islandsEnabled?.[i] !== undefined) enabled[i] = v;
  }
  if (Object.keys(enabled).length) control.islandsEnabled = enabled;
  if (ISLANDS.every((i) => data.get(`on:${i}`) !== 'on')) return { error: 'Cal deixar almenys una illa activa.' };

  const difficulty = {};
  for (const i of ISLANDS) {
    for (const r of status.islands[i].regions) {
      const v = data.get(`d:${r.id}`);
      if (v === null) continue;
      if (Number(v) !== r.difficulty || pending?.difficulty?.[r.id] !== undefined) difficulty[r.id] = Number(v);
    }
  }
  if (Object.keys(difficulty).length) control.difficulty = difficulty;

  return Object.keys(control).length > 2 ? control : null;
}

// ---------------------------------------------------------------- arrencada

$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  store(KEY_TOKEN, $('token').value.trim());
  store(KEY_REPO, $('repo').value.trim() || DEFAULT_REPO);
  void refresh();
});
$('forget').addEventListener('click', () => {
  store(KEY_TOKEN, null);
  $('children').replaceChildren();
  message('Token oblidat en aquest navegador.');
  showLogin(true);
});
$('reload').addEventListener('click', () => void refresh());
$('settings').addEventListener('click', () => showLogin($('login').hidden));

void refresh();
