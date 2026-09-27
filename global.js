// Configuració global compartida pels dos fills (`control/_global.json`, spec 2026-09-27 §3 i §1.2):
// premis reals, objectiu familiar i so. Es desa sempre com una còpia sencera (cada camp substitueix
// el que hi hagués); cada PC l'aplica si `updatedAt` és més nou que l'últim aplicat.

import { explain, putControl } from './api.js';
import { confirmButton, h } from './util.js';

const SUGGESTIONS = [
  { title: 'Triar el sopar', cost: 300, icon: '🍝' },
  { title: 'Pel·lícula en família', cost: 500, icon: '🍿' },
  { title: '30 minuts extra de pantalla', cost: 250, icon: '📺' },
];

function newRewardId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `reward-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** El que es mostra com a «actual»: el control pendent si existeix, si no l'últim que ha aplicat algun PC. */
function effectiveGlobal(globalControl, children) {
  const withSettings = children.map((c) => c.status?.settings).find((s) => s);
  return {
    realRewards: globalControl?.realRewards ?? withSettings?.realRewards ?? [],
    family: globalControl?.family ?? withSettings?.family ?? { daysPerWeek: 0, rewardText: '' },
    sound: globalControl?.sound ?? withSettings?.sound ?? true,
  };
}

function keepOthers(full) {
  const base = {};
  if (full?.realRewards !== undefined) base.realRewards = full.realRewards;
  if (full?.family !== undefined) base.family = full.family;
  if (full?.sound !== undefined) base.sound = full.sound;
  return base;
}

async function saveGlobal(state, patchKey, value, note, refresh) {
  note.textContent = 'Desant…';
  try {
    await putControl(
      'control/_global.json',
      state.globalControl,
      state.globalSha,
      (full) => ({ version: 1, updatedAt: new Date().toISOString(), ...keepOthers(full), [patchKey]: value }),
      `panell: ${patchKey} global`,
    );
    note.textContent = 'Desat.';
    await refresh();
  } catch (err) {
    note.textContent = explain(err);
  }
}

function pendingBanner(state, children) {
  const gc = state.globalControl;
  if (!gc) return null;
  const notApplied = children.filter((c) => {
    if (c.status?.settings === undefined) return false; // build antic: no ho podem saber
    const appliedAt = c.status.settings.updatedFromGlobal;
    if (!appliedAt) return true;
    const a = Date.parse(appliedAt);
    return Number.isNaN(a) || Date.parse(gc.updatedAt) > a;
  });
  if (notApplied.length === 0) return null;
  return h('p', { class: 'pending' }, `Canvis pendents d’aplicar quan obrin l’app: ${notApplied.map((c) => c.status.name).join(', ')}.`);
}

function rewardRow(state, cur, reward, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const titleInput = h('input', { class: 'cell-input', value: reward.title, maxlength: '60', 'aria-label': `Títol de ${reward.title}` });
  const costInput = h('input', { class: 'cell-input tabular', type: 'number', min: '1', max: '5000', value: String(reward.cost), 'aria-label': `Cost de ${reward.title}` });
  const iconInput = h('input', { class: 'cell-input icon', value: reward.icon, maxlength: '4', 'aria-label': `Icona de ${reward.title}` });
  const activeInput = h('input', { type: 'checkbox', checked: reward.active });
  const commit = (changes) => void saveGlobal(state, 'realRewards', cur.realRewards.map((r) => (r.id === reward.id ? { ...r, ...changes } : r)), note, refresh);
  titleInput.addEventListener('change', () => {
    const v = titleInput.value.trim();
    if (v) commit({ title: v });
    else titleInput.value = reward.title;
  });
  costInput.addEventListener('change', () => {
    const n = Math.round(Number(costInput.value));
    if (Number.isFinite(n) && n > 0) commit({ cost: n });
    else costInput.value = String(reward.cost);
  });
  iconInput.addEventListener('change', () => commit({ icon: iconInput.value.trim() || '🎁' }));
  activeInput.addEventListener('change', () => commit({ active: activeInput.checked }));
  const del = confirmButton({
    label: 'Elimina',
    confirmLabel: 'Sí, elimina',
    onConfirm: () => void saveGlobal(state, 'realRewards', cur.realRewards.filter((r) => r.id !== reward.id), note, refresh),
  });
  return h(
    'li',
    { class: 'reward-row' },
    h('div', { class: 'reward-row-line' }, iconInput, titleInput),
    h('div', { class: 'reward-row-line' }, costInput, h('label', { class: 'check' }, activeInput, 'Actiu'), del),
    note,
  );
}

function rewardsSection(state, cur, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const rows = cur.realRewards.length
    ? h('ul', { class: 'reward-list' }, cur.realRewards.map((r) => rewardRow(state, cur, r, refresh)))
    : h('p', { class: 'muted small' }, 'Encara no hi ha cap premi real.');
  const titleInput = h('input', { type: 'text', maxlength: '60', placeholder: 'Per exemple: triar el sopar' });
  const costInput = h('input', { type: 'number', min: '1', max: '5000', value: '200' });
  const iconInput = h('input', { type: 'text', maxlength: '4', value: '🎁' });
  const addForm = h(
    'form',
    { class: 'control' },
    h('label', {}, 'Títol', titleInput),
    h('label', {}, 'Cost en monedes', costInput),
    h('label', {}, 'Icona (un emoji)', iconInput),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Afegeix')),
    note,
  );
  addForm.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const title = titleInput.value.trim();
    const cost = Math.round(Number(costInput.value));
    if (!title || !(cost > 0)) {
      note.textContent = 'Cal un títol i un cost més gran que zero.';
      return;
    }
    const item = { id: newRewardId(), title, cost, icon: iconInput.value.trim() || '🎁', active: true };
    void saveGlobal(state, 'realRewards', [...cur.realRewards, item], note, refresh).then(() => {
      titleInput.value = '';
      costInput.value = '200';
      iconInput.value = '🎁';
    });
  });
  const suggestions = h(
    'div',
    { class: 'row' },
    SUGGESTIONS.map((s) =>
      h(
        'button',
        { type: 'button', class: 'ghost', onclick: () => void saveGlobal(state, 'realRewards', [...cur.realRewards, { id: newRewardId(), ...s, active: true }], note, refresh) },
        `${s.icon} ${s.title} · ${s.cost}`,
      ),
    ),
  );
  return h(
    'details',
    { class: 'control-wrap' },
    h('summary', {}, 'Premis reals'),
    rows,
    h('h3', { class: 'subhead' }, 'Premi nou'),
    addForm,
    h('p', { class: 'muted small' }, 'Propostes (clica per afegir-la):'),
    suggestions,
  );
}

function familySection(state, cur, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const daysInput = h('input', { type: 'number', min: '0', max: '14', value: String(cur.family.daysPerWeek) });
  const rewardInput = h('input', { type: 'text', maxlength: '120', value: cur.family.rewardText ?? '', placeholder: 'Per exemple: dissabte de pizza i joc de taula' });
  const form = h(
    'form',
    { class: 'control' },
    h('label', {}, 'Dies per setmana (0-14)', daysInput),
    h('p', { class: 'muted small' }, '0 desactiva l’objectiu familiar.'),
    h('label', {}, 'Premi de la setmana', rewardInput),
    h('div', { class: 'row' }, h('button', { type: 'submit' }, 'Desa')),
    note,
  );
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const daysPerWeek = Math.round(Number(daysInput.value));
    if (!(daysPerWeek >= 0 && daysPerWeek <= 14)) {
      note.textContent = 'Entre 0 i 14 dies.';
      return;
    }
    const rewardText = rewardInput.value.trim().slice(0, 120);
    void saveGlobal(state, 'family', { daysPerWeek, rewardText }, note, refresh);
  });
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'Objectiu familiar'), form);
}

function soundSection(state, cur, refresh) {
  const note = h('p', { class: 'muted small', role: 'status' });
  const input = h('input', { type: 'checkbox', checked: cur.sound });
  input.addEventListener('change', () => void saveGlobal(state, 'sound', input.checked, note, refresh));
  return h('details', { class: 'control-wrap' }, h('summary', {}, 'So'), h('label', { class: 'check' }, input, 'Efectes de so i veu (afecta els dos perfils)'), note);
}

export function globalCard(state, refresh) {
  const { children, globalControl } = state;
  const cur = effectiveGlobal(globalControl, children);
  return h(
    'article',
    { class: 'card' },
    h('h2', {}, 'Configuració general'),
    h('p', { class: 'muted small' }, 'Val per als dos fills.'),
    pendingBanner(state, children),
    rewardsSection(state, cur, refresh),
    familySection(state, cur, refresh),
    soundSection(state, cur, refresh),
  );
}
