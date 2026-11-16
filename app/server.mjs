// Lockr Study Spots server. No dependencies: Node 22.13+ (built-in SQLite).
//   node app/server.mjs            PORT=8787  LOCKR_DB=app/data/lockr.db
// Serves app/public and a small JSON API. Everything that changes is pushed to open
// pages over one server-sent event stream, so friends see each other's posts live.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { SPOTS, METERS, COURSES, RES_KINDS } from './public/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const SPOT_IDS = new Set(SPOTS.map(s => s.id));
const COURSE_IDS = new Set(COURSES.map(c => c[0]));
const METER_KEYS = METERS.map(m => m[0]);
const ANON_WORDS = ['gargoyle', 'phoenix', 'carrel', 'dome', 'midway', 'stacks', 'quad', 'ivy', 'cloister', 'lantern', 'bookend', 'turret'];
const SESSION_MAX_MS = 8 * 3600e3;      // a check-in nobody ended stops counting after 8 hours
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, pass TEXT NOT NULL, anon INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logins (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS friends (a INTEGER NOT NULL, b INTEGER NOT NULL, status TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (a, b));
CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, text TEXT NOT NULL, spot TEXT, anon INTEGER NOT NULL, audience TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS post_votes (post_id INTEGER NOT NULL, user_id INTEGER NOT NULL, d INTEGER NOT NULL, PRIMARY KEY (post_id, user_id));
CREATE TABLE IF NOT EXISTS checkins (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, spot TEXT NOT NULL, start INTEGER NOT NULL, stop INTEGER);
CREATE TABLE IF NOT EXISTS ranks (user_id INTEGER PRIMARY KEY, list TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ratings (user_id INTEGER NOT NULL, spot TEXT NOT NULL, lockin REAL, larp REAL, yap REAL, outlets REAL, PRIMARY KEY (user_id, spot));
CREATE TABLE IF NOT EXISTS gems (user_id INTEGER NOT NULL, spot TEXT NOT NULL, day TEXT NOT NULL, PRIMARY KEY (user_id, spot, day));
CREATE TABLE IF NOT EXISTS resources (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, course TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, anon INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS res_votes (res_id INTEGER NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY (res_id, user_id));
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`;

const dayOf = ms => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date(ms));
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPass = (pass, salt) => crypto.scryptSync(pass, salt, 32).toString('hex');
// A ranking of n spots scores them 10 down to 5, evenly spaced.
export const rankScore = (i, n) => n === 1 ? 10 : 10 - 5 * i / (n - 1);

class Fail extends Error { constructor(status, message) { super(message); this.status = status; } }
const need = (ok, status, message) => { if (!ok) throw new Fail(status, message); };

export function createApp({ dbPath = ':memory:', now = () => Date.now() } = {}) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);

  // One secret per database keeps anonymous handles stable but not guessable from a user id.
  let secret = one('SELECT v FROM meta WHERE k = ?', 'secret')?.v;
  if (!secret) { secret = crypto.randomBytes(24).toString('hex'); run('INSERT INTO meta (k, v) VALUES (?, ?)', 'secret', secret); }
  const handle = id => 'anon ' + ANON_WORDS[parseInt(sha(secret + ':' + id).slice(0, 8), 16) % ANON_WORDS.length];

  const streams = new Set();
  const changed = () => { for (const res of streams) res.write('data: changed\n\n'); };
  const hits = new Map();   // "what:who" -> timestamps, for simple rate limits
  const limit = (key, max, windowMs) => {
    const t = now(), list = (hits.get(key) || []).filter(x => t - x < windowMs);
    need(list.length < max, 429, 'Slow down a little, then try again.');
    list.push(t); hits.set(key, list);
  };

  const friendIds = id => q(`SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM friends WHERE status = 'accepted' AND (a = ? OR b = ?)`, id, id, id).map(r => r.id);
  const shown = (u, viewer) => ({ id: u.id, username: u.username, name: u.name });
  const liveSince = () => now() - SESSION_MAX_MS;
  const sessionEnd = c => Math.min(c.stop ?? now(), c.start + SESSION_MAX_MS);

  function state(me) {
    const fids = friendIds(me.id), fset = new Set(fids), t = now();
    const users = new Map(q('SELECT id, username, name, anon FROM users').map(u => [u.id, u]));
    const label = (uid, anon) => anon ? handle(uid) : users.get(uid).name;

    // Spots: score from everyone's rankings, meters from ratings, who is there from open check-ins.
    const spots = Object.fromEntries(SPOTS.map(s => [s.id, { score: null, rankers: 0, here: 0, friendsHere: [], meters: null, raters: 0, gems: 0, gemmed: false, myRating: null }]));
    const sums = {};
    for (const r of q('SELECT user_id, list FROM ranks')) {
      const list = JSON.parse(r.list).filter(id => SPOT_IDS.has(id));
      list.forEach((id, i) => { (sums[id] ||= []).push(rankScore(i, list.length)); });
    }
    for (const [id, a] of Object.entries(sums)) { spots[id].score = a.reduce((x, y) => x + y, 0) / a.length; spots[id].rankers = a.length; }
    for (const c of q('SELECT user_id, spot FROM checkins WHERE stop IS NULL AND start > ?', liveSince())) {
      if (!spots[c.spot]) continue;
      spots[c.spot].here++;
      const u = users.get(c.user_id);
      if (fset.has(c.user_id) && !u.anon) spots[c.spot].friendsHere.push(u.name);
    }
    for (const r of q(`SELECT spot, COUNT(*) AS n, ${METER_KEYS.map(k => `AVG(${k}) AS ${k}`).join(', ')} FROM ratings GROUP BY spot`)) {
      if (!spots[r.spot]) continue;
      spots[r.spot].raters = r.n; spots[r.spot].meters = Object.fromEntries(METER_KEYS.map(k => [k, r[k]]));
    }
    for (const r of q('SELECT * FROM ratings WHERE user_id = ?', me.id)) if (spots[r.spot]) spots[r.spot].myRating = Object.fromEntries(METER_KEYS.map(k => [k, r[k]]));
    const today = dayOf(t);
    for (const g of q('SELECT spot, COUNT(*) AS n, SUM(user_id = ?) AS mine FROM gems WHERE day = ? GROUP BY spot', me.id, today)) {
      if (spots[g.spot]) { spots[g.spot].gems = g.n; spots[g.spot].gemmed = !!g.mine; }
    }

    // Posts: campus posts go to everyone, friends posts to the author and their friends.
    const votes = new Map(q('SELECT post_id, SUM(d) AS n FROM post_votes GROUP BY post_id').map(v => [v.post_id, v.n]));
    const mine = new Map(q('SELECT post_id, d FROM post_votes WHERE user_id = ?', me.id).map(v => [v.post_id, v.d]));
    const posts = q('SELECT * FROM posts ORDER BY created DESC LIMIT 300')
      .filter(p => p.audience === 'campus' || p.user_id === me.id || fset.has(p.user_id))
      .map(p => ({ id: p.id, by: label(p.user_id, p.anon), mine: p.user_id === me.id, friend: !p.anon && fset.has(p.user_id), anon: !!p.anon,
        audience: p.audience, spot: p.spot, text: p.text, created: p.created, votes: votes.get(p.id) || 0, myVote: mine.get(p.id) || 0 }));

    const rv = new Map(q('SELECT res_id, COUNT(*) AS n FROM res_votes GROUP BY res_id').map(v => [v.res_id, v.n]));
    const myRv = new Set(q('SELECT res_id FROM res_votes WHERE user_id = ?', me.id).map(v => v.res_id));
    const resources = q('SELECT * FROM resources ORDER BY created DESC').map(r => ({ id: r.id, course: r.course, kind: r.kind, title: r.title,
      by: label(r.user_id, r.anon), mine: r.user_id === me.id, votes: rv.get(r.id) || 0, voted: myRv.has(r.id) }));

    // Hours: mine, plus friends who are not in anonymous mode.
    const weekAgo = t - 7 * 86400e3, hours = {};
    for (const c of q('SELECT user_id, start, stop FROM checkins WHERE start > ?', weekAgo)) hours[c.user_id] = (hours[c.user_id] || 0) + (sessionEnd(c) - c.start) / 3600e3;
    const board = [me.id, ...fids.filter(id => !users.get(id).anon)].map(id => ({ name: users.get(id).name, me: id === me.id, hours: hours[id] || 0 })).sort((a, b) => b.hours - a.hours);
    const days = new Set(q('SELECT start FROM checkins WHERE user_id = ?', me.id).map(c => dayOf(c.start)));
    // Days in a row with a check-in; today not counting against you until it is over.
    let streak = 0, d = days.has(dayOf(t)) ? t : t - 86400e3;
    for (; days.has(dayOf(d)); d -= 86400e3) streak++;

    const session = one('SELECT spot, start FROM checkins WHERE user_id = ? AND stop IS NULL AND start > ? ORDER BY start DESC', me.id, liveSince()) || null;
    const rel = q('SELECT * FROM friends WHERE a = ? OR b = ?', me.id, me.id);
    return {
      now: t,
      me: { id: me.id, username: me.username, name: me.name, anon: !!me.anon, handle: handle(me.id) },
      friends: fids.map(id => shown(users.get(id))).sort((a, b) => a.name.localeCompare(b.name)),
      incoming: rel.filter(r => r.status === 'pending' && r.b === me.id).map(r => shown(users.get(r.a))),
      outgoing: rel.filter(r => r.status === 'pending' && r.a === me.id).map(r => shown(users.get(r.b))),
      spots, posts, resources, session,
      myRank: JSON.parse(one('SELECT list FROM ranks WHERE user_id = ?', me.id)?.list || '[]').filter(id => SPOT_IDS.has(id)),
      stats: { streak, weekHours: hours[me.id] || 0 }, board,
    };
  }

  const text = (v, max, what) => { need(typeof v === 'string', 400, `${what} is missing.`); const s = v.replace(/\s+/g, ' ').trim(); need(s.length > 0, 400, `${what} is empty.`); need(s.length <= max, 400, `${what} is too long (${max} characters at most).`); return s; };
  const login = (res, req, userId) => {
    const token = crypto.randomBytes(32).toString('hex');
    run('INSERT INTO logins (token, user_id, created) VALUES (?, ?, ?)', sha(token), userId, now());
    const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `lockr=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${90 * 86400}${secure}`);
  };
  const tokenOf = req => /(?:^|;\s*)lockr=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
  const userOf = req => { const t = tokenOf(req); return t ? one('SELECT u.* FROM logins l JOIN users u ON u.id = l.user_id WHERE l.token = ?', sha(t)) : undefined; };
  const findUser = name => one('SELECT * FROM users WHERE username = ?', String(name || '').trim().replace(/^@/, '').toLowerCase());

  // Routes. Each returns the JSON to send; `me` is the signed-in user or undefined.
  const open = {
    'POST /api/signup': (b, req, res) => {
      limit('signup:' + (req.socket.remoteAddress || ''), 20, 3600e3);
      const username = String(b.username || '').trim().toLowerCase();
      need(/^[a-z0-9_]{3,20}$/.test(username), 400, 'Usernames are 3 to 20 letters, numbers or underscores.');
      need(typeof b.password === 'string' && b.password.length >= 8 && b.password.length <= 200, 400, 'Passwords need at least 8 characters.');
      const name = text(b.name || username, 30, 'Name');
      need(!findUser(username), 409, 'That username is taken.');
      const salt = crypto.randomBytes(16).toString('hex');
      const { lastInsertRowid: id } = run('INSERT INTO users (username, name, salt, pass, created) VALUES (?, ?, ?, ?, ?)', username, name, salt, hashPass(b.password, salt), now());
      login(res, req, Number(id));
      return { ok: true };
    },
    'POST /api/login': (b, req, res) => {
      limit('login:' + (req.socket.remoteAddress || ''), 30, 600e3);
      const u = findUser(b.username);
      const ok = u && typeof b.password === 'string' && crypto.timingSafeEqual(Buffer.from(hashPass(b.password, u.salt), 'hex'), Buffer.from(u.pass, 'hex'));
      need(ok, 401, 'Wrong username or password.');
      login(res, req, u.id);
      return { ok: true };
    },
    'POST /api/logout': (b, req, res) => {
      const t = tokenOf(req);
      if (t) run('DELETE FROM logins WHERE token = ?', sha(t));
      res.setHeader('Set-Cookie', 'lockr=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return { ok: true };
    },
  };
  const authed = {
    'GET /api/state': (b, me) => state(me),
    'POST /api/me': (b, me) => {
      if (b.anon !== undefined) run('UPDATE users SET anon = ? WHERE id = ?', b.anon ? 1 : 0, me.id);
      if (b.name !== undefined) run('UPDATE users SET name = ? WHERE id = ?', text(b.name, 30, 'Name'), me.id);
    },
    'POST /api/friends/add': (b, me) => {
      const u = findUser(b.username);
      need(u, 404, 'No one has that username.');
      need(u.id !== me.id, 400, 'That is you.');
      const back = one('SELECT * FROM friends WHERE a = ? AND b = ?', u.id, me.id);
      if (back) run(`UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ?`, u.id, me.id);      // they already asked: this accepts
      else run(`INSERT OR IGNORE INTO friends (a, b, status, created) VALUES (?, ?, 'pending', ?)`, me.id, u.id, now());
    },
    'POST /api/friends/remove': (b, me) => { run('DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)', me.id, +b.id, +b.id, me.id); },
    'POST /api/posts': (b, me) => {
      limit('post:' + me.id, 10, 60e3);
      const body = text(b.text, 240, 'Post');
      need(b.spot == null || b.spot === '' || SPOT_IDS.has(b.spot), 400, 'Unknown spot.');
      run('INSERT INTO posts (user_id, text, spot, anon, audience, created) VALUES (?, ?, ?, ?, ?, ?)', me.id, body, b.spot || null, b.anon ? 1 : 0, b.audience === 'friends' ? 'friends' : 'campus', now());
    },
    'POST /api/posts/vote': (b, me) => {
      const d = Math.sign(+b.d || 0), p = one('SELECT * FROM posts WHERE id = ?', +b.id);
      need(p && (p.audience === 'campus' || p.user_id === me.id || friendIds(me.id).includes(p.user_id)), 404, 'That post is gone.');
      if (d) run('INSERT INTO post_votes (post_id, user_id, d) VALUES (?, ?, ?) ON CONFLICT (post_id, user_id) DO UPDATE SET d = excluded.d', p.id, me.id, d);
      else run('DELETE FROM post_votes WHERE post_id = ? AND user_id = ?', p.id, me.id);
    },
    'POST /api/posts/delete': (b, me) => {
      const r = run('DELETE FROM posts WHERE id = ? AND user_id = ?', +b.id, me.id);
      if (r.changes) run('DELETE FROM post_votes WHERE post_id = ?', +b.id);
    },
    'POST /api/session/start': (b, me) => {
      need(SPOT_IDS.has(b.spot), 400, 'Unknown spot.');
      run('UPDATE checkins SET stop = ? WHERE user_id = ? AND stop IS NULL', now(), me.id);
      run('INSERT INTO checkins (user_id, spot, start) VALUES (?, ?, ?)', me.id, b.spot, now());
    },
    'POST /api/session/end': (b, me) => {
      for (const c of q('SELECT id, start FROM checkins WHERE user_id = ? AND stop IS NULL', me.id)) run('UPDATE checkins SET stop = ? WHERE id = ?', Math.min(now(), c.start + SESSION_MAX_MS), c.id);
    },
    'POST /api/rank': (b, me) => {
      need(Array.isArray(b.list) && b.list.every(id => SPOT_IDS.has(id)) && new Set(b.list).size === b.list.length, 400, 'That ranking has a spot we do not know.');
      run('INSERT INTO ranks (user_id, list) VALUES (?, ?) ON CONFLICT (user_id) DO UPDATE SET list = excluded.list', me.id, JSON.stringify(b.list));
    },
    'POST /api/rate': (b, me) => {
      need(SPOT_IDS.has(b.spot), 400, 'Unknown spot.');
      const v = METER_KEYS.map(k => +b[k]);
      need(v.every(x => x >= 0 && x <= 10), 400, 'Ratings run from 0 to 10.');
      run(`INSERT INTO ratings (user_id, spot, ${METER_KEYS.join(', ')}) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, spot) DO UPDATE SET ${METER_KEYS.map(k => `${k} = excluded.${k}`).join(', ')}`, me.id, b.spot, ...v);
    },
    'POST /api/gem': (b, me) => {
      need(SPOT_IDS.has(b.spot), 400, 'Unknown spot.');
      const day = dayOf(now());
      const r = run('DELETE FROM gems WHERE user_id = ? AND spot = ? AND day = ?', me.id, b.spot, day);
      if (!r.changes) run('INSERT INTO gems (user_id, spot, day) VALUES (?, ?, ?)', me.id, b.spot, day);
    },
    'POST /api/resources': (b, me) => {
      limit('res:' + me.id, 10, 60e3);
      need(COURSE_IDS.has(b.course), 400, 'Unknown course.');
      need(RES_KINDS.includes(b.kind), 400, 'Unknown kind.');
      run('INSERT INTO resources (user_id, course, kind, title, anon, created) VALUES (?, ?, ?, ?, ?, ?)', me.id, b.course, b.kind, text(b.title, 120, 'Title'), b.anon ? 1 : 0, now());
    },
    'POST /api/resources/vote': (b, me) => {
      need(one('SELECT id FROM resources WHERE id = ?', +b.id), 404, 'That is gone.');
      const r = run('DELETE FROM res_votes WHERE res_id = ? AND user_id = ?', +b.id, me.id);
      if (!r.changes) run('INSERT INTO res_votes (res_id, user_id) VALUES (?, ?)', +b.id, me.id);
    },
    'POST /api/resources/delete': (b, me) => {
      const r = run('DELETE FROM resources WHERE id = ? AND user_id = ?', +b.id, me.id);
      if (r.changes) run('DELETE FROM res_votes WHERE res_id = ?', +b.id);
    },
  };

  const readBody = req => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 16384) { reject(new Fail(413, 'Too much data.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new Fail(400, 'That was not JSON.')); } });
    req.on('error', reject);
  });
  const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };

  function serveFile(req, res, urlPath) {
    let rel = decodeURIComponent(urlPath);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(PUBLIC, rel);
    if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, { error: 'No.' });
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, { error: 'Not found.' });
      const big = /\.(glb|webp|jpg|png|woff2)$/.test(file) || rel.startsWith('/vendor/');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': big ? 'public, max-age=86400' : 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), key = `${req.method} ${url.pathname}`;
    try {
      if (key === 'GET /api/events') {
        need(userOf(req), 401, 'Sign in first.');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', Connection: 'keep-alive' });
        res.write('retry: 3000\n\n');
        streams.add(res);
        const beat = setInterval(() => res.write(': beat\n\n'), 25000);
        req.on('close', () => { clearInterval(beat); streams.delete(res); });
        return;
      }
      if (open[key] || authed[key]) {
        // JSON only: a form on another site cannot send this content type without a preflight.
        if (req.method === 'POST') need(/^application\/json/.test(req.headers['content-type'] || ''), 415, 'Send JSON.');
        const body = req.method === 'POST' ? await readBody(req) : {};
        if (open[key]) return send(res, 200, open[key](body, req, res));
        const me = userOf(req);
        need(me, 401, 'Sign in first.');
        const out = authed[key](body, me);
        if (req.method === 'POST') changed();
        return send(res, 200, out ?? { ok: true });
      }
      if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found.' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Not allowed.' });
      // The front door: people who are signed in, or arriving on an invite link, go straight to the app.
      if (url.pathname === '/' && (userOf(req) || url.searchParams.has('add'))) { res.writeHead(302, { Location: '/app.html' + url.search, 'Cache-Control': 'no-store' }); return res.end(); }
      serveFile(req, res, url.pathname);
    } catch (e) {
      if (!(e instanceof Fail)) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, { error: e instanceof Fail ? e.message : 'Something broke on our side.' });
    }
  });
  server.on('close', () => { for (const res of streams) res.end(); db.close(); });
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8787, dbPath = process.env.LOCKR_DB || path.join(HERE, 'data', 'lockr.db');
  createApp({ dbPath }).listen(port, () => console.log(`Lockr Study Spots on http://localhost:${port}  (database: ${dbPath})`));
}
