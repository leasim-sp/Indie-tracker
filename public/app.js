/* ── State ─────────────────────────────────────────────────────────────────── */
const state = {
  authenticated: false,
  selectedArtists: [],   // { id, name, image }
  releases: [],          // all fetched releases (merged from all artists)
  visibleReleases: [],   // after active-tab filter
  activeTab: 'all',
  selectedTracks: new Map(), // uri → { name, albumName, artistName }
  expandedAlbums: new Set(),
  albumTracks: new Map(),    // albumId → tracks[]
  playlists: [],
  loading: false
};

/* ── DOM refs ──────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

/* ── Helpers ───────────────────────────────────────────────────────────────── */
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) {
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${months[parseInt(parts[1]) - 1]} ${parts[0]}`;
  }
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getTypeLabel(albumType, name) {
  const lower = name.toLowerCase();
  if (lower.includes(' ep') || lower.endsWith(' ep') || lower.match(/\bep\b/)) return 'EP';
  const map = { album: 'Álbum', single: 'Single', compilation: 'Compilación', ep: 'EP' };
  return map[albumType] || albumType;
}

function getTypeClass(albumType, name) {
  const lower = name.toLowerCase();
  if (lower.includes(' ep') || lower.endsWith(' ep') || lower.match(/\bep\b/)) return 'ep';
  return albumType;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

/* ── API calls ─────────────────────────────────────────────────────────────── */
const api = {
  async request(url, options = {}) {
    const resp = await fetch(url, options);
    if (resp.status === 401) {
      window.location.href = '/login';
      return null;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || err.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  },

  getAuthStatus: () => api.request('/api/auth/status'),
  getMe: () => api.request('/api/me'),
  searchArtists: q => api.request(`/api/search?q=${encodeURIComponent(q)}`),

  getArtistReleases(artistId, from, to) {
    const params = new URLSearchParams({ include_groups: 'album,single,compilation' });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return api.request(`/api/artists/${artistId}/releases?${params}`);
  },

  getAlbumTracks: id => api.request(`/api/albums/${id}/tracks`),
  getPlaylists: () => api.request('/api/playlists'),

  createPlaylist: name => api.request('/api/playlists', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, public: false })
  }),

  addTracksToPlaylist: (playlistId, uris) => api.request(`/api/playlists/${playlistId}/tracks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uris })
  })
};

/* ── Toast notifications ───────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const container = $('toasts');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="toast-dot"></span>${message}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 220);
  }, 3500);
}

/* ── Auth & user ───────────────────────────────────────────────────────────── */
async function initAuth() {
  const status = await api.getAuthStatus();
  state.authenticated = status?.authenticated ?? false;

  const loginBtn = $('login-btn');
  const loginScreen = $('login-screen');
  const appDiv = $('app');
  const userInfo = $('user-info');

  if (!state.authenticated) {
    loginBtn.classList.remove('hidden');
    loginScreen.classList.remove('hidden');
    return;
  }

  appDiv.classList.remove('hidden');

  try {
    const me = await api.getMe();
    const avatar = me.images?.[0]?.url;
    if (avatar) {
      $('user-avatar').src = avatar;
    } else {
      $('user-avatar').style.display = 'none';
    }
    $('user-name').textContent = me.display_name || me.id;
    userInfo.classList.remove('hidden');
  } catch { /* non-critical */ }

  initDefaultDates();
  bindEvents();
}

/* ── Default dates (last 12 months) ───────────────────────────────────────── */
function initDefaultDates() {
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  $('date-to').value = today.toISOString().split('T')[0];
  $('date-from').value = oneYearAgo.toISOString().split('T')[0];
}

/* ── Artist search ─────────────────────────────────────────────────────────── */
function bindArtistSearch() {
  const input = $('artist-input');
  const suggestions = $('search-suggestions');

  const doSearch = debounce(async (q) => {
    if (q.length < 2) { suggestions.classList.add('hidden'); return; }
    try {
      const data = await api.searchArtists(q);
      renderSuggestions(data?.artists?.items || []);
    } catch { suggestions.classList.add('hidden'); }
  }, 280);

  input.addEventListener('input', e => doSearch(e.target.value.trim()));

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { suggestions.classList.add('hidden'); input.blur(); }
  });

  document.addEventListener('click', e => {
    if (!$('artist-search-wrapper').contains(e.target)) {
      suggestions.classList.add('hidden');
    }
  });
}

