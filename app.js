// Panell web d'Escola: llegeix `status/<id>.json` del repositori de dades i escriu `control/<id>.json` i
// `control/_global.json` (spec 2026-09-27, §3 i §5). Sense dades a la pàgina: tot surt del repositori amb
// el token del pare. Tot el text del repositori s'insereix amb textContent, mai com a HTML (vegeu `h` a
// util.js). Codi repartit en mòduls petits (util/api/view/child/global), sense build ni dependències.
// Pestanyes per nen i rutes al hash (`#marti`, `#marti/ajusta`, `#general`): spec 2026-11-17-panell-mobil.

import { ApiError, DEFAULT_REPO, api, explain, forgetToken, readJson, session, setSession } from './api.js';
import { h, load, store } from './util.js';
import { parseRoute, routeHash } from './view.js';
import { childSection, childSummary } from './child.js';
import { globalCard } from './global.js';

const $ = (id) => document.getElementById(id);
const TAB_KEY = 'escola.tab';

/** Dades de l'última càrrega: canviar de pestanya o de secció no torna a llegir el repositori. */
let data = null;

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
  $('token').value = load('escola.token') || '';
  $('repo').value = session().repo;
}

/** La ruta actual; sense hash, l'última pestanya vista (si encara existeix) o el primer nen. */
function currentRoute(ids) {
  if (!location.hash) {
    const saved = load(TAB_KEY);
    if (saved && (saved === 'general' || ids.includes(saved))) return { tab: saved, section: null };
  }
  return parseRoute(location.hash, ids);
}

function tabs(children, active) {
  const items = [...children.map((c) => [c.id, c.status.name]), ['general', '⚙︎ General']];
  return items.map(([id, label]) => h('a', { class: 'tab', href: routeHash(id), 'aria-current': id === active ? 'page' : null }, label));
}

/** `resetScroll` només en canviar de ruta: després de desar, la vista es repinta al mateix lloc. */
function render({ resetScroll = false } = {}) {
  if (!data) return;
  const { children, globalControl, globalSha } = data;
  const ids = children.map((c) => c.id);
  const route = currentRoute(ids);
  store(TAB_KEY, route.tab);
  $('tabs').hidden = false;
  $('tabs').replaceChildren(...tabs(children, route.tab));
  const view = $('view');
  if (route.tab === 'general') {
    view.replaceChildren(globalCard({ children, globalControl, globalSha }, refresh));
  } else {
    const child = children.find((c) => c.id === route.tab);
    const page = route.section ? childSection(child, route.section, refresh) : null;
    view.replaceChildren(page ?? childSummary(child));
  }
  if (resetScroll) window.scrollTo(0, 0);
}

async function refresh() {
  if (!session().token) {
    showLogin(true);
    return;
  }
  showLogin(false);
  message('Carregant…');
  try {
    const [listing, globalFile] = await Promise.all([api('status'), readJson('control/_global.json')]);
    const globalControl = globalFile?.json ?? null;
    const globalSha = globalFile?.sha ?? null;
    if (!listing || !Array.isArray(listing)) {
      data = { children: [], globalControl, globalSha };
      render();
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
    data = { children: children.filter((c) => c.status), globalControl, globalSha };
    render();
    message('');
  } catch (err) {
    message(explain(err), 'warn');
    if (err instanceof ApiError && err.status === 401) showLogin(true);
  }
}

$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  setSession($('token').value.trim(), $('repo').value.trim() || DEFAULT_REPO);
  void refresh();
});
$('forget').addEventListener('click', () => {
  forgetToken();
  data = null;
  $('tabs').hidden = true;
  $('tabs').replaceChildren();
  $('view').replaceChildren();
  message('Token oblidat en aquest navegador.');
  showLogin(true);
});
$('reload').addEventListener('click', () => void refresh());
$('settings').addEventListener('click', () => showLogin($('login').hidden));
window.addEventListener('hashchange', () => render({ resetScroll: true }));

void refresh();
