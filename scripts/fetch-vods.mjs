// Pulls every Blam League member's past broadcasts and highlights from Twitch
// and writes data/videos.json for the site. Runs on GitHub Actions every 2 hours.
// Needs two repository secrets: TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET.

import { readFile, writeFile } from 'node:fs/promises';

const league = JSON.parse(await readFile('data/league.json', 'utf8'));
const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const SECRET = process.env.TWITCH_CLIENT_SECRET;

if (!CLIENT_ID || !SECRET) {
  console.warn('Twitch is not connected yet: add TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET under Settings > Secrets and variables > Actions. Publishing the site without new videos.');
  process.exit(0);
}

// 1. App access token
const tokRes = await fetch('https://id.twitch.tv/oauth2/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: SECRET, grant_type: 'client_credentials' }),
});
const tok = await tokRes.json();
if (!tok.access_token) {
  console.error('Twitch rejected the Client ID / Secret:', JSON.stringify(tok));
  process.exit(1);
}
const HEADERS = { 'Client-Id': CLIENT_ID, Authorization: `Bearer ${tok.access_token}` };

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function helix(path, params) {
  const url = new URL('https://api.twitch.tv/helix/' + path);
  for (const [k, v] of params) url.searchParams.append(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`${path} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  throw new Error(`${path} kept hitting the rate limit`);
}
const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

const logins = league.members.map(m => m.twitch.toLowerCase());

// 2. Look up members (id, display name, avatar)
const users = [];
for (const group of chunks(logins, 100)) {
  const r = await helix('users', group.map(l => ['login', l]));
  users.push(...r.data);
}
const found = new Set(users.map(u => u.login));
const notFound = logins.filter(l => !found.has(l));
if (notFound.length) console.warn('Not found on Twitch (check spelling):', notFound.join(', '));

// 3. Who is live right now
const live = [];
for (const group of chunks(logins, 100)) {
  const r = await helix('streams', group.map(l => ['user_login', l]));
  for (const s of r.data) {
    live.push({ login: s.user_login, title: s.title, game: s.game_name, viewers: s.viewer_count, started: s.started_at });
  }
}

// 4. Past broadcasts + highlights + uploads for each member
const weeks = (league.weeks || []).map(w => ({ ...w, t: Date.parse(w.start) })).sort((a, b) => a.t - b.t);
const hide = new Set((league.hideVideos || []).map(String));
const mustInclude = (league.titleMustIncludeAny || []).map(s => s.toLowerCase()).filter(Boolean);

function weekFor(title, created) {
  const t = Date.parse(created);
  let byDate = null;
  for (const w of weeks) if (w.t <= t) byDate = w;
  const m = title.match(/\b(?:wk|week)\s*[#.:-]?\s*(\d{1,2})\b/i);
  const season = byDate ? byDate.season : league.season;
  if (m) return { season, week: Number(m[1]), source: 'title' };
  if (byDate) return { season: byDate.season, week: byDate.week, source: 'date' };
  return { season: null, week: null, source: 'none' };
}

const videos = [];
for (const u of users) {
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const params = [['user_id', u.id], ['type', 'all'], ['first', '100']];
    if (cursor) params.push(['after', cursor]);
    const r = await helix('videos', params);
    for (const v of r.data) {
      if (hide.has(String(v.id))) continue;
      if (mustInclude.length && !mustInclude.some(k => v.title.toLowerCase().includes(k))) continue;
      const thumb = v.thumbnail_url && !v.thumbnail_url.includes('404')
        ? v.thumbnail_url.replace('%{width}', '640').replace('%{height}', '360')
        : null;
      const wk = weekFor(v.title, v.created_at);
      videos.push({
        id: v.id,
        login: u.login,
        title: v.title || 'Untitled stream',
        created: v.created_at,
        duration: v.duration,
        views: v.view_count,
        type: v.type,
        thumb,
        season: wk.season,
        week: wk.week,
        weekFrom: wk.source,
      });
    }
    cursor = r.pagination?.cursor;
    if (!cursor) break;
  }
}
videos.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));

const members = {};
for (const u of users) members[u.login] = { display: u.display_name, avatar: u.profile_image_url };

await writeFile('data/videos.json', JSON.stringify({
  updated: new Date().toISOString(),
  members,
  live,
  notFound,
  videos,
}, null, 1));

console.log(`Saved ${videos.length} videos from ${users.length} channels. ${live.length} live now.`);
