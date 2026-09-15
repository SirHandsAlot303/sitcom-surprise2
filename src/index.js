// src/index.js - Sitcom Surprise - single catalog, true single-click, bulletproof meta
'use strict';
const express = require('express');
const path = require('path');
const { decodeConfig } = require('./config');
const { pickRandomEpisode, getTopEpisodes } = require('./tvmaze');

const app = express();

const ADDON_ID = 'org.stremio.sitcomsurprise';
const ADDON_NAME = 'Sitcom Surprise';
const ADDON_VERSION = '5.0.0';
const DEFAULT_CFG = { lists: [{ shows: [{ id: 'tt0898266', name: 'The Big Bang Theory' }], topPercent: 100 }] };

// One addon install can expose several named lists (e.g. "Me" / "Wife"),
// each rendered as its own catalog row in Stremio's Discover/Board — same
// idea as an addon showing "Decade - 1990s" and "Decade - 2000s" as
// separate rows. A single-list config keeps the original catalog id
// ('shuffle') and item ids so existing single-person installs/links are
// unaffected; multi-list configs get one 'shuffle-<index>' catalog per list.
function getLists(cfg) {
  return (cfg && Array.isArray(cfg.lists) && cfg.lists.length) ? cfg.lists : DEFAULT_CFG.lists;
}
function catalogIdForList(lists, index) {
  return lists.length > 1 ? `shuffle-${index}` : 'shuffle';
}
function surpriseIdForList(lists, index) {
  return lists.length > 1 ? `shuffle:surprise:${index}` : 'shuffle:surprise';
}
function listIndexFromCatalogId(lists, catalogId) {
  if (lists.length === 1) return 0;
  const m = /^shuffle-(\d+)$/.exec(catalogId || '');
  if (m) {
    const i = parseInt(m[1], 10);
    if (i >= 0 && i < lists.length) return i;
  }
  return 0;
}
function listIndexFromSurpriseId(lists, id) {
  const m = /^shuffle:surprise(?::(\d+))?$/.exec(id || '');
  if (!m) return null;
  if (m[1] == null) return 0;
  const i = parseInt(m[1], 10);
  return (i >= 0 && i < lists.length) ? i : 0;
}

function getLogoUrl(req) {
  const fallback = 'https://sitcom-surprise.vercel.app/logo.png';
  if (!req) return fallback;
  const host = req.get('host');
  if (!host) return fallback;
  return `https://${host}/logo.png`;
}

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use('/configure', express.static(path.join(__dirname, '..', 'public')));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/', (req, res) => res.redirect('/configure'));