function renderSuggestions(artists) {
  const container = $('search-suggestions');
  if (!artists.length) { container.classList.add('hidden'); return; }

  container.innerHTML = artists.map(a => {
    const img = a.images?.[0]?.url;
    const followers = a.followers?.total
      ? `${(a.followers.total / 1000).toFixed(0)}k seguidores`
      : 'Artista';
    const alreadySelected = state.selectedArtists.some(s => s.id === a.id);
    return `
      <div class="suggestion-item ${alreadySelected ? 'already' : ''}"
           data-id="${a.id}"
           data-name="${a.name.replace(/"/g, '&quot;')}"
           data-img="${img || ''}">
        ${img
          ? `<img class="suggestion-avatar" src="${img}" alt="${a.name}">`
          : `<div class="suggestion-avatar-placeholder">♪</div>`}
        <div class="suggestion-info">
          <div class="suggestion-name">${a.name}</div>
          <div class="suggestion-followers">${alreadySelected ? '✓ Ya añadido' : followers}</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.suggestion-item:not(.already)').forEach(el => {
    el.addEventListener('click', () => {
      addArtist({ id: el.dataset.id, name: el.dataset.name, image: el.dataset.img });
      $('artist-input').value = '';
      container.classList.add('hidden');
    });
  });

  container.classList.remove('hidden');
}

function addArtist(artist) {
  if (state.selectedArtists.find(a => a.id === artist.id)) return;
  state.selectedArtists.push(artist);
  renderSelectedArtists();
  updateSearchButton();
}

function removeArtist(id) {
  state.selectedArtists = state.selectedArtists.filter(a => a.id !== id);
  // Remove releases from that artist
  state.releases = state.releases.filter(r => r._artistId !== id);
  renderSelectedArtists();
  applyTabFilter();
  updateSearchButton();
}

function renderSelectedArtists() {
  const container = $('selected-artists');
  container.innerHTML = state.selectedArtists.map(a => `
    <div class="chip">
      ${a.image ? `<img src="${a.image}" alt="${a.name}">` : ''}
      ${a.name}
      <span class="chip-remove" data-id="${a.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="12" height="12">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </span>
    </div>`).join('');

  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => removeArtist(btn.dataset.id));
  });
}

function updateSearchButton() {
  $('search-btn').disabled = state.selectedArtists.length === 0;
}

/* ── Fetch releases ────────────────────────────────────────────────────────── */
async function fetchReleases() {
  if (!state.selectedArtists.length) return;

  state.releases = [];
  state.selectedTracks.clear();
  state.expandedAlbums.clear();
  state.albumTracks.clear();

  setLoading(true);
  updateSelectionBar();

  const from = $('date-from').value;
  const to = $('date-to').value;

  try {
    const results = await Promise.allSettled(
      state.selectedArtists.map(a => api.getArtistReleases(a.id, from, to))
    );

    results.forEach((result, i) => {
      if (result.status === 'fulfilled' && result.value?.releases) {
        const artist = state.selectedArtists[i];
        result.value.releases.forEach(r => {
          r._artistId = artist.id;
          r._artistName = artist.name;
        });
        state.releases = state.releases.concat(result.value.releases);
      } else if (result.status === 'rejected') {
        showToast(`Error cargando ${state.selectedArtists[i].name}: ${result.reason.message}`, 'error');
      }
    });

    // Sort all releases by date descending
    state.releases.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

    applyTabFilter();
  } catch (err) {
    showToast('Error buscando lanzamientos: ' + err.message, 'error');
  } finally {
    setLoading(false);
  }
}

function setLoading(active) {
  state.loading = active;
  $('loading-state').classList.toggle('hidden', !active);
  $('releases-grid').classList.toggle('hidden', active);
  if (active) $('empty-state').classList.add('hidden');
}

/* ── Tab filter ────────────────────────────────────────────────────────────── */
function applyTabFilter() {
  const tab = state.activeTab;
  if (tab === 'all') {
    state.visibleReleases = state.releases;
  } else if (tab === 'ep') {
    state.visibleReleases = state.releases.filter(r => {
      const lower = r.name.toLowerCase();
      return r.album_type === 'ep' ||
        lower.includes(' ep') || lower.endsWith(' ep') || lower.match(/\bep\b/);
    });
  } else if (tab === 'single') {
    state.visibleReleases = state.releases.filter(r => {
      if (r.album_type !== 'single') return false;
      const lower = r.name.toLowerCase();
      return !(lower.includes(' ep') || lower.endsWith(' ep') || lower.match(/\bep\b/));
    });
  } else {
    state.visibleReleases = state.releases.filter(r => r.album_type === tab);
  }

  renderReleases();
}

/* ── Render releases ───────────────────────────────────────────────────────── */
function renderReleases() {
  const grid = $('releases-grid');
  const empty = $('empty-state');
  const count = $('results-count');

  const total = state.visibleReleases.length;
  count.textContent = total ? `${total} lanzamientos` : '';

  if (!state.releases.length && !state.loading) {
    empty.classList.remove('hidden');
    grid.innerHTML = '';
    return;
  }
  empty.classList.add('hidden');

  if (!total) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-3);padding:60px 0">
      No hay lanzamientos de este tipo en el periodo seleccionado.</div>`;
    return;
  }

  grid.innerHTML = state.visibleReleases.map(release => renderReleaseCard(release)).join('');

  // Bind expand buttons
  grid.querySelectorAll('.btn-expand').forEach(btn => {
    btn.addEventListener('click', () => toggleAlbumTracks(btn.dataset.albumId));
  });

  // Bind select-all buttons
  grid.querySelectorAll('.btn-select-all').forEach(btn => {
    btn.addEventListener('click', () => selectAllInAlbum(btn.dataset.albumId));
  });

  // Re-expand previously expanded albums
  state.expandedAlbums.forEach(id => {
    const card = grid.querySelector(`[data-card-id="${id}"]`);
    if (card) renderTrackList(id, card);
  });
}

function renderReleaseCard(release) {
  const typeClass = getTypeClass(release.album_type, release.name);
  const typeLabel = getTypeLabel(release.album_type, release.name);
  const cover = release.images?.[0]?.url;
  const hasSelection = [...state.selectedTracks.values()].some(t => t.albumId === release.id);
  const isExpanded = state.expandedAlbums.has(release.id);
  const tracks = release.total_tracks;

  return `
    <div class="release-card ${hasSelection ? 'has-selection' : ''}" data-card-id="${release.id}">
      <div class="release-cover-wrapper">
        ${cover
          ? `<img class="release-cover" src="${cover}" alt="${release.name}" loading="lazy">`
          : `<div class="release-cover-placeholder">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="40" height="40">
                 <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
               </svg>
             </div>`}
        <span class="release-type-badge ${typeClass}">${typeLabel}</span>
      </div>
      <div class="release-info">
        <div class="release-title" title="${release.name}">${release.name}</div>
        <div class="release-artist">${release._artistName}</div>
        <div class="release-meta">
          <span class="release-date">${formatDate(release.release_date)}</span>
          <span class="release-tracks">${tracks} ${tracks === 1 ? 'canción' : 'canciones'}</span>
        </div>
      </div>
      <div class="release-actions">
        <button class="btn-expand" data-album-id="${release.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
            ${isExpanded
              ? '<polyline points="18 15 12 9 6 15"/>'
              : '<polyline points="6 9 12 15 18 9"/>'}
          </svg>
          ${isExpanded ? 'Ocultar' : 'Ver canciones'}
        </button>
        <button class="btn-select-all" data-album-id="${release.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="11" height="11">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Todo
        </button>
      </div>
      ${isExpanded ? renderTrackListHTML(release.id) : ''}
    </div>`;
}

function renderTrackListHTML(albumId) {
  const tracks = state.albumTracks.get(albumId);
  if (!tracks) return `<div class="track-list"><div class="track-loading"><div class="spinner"></div> Cargando…</div></div>`;

  const items = tracks.map((t, i) => {
    const isSelected = state.selectedTracks.has(t.uri);
    return `
      <div class="track-item ${isSelected ? 'selected' : ''}" data-uri="${t.uri}">
        <span class="track-num">${i + 1}</span>
        <span class="track-name" title="${t.name}">${t.name}</span>
        <span class="track-duration">${formatDuration(t.duration_ms)}</span>
        <input type="checkbox" class="track-checkbox" data-uri="${t.uri}"
               data-name="${t.name.replace(/"/g, '&quot;')}"
               data-album-id="${albumId}"
               ${isSelected ? 'checked' : ''}>
      </div>`;
  }).join('');

  return `<div class="track-list">${items}</div>`;
}

/* ── Expand/load album tracks ──────────────────────────────────────────────── */
async function toggleAlbumTracks(albumId) {
  const card = $('releases-grid').querySelector(`[data-card-id="${albumId}"]`);
  if (!card) return;

  if (state.expandedAlbums.has(albumId)) {
    state.expandedAlbums.delete(albumId);
    const trackList = card.querySelector('.track-list');
    if (trackList) trackList.remove();
    const btn = card.querySelector('.btn-expand');
    if (btn) btn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
        <polyline points="6 9 12 15 18 9"/>
      </svg> Ver canciones`;
    return;
  }

  state.expandedAlbums.add(albumId);
  const btn = card.querySelector('.btn-expand');
  if (btn) btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12">
      <polyline points="18 15 12 9 6 15"/>
    </svg> Ocultar`;

  renderTrackList(albumId, card);
}

async function renderTrackList(albumId, card) {
  // Show loading placeholder
  let existingList = card.querySelector('.track-list');
  if (!existingList) {
    const placeholder = document.createElement('div');
    placeholder.className = 'track-list';
    placeholder.innerHTML = '<div class="track-loading"><div class="spinner"></div> Cargando…</div>';
    card.appendChild(placeholder);
    existingList = placeholder;
  }

  if (!state.albumTracks.has(albumId)) {
    try {
      const data = await api.getAlbumTracks(albumId);
      state.albumTracks.set(albumId, data?.tracks || []);
    } catch (err) {
      existingList.innerHTML = `<div class="track-loading" style="color:var(--danger)">Error: ${err.message}</div>`;
      return;
    }
  }

  // Find the release info for this album
  const release = state.releases.find(r => r.id === albumId);
  existingList.outerHTML = renderTrackListHTML(albumId);

  // Re-bind checkboxes in this card
  card.querySelectorAll('.track-checkbox').forEach(cb => bindCheckbox(cb, release));
  card.querySelectorAll('.track-item').forEach(item => {
    item.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT') return;
      const cb = item.querySelector('.track-checkbox');
      if (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event('change')); }
    });
  });
}

