// src/config.js
'use strict';

function normalizeList(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid config: malformed list');
  if (!Array.isArray(raw.shows)) throw new Error('Invalid config: missing "shows" array');
  if (raw.shows.length === 0) throw new Error('Invalid config: at least 1 show required');

  const shows = raw.shows
    .filter(s => s && typeof s.id === 'string' && s.id.match(/^tt\d+$/))
    .map(s => ({ id: s.id, name: (s.name || s.id).toString().slice(0, 100) }));

  if (shows.length === 0) throw new Error('Invalid config: no valid shows');

  let topPercent = raw.topPercent;
  if (topPercent == null || topPercent === '') {
    topPercent = 100;
  } else {
    topPercent = Math.round(Number(topPercent));
    if (!Number.isFinite(topPercent) || topPercent < 1) topPercent = 20;
    if (topPercent > 100) topPercent = 100;
  }

  const list = { shows, topPercent };
  if (typeof raw.label === 'string' && raw.label.trim()) {
    list.label = raw.label.trim().slice(0, 40);
  }
  return list;
}

function encodeConfig(config) {
  return Buffer.from(JSON.stringify(config)).toString('base64url');
}

// Two shapes are accepted on decode:
//   Legacy / single list:  { shows: [...], topPercent, label? }
//   Multi-list:             { lists: [ { shows: [...], topPercent, label? }, ... ] }
// Both are normalized to the same canonical shape: { lists: [...] }.
// A single-list config is functionally identical to the old flat config
// (same catalog id 'shuffle', same item ids) so existing installs and
// links keep working exactly as before; multi-list configs get one
// extra catalog row per list, all from a single addon install.
function decodeConfig(base64String) {
  try {
    const json = Buffer.from(base64String, 'base64url').toString('utf-8');
    const raw = JSON.parse(json);

    const rawLists = Array.isArray(raw.lists) ? raw.lists : [raw];
    if (rawLists.length === 0) throw new Error('Invalid config: at least 1 list required');

    const lists = rawLists.map(normalizeList);
    return { lists };
  } catch (err) {
    if (err.message && err.message.startsWith('Invalid config')) throw err;
    throw new Error(`Failed to decode config: ${err.message}`);
  }
}

module.exports = { encodeConfig, decodeConfig };
