// Capa d'accés a l'API Contents de GitHub (o al servidor fals de scripts/dev-sync-server.mjs).

import { decodeBase64, encodeBase64, load, pretty, store } from './util.js';

export const DEFAULT_REPO = 'davidherrerosd-ai/escola-dades';
export const KEY_TOKEN = 'escola.token';
export const KEY_REPO = 'escola.repo';
// `?api=http://127.0.0.1:port` per provar contra scripts/dev-sync-server.mjs
export const API = new URLSearchParams(location.search).get('api') || 'https://api.github.com';

export class ApiError extends Error {
  constructor(status) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

export function session() {
  return { token: load(KEY_TOKEN), repo: load(KEY_REPO) || DEFAULT_REPO };
}

export function setSession(token, repo) {
  store(KEY_TOKEN, token);
  store(KEY_REPO, repo || DEFAULT_REPO);
}

export function forgetToken() {
  store(KEY_TOKEN, null);
}

export async function api(path, init = {}) {
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

export async function readJson(path) {
  const file = await api(path);
  if (!file) return null;
  return { sha: file.sha, json: JSON.parse(decodeBase64(file.content)) };
}

export function explain(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'El token no és vàlid o ha caducat.';
    if (err.status === 403) return 'El token no té permís sobre el repositori de dades.';
    if (err.status === 409 || err.status === 422) return 'Algú altre ha canviat la configuració mentrestant. Torna-ho a provar.';
    return `Error del servidor (${err.message}).`;
  }
  if (err instanceof SyntaxError) return 'Hi ha un fitxer malmès al repositori de dades.';
  return 'No s’ha pogut connectar. Comprova la connexió.';
}

function isConflict(err) {
  return err instanceof ApiError && (err.status === 409 || err.status === 422);
}

/**
 * Desa `path` amb el contingut que torni `build(full)`, on `full` és l'últim contingut conegut (o `null` si
 * el fitxer encara no existeix). Si el `sha` ja no és vàlid perquè algú altre ha desat abans, rellegeix el
 * fitxer i ho torna a provar una sola vegada amb el contingut fresc (spec 2026-09-27 §3: «ante un 409/422
 * relee y reintenta una vez fusionando»).
 */
export async function putControl(path, full, sha, build, message) {
  const attempt = async (curFull, curSha) => {
    const control = build(curFull);
    const res = await api(path, {
      method: 'PUT',
      body: JSON.stringify({ message, content: encodeBase64(pretty(control)), ...(curSha ? { sha: curSha } : {}) }),
    });
    return { control, sha: res.content.sha };
  };
  try {
    return await attempt(full, sha);
  } catch (err) {
    if (!isConflict(err)) throw err;
    const fresh = await readJson(path);
    return attempt(fresh?.json ?? null, fresh?.sha ?? null);
  }
}
