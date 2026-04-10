require('dotenv').config();
const express = require('express');
const axios = require('axios');
const session = require('express-session');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
// REDIRECT_URI is resolved at startup once LAN IP is known (see bottom of file)
let REDIRECT_URI = process.env.REDIRECT_URI || `https://localhost:${process.env.PORT || 3000}/callback`;
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'indie-tracker-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: true, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// ── Auth helpers ──────────────────────────────────────────────────────────────

function basicAuthHeader() {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

async function refreshTokenIfNeeded(req) {
  if (!req.session.accessToken) return false;
  if (Date.now() < req.session.expiresAt - 60_000) return true;

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: req.session.refreshToken
    });
    const resp = await axios.post('https://accounts.spotify.com/api/token', params, {
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    req.session.accessToken = resp.data.access_token;
    req.session.expiresAt = Date.now() + resp.data.expires_in * 1000;
    if (resp.data.refresh_token) req.session.refreshToken = resp.data.refresh_token;
    return true;
  } catch {
    req.session.destroy(() => {});
    return false;
  }
}

async function ensureAuth(req, res, next) {
  const ok = await refreshTokenIfNeeded(req);
  if (!ok) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function spotifyHeaders(req) {
  return { Authorization: 'Bearer ' + req.session.accessToken };
}

// ── Spotify OAuth ─────────────────────────────────────────────────────────────

app.get('/login', (req, res) => {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: [
      'user-read-private',
      'user-read-email',
      'playlist-read-private',
      'playlist-read-collaborative',
      'playlist-modify-public',
      'playlist-modify-private'
    ].join(' '),
    redirect_uri: REDIRECT_URI,
    state: Math.random().toString(36).slice(2)
  });
  res.redirect('https://accounts.spotify.com/authorize?' + params);
});