// Stremio's "Configure" button on an installed addon opens
// <base>/<config>/configure (it derives this from the manifest URL).
// Without this route that 404'd — which is why editing an already-
// installed addon's lists appeared broken / lost.
app.get('/:config/configure', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.param('config', (req, res, next, configParam) => {
  if (configParam === 'default') {
    req.addonConfig = DEFAULT_CFG;
    return next();
  }
  try {
    req.addonConfig = decodeConfig(configParam);
    next();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function buildManifest(cfg, req) {
  const logo = getLogoUrl(req);
  const lists = getLists(cfg);
  const multi = lists.length > 1;
  return {
    id: ADDON_ID,
    version: ADDON_VERSION,
    name: ADDON_NAME,
    description: multi
      ? `One tile per show, one row per list (${lists.map(l => l.label || 'Unnamed').join(', ')}). One click = surprise random episode.`
      : `One tile per show. One click = surprise random episode from ${lists[0].topPercent === 100 ? 'all episodes' : `top ${lists[0].topPercent}% by rating`}.`,
    logo,
    resources: [
      'catalog',
      { name: 'meta', types: ['series'], idPrefixes: ['shuffle:'] },
      { name: 'stream', types: ['series'], idPrefixes: ['shuffle:'] },
    ],
    types: ['series'],
    idPrefixes: ['shuffle:'],
    catalogs: lists.map((list, i) => ({
      type: 'series',
      id: catalogIdForList(lists, i),
      name: list.label ? `${ADDON_NAME} — ${list.label}` : (multi ? `${ADDON_NAME} ${i + 1}` : ADDON_NAME),
    })),
    behaviorHints: { configurable: true, configurationRequired: false },
    stremioAddonsConfig: {
      issuer: 'https://stremio-addons.net',
      signature: 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4Q0JDLUhTMjU2In0..SJlrGzhzvmlgE3T3Pk5mXQ.swO7lehOLqeaZgmRj1sU4GPVi5keX36xOTNQj78csMQXkV7pzYI4nGSWUB06Qdhn30qYDBeEyVtX4gksplpAkzfDHX1XX3b59YiQRvzuP5HqjR4Nq4T2Pli-ipgH1KCu.GqL2GUbwQmpd9g4SGFDgCA',
    },
  };
}

function parseExtra(extraStr) {
  if (!extraStr) return {};
  try {
    const sp = new URLSearchParams(extraStr);
    const obj = {};
    for (const [k, v] of sp.entries()) obj[k] = v;
    return obj;
  } catch { return {}; }
}

function getSurprisePosterUrl(req) {
  const fallback = 'https://sitcom-surprise.vercel.app/surprise-poster.png';
  if (!req) return fallback;
  const host = req.get('host');
  if (!host) return fallback;
  return `https://${host}/surprise-poster.png`;
}

function catalogHandler(req, res) {
  const cfg = req.addonConfig || DEFAULT_CFG;
  const lists = getLists(cfg);
  const listIndex = listIndexFromCatalogId(lists, req.params.id);
  const list = lists[listIndex];

  const extra = parseExtra(req.params.extra);
  const search = (extra.search || '').toLowerCase();
  let filtered = list.shows;
  if (search) filtered = filtered.filter(s => s.name.toLowerCase().includes(search));
  const skip = parseInt(extra.skip || '0', 10) || 0;
  const paged = filtered.slice(skip, skip + 100);

  const metas = paged.map(show => ({
    id: `shuffle:${show.id}`,
    type: 'series',
    name: show.name,
    poster: `https://images.metahub.space/poster/medium/${show.id}/img.jpg`,
    background: `https://images.metahub.space/background/medium/${show.id}/img.jpg`,
    logo: `https://images.metahub.space/logo/medium/${show.id}/img.png`,
    description: `🎲 Surprise! One click → random ${list.topPercent === 100 ? 'episode' : `top ${list.topPercent}% episode`} of ${show.name}`,
    posterShape: 'poster',
    behaviorHints: { defaultVideoId: null },
  }));

  // Prepend the Surprise tile on the first page
  if (skip === 0 && (!search || '🎲 surprise'.includes(search))) {
    const surpriseTile = {
      id: surpriseIdForList(lists, listIndex),
      type: 'series',
      name: '🎲 Surprise',
      poster: getSurprisePosterUrl(req),
      background: getSurprisePosterUrl(req),
      logo: getLogoUrl(req),
      description: '🎲 Random show, random episode — pure surprise!',
      posterShape: 'poster',
      behaviorHints: { defaultVideoId: null },
    };
    metas.unshift(surpriseTile);
  }

  res.json({ metas });
  for (const show of paged) getTopEpisodes(show.id, list.topPercent).catch(() => {});
}

async function handleMeta(req, res) {
  const rawId = req.params.id;
  const decodedId = (() => {
    try { return decodeURIComponent(rawId); } catch { return rawId; }
  })();

  const cfg = req.addonConfig || DEFAULT_CFG;
  const lists = getLists(cfg);

  // --- Surprise tile: pick a random show from ITS list, then a random episode ---
  const surpriseListIndex = listIndexFromSurpriseId(lists, decodedId) ?? listIndexFromSurpriseId(lists, rawId);
  if (surpriseListIndex !== null) {
    const list = lists[surpriseListIndex];
    const surpriseId = surpriseIdForList(lists, surpriseListIndex);
    const shows = list.shows || [];
    if (shows.length === 0) return res.json({ meta: null });
    const show = shows[Math.floor(Math.random() * shows.length)];

    try {
      const episode = await pickRandomEpisode(show.id, list.topPercent || 100);
      const videoId = `${show.id}:${episode.season}:${episode.number}`;
      const epLabel = `S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`;

      return res.json({
        meta: {
          id: surpriseId,
          type: 'series',
          name: '🎲 Surprise',
          poster: `https://images.metahub.space/poster/medium/${show.id}/img.jpg`,
          background: `https://images.metahub.space/background/medium/${show.id}/img.jpg`,
          logo: getLogoUrl(req),
          description: `🎲 Surprise picked ${show.name}! ${epLabel} — ${episode.name}${episode.rating != null ? ` (★${episode.rating})` : ''}. New surprise every open!`,
          releaseInfo: `${episode.season}`,
          imdbRating: episode.rating != null ? String(episode.rating) : undefined,
          behaviorHints: { defaultVideoId: videoId },
          videos: [
            {
              id: videoId,
              name: `${show.name} ${epLabel} — ${episode.name}`,
              season: episode.season,
              number: episode.number,
              episode: episode.number,
              overview: `🎲 Surprise! Randomly picked ${show.name} ${epLabel}: ${episode.name}`,
              released: '2020-01-01T00:00:00.000Z',
            },
          ],
        },
      });
    } catch (err) {
      console.error(`[Meta] Surprise error for ${show.id}:`, err.message);
      const fallbackVideoId = `${show.id}:1:1`;
      return res.json({
        meta: {
          id: surpriseId,
          type: 'series',
          name: '🎲 Surprise',
          poster: `https://images.metahub.space/poster/medium/${show.id}/img.jpg`,
          background: `https://images.metahub.space/background/medium/${show.id}/img.jpg`,
          logo: getLogoUrl(req),
          description: `⚠️ Could not fetch episodes for ${show.name}: ${err.message}. Retrying next open will get a surprise!`,
          releaseInfo: '1',
          behaviorHints: { defaultVideoId: fallbackVideoId },
          videos: [
            {
              id: fallbackVideoId,
              name: `${show.name} S01E01 (Retry)`,
              season: 1,
              number: 1,
              episode: 1,
              overview: `Error: ${err.message}. Will retry with random episode on next open.`,
              released: '2020-01-01T00:00:00.000Z',
            },
          ],
        },
      });
    }
  }

  // --- Per-show tile: search across all lists (a show's own id is unique regardless of which list/row it was clicked from) ---
  const imdbMatch = decodedId.match(/(shuffle:)(tt\d+)/);
  const imdbId = imdbMatch ? imdbMatch[2] : null;

  if (!imdbId) {
    console.warn(`[Meta] No valid shuffle ID found: ${rawId}`);
    return res.json({ meta: null });
  }

  let show = null;
  let topPercent = 100;
  for (const list of lists) {
    const found = (list.shows || []).find(s => s.id === imdbId);
    if (found) { show = found; topPercent = list.topPercent || 100; break; }
  }
  if (!show) {
    console.warn(`[Meta] Show ${imdbId} not in config, returning null`);
    return res.json({ meta: null });
  }

  try {
    const episode = await pickRandomEpisode(imdbId, topPercent);
    const videoId = `${imdbId}:${episode.season}:${episode.number}`;
    const epLabel = `S${String(episode.season).padStart(2, '0')}E${String(episode.number).padStart(2, '0')}`;

    res.json({
      meta: {
        id: `shuffle:${imdbId}`,
        type: 'series',
        name: show.name,
        poster: `https://images.metahub.space/poster/medium/${imdbId}/img.jpg`,
        background: `https://images.metahub.space/background/medium/${imdbId}/img.jpg`,
        logo: `https://images.metahub.space/logo/medium/${imdbId}/img.png`,
        description: `🎲 Surprise — ${topPercent === 100 ? 'All episodes' : `Top ${topPercent}%`} · ${epLabel} — ${episode.name}${episode.rating != null ? ` (★${episode.rating})` : ''}. New surprise every open!`,
        releaseInfo: `${episode.season}`,
        imdbRating: episode.rating != null ? String(episode.rating) : undefined,
        behaviorHints: { defaultVideoId: videoId },
        videos: [
          {
            id: videoId,
            name: `${epLabel} ${episode.name}`,
            season: episode.season,
            number: episode.number,
            episode: episode.number,
            overview: `Surprise pick from ${topPercent === 100 ? 'all episodes' : `top ${topPercent}%`}. ${show.name} ${epLabel}: ${episode.name}`,
            released: '2020-01-01T00:00:00.000Z',
          },
        ],
      },
    });
  } catch (err) {
    console.error(`[Meta] Error for ${imdbId}:`, err.message);
    const fallbackVideoId = `${imdbId}:1:1`;
    res.json({
      meta: {
        id: `shuffle:${imdbId}`,
        type: 'series',
        name: show.name,
        poster: `https://images.metahub.space/poster/medium/${imdbId}/img.jpg`,
        background: `https://images.metahub.space/background/medium/${imdbId}/img.jpg`,
        logo: `https://images.metahub.space/logo/medium/${imdbId}/img.png`,
        description: `⚠️ Could not fetch episodes: ${err.message}. Retrying next open will get a surprise!`,
        releaseInfo: '1',
        behaviorHints: { defaultVideoId: fallbackVideoId },
        videos: [
          {
            id: fallbackVideoId,
            name: 'S01E01 (Retry)',
            season: 1,
            number: 1,
            episode: 1,
            overview: `Error: ${err.message}. Will retry with random episode on next open.`,
            released: '2020-01-01T00:00:00.000Z',
          },
        ],
      },
    });
  }
}

async function handleStream(req, res) {
  res.json({ streams: [], cacheMaxAge: 0 });
}

// Manifest
app.get('/manifest.json', (req, res) => {
  res.json(buildManifest(DEFAULT_CFG, req));
});
app.get('/:config/manifest.json', (req, res) => {
  res.json(buildManifest(req.addonConfig, req));
  for (const list of getLists(req.addonConfig)) {
    for (const show of list.shows) getTopEpisodes(show.id, list.topPercent).catch(() => {});
  }
});
app.get('/:config/manifest', (req, res) => res.json(buildManifest(req.addonConfig, req)));

// Root catalog/meta without config
app.get('/catalog/series/shuffle.json', catalogHandler);
app.get('/catalog/series/shuffle/:extra.json', catalogHandler);
app.get('/catalog/:type/:id.json', catalogHandler);
app.get('/catalog/:type/:id/:extra.json', catalogHandler);
app.get('/meta/series/:id.json', handleMeta);
app.get('/meta/:type/:id.json', handleMeta);

// Configured catalog/meta (main flow)
app.get('/:config/catalog/series/shuffle.json', catalogHandler);
app.get('/:config/catalog/series/shuffle/:extra.json', catalogHandler);
app.get('/:config/catalog/:type/:id.json', catalogHandler);
app.get('/:config/catalog/:type/:id/:extra.json', catalogHandler);
app.get('/:config/meta/series/:id.json', handleMeta);
app.get('/:config/meta/:type/:id.json', handleMeta);
app.get('/:config/stream/series/:id.json', handleStream);
app.get('/:config/stream/:type/:id.json', handleStream);

// Stream for root as well
app.get('/stream/series/:id.json', handleStream);
app.get('/stream/:type/:id.json', handleStream);

try {
  const { _loadFileCache } = require('./tvmaze');
  _loadFileCache();
  console.log('[Startup] Persistent cache loaded');
} catch (e) {
  console.warn('[Startup] Cache load failed', e.message);
}

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => console.log(`${ADDON_NAME} v${ADDON_VERSION} running at http://localhost:${PORT}`));
}
module.exports = app;