function bindCheckbox(cb, release) {
  cb.addEventListener('change', () => {
    const uri = cb.dataset.uri;
    const item = cb.closest('.track-item');
    if (cb.checked) {
      state.selectedTracks.set(uri, {
        uri,
        name: cb.dataset.name,
        albumId: cb.dataset.albumId,
        albumName: release?.name || '',
        artistName: release?._artistName || ''
      });
      item?.classList.add('selected');
    } else {
      state.selectedTracks.delete(uri);
      item?.classList.remove('selected');
    }
    updateSelectionBar();
    // Update card border
    const card = cb.closest('.release-card');
    const hasAny = [...state.selectedTracks.values()].some(t => t.albumId === cb.dataset.albumId);
    card?.classList.toggle('has-selection', hasAny);
  });
}

/* ── Select all tracks in an album ────────────────────────────────────────── */
async function selectAllInAlbum(albumId) {
  // Load tracks if not yet loaded
  if (!state.albumTracks.has(albumId)) {
    if (!state.expandedAlbums.has(albumId)) {
      await toggleAlbumTracks(albumId);
    }
    // Wait a tick for async load
    await new Promise(r => setTimeout(r, 600));
  }

  const tracks = state.albumTracks.get(albumId);
  if (!tracks) { showToast('Cargando canciones, inténtalo de nuevo', 'error'); return; }

  const release = state.releases.find(r => r.id === albumId);
  const allSelected = tracks.every(t => state.selectedTracks.has(t.uri));

  if (allSelected) {
    // Deselect all
    tracks.forEach(t => state.selectedTracks.delete(t.uri));
  } else {
    // Select all
    tracks.forEach(t => {
      state.selectedTracks.set(t.uri, {
        uri: t.uri,
        name: t.name,
        albumId,
        albumName: release?.name || '',
        artistName: release?._artistName || ''
      });
    });
  }

  updateSelectionBar();
  // Refresh card UI
  const card = $('releases-grid').querySelector(`[data-card-id="${albumId}"]`);
  if (card) {
    const hasAny = [...state.selectedTracks.values()].some(t => t.albumId === albumId);
    card.classList.toggle('has-selection', hasAny);
    const trackList = card.querySelector('.track-list');
    if (trackList) {
      trackList.querySelectorAll('.track-item').forEach(item => {
        const uri = item.dataset.uri;
        item.classList.toggle('selected', state.selectedTracks.has(uri));
        const cb = item.querySelector('.track-checkbox');
        if (cb) cb.checked = state.selectedTracks.has(uri);
      });
    }
  }
}

