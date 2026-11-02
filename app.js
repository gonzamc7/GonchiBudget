// GonchiBudget — all data lives in this browser's localStorage.

const STORAGE_KEY = 'gonchibudget.v1';
const MAX_CATEGORIES = 10;
const PERIOD_LABEL = { weekly: 'week', monthly: 'month', yearly: 'year' };

// ---------- State ----------

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalize(JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data', e);
  }
  return { currency: '$', categories: [], entries: [] };
}

function normalize(data) {
  // Only expense categories are used (older versions also had income ones)
  const categories = (Array.isArray(data.categories) ? data.categories : []).filter(c => c.type !== 'income');
  const ids = new Set(categories.map(c => c.id));
  return {
    currency: typeof data.currency === 'string' ? data.currency : '$',
    categories,
    entries: (Array.isArray(data.entries) ? data.entries : []).filter(e => ids.has(e.categoryId)),
  };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save. Your browser may be blocking local storage.');
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Accepts "12.50" or "12,50"
function parseAmount(s) {
  const n = parseFloat(String(s).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

// ---------- Dates & periods ----------

function toISO(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function fromISO(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Current period [start, end] (inclusive dates). Weeks run Monday–Sunday.
function periodBounds(period, today = new Date()) {
  const y = today.getFullYear(), m = today.getMonth(), d = today.getDate();
  if (period === 'weekly') {
    const offset = (today.getDay() + 6) % 7; // Monday = 0
    return [new Date(y, m, d - offset), new Date(y, m, d - offset + 6)];
  }
  if (period === 'yearly') return [new Date(y, 0, 1), new Date(y, 11, 31)];
  return [new Date(y, m, 1), new Date(y, m + 1, 0)];
}

function daysLeftInPeriod(period) {
  const [, end] = periodBounds(period);
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end - start) / 86400000) + 1; // includes today
}

function totalInCurrentPeriod(cat) {
  const [start, end] = periodBounds(cat.period).map(toISO);
  return state.entries
    .filter(e => e.categoryId === cat.id && e.date >= start && e.date <= end)
    .reduce((sum, e) => sum + e.amount, 0);
}

// ---------- Formatting ----------

function money(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${state.currency}${abs}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const $ = id => document.getElementById(id);

// ---------- Rendering ----------

function render() {
  renderCategories();
  renderEntries();
}

function renderCategories() {
  const cats = state.categories;
  $('expense-count').textContent = `${cats.length}/${MAX_CATEGORIES}`;
  $('add-expense-cat').disabled = cats.length >= MAX_CATEGORIES;

  const list = $('expense-list');
  if (!cats.length) {
    list.innerHTML = `<div class="placeholder">No categories yet.<br>Tap “+ Category” to add one.</div>`;
    return;
  }
  list.innerHTML = cats.map(expenseCard).join('');
}


function expenseCard(c) {
  const spent = totalInCurrentPeriod(c);
  const left = c.amount - spent;
  const usedPct = c.amount > 0 ? (spent / c.amount) * 100 : (spent > 0 ? 100 : 0);
  const pct = Math.max(0, 100 - usedPct); // bar = money left
  const level = left < 0 ? 'bad' : usedPct >= 80 ? 'warn' : 'good';
  const days = daysLeftInPeriod(c.period);

  return `
    <div class="cat" role="button" tabindex="0" data-log="${c.id}">
      <div class="cat-top">
        <span class="cat-name">${esc(c.name)}</span>
        <button class="cat-edit" data-edit="${c.id}" aria-label="Edit ${esc(c.name)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button>
        <span class="cat-left ${level}">${money(left)} <small>${left < 0 ? 'over' : 'left'}</small></span>
      </div>
      <div class="bar ${level}"><div style="width:${pct}%"></div></div>
      <div class="meta"><span>of ${money(c.amount)} / ${PERIOD_LABEL[c.period]}</span><span>${days} day${days === 1 ? '' : 's'} left</span></div>
    </div>`;
}

function renderEntries() {
  const byId = Object.fromEntries(state.categories.map(c => [c.id, c]));
  const rows = [...state.entries]
    .sort((a, b) => (b.date + b.created).localeCompare(a.date + a.created))
    .slice(0, 200);

  $('entry-empty').hidden = rows.length > 0;
  $('entry-list').hidden = rows.length === 0;

  let html = '';
  let lastDate = null;
  for (const e of rows) {
    if (e.date !== lastDate) {
      lastDate = e.date;
      const label = fromISO(e.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      html += `<div class="day-label">${label}</div>`;
    }
    const cat = byId[e.categoryId];
    html += `
      <div class="entry">
        <div class="entry-main">
          <div class="entry-cat">${cat ? esc(cat.name) : '<em>Deleted</em>'}</div>
          ${e.note ? `<div class="entry-note">${esc(e.note)}</div>` : ''}
        </div>
        <span class="entry-amt">−${money(e.amount)}</span>
        <button class="entry-del" data-del="${e.id}" aria-label="Delete expense"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg></button>
      </div>`;
  }
  $('entry-list').innerHTML = html;
}

// ---------- Views (tab bar) ----------

function showView(view) {
  $('view-budget').hidden = view !== 'budget';
  $('view-history').hidden = view !== 'history';
  $('view-title').textContent = view === 'budget' ? 'Budget' : 'History';
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  window.scrollTo(0, 0);
}

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

// ---------- Sheets (dialogs) ----------

function openSheet(dialog) {
  dialog.showModal();
}

// Close on Cancel/Done buttons and when tapping the dimmed backdrop
document.querySelectorAll('dialog.sheet').forEach(d => {
  d.addEventListener('click', e => {
    if (e.target === d || e.target.closest('[data-close]')) d.close();
  });
});

// ---------- Add entry sheet ----------

let entryCategoryId = null;

let lastCategoryId = null; // pre-selects the category used last time

function renderCategorySelect() {
  const cats = state.categories;
  if (!cats.some(c => c.id === entryCategoryId)) {
    entryCategoryId = cats.some(c => c.id === lastCategoryId) ? lastCategoryId : cats[0]?.id ?? null;
  }
  $('entry-cat').innerHTML = cats
    .map(c => `<option value="${c.id}" ${c.id === entryCategoryId ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');
  $('entry-cat').disabled = !cats.length;
  $('entry-hint').textContent = cats.length ? '' : 'Create a category first.';
}

function openEntrySheet(categoryId) {
  const cat = state.categories.find(c => c.id === categoryId);
  entryCategoryId = cat ? cat.id : null;
  $('entry-currency').textContent = state.currency;
  $('entry-amount').value = '';
  $('entry-note').value = '';
  $('entry-date').value = toISO(new Date());
  renderCategorySelect();
  openSheet($('entry-sheet'));
  $('entry-amount').focus();
}

$('add-btn').addEventListener('click', () => openEntrySheet(null));

$('entry-cat').addEventListener('change', e => { entryCategoryId = e.target.value; });

$('entry-form').addEventListener('submit', e => {
  e.preventDefault();
  const amount = parseAmount($('entry-amount').value);
  const date = $('entry-date').value;
  if (!(amount > 0)) {
    $('entry-hint').textContent = 'Enter an amount';
    $('entry-amount').focus();
    return;
  }
  if (!entryCategoryId) {
    $('entry-hint').textContent = 'Create a category first.';
    return;
  }
  lastCategoryId = entryCategoryId;
  state.entries.push({
    id: uid(),
    categoryId: entryCategoryId,
    amount,
    date: date || toISO(new Date()),
    note: $('entry-note').value.trim(),
    created: new Date().toISOString(),
  });
  save();
  $('entry-sheet').close();
  render();
});

// ---------- Category sheet ----------

let editing = null; // { id }

function openCategorySheet(cat) {
  editing = { id: cat ? cat.id : null };
  $('cat-title').textContent = cat ? 'Edit category' : 'New category';
  $('cat-name').value = cat ? cat.name : '';
  $('cat-amount').value = cat ? cat.amount : '';
  const period = cat ? cat.period : 'monthly';
  document.querySelector(`input[name="cat-period"][value="${period}"]`).checked = true;
  $('cat-delete').hidden = !cat;
  openSheet($('cat-sheet'));
  if (!cat) $('cat-name').focus();
}

$('cat-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('cat-name').value.trim();
  const amount = parseAmount($('cat-amount').value);
  const period = document.querySelector('input[name="cat-period"]:checked').value;
  if (!name) return $('cat-name').focus();
  if (!(amount >= 0)) return $('cat-amount').focus();

  if (editing.id) {
    Object.assign(state.categories.find(c => c.id === editing.id), { name, amount, period });
  } else {
    if (state.categories.length >= MAX_CATEGORIES) return;
    state.categories.push({ id: uid(), type: 'expense', name, amount, period });
  }
  save();
  $('cat-sheet').close();
  render();
});

$('cat-delete').addEventListener('click', () => {
  const cat = state.categories.find(c => c.id === editing.id);
  const count = state.entries.filter(e => e.categoryId === cat.id).length;
  const msg = count
    ? `Delete “${cat.name}” and its ${count} entr${count === 1 ? 'y' : 'ies'}?`
    : `Delete “${cat.name}”?`;
  if (!confirm(msg)) return;
  state.categories = state.categories.filter(c => c.id !== cat.id);
  state.entries = state.entries.filter(e => e.categoryId !== cat.id);
  save();
  $('cat-sheet').close();
  render();
});

$('add-expense-cat').addEventListener('click', () => openCategorySheet());

// Card taps: "Edit" edits, anywhere else logs an entry in that category
document.querySelector('main').addEventListener('click', e => {
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    const cat = state.categories.find(c => c.id === edit.dataset.edit);
    if (cat) openCategorySheet(cat);
    return;
  }
  const card = e.target.closest('[data-log]');
  if (card) return openEntrySheet(card.dataset.log);

  const del = e.target.closest('[data-del]');
  if (del && confirm('Delete this expense?')) {
    state.entries = state.entries.filter(x => x.id !== del.dataset.del);
    save();
    render();
  }
});

// ---------- Settings ----------

$('settings-btn').addEventListener('click', () => {
  $('currency').value = state.currency;
  openSheet($('settings-sheet'));
});

$('currency').addEventListener('input', e => {
  state.currency = e.target.value;
  save();
  render();
});

$('export-btn').addEventListener('click', async () => {
  const json = JSON.stringify(state, null, 2);
  const name = `gonchibudget-backup-${toISO(new Date())}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // On iPhone, the share sheet lets you save to Files, AirDrop, email, etc.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'GonchiBudget backup' }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = normalize(JSON.parse(await file.text()));
    if (!confirm(`Replace current data with ${data.categories.length} categories and ${data.entries.length} entries from the backup?`)) return;
    state = data;
    save();
    render();
    $('settings-sheet').close();
  } catch {
    alert('That file is not a valid GonchiBudget backup.');
  }
});

// Refresh when coming back to the app (e.g. a new day or week started)
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

render();

// Offline support (skipped on this Mac's local preview so edits show up immediately)
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Offline mode unavailable', err));
}
