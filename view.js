// Lògica pura de la vista del panell (spec 2026-11-17-panell-mobil): rutes del hash i encerts.
// Sense DOM, perquè es pugui provar amb Vitest.

/** Seccions de cada nen, en l'ordre dels botons del resum. */
export const SECTIONS = ['ajusta', 'errors', 'premis', 'monedes', 'missatge', 'expedicions', 'entrenament', 'vela'];

/** `#marti/ajusta` → `{ tab: 'marti', section: 'ajusta' }`. Res de conegut → el primer nen (o `general`). */
export function parseRoute(hash, childIds) {
  const [tab = '', section = ''] = String(hash || '').replace(/^#/, '').split('/');
  const fallback = childIds[0] ?? 'general';
  if (tab === 'general') return { tab: 'general', section: null };
  if (!childIds.includes(tab)) return { tab: fallback, section: null };
  return { tab, section: SECTIONS.includes(section) ? section : null };
}

export function routeHash(tab, section = null) {
  return section ? `#${tab}/${section}` : `#${tab}`;
}

/** Percentatge d'encerts arrodonit i to: verd ≥ 70, groc 50-69, vermell < 50, gris sense exercicis. */
export function accuracy(correct, total) {
  if (!total) return { pct: null, tone: 'none' };
  const pct = Math.round((correct / total) * 100);
  return { pct, tone: pct >= 70 ? 'good' : pct >= 50 ? 'mid' : 'bad' };
}