/* ── Selection bar ─────────────────────────────────────────────────────────── */
function updateSelectionBar() {
  const count = state.selectedTracks.size;
  const bar = $('selection-bar');
  $('selection-count').textContent = `${count} ${count === 1 ? 'canción seleccionada' : 'canciones seleccionadas'}`;
  bar.classList.toggle('hidden', count === 0);
}

/* ── Playlist modal ────────────────────────────────────────────────────────── */
async function openPlaylistModal() {
  $('playlist-modal').classList.remove('hidden');
  $('new-playlist-name').value = '';
  await loadPlaylists();
}

function closePlaylistModal() {
  $('playlist-modal').classList.add('hidden');
}

async function loadPlaylists() {
  const container = $('playlists-list');
  container.innerHTML = '<div class="loading-placeholder">Cargando listas…</div>';
  try {
    const data = await api.getPlaylists();
    state.playlists = data?.playlists || [];
    renderPlaylists();
  } catch (err) {
    container.innerHTML = `<div class="loading-placeholder" style="color:var(--danger)">Error: ${err.message}</div>`;
  }
}

function renderPlaylists() {
  const container = $('playlists-list');
  if (!state.playlists.length) {
    container.innerHTML = '<div class="loading-placeholder">No tienes listas de reproducción.</div>';
    return;
  }
  container.innerHTML = state.playlists.map(p => {
    const cover = p.images?.[0]?.url;
    return `
      <div class="playlist-item" data-id="${p.id}">
        ${cover
          ? `<img class="playlist-cover" src="${cover}" alt="${p.name}">`
          : `<div class="playlist-cover-placeholder">
               <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="20" height="20">
                 <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
               </svg>
             </div>`}
        <div class="playlist-info">
          <div class="playlist-name">${p.name}</div>
          <div class="playlist-tracks-count">${p.tracks?.total ?? 0} canciones</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', () => addTracksToPlaylist(item.dataset.id, item.querySelector('.playlist-name').textContent));
  });
}

async function addTracksToPlaylist(playlistId, playlistName) {
  const uris = [...state.selectedTracks.keys()];
  if (!uris.length) return;

  closePlaylistModal();
  try {
    await api.addTracksToPlaylist(playlistId, uris);
    showToast(`✓ ${uris.length} ${uris.length === 1 ? 'canción añadida' : 'canciones añadidas'} a "${playlistName}"`, 'success');
    state.selectedTracks.clear();
    updateSelectionBar();
    // Clear visual selections
    document.querySelectorAll('.track-item.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.track-checkbox:checked').forEach(cb => cb.checked = false);
    document.querySelectorAll('.release-card.has-selection').forEach(c => c.classList.remove('has-selection'));
  } catch (err) {
    showToast('Error añadiendo canciones: ' + err.message, 'error');
  }
}

async function createAndAddToPlaylist() {
  const name = $('new-playlist-name').value.trim();
  if (!name) { showToast('Escribe un nombre para la lista', 'error'); return; }

  const btn = $('create-playlist-btn');
  btn.disabled = true;
  btn.textContent = 'Creando…';

  try {
    const playlist = await api.createPlaylist(name);
    await addTracksToPlaylist(playlist.id, name);
    state.playlists.unshift(playlist);
  } catch (err) {
    showToast('Error creando lista: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Crear y añadir';
  }
}

/* ── Event bindings ────────────────────────────────────────────────────────── */
function bindEvents() {
  bindArtistSearch();

  // Search button
  $('search-btn').addEventListener('click', fetchReleases);

  // Date inputs trigger re-search if there are already results
  $('date-from').addEventListener('change', () => { if (state.releases.length) fetchReleases(); });
  $('date-to').addEventListener('change', () => { if (state.releases.length) fetchReleases(); });

  // Tab filter
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.activeTab = tab.dataset.type;
      applyTabFilter();
    });
  });

  // Selection bar
  $('clear-selection').addEventListener('click', () => {
    state.selectedTracks.clear();
    updateSelectionBar();
    document.querySelectorAll('.track-item.selected').forEach(el => el.classList.remove('selected'));
    document.querySelectorAll('.track-checkbox:checked').forEach(cb => cb.checked = false);
    document.querySelectorAll('.release-card.has-selection').forEach(c => c.classList.remove('has-selection'));
  });

  $('add-to-playlist-btn').addEventListener('click', openPlaylistModal);

  // Modal
  $('modal-close').addEventListener('click', closePlaylistModal);
  $('playlist-modal').addEventListener('click', e => {
    if (e.target === $('playlist-modal')) closePlaylistModal();
  });
  $('create-playlist-btn').addEventListener('click', createAndAddToPlaylist);
  $('new-playlist-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') createAndAddToPlaylist();
  });
}

/* ── Init ──────────────────────────────────────────────────────────────────── */
initAuth();
