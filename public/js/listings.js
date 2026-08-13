/**
 * Saved items: search, filter, sort — with the state mirrored into the URL.
 *
 * Filtering is client-side over the cards the server already rendered, so the
 * page still works with JS disabled (unfiltered). The query string is the
 * source of truth for the view, which makes a filtered page refreshable,
 * shareable, and back-button correct.
 *
 * Note the selector: cards render as `.card`. An earlier version of this file
 * queried `.item-card`, matched nothing, and silently disabled the entire
 * toolbar — hence the selector assertion in the test harness.
 */
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.querySelector('.item-list');
  const cards = Array.from(document.querySelectorAll('.card'));
  if (!grid || cards.length === 0) return;

  const searchInput = document.getElementById('searchInput');
  const searchClear = document.getElementById('searchClear');
  const sortSelect = document.getElementById('sortSelect');
  const filtersToggle = document.getElementById('filtersToggle');
  const filtersPanel = document.getElementById('filtersPanel');
  const filtersCount = document.getElementById('filtersCount');
  const filtersClear = document.getElementById('filtersClear');
  const conditionBoxes = Array.from(document.querySelectorAll('[data-filter-condition]'));
  const platformBoxes = Array.from(document.querySelectorAll('[data-filter-platform]'));
  const activeFilters = document.getElementById('activeFilters');
  const pillHost = document.getElementById('activeFilterPills');
  const clearAll = document.getElementById('clearAllFilters');
  const clearFromEmpty = document.getElementById('clearFiltersEmpty');
  const noResults = document.getElementById('noResults');
  const resultCount = document.getElementById('resultCount');

  const state = { q: '', conditions: [], platforms: [], sort: 'newest' };

  // ---- URL <-> state ------------------------------------------------------

  function readUrl() {
    const p = new URLSearchParams(location.search);
    state.q = p.get('q') || '';
    state.conditions = (p.get('condition') || '').split(',').filter(Boolean);
    state.platforms = (p.get('platform') || '').split(',').filter(Boolean);
    const sort = p.get('sort');
    state.sort = sort && [...sortSelect.options].some(o => o.value === sort) ? sort : 'newest';
  }

  function writeUrl(push) {
    const p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.conditions.length) p.set('condition', state.conditions.join(','));
    if (state.platforms.length) p.set('platform', state.platforms.join(','));
    if (state.sort !== 'newest') p.set('sort', state.sort);

    const qs = p.toString();
    const url = location.pathname + (qs ? '?' + qs : '');
    // replaceState while typing keeps the history stack from filling with
    // every keystroke; discrete controls push so Back is meaningful.
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
  }

  // ---- controls -> state --------------------------------------------------

  function syncControls() {
    searchInput.value = state.q;
    searchClear.hidden = !state.q;
    sortSelect.value = state.sort;

    conditionBoxes.forEach(b => { b.checked = state.conditions.includes(b.value); });
    platformBoxes.forEach(b => { b.checked = state.platforms.includes(b.value); });

    const n = state.conditions.length + state.platforms.length;
    filtersCount.textContent = String(n);
    filtersCount.hidden = n === 0;

    renderPills();
  }

  function renderPills() {
    const pills = [];
    if (state.q) pills.push({ kind: 'q', value: state.q, label: 'Search: ' + state.q });
    state.conditions.forEach(c => pills.push({ kind: 'condition', value: c, label: 'Condition: ' + c }));
    state.platforms.forEach(p => pills.push({ kind: 'platform', value: p, label: 'Marketplace: ' + p }));

    pillHost.textContent = '';
    pills.forEach(({ kind, value, label }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'filter-pill';
      btn.dataset.kind = kind;
      btn.dataset.value = value;
      btn.textContent = label;                 // textContent — labels carry scraped text
      const x = document.createElement('span');
      x.className = 'filter-pill__x';
      x.setAttribute('aria-hidden', 'true');
      x.textContent = '×';
      btn.append(x);
      btn.setAttribute('aria-label', 'Remove filter: ' + label);
      pillHost.append(btn);
    });

    activeFilters.hidden = pills.length === 0;
  }

  // ---- state -> DOM -------------------------------------------------------

  function apply() {
    const q = state.q.toLowerCase().trim();

    cards.forEach(card => {
      const d = card.dataset;
      const matchesSearch = !q ||
        (d.title || '').includes(q) ||
        (d.description || '').includes(q);

      const matchesCondition = !state.conditions.length || state.conditions.includes(d.condition || '');
      const matchesPlatform = !state.platforms.length || state.platforms.includes(d.platform || '');

      card.classList.toggle('is-hidden', !(matchesSearch && matchesCondition && matchesPlatform));
    });

    const visible = cards.filter(c => !c.classList.contains('is-hidden'));
    noResults.classList.toggle('is-hidden', visible.length > 0);
    grid.classList.toggle('is-hidden', visible.length === 0);
    resultCount.textContent = visible.length === cards.length
      ? visible.length + ' items'
      : visible.length + ' of ' + cards.length + ' items match';
  }

  function sort() {
    const by = state.sort;
    const num = (el, k) => parseFloat(el.dataset[k]) || 0;
    const order = ['new', 'like new', 'good', 'fair', 'poor'];

    const sorted = cards.slice().sort((a, b) => {
      switch (by) {
        case 'price-high': return num(b, 'price') - num(a, 'price');
        case 'price-low':  return num(a, 'price') - num(b, 'price');
        case 'title':      return (a.dataset.title || '').localeCompare(b.dataset.title || '');
        case 'condition': {
          const ai = order.indexOf(a.dataset.condition);
          const bi = order.indexOf(b.dataset.condition);
          return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
        }
        case 'oldest':     return num(a, 'addedAt') - num(b, 'addedAt');
        case 'newest':
        default:           return num(b, 'addedAt') - num(a, 'addedAt');
      }
    });
    sorted.forEach(c => grid.appendChild(c));
  }

  function update(push) {
    syncControls();
    sort();
    apply();
    writeUrl(push);
  }

  // ---- events -------------------------------------------------------------

  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.q = searchInput.value;
      update(false);
    }, 250);
  });

  searchClear.addEventListener('click', () => {
    state.q = '';
    update(true);
    searchInput.focus();
  });

  sortSelect.addEventListener('change', () => { state.sort = sortSelect.value; update(true); });

  function readBoxes() {
    state.conditions = conditionBoxes.filter(b => b.checked).map(b => b.value);
    state.platforms = platformBoxes.filter(b => b.checked).map(b => b.value);
    update(true);
  }
  conditionBoxes.concat(platformBoxes).forEach(b => b.addEventListener('change', readBoxes));

  filtersToggle.addEventListener('click', () => {
    const open = filtersPanel.hasAttribute('hidden');
    filtersPanel.toggleAttribute('hidden', !open);
    filtersToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  document.addEventListener('click', (e) => {
    if (filtersPanel.hasAttribute('hidden')) return;
    if (e.target.closest('#filtersPanel') || e.target.closest('#filtersToggle')) return;
    filtersPanel.setAttribute('hidden', '');
    filtersToggle.setAttribute('aria-expanded', 'false');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !filtersPanel.hasAttribute('hidden')) {
      filtersPanel.setAttribute('hidden', '');
      filtersToggle.setAttribute('aria-expanded', 'false');
      filtersToggle.focus();
    }
  });

  function reset() {
    state.q = '';
    state.conditions = [];
    state.platforms = [];
    update(true);
  }
  [filtersClear, clearAll, clearFromEmpty].forEach(el => el && el.addEventListener('click', reset));

  pillHost.addEventListener('click', (e) => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    const { kind, value } = pill.dataset;
    if (kind === 'q') state.q = '';
    else if (kind === 'condition') state.conditions = state.conditions.filter(c => c !== value);
    else if (kind === 'platform') state.platforms = state.platforms.filter(p => p !== value);
    update(true);
  });

  // Back/forward must restore the view the URL describes.
  window.addEventListener('popstate', () => { readUrl(); syncControls(); sort(); apply(); });

  readUrl();
  update(false);
});
