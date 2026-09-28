// Utilitats compartides pel panell web: sense dependències, sense innerHTML amb dades.

export function store(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* navegador sense emmagatzematge: caldrà tornar a enganxar el token */
  }
}

export function load(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** `h('p', { class: 'x' }, 'text', fill)`: crea elements sense passar mai per innerHTML. */
export function h(tag, attrs = {}, ...children) {
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

export function decodeBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeBase64(text) {
  let bin = '';
  for (const byte of new TextEncoder().encode(text)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

/** JSON amb el mateix format que escriuen les apps: dues espais i salt de línia final. */
export function pretty(obj) {
  return JSON.stringify(obj, null, 2) + '\n';
}

export function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'ara mateix';
  if (min < 60) return `fa ${min} min`;
  const hours = Math.round(min / 60);
  if (hours < 24) return `fa ${hours} h`;
  return new Date(t).toLocaleString('ca-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function shortDate(date) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('ca-ES', { weekday: 'short', day: 'numeric' });
}

/** `2026-09-28` → `28 de set.`, com al panell local (`shortDate` de `parents-ui.tsx`). */
export function dateWithMonth(date) {
  const d = new Date(`${date}T12:00:00`);
  return d.toLocaleDateString('ca-ES', { day: 'numeric', month: 'short' });
}

/** Id d'acció vàlid pel contracte del control remot: `/^[a-z0-9-]{4,64}$/`. */
export function actionId(prefix) {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${rand}`;
}

/**
 * Botó amb confirmació en dos passos sense diàleg natiu: en clicar mostra «Confirma / Cancel·la» al seu lloc.
 * Evita `confirm()` (bloquejant i lleig al mòbil) mantenint el mateix patró que ja fa servir la resta del
 * panell (per exemple, cancel·lar una petició de premi).
 */
export function confirmButton({ label, confirmLabel = 'Confirma', cancelLabel = 'Cancel·la', onConfirm }) {
  const wrap = h('span', { class: 'confirm' });
  const showIdle = () => {
    wrap.replaceChildren(h('button', { type: 'button', class: 'ghost', onclick: showAsk }, label));
  };
  const showAsk = () => {
    wrap.replaceChildren(
      h('button', { type: 'button', onclick: () => void onConfirm() }, confirmLabel),
      h('button', { type: 'button', class: 'ghost', onclick: showIdle }, cancelLabel),
    );
  };
  showIdle();
  return wrap;
}
