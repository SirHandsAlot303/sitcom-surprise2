// public/app.js - Sitcom Surprise
'use strict';
(function () {
  const searchInput = document.getElementById('search-input');
  const searchResults = document.getElementById('search-results');
  const favoritesList = document.getElementById('favorites-list');
  const showCount = document.getElementById('show-count');
  const installBtn = document.getElementById('install-btn');
  const installOutput = document.getElementById('install-output');
  const installOutputMsg = document.getElementById('install-output-msg');
  const installLink = document.getElementById('install-link');
  const installUrl = document.getElementById('install-url');
  const copyBtn = document.getElementById('copy-btn');
  const percentSlider = document.getElementById('percent-slider');
  const percentInput = document.getElementById('percent-input');
  const percentDesc = document.getElementById('percent-desc');
  const percentClearBtn = document.getElementById('percent-clear');
  const labelInput = document.getElementById('label-input');
  const saveListBtn = document.getElementById('save-list-btn');
  const savedListsEl = document.getElementById('saved-lists');

  // The list currently being built (search + add shows to this one).
  const favorites = new Map();
  let lastSearchResults = new Map(); // id -> {id, name, poster}, populated on each search render
  let topPercent = 20;
  let topPercentIsAll = false;

  // Lists already saved via "Save this list & start a new one" — each
  // becomes its own row/catalog in Stremio once installed, all from a
  // single addon install (see step 4 in the UI).
  let savedLists = [];

  // Default examples so configurator doesn't look empty
  const DEFAULT_SHOWS = [
    { id: 'tt0898266', name: 'The Big Bang Theory', poster: 'https://images.metahub.space/poster/medium/tt0898266/img.jpg' },
    { id: 'tt2575988', name: 'Silicon Valley', poster: 'https://images.metahub.space/poster/medium/tt2575988/img.jpg' },
    { id: 'tt0108778', name: 'Friends', poster: 'https://images.metahub.space/poster/medium/tt0108778/img.jpg' },
  ];

  function updatePercentDesc() {
    if (topPercentIsAll || topPercent === 100) {
      percentDesc.textContent = '100% — all episodes, fully random';
      return;
    }
    if (topPercent >= 50) percentDesc.textContent = `Top ${topPercent}% — wide selection by rating`;
    else if (topPercent >= 20) percentDesc.textContent = `Top ${topPercent}% — highest rated episodes`;
    else percentDesc.textContent = `Top ${topPercent}% — only the very best`;
  }

  function setTopPercent(v, isAllFlag = false) {
    if (isAllFlag) {
      topPercentIsAll = true; topPercent = 100;
      percentSlider.value = 100; percentInput.value = ''; percentInput.placeholder = 'all (100)';
      updatePercentDesc(); updateInstallBtn(); return;
    }
    topPercentIsAll = false;
    let num = parseInt(v, 10);
    if (isNaN(num) || v === '' || v == null) { topPercent = 100; percentInput.placeholder = '100'; }
    else topPercent = Math.max(1, Math.min(100, num));
    percentSlider.value = topPercent;
    if (document.activeElement !== percentInput) percentInput.value = topPercent === 100 && v === '' ? '' : topPercent;
    updatePercentDesc(); updateInstallBtn();
  }

  percentSlider.addEventListener('input', (e) => { topPercentIsAll = false; setTopPercent(e.target.value); percentInput.value = e.target.value; });
  percentInput.addEventListener('input', (e) => { const val = e.target.value.trim(); if (val === '') { setTopPercent(100); return; } setTopPercent(val); });
  percentClearBtn.addEventListener('click', () => setTopPercent(null, true));
  updatePercentDesc();

  let searchTimeout;
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (query.length < 2) { searchResults.innerHTML = ''; return; }
    searchTimeout = setTimeout(() => searchShows(query), 350);
  });

  async function searchShows(query) {
    try {
      const res = await fetch(`https://api.tvmaze.com/search/shows?q=${encodeURIComponent(query)}`);
      const data = await res.json();
      renderSearchResults(data);
    } catch { searchResults.innerHTML = '<p class="error">Search failed. Please try again.</p>'; }
  }

  function renderSearchResults(results) {
    lastSearchResults = new Map();
    searchResults.innerHTML = results.filter(r => r.show && r.show.externals && r.show.externals.imdb).slice(0, 12).map(r => {
      const show = r.show; const imdbId = show.externals.imdb; const poster = show.image ? show.image.medium : '';
      const year = show.premiered ? show.premiered.slice(0, 4) : '?'; const isAdded = favorites.has(imdbId);
      const safeName = escapeHtml(show.name); const safePoster = escapeHtml(poster);
      lastSearchResults.set(imdbId, { id: imdbId, name: show.name, poster });
      return `
        <div class="show-card ${isAdded ? 'added' : ''}" data-id="${imdbId}">
          <div class="poster-wrap">${poster ? `<img src="${safePoster}" alt="${safeName}" loading="lazy">` : '<div class="no-poster">No Image</div>'}</div>
          <div class="show-info"><span class="show-title">${safeName}</span><span class="show-year">${year}</span></div>
          <button type="button" class="btn-add" data-id="${imdbId}">${isAdded ? '✓ Added' : '+ Add'}</button>
        </div>`;
    }).join('');
  }

  // Event delegation: no inline onclick="" strings built from show names/posters
  // (an earlier version broke on show names with apostrophes this way). Looking
  // data up by data-id from a Map avoids that whole class of bug.
  searchResults.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-add');
    if (!btn) return;
    const item = lastSearchResults.get(btn.dataset.id);
    if (!item) return;
    toggleFavorite(item);
  });

  favoritesList.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove');
    if (!btn) return;
    const id = btn.dataset.id;
    const item = favorites.get(id);
    if (!item) return;
    toggleFavorite(item);
  });

  function toggleFavorite(item) {
    if (favorites.has(item.id)) favorites.delete(item.id);
    else favorites.set(item.id, { id: item.id, name: item.name, poster: item.poster });
    renderFavorites();
    const q = searchInput.value.trim(); if (q.length >= 2) searchShows(q);
    updateInstallBtn();
  }

  function renderFavorites() {
    if (favorites.size === 0) {
      favoritesList.innerHTML = '<p class="empty-state">No shows yet. Search above to add your favorites!</p>';
      showCount.textContent = '0'; return;
    }
    showCount.textContent = favorites.size;
    favoritesList.innerHTML = Array.from(favorites.values()).map(show => `
      <div class="show-card favorite" data-id="${show.id}">
        <div class="poster-wrap">${show.poster ? `<img src="${escapeHtml(show.poster)}" alt="${escapeHtml(show.name)}" loading="lazy">` : '<div class="no-poster">No Image</div>'}</div>
        <div class="show-info"><span class="show-title">${escapeHtml(show.name)}</span></div>
        <button type="button" class="btn-remove" data-id="${show.id}">✕ Remove</button>
      </div>`).join('');
  }

  // --- Saved lists (multi-list build) ---

  function currentListSnapshot() {
    const label = labelInput.value.trim();
    const shows = Array.from(favorites.values()).map(s => ({ id: s.id, name: s.name }));
    const pct = topPercentIsAll ? 100 : topPercent;
    return { label, shows, topPercent: pct };
  }

  saveListBtn.addEventListener('click', () => {
    if (favorites.size === 0) return;
    const snapshot = currentListSnapshot();
    savedLists.push(snapshot);
    renderSavedLists();

    // Reset the builder for a new list
    favorites.clear();
    labelInput.value = '';
    setTopPercent(20);
    renderFavorites();
    updateInstallBtn();
    searchInput.focus();
  });

  savedListsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-remove');
    if (!btn) return;
    const idx = parseInt(btn.dataset.index, 10);
    if (Number.isNaN(idx)) return;
    savedLists.splice(idx, 1);
    renderSavedLists();
    updateInstallBtn();
  });

  function renderSavedLists() {
    if (savedLists.length === 0) {
      savedListsEl.innerHTML = '';
      return;
    }
    savedListsEl.innerHTML = savedLists.map((list, i) => `
      <div class="saved-list-chip">
        <span class="chip-info">${escapeHtml(list.label || `List ${i + 1}`)}<span class="chip-meta">${list.shows.length} show${list.shows.length === 1 ? '' : 's'} · ${list.topPercent === 100 ? 'all episodes' : `top ${list.topPercent}%`}</span></span>
        <button type="button" class="btn-remove" data-index="${i}">✕ Remove</button>
      </div>`).join('');
  }

  function updateInstallBtn() {
    const hasShows = favorites.size > 0 || savedLists.length > 0;
    installBtn.disabled = !hasShows;
    if (hasShows) installOutput.classList.add('hidden');
  }

  installBtn.addEventListener('click', () => {
    const lists = savedLists.slice();
    if (favorites.size > 0) lists.push(currentListSnapshot());
    if (lists.length === 0) return;

    const config = lists.length === 1
      ? { shows: lists[0].shows, topPercent: lists[0].topPercent, ...(lists[0].label ? { label: lists[0].label } : {}) }
      : { lists };

    const encoded = btoa(JSON.stringify(config)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const base = window.location.origin;
    const manifestUrl = `${base}/${encoded}/manifest.json`;
    const stremioUrl = `stremio://${base.replace(/^https?:\/\//, '')}/${encoded}/manifest.json`;
    installLink.href = stremioUrl; installUrl.value = manifestUrl;
    installOutputMsg.textContent = lists.length > 1
      ? `Addon ready! ${lists.length} lists, one row each, single install.`
      : 'Addon ready! Single row, single tile per show, single click surprise.';
    installOutput.classList.remove('hidden');
  });

  copyBtn.addEventListener('click', () => {
    installUrl.select(); navigator.clipboard.writeText(installUrl.value);
    copyBtn.textContent = '✓ Copied'; setTimeout(() => copyBtn.textContent = 'Copy', 2000);
  });

  function escapeHtml(str) { if (!str) return ''; return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;'); }

  // Load default examples if empty
  (function loadDefaults() {
    if (favorites.size === 0) {
      for (const s of DEFAULT_SHOWS) favorites.set(s.id, s);
      renderFavorites(); updateInstallBtn();
    }
  })();
})();