app.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));

  try {
    const params = new URLSearchParams({
      code,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code'
    });
    const resp = await axios.post('https://accounts.spotify.com/api/token', params, {
      headers: {
        Authorization: basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    req.session.accessToken = resp.data.access_token;
    req.session.refreshToken = resp.data.refresh_token;
    req.session.expiresAt = Date.now() + resp.data.expires_in * 1000;
    res.redirect('/');
  } catch (err) {
    console.error('OAuth error:', err.response?.data || err.message);
    res.redirect('/?error=auth_failed');
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ── API Routes ────────────────────────────────────────────────────────────────

app.get('/api/auth/status', async (req, res) => {
  const ok = await refreshTokenIfNeeded(req);
  res.json({ authenticated: ok });
});

app.get('/api/me', ensureAuth, async (req, res) => {
  try {
    const resp = await axios.get('https://api.spotify.com/v1/me', {
      headers: spotifyHeaders(req)
    });
    res.json(resp.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

app.get('/api/search', ensureAuth, async (req, res) => {
  const { q } = req.query;
  if (!q) return res.json({ artists: { items: [] } });

  try {
    const resp = await axios.get('https://api.spotify.com/v1/search', {
      params: { q, type: 'artist', limit: 8 },
      headers: spotifyHeaders(req)
    });
    res.json(resp.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

// Fetch all releases for an artist with optional date filter
app.get('/api/artists/:id/releases', ensureAuth, async (req, res) => {
  const { id } = req.params;
  const { from, to, include_groups = 'album,single,compilation' } = req.query;

  try {
    let releases = [];
    let nextUrl = `https://api.spotify.com/v1/artists/${id}/albums`;
    let firstParams = { include_groups, limit: 50, market: 'from_token' };
    let page = 0;
    const MAX_PAGES = 10;

    while (nextUrl && page < MAX_PAGES) {
      const resp = await axios.get(nextUrl, {
        params: page === 0 ? firstParams : undefined,
        headers: spotifyHeaders(req)
      });
      releases = releases.concat(resp.data.items);
      nextUrl = resp.data.next;
      page++;
    }

    // Deduplicate by name + release_date (avoid region duplicates)
    const seen = new Set();
    releases = releases.filter(r => {
      const key = `${r.name.toLowerCase()}|${r.release_date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Date filter
    if (from || to) {
      const fromTs = from ? new Date(from).getTime() : 0;
      const toTs = to ? new Date(to).getTime() : Infinity;
      releases = releases.filter(r => {
        const d = new Date(r.release_date).getTime();
        return d >= fromTs && d <= toTs;
      });
    }

    // Sort newest first
    releases.sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

    res.json({ releases });
  } catch (err) {
    console.error('Releases error:', err.response?.data || err.message);
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

// Get tracks for an album
app.get('/api/albums/:id/tracks', ensureAuth, async (req, res) => {
  try {
    let tracks = [];
    let nextUrl = `https://api.spotify.com/v1/albums/${req.params.id}/tracks`;
    const firstParams = { limit: 50, market: 'from_token' };
    let page = 0;

    while (nextUrl && page < 5) {
      const resp = await axios.get(nextUrl, {
        params: page === 0 ? firstParams : undefined,
        headers: spotifyHeaders(req)
      });
      tracks = tracks.concat(resp.data.items);
      nextUrl = resp.data.next;
      page++;
    }
    res.json({ tracks });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

// Get current user's playlists
app.get('/api/playlists', ensureAuth, async (req, res) => {
  try {
    let playlists = [];
    let nextUrl = 'https://api.spotify.com/v1/me/playlists';
    const firstParams = { limit: 50 };
    let page = 0;

    while (nextUrl && page < 4) {
      const resp = await axios.get(nextUrl, {
        params: page === 0 ? firstParams : undefined,
        headers: spotifyHeaders(req)
      });
      playlists = playlists.concat(resp.data.items);
      nextUrl = resp.data.next;
      page++;
    }
    res.json({ playlists });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

// Create a new playlist
app.post('/api/playlists', ensureAuth, async (req, res) => {
  const { name, description = '', public: isPublic = false } = req.body;
  try {
    const me = await axios.get('https://api.spotify.com/v1/me', { headers: spotifyHeaders(req) });
    const resp = await axios.post(
      `https://api.spotify.com/v1/users/${me.data.id}/playlists`,
      { name, description, public: isPublic },
      { headers: spotifyHeaders(req) }
    );
    res.json(resp.data);
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

// Add tracks to a playlist (handles >100 tracks in batches)
app.post('/api/playlists/:id/tracks', ensureAuth, async (req, res) => {
  const { uris } = req.body;
  if (!uris || !uris.length) return res.status(400).json({ error: 'No URIs provided' });

  try {
    const results = [];
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      const resp = await axios.post(
        `https://api.spotify.com/v1/playlists/${req.params.id}/tracks`,
        { uris: batch },
        { headers: spotifyHeaders(req) }
      );
      results.push(resp.data);
    }
    res.json({ snapshot_id: results[results.length - 1]?.snapshot_id });
  } catch (err) {
    res.status(err.response?.status || 500).json(err.response?.data || { error: 'API error' });
  }
});

// ── Network & Certificate ─────────────────────────────────────────────────────

const fs = require('fs');
const os = require('os');
const CERT_DIR = path.join(__dirname, '.certs');
const KEY_FILE  = path.join(CERT_DIR, 'server.key');
const CERT_FILE = path.join(CERT_DIR, 'server.crt');
const IP_FILE   = path.join(CERT_DIR, 'ip.txt');

function getLanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

function getOrCreateCert(lanIP) {
  const savedIP   = fs.existsSync(IP_FILE)   ? fs.readFileSync(IP_FILE, 'utf8').trim() : null;
  const certsExist = fs.existsSync(KEY_FILE) && fs.existsSync(CERT_FILE);

  if (certsExist && savedIP === (lanIP || '')) {
    return { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) };
  }

  // First run or LAN IP changed → regenerate
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const altNames = lanIP
    ? `DNS:localhost,IP:127.0.0.1,IP:${lanIP}`
    : `DNS:localhost,IP:127.0.0.1`;

  execSync(
    `openssl req -x509 -newkey rsa:2048 -keyout "${KEY_FILE}" -out "${CERT_FILE}" ` +
    `-days 825 -nodes -subj "/CN=localhost" ` +
    `-addext "subjectAltName=${altNames}"`,
    { stdio: 'ignore' }
  );
  fs.chmodSync(KEY_FILE, 0o600);
  fs.writeFileSync(IP_FILE, lanIP || '');
  console.log(`\n   Certificado generado (IPs: localhost${lanIP ? ', ' + lanIP : ''})`);
  return { key: fs.readFileSync(KEY_FILE), cert: fs.readFileSync(CERT_FILE) };
}

// Route: download certificate for mobile installation
app.get('/cert', (req, res) => {
  res.setHeader('Content-Type', 'application/x-x509-ca-cert');
  res.setHeader('Content-Disposition', 'attachment; filename="indie-tracker.crt"');
  res.sendFile(CERT_FILE);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const LAN_IP    = getLanIP();
const tlsCreds  = getOrCreateCert(LAN_IP);
const server    = https.createServer(tlsCreds, app);
const localUrl  = `https://localhost:${PORT}`;
const lanUrl    = LAN_IP ? `https://${LAN_IP}:${PORT}` : null;

// If .env redirect URI still points to localhost but we have a LAN IP, upgrade it
if (REDIRECT_URI.includes('localhost') && lanUrl) {
  REDIRECT_URI = `${lanUrl}/callback`;
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎵  Indie Tracker`);
  console.log(`   Ordenador : ${localUrl}`);
  if (lanUrl) console.log(`   Móvil/Red  : ${lanUrl}`);

  if (lanUrl) {
    console.log(`\n   ── Acceso desde móvil ──────────────────────────────────`);
    console.log(`   1. Abre en el móvil: ${lanUrl}`);
    console.log(`   2. Acepta el aviso del certificado`);
    console.log(`      (Safari: "Mostrar detalles" → "Visitar este sitio web")`);
    console.log(`      (Edge:   "Avanzado" → "Continuar de todos modos")`);
    console.log(`   3. Para no repetirlo nunca más, instala el certificado:`);
    console.log(`      Abre en el móvil → ${lanUrl}/cert`);
    console.log(`      y sigue los pasos de instalación del sistema.`);
    console.log(`\n   ── Spotify Developer Dashboard ─────────────────────────`);
    console.log(`   Añade esta Redirect URI en tu app de Spotify:`);
    console.log(`   → ${REDIRECT_URI}`);
    console.log(`   (Settings → Edit → Redirect URIs)\n`);
  }
});
