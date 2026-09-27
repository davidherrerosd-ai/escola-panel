// Panell web d'Escola: llegeix `status/<id>.json` del repositori de dades i escriu `control/<id>.json` i
// `control/_global.json` (spec 2026-09-27, §3 i §5). Sense dades a la pàgina: tot surt del repositori amb
// el token del pare. Tot el text del repositori s'insereix amb textContent, mai com a HTML (vegeu `h` a
// util.js). Codi repartit en mòduls petits (util/api/child/global) perquè cap fitxer creixi sense mida;
// segueix sense build ni dependències, amb ES modules natius.

import { ApiError, DEFAULT_REPO, api, explain, forgetToken, readJson, session, setSession } from './api.js';
import { load } from './util.js';
import { childCard } from './child.js';
import { globalCard } from './global.js';

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
  $('token').value = load('escola.token') || '';
  $('repo').value = session().repo;
}

async function refresh() {
  if (!session().token) {
    showLogin(true);
    return;
  }
  showLogin(false);
  message('Carregant…');
  const childrenRoot = $('children');
  const globalRoot = $('global');
  try {
    const [listing, globalFile] = await Promise.all([api('status'), readJson('control/_global.json')]);
    const globalControl = globalFile?.json ?? null;
    const globalSha = globalFile?.sha ?? null;
    if (!listing || !Array.isArray(listing)) {
      childrenRoot.replaceChildren();
      globalRoot.replaceChildren(globalCard({ children: [], globalControl, globalSha }, refresh));
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
    const withStatus = children.filter((c) => c.status);
    childrenRoot.replaceChildren(...withStatus.map((c) => childCard(c, refresh)));
    globalRoot.replaceChildren(globalCard({ children: withStatus, globalControl, globalSha }, refresh));
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
  $('children').replaceChildren();
  $('global').replaceChildren();
  message('Token oblidat en aquest navegador.');
  showLogin(true);
});
$('reload').addEventListener('click', () => void refresh());
$('settings').addEventListener('click', () => showLogin($('login').hidden));

void refresh();
