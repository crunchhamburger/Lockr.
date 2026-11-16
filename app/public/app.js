// Lockr Study Spots, the page. State lives on the server (`S`); `V` is what this page is showing.
import { SPOTS, KINDS, METERS, BLDG, FLOORS, COURSES, RES_KINDS } from './data.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const spot = id => SPOTS.find(s => s.id === id);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

let S = null;            // server state, or null when signed out
let MODELS = {};         // building id -> { file, credit } for the 3D models that exist
let V = { tab: 'spots', filter: 'all', spot: null, bldg: null, floor: null, course: null, pin: 'reg', rating: false, rank: null, done: null,
  feed: 'friends', auth: 'signup', err: '', busy: false };
const invite = new URLSearchParams(location.search).get('add');

// ---------- Server ----------
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.error || 'Something went wrong.'); e.status = res.status; throw e; }
  return data;
}
let stream = null;
async function refresh() {
  try { S = await api('/api/state'); }
  catch (e) { if (e.status === 401) S = null; else return toast('Cannot reach the server. Retrying.'); }
  if (S && !stream) { stream = new EventSource('/api/events'); stream.onmessage = refresh; }
  if (!S && stream) { stream.close(); stream = null; }
  render(true);
}
// Send a change, then show the server's answer. Errors appear as a toast.
async function act(path, body) {
  try { await api(path, body); await refresh(); return true; }
  catch (e) { toast(e.message); return false; }
}
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500); }

// ---------- Derived ----------
const st = id => S.spots[id];
const ranked = () => [...SPOTS].sort((a, b) => (st(b.id).score ?? -1) - (st(a.id).score ?? -1) || a.name.localeCompare(b.name));
const place = s => { const i = ranked().indexOf(s); return st(s.id).score == null ? null : i + 1; };
const myScore = id => { const i = S.myRank.indexOf(id), n = S.myRank.length; return i < 0 ? null : n === 1 ? 10 : 10 - 5 * i / (n - 1); };
const fmt = x => x == null ? null : x.toFixed(1);
function ago(ms) {
  const s = Math.max(0, (S.now - ms) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : plural(Math.floor(s / 86400), 'day') + ' ago';
}
const hereLine = x => x.here ? `<i class="dot live"></i>${x.here} locked in${x.friendsHere.length ? ` · ${esc(x.friendsHere.join(', '))}` : ''}` : `<i class="dot off"></i>Nobody locked in`;
const scoreBox = (x, key) => x.score == null ? `<span class="score none">New</span>` : `<span class="score" ${key ? `data-n="s-${key}"` : ''}>${fmt(x.score)}</span>`;
// A two-or-more way switch whose highlight slides from where it was (`from`) to where it is.
const seg = (act, items, cur, label) => `<div class="seg" role="group" aria-label="${label}" style="--n:${items.length};--i:${Math.max(0, items.findIndex(k => k[0] === (segFrom[act] ?? cur)))}" data-i="${items.findIndex(k => k[0] === cur)}">${items.map(([k, l]) => `<button type="button" data-act="${act}" data-id="${k}" aria-pressed="${cur === k}">${l}</button>`).join('')}</div>`;
const segFrom = {};

// ---------- Views ----------
function spotRow(s) {
  const x = st(s.id), n = place(s);
  return `<button class="item" data-act="spot" data-id="${s.id}">
    <span class="n">${n ?? ''}</span>
    <span class="grow"><span class="name">${esc(s.name)}</span><span class="sub" data-n="h-${s.id}">${hereLine(x)}</span></span>${scoreBox(x, s.id)}</button>`;
}
function modelSlot(b) {
  return MODELS[b] ? `<div class="model" data-model="${b}"></div>` : '';
}
function viewSpots() {
  const list = ranked().filter(s => V.filter === 'all' || s.kind === V.filter);
  return `<div><h1 class="h1">Where UChicago locks in</h1><p class="sub">${plural(SPOTS.length, 'study spot')}, ranked head to head by the people who use them.</p></div>
    <div class="filters">${KINDS.map(k => `<button class="pill ${V.filter === k[0] ? 'on' : ''}" data-act="filter" data-id="${k[0]}" aria-pressed="${V.filter === k[0]}">${k[1]}</button>`).join('')}</div>
    <div class="list">${list.map(spotRow).join('')}</div>`;
}
function viewSpot() {
  const s = spot(V.spot), x = st(s.id), n = place(s), mine = myScore(s.id);
  const inSess = S.session && S.session.spot === s.id;
  const posts = S.posts.filter(p => p.spot === s.id);
  const val = k => V.rating ? (x.myRating?.[k] ?? x.meters?.[k] ?? 5) : x.meters?.[k];
  const mrows = METERS.map(([k, label, hint]) => V.rating
    ? `<div class="meter"><b>${label}</b><span class="v" id="out-${k}">${fmt(Math.round(val(k) * 2) / 2)}</span>
        <input type="range" id="rate-${k}" min="0" max="10" step="0.5" value="${Math.round(val(k) * 2) / 2}" data-k="${k}" aria-label="${label}"><span class="hint">${hint}</span></div>`
    : `<div class="meter"><b>${label}</b><span class="v" data-n="m-${k}">${fmt(val(k)) ?? 'No ratings'}</span>
        <div class="bar"><i style="width:${(val(k) ?? 0) * 10}%;--d:${METERS.findIndex(m => m[0] === k) * 70}ms"></i></div><span class="hint">${hint}</span></div>`).join('');
  return `<button class="back" data-act="back">‹ Back</button>
    ${modelSlot(s.bldg)}
    <div><p class="code">${s.code}</p><h1 class="h1">${esc(s.name)}</h1><p class="sub">${esc(s.where)}</p></div>
    <div class="row"><span class="big" ${x.score == null ? '' : `data-count="${x.score}"`}>${fmt(x.score) ?? '–'}</span>
      <span class="grow sub">${n ? `#${n} on campus, from ${plural(x.rankers, 'ranking')}` : 'Nobody has ranked it yet. Be the first.'}${mine ? `<br>Your score: <b>${fmt(mine)}</b>` : ''}</span></div>
    <p class="lead">${esc(s.note)}</p>
    <div class="wrap">${s.tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>
    <div class="row"><button class="btn pri grow" data-act="${inSess ? 'end' : 'lockin'}" data-id="${s.id}">${inSess ? 'End session' : 'Lock in here'}</button>
      <button class="btn grow" data-act="rank" data-id="${s.id}">${mine ? 'Rank it again' : 'Rank this spot'}</button></div>
    <div class="card stack"><h2 class="h2">Right now</h2><p data-n="now">${hereLine(x)}</p></div>
    <div class="card stack"><div class="row"><h2 class="h2 grow">Vibe meters</h2>
      <button class="btn sm" data-act="${V.rating ? 'saverate' : 'rate'}">${V.rating ? 'Save my rating' : x.myRating ? 'Change my rating' : 'Rate the vibes'}</button></div>
      ${mrows}<p class="small">${x.raters ? `Averaged from ${plural(x.raters, 'rating')}.` : 'No ratings yet.'}</p></div>
    <div class="card stack"><h2 class="h2">Baddie counter</h2>
      <div class="gem"><span class="count" data-n="gem">${x.gems}</span><span class="grow sub">rare ${x.gems === 1 ? 'gem' : 'gems'} spotted here today</span>
        <button class="btn sm ${x.gemmed ? '' : 'pri'}" data-act="gem" data-id="${s.id}">${x.gemmed ? 'Counted' : 'Spotted one'}</button></div>
      <p class="small">A count only. No names, photos or descriptions, ever.</p></div>
    <button class="btn" data-act="bldg" data-id="${s.bldg}">Open ${esc(BLDG[s.bldg][3])}</button>
    <h2 class="h2">Posts about this spot</h2>
    ${posts.length ? `<div class="list">${posts.map(postRow).join('')}</div>` : `<p class="sub">Nothing yet. Post from the Feed tab and tag this spot.</p>`}`;
}
function viewMap() {
  const sel = V.pin, here = id => SPOTS.filter(s => s.bldg === id).reduce((n, s) => n + st(s.id).here, 0);
  const streets = [[20, 84, 340, 84, '57th St'], [20, 240, 340, 240, '59th St'], [20, 304, 340, 304, '60th St'], [20, 364, 340, 364, '61st St']];
  const aves = [[84, 30, 84, 400, 'Ellis'], [222, 30, 222, 400, 'University'], [296, 30, 296, 400, 'Woodlawn']];
  // Where each name sits around its pin, so neighbours do not print over each other.
  const side = { man: 'l', reg: 'r', rey: 'a' };
  const pins = Object.entries(BLDG).map(([id, [name, x, y]]) => { const n = here(id), r = n ? 13 : 8, at = side[id] || 'b';
    const lx = at === 'l' ? x - r - 5 : at === 'r' ? x + r + 5 : x, ly = at === 'a' ? y - r - 9 : at === 'b' ? y + r + 11 : y, anchor = at === 'l' ? 'end' : at === 'r' ? 'start' : 'middle';
    return `<g class="pin ${id === sel ? 'sel' : ''} ${n ? 'live' : ''}" style="--d:${Math.round(y / 2.4)}ms" data-act="pin" data-id="${id}" tabindex="0" role="button" aria-label="${name}, ${n} locked in" aria-pressed="${id === sel}">
    <circle class="hit" cx="${x}" cy="${y}" r="20"></circle>${n ? `<circle class="ping" cx="${x}" cy="${y}" r="13"></circle>` : ''}<circle class="d" cx="${x}" cy="${y}" r="${r}"></circle>${n ? `<text class="c" x="${x}" y="${y}">${n}</text>` : ''}
    <text class="pn" x="${lx}" y="${ly}" text-anchor="${anchor}">${name}</text></g>`; }).join('');
  const inB = ranked().filter(s => s.bldg === sel);
  return `<div><h1 class="h1">Campus map</h1><p class="sub">The number on a building is how many people are locked in there now. Tap one to see it.</p></div>
    <svg class="map" viewBox="0 0 360 420" role="group" aria-label="Sketch map of campus study buildings">
      <rect class="green" x="20" y="250" width="320" height="44" rx="4"></rect><rect class="green" x="92" y="92" width="122" height="140" rx="4"></rect>
      ${streets.map(l => `<line class="st" x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}"></line><text class="lbl" x="338" y="${l[1] - 8}" text-anchor="end">${l[4]}</text>`).join('')}
      ${aves.map(l => `<line class="st" x1="${l[0]}" y1="${l[1]}" x2="${l[2]}" y2="${l[3]}"></line><text class="lbl" x="${l[0] + 8}" y="26">${l[4]}</text>`).join('')}
      <text class="lbl" x="150" y="276" text-anchor="middle">MIDWAY PLAISANCE</text><text class="lbl" x="206" y="204" text-anchor="end">MAIN QUAD</text>
      ${pins}</svg>
    <p class="small">A sketch: the buildings are in the right order, the distances are not to scale.</p>
    <div class="row"><h2 class="h2 grow">${esc(BLDG[sel][3])}</h2><button class="btn sm" data-act="bldg" data-id="${sel}">Open building</button></div>
    ${modelSlot(sel)}
    <div class="list">${inB.map(spotRow).join('')}</div>`;
}
function viewBldg() {
  const b = FLOORS[V.bldg], all = ranked().filter(s => s.bldg === V.bldg), credit = MODELS[V.bldg]?.credit;
  let floors = '';
  if (b) {
    const fl = V.floor || b.start, zones = b.f[fl];
    const svg = zones.map(z => { const s = z[5] && spot(z[5]), x = s && st(s.id);
      return `<g ${s ? `data-act="spot" data-id="${s.id}" tabindex="0" role="button" aria-label="${esc(s.name)}"` : ''}>
        <rect class="z ${s ? 'hot' : ''}" x="${z[1]}" y="${z[2]}" width="${z[3]}" height="${z[4]}" rx="6"></rect>
        <text x="${z[1] + 8}" y="${z[2] + 19}">${esc(z[0])}</text>
        ${s ? `<text class="s" x="${z[1] + 8}" y="${z[2] + 35}">${fmt(x.score) ?? 'New'} · ${x.here} here</text>` : ''}</g>`; }).join('');
    floors = `<div class="row"><h2 class="h2">Floor</h2><div class="floors">${b.order.map(f => `<button class="${f === fl ? 'on' : ''}" data-act="floor" data-id="${f}" aria-pressed="${f === fl}">${f}</button>`).join('')}</div></div>
      <svg class="map floor" viewBox="0 0 320 200" role="group" aria-label="Floor ${fl} sketch"><rect class="out" x="10" y="10" width="300" height="180" rx="10"></rect>${svg}</svg>
      <p class="small">A hand sketch of where things are, not a surveyed floor plan. Tap a red area to open that spot.</p>`;
  }
  return `<button class="back" data-act="back">‹ Back</button>
    <div><h1 class="h1">${esc(BLDG[V.bldg][3])}</h1><p class="sub">${plural(all.length, 'rated spot')} inside.</p></div>
    ${modelSlot(V.bldg)}
    ${credit ? `<p class="small">3D model made with Hunyuan3D from <a class="textlink" href="${esc(credit.page)}" target="_blank" rel="noopener">a photograph by ${esc(credit.artist)}</a> (${esc(credit.license)}). It shows the outside only, and the sides the photo did not see are the model's guess.</p>` : ''}
    ${floors}
    <h2 class="h2">Spots here</h2>
    <div class="list">${all.map(spotRow).join('')}</div>`;
}
const ARROW = { 1: 'M6 15l6-6 6 6', '-1': 'M6 9l6 6 6-6' };
function postRow(p) {
  const s = p.spot && spot(p.spot), v = (d, label) => `<button class="${p.myVote === d ? 'on' : ''}" data-act="vote" data-id="${p.id}" data-d="${d}" aria-label="${label}" aria-pressed="${p.myVote === d}"><svg viewBox="0 0 24 24"><path d="${ARROW[d]}"></path></svg></button>`;
  return `<div class="post" data-pid="${p.id}"><div class="votes">${v(1, 'Upvote')}<span data-n="v-${p.id}">${p.votes}</span>${v(-1, 'Downvote')}</div>
    <div class="grow"><p class="meta"><span class="who">${esc(p.by)}${p.mine ? ' (you)' : ''}</span><span>${ago(p.created)}</span>
      ${p.audience === 'friends' ? '<span class="only">Friends only</span>' : ''}
      ${s ? `<button class="link" data-act="spot" data-id="${s.id}">${esc(s.name)}</button>` : ''}</p>
      <p class="body">${esc(p.text)}</p>
      ${p.mine ? `<button class="link small" data-act="delpost" data-id="${p.id}">Delete</button>` : ''}</div></div>`;
}
function viewFeed() {
  const friends = V.feed === 'friends';
  const posts = S.posts.filter(p => !friends || p.mine || p.friend || p.audience === 'friends');
  const none = friends
    ? (S.friends.length ? 'Your friends have not posted yet. Say something first.' : 'Add a friend from the Me tab and their posts show up here.')
    : 'Nobody has posted yet. Say something first.';
  return `<div><h1 class="h1">The feed</h1><p class="sub">What people say about where they study.</p></div>
    <form class="card stack" id="postForm">
      <textarea id="postText" maxlength="240" placeholder="Say something about a spot" aria-label="Post text"></textarea>
      <div class="row"><select id="postSpot" class="grow" aria-label="Tag a spot"><option value="">No spot</option>${[...SPOTS].sort((a, b) => a.name.localeCompare(b.name)).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <select id="postAud" class="grow" aria-label="Who can see it"><option value="campus">Everyone on campus</option><option value="friends" ${friends ? 'selected' : ''}>Friends only</option></select></div>
      <div class="row"><label class="tog grow"><input type="checkbox" id="postAnon" ${S.me.anon ? 'checked' : ''}>Post as ${esc(S.me.handle)}</label>
        <button class="btn pri" type="submit">Post it</button></div></form>
    ${seg('feed', [['friends', 'Friends'], ['campus', 'Campus']], V.feed, 'Which posts')}
    ${posts.length ? `<div class="list">${posts.map(postRow).join('')}</div>` : `<p class="sub">${none}</p>`}`;
}
function viewClasses() {
  const count = c => S.resources.filter(r => r.course === c).length;
  if (V.course) {
    const c = COURSES.find(x => x[0] === V.course), s = spot(c[2]), items = S.resources.filter(r => r.course === c[0]).sort((a, b) => b.votes - a.votes);
    return `<button class="back" data-act="back">‹ Back</button>
      <div><p class="code">${c[0]}</p><h1 class="h1">${esc(c[1])}</h1></div>
      <button class="card row" data-act="spot" data-id="${s.id}"><span class="grow"><span class="small">Where this class studies</span><br><b>${esc(s.name)}</b></span>${scoreBox(st(s.id))}</button>
      <h2 class="h2">Shared by students</h2>
      ${items.length ? `<div class="list">${items.map(r => `<div class="post"><div class="votes"><button class="${r.voted ? 'on' : ''}" data-act="rvote" data-id="${r.id}" aria-label="Upvote" aria-pressed="${r.voted}"><svg viewBox="0 0 24 24"><path d="${ARROW[1]}"></path></svg></button><span data-n="rv-${r.id}">${r.votes}</span></div>
        <div class="grow"><p class="meta"><span class="who">${esc(r.kind)}</span><span>${esc(r.by)}${r.mine ? ' (you)' : ''}</span></p><p class="body">${esc(r.title)}</p>
        ${r.mine ? `<button class="link small" data-act="delres" data-id="${r.id}">Delete</button>` : ''}</div></div>`).join('')}</div>` : '<p class="sub">Nothing shared for this class yet.</p>'}
      <form class="card stack" id="resForm"><h2 class="h2">Share something you made</h2>
        <label class="f">What is it?<input type="text" id="resTitle" maxlength="120" placeholder="Midterm 1 review sheet"></label>
        <div class="row"><select id="resKind" class="grow" aria-label="Kind">${RES_KINDS.map(k => `<option>${k}</option>`).join('')}</select><button class="btn pri" type="submit">Share it</button></div>
        <label class="tog"><input type="checkbox" id="resAnon" ${S.me.anon ? 'checked' : ''}>Share as ${esc(S.me.handle)}</label>
        <p class="small">Your own work only. No exams, graded work or answer keys.</p></form>`;
  }
  return `<div><h1 class="h1">Classes</h1><p class="sub">Study guides, notes and tips, sorted by course.</p></div>
    <div class="list">${COURSES.map(c => `<button class="item" data-act="course" data-id="${c[0]}"><span class="grow"><span class="code">${c[0]}</span><span class="name">${esc(c[1])}</span></span>
      <span class="sub">${count(c[0])} shared</span></button>`).join('')}</div>`;
}
function viewMe() {
  const link = `${location.origin}/?add=${S.me.username}`;
  return `<div><h1 class="h1">${esc(S.me.name)}</h1><p class="sub">@${esc(S.me.username)}</p></div>
    <div class="stats"><div><b data-n="streak">${S.stats.streak}</b><span>day streak</span></div><div><b>${S.stats.weekHours.toFixed(1)}</b><span>hours this week</span></div><div><b>${S.myRank.length}</b><span>spots ranked</span></div></div>
    <div class="card stack"><label class="tog"><input type="checkbox" id="anonBox" ${S.me.anon ? 'checked' : ''}><span class="grow">Anonymous mode</span></label>
      <p class="small">${S.me.anon ? `On. New posts default to <b>${esc(S.me.handle)}</b>, and friends see a count where you lock in, not your name.` : 'Off. Friends see your name on posts, check-ins and the leaderboard.'}</p></div>
    <h2 class="h2">Friends</h2>
    ${S.incoming.length ? `<div class="list">${S.incoming.map(u => `<div class="item"><span class="grow"><span class="name">${esc(u.name)}</span><span class="sub">@${esc(u.username)} wants to be friends</span></span>
      <button class="btn sm pri" data-act="addfriend" data-id="${u.username}">Accept</button><button class="btn sm quiet" data-act="unfriend" data-id="${u.id}">Decline</button></div>`).join('')}</div>` : ''}
    <form class="card stack" id="friendForm"><label class="f">Add a friend by username<input type="text" id="friendName" autocapitalize="none" autocomplete="off" placeholder="their_username"></label>
      <div class="row"><button class="btn pri" type="submit">Send request</button><button class="btn" type="button" data-act="copy" data-id="${esc(link)}">Copy my invite link</button></div></form>
    ${S.friends.length || S.outgoing.length ? `<div class="list">
      ${S.friends.map(u => `<div class="item"><span class="grow"><span class="name">${esc(u.name)}</span><span class="sub">@${esc(u.username)}</span></span><button class="btn sm quiet" data-act="unfriend" data-id="${u.id}">Remove</button></div>`).join('')}
      ${S.outgoing.map(u => `<div class="item"><span class="grow"><span class="name">${esc(u.name)}</span><span class="sub">@${esc(u.username)} · request sent</span></span><button class="btn sm quiet" data-act="unfriend" data-id="${u.id}">Cancel</button></div>`).join('')}</div>`
      : '<p class="sub">No friends yet. Send your invite link to someone you study with.</p>'}
    <h2 class="h2">Most locked in this week</h2>
    <div class="list">${S.board.map((b, i) => `<div class="item"><span class="n">${i + 1}</span><span class="grow name">${esc(b.name)}${b.me ? ' (you)' : ''}</span><span class="code">${b.hours.toFixed(1)} h</span></div>`).join('')}</div>
    <p class="small">You and your friends. Friends in anonymous mode are left out.</p>
    <h2 class="h2">Your ranking</h2>
    ${S.myRank.length ? `<div class="list">${S.myRank.map((id, i) => `<button class="item" data-act="spot" data-id="${id}"><span class="n">${i + 1}</span><span class="grow name">${esc(spot(id).name)}</span><span class="score">${fmt(myScore(id))}</span></button>`).join('')}</div>`
      : '<p class="sub">Open a spot and choose “Rank this spot” to start your list.</p>'}
    <button class="btn" data-act="logout">Sign out</button>`;
}
function viewAuth() {
  const up = V.auth === 'signup';
  return `<div class="auth"><div class="stack">
      <h1 class="h1">Rank the places UChicago studies</h1>
      <p class="lead">${invite ? `<b>@${esc(invite)}</b> invited you. ` : ''}Lockr Study Spots is ${SPOTS.length} libraries, reading rooms and cafés, scored by the students who sit in them.</p>
      <ul><li>See which spots your friends are locked in at right now.</li><li>Post to friends only, or to campus under an anonymous handle.</li><li>Trade study guides and notes by class.</li></ul></div>
    <form class="card stack" id="authForm" novalidate>
      ${seg('auth', [['signup', 'Create account'], ['login', 'Sign in']], V.auth, 'Account')}
      ${up ? `<label class="f">Your name<input type="text" id="authName" maxlength="30" autocomplete="name" placeholder="Maya"></label>` : ''}
      <label class="f">Username<input type="text" id="authUser" maxlength="20" autocapitalize="none" autocomplete="username" placeholder="maya_k"></label>
      <label class="f">Password<input type="password" id="authPass" autocomplete="${up ? 'new-password' : 'current-password'}">${up ? '<span class="small">8 characters or more.</span>' : ''}</label>
      ${V.err ? `<p class="err" role="alert">${esc(V.err)}</p>` : ''}
      <button class="btn pri" type="submit" ${V.busy ? 'disabled' : ''}>${up ? 'Create my account' : 'Sign in'}</button>
    </form></div>`;
}

// ---------- Ranking: head-to-head picks place a spot in your list ----------
function sheet() {
  const el = $('sheet');
  if (V.done) {
    const s = spot(V.done), i = S.myRank.indexOf(s.id);
    el.innerHTML = `<div class="panel" role="dialog" aria-label="Ranked"><p class="small">Ranked</p><h2 class="h1">#${i + 1} of ${S.myRank.length} on your list</h2>
      <p>${esc(s.name)} gets a <b>${fmt(myScore(s.id))}</b> from you.</p><button class="btn pri" data-act="closesheet">Done</button></div>`;
  } else if (V.rank) {
    const a = spot(V.rank.id), b = spot(V.rank.list[(V.rank.lo + V.rank.hi) >> 1]);
    el.innerHTML = `<div class="panel" role="dialog" aria-label="Head to head"><p class="small">Head to head</p><h2 class="h1">Which is better to lock in at?</h2>
      <div class="vs"><button data-act="pick" data-d="new">${esc(a.name)}</button><button data-act="pick" data-d="old">${esc(b.name)}</button></div>
      <button class="btn" data-act="closesheet">Cancel</button></div>`;
  }
  const show = !!(V.rank || V.done);
  el.classList.toggle('opening', show && el.hidden);
  el.hidden = !show;
}
async function finishRank(list, id) { V.rank = null; if (await act('/api/rank', { list })) { V.done = id; render(true); } }
function startRank(id) {
  const list = S.myRank.filter(x => x !== id);
  V.done = null;
  if (!list.length) return finishRank([id], id);
  V.rank = { id, list, lo: 0, hi: list.length }; render(true);
}
function pick(d) {
  const r = V.rank, mid = (r.lo + r.hi) >> 1;
  if (d === 'new') r.hi = mid; else r.lo = mid + 1;
  if (r.lo >= r.hi) { r.list.splice(r.lo, 0, r.id); return finishRank(r.list, r.id); }
  render(true);
}

// ---------- The 3D building. One viewer per building is kept and moved into place, so a redraw does not reload it. ----------
const viewers = {};
let viewerLib;
function mountModels() {
  for (const slot of document.querySelectorAll('[data-model]')) {
    const id = slot.dataset.model;
    if (!viewers[id]) {
      viewerLib ||= import('./vendor/model-viewer.min.js');
      const m = viewers[id] = document.createElement('model-viewer');
      for (const [k, v] of Object.entries({ src: `models/${MODELS[id].file}`, alt: `3D model of ${BLDG[id][3]}`, 'camera-controls': '', 'auto-rotate': '', 'rotation-per-second': '12deg', 'auto-rotate-delay': '0',
        'interaction-prompt': 'none', 'shadow-intensity': '0.9', 'shadow-softness': '0.9', exposure: '1.05', 'tone-mapping': 'neutral', 'camera-orbit': '25deg 72deg auto', 'min-camera-orbit': 'auto 20deg auto', 'max-camera-orbit': 'auto 88deg auto', 'disable-pan': '' })) m.setAttribute(k, v);
    }
    viewers[id].addEventListener('load', () => viewers[id].classList.add('ready'), { once: true });
    slot.append(viewers[id]);
    slot.insertAdjacentHTML('beforeend', '<span class="how">Drag to turn</span>');
  }
}

// ---------- Render ----------
const TABS = [['spots', 'Spots', 'M4 6h16M4 12h16M4 18h10'], ['map', 'Map', 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'],
  ['feed', 'Feed', 'M4 5h16v11H9l-5 4z'], ['classes', 'Classes', 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11'], ['me', 'Me', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0']];
let lastHtml = '', seen = null, tabsBuilt = false, popKey = null;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
// Count a number up to its value once, when a screen is opened.
function countUp(el) {
  const to = +el.dataset.count, t0 = performance.now(), dur = 650;
  const step = t => { const k = Math.min(1, (t - t0) / dur); el.textContent = (to * (1 - Math.pow(1 - k, 3))).toFixed(1); if (k < 1 && el.isConnected) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// `keep` is false when the person went somewhere (the new screen enters) and true when only the data changed (nothing re-enters; changed numbers bump, new posts slide in).
function render(keep) {
  const view = $('view');
  const html = !S ? viewAuth() : V.spot ? viewSpot() : V.bldg ? viewBldg() : { spots: viewSpots, map: viewMap, feed: viewFeed, classes: viewClasses, me: viewMe }[V.tab]();
  if (html !== lastHtml) {
    // Keep what is being typed, and where the cursor is, across a redraw.
    const y = view.scrollTop, a = document.activeElement, focus = a && view.contains(a) && a.id ? [a.id, a.selectionStart, a.selectionEnd] : null;
    const typed = keep ? [...view.querySelectorAll('input[id], textarea[id], select[id]')].map(el => [el.id, el.type === 'checkbox' ? el.checked : el.value]) : [];
    const before = keep ? new Map([...view.querySelectorAll('[data-n]')].map(el => [el.dataset.n, el.textContent])) : null;
    view.classList.toggle('nav', !keep);
    view.dataset.dir = V.dir || 'fwd';
    view.innerHTML = lastHtml = html;
    for (const [id, v] of typed) { const el = $(id); if (el && el.type !== 'checkbox' && el.type !== 'range' && !id.startsWith('anon')) el.value = v; }
    if (focus && $(focus[0])) { const el = $(focus[0]); el.focus(); try { el.setSelectionRange(focus[1], focus[2]); } catch {} }
    view.scrollTop = keep ? y : 0;
    if (before) for (const el of view.querySelectorAll('[data-n]')) if (before.has(el.dataset.n) && before.get(el.dataset.n) !== el.textContent) el.classList.add('bump');
    if (!keep && !reduced.matches) view.querySelectorAll('[data-count]').forEach(countUp);
    // Posts that were not on any screen before arrive with a slide and a highlight.
    if (S) { const ids = S.posts.map(p => String(p.id)); if (seen) for (const el of view.querySelectorAll('.post[data-pid]')) if (!seen.has(el.dataset.pid)) el.classList.add('new'); seen = new Set([...(seen || []), ...ids]); } else seen = null;
    if (popKey) { view.querySelector(popKey)?.classList.add('pop'); popKey = null; }
    requestAnimationFrame(() => view.querySelectorAll('.seg[data-i]').forEach(el => el.style.setProperty('--i', el.dataset.i)));
    Object.keys(segFrom).forEach(k => delete segFrom[k]);
    mountModels();
  }
  V.dir = 'fwd';
  $('tabs').hidden = $('anonChip').hidden = !S;
  if (S) {
    // The tab bar is built once, so its highlight can slide between tabs.
    if (!tabsBuilt) { $('tabs').innerHTML = '<i class="ind" aria-hidden="true"></i>' + TABS.map(t => `<button data-act="tab" data-id="${t[0]}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${t[2]}"></path></svg>${t[1]}<span class="badge" hidden></span></button>`).join(''); tabsBuilt = true; }
    $('tabs').style.setProperty('--i', TABS.findIndex(t => t[0] === V.tab));
    for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-current', V.tab === b.dataset.id);
    const badge = $('tabs').querySelector('[data-id=me] .badge'); badge.hidden = !S.incoming.length; badge.textContent = S.incoming.length;
    $('anonChip').textContent = S.me.anon ? 'Anonymous: on' : 'Anonymous: off';
    $('anonChip').className = 'pill' + (S.me.anon ? ' on' : '');
    $('anonChip').setAttribute('aria-pressed', S.me.anon);
    if (S.session) $('sessName').textContent = spot(S.session.spot).name;
  }
  $('session').hidden = !(S && S.session);
  tick(); if (S) sheet(); else $('sheet').hidden = true;
}
function tick() {
  if (!S || !S.session) return;
  const s = Math.max(0, Math.floor((Date.now() - S.session.start) / 1000)), p = n => String(n).padStart(2, '0');
  $('sessTime').textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}`;
}
setInterval(tick, 1000);

// ---------- Events. A handler returns true to keep the scroll position. ----------
const go = fn => (...a) => { fn(...a); render(false); };
const stay = fn => (...a) => { fn(...a); render(true); };
const ACT = {
  tab: go(id => { V.tab = id; V.spot = V.bldg = V.course = null; V.rating = false; }),
  filter: stay(id => { V.filter = id; }),
  feed: stay(id => { segFrom.feed = V.feed; V.feed = id; }),
  auth: stay(id => { segFrom.auth = V.auth; V.auth = id; V.err = ''; }),
  spot: go(id => { V.spot = id; V.rating = false; }),
  back: go(() => { V.dir = 'back'; if (V.spot) { V.spot = null; V.rating = false; } else if (V.bldg) V.bldg = null; else V.course = null; }),
  pin: stay(id => { V.pin = id; }),
  bldg: go(id => { V.bldg = id; V.floor = null; V.spot = null; }),
  floor: stay(id => { V.floor = id; }),
  course: go(id => { V.course = id; }),
  rate: stay(() => { V.rating = true; }),
  closesheet: stay(() => { V.rank = V.done = null; }),
  rank: id => startRank(id),
  pick: (id, d) => pick(d),
  anon: () => act('/api/me', { anon: !S.me.anon }),
  lockin: id => act('/api/session/start', { spot: id }),
  end: () => act('/api/session/end', {}),
  saverate: async () => { const r = { spot: V.spot }; METERS.forEach(m => { r[m[0]] = +$('rate-' + m[0]).value; }); V.rating = false; await act('/api/rate', r); },
  gem: id => act('/api/gem', { spot: id }),
  vote: (id, d) => act('/api/posts/vote', { id: +id, d: S.posts.find(p => p.id === +id)?.myVote === +d ? 0 : +d }),
  delpost: id => act('/api/posts/delete', { id: +id }),
  rvote: id => act('/api/resources/vote', { id: +id }),
  delres: id => act('/api/resources/delete', { id: +id }),
  addfriend: name => act('/api/friends/add', { username: name }),
  unfriend: id => act('/api/friends/remove', { id: +id }),
  copy: async text => { try { await navigator.clipboard.writeText(text); toast('Invite link copied.'); } catch { toast(text); } },
  logout: async () => { await api('/api/logout', {}).catch(() => {}); V.tab = 'spots'; V.spot = V.bldg = V.course = null; await refresh(); },
};
$('app').addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  if (el.matches('.votes button, [data-act=gem]')) popKey = `[data-act="${el.dataset.act}"][data-id="${el.dataset.id}"]` + (el.dataset.d ? `[data-d="${el.dataset.d}"]` : '');
  ACT[el.dataset.act](el.dataset.id, el.dataset.d);
});
$('app').addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('g[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (e.key === 'Escape' && (V.rank || V.done)) ACT.closesheet();
});
$('app').addEventListener('input', e => { if (e.target.dataset.k) $('out-' + e.target.dataset.k).textContent = (+e.target.value).toFixed(1); });
$('app').addEventListener('change', e => { if (e.target.id === 'anonBox') act('/api/me', { anon: e.target.checked }); });
$('app').addEventListener('submit', async e => {
  e.preventDefault();
  const id = e.target.id, val = x => $(x).value.trim();
  if (id === 'authForm') {
    const up = V.auth === 'signup';
    V.busy = true; V.err = '';
    try {
      await api(up ? '/api/signup' : '/api/login', { username: val('authUser'), password: $('authPass').value, name: up ? val('authName') : undefined });
      if (invite) await api('/api/friends/add', { username: invite }).catch(() => {});
      history.replaceState(null, '', location.pathname);
    } catch (err) { V.err = err.message; }
    V.busy = false; lastHtml = '';
    await refresh();
  } else if (id === 'postForm') {
    if (!val('postText')) return $('postText').focus();
    if (await act('/api/posts', { text: val('postText'), spot: $('postSpot').value, audience: $('postAud').value, anon: $('postAnon').checked })) { $('postText').value = ''; lastHtml = ''; render(true); }
  } else if (id === 'resForm') {
    if (!val('resTitle')) return $('resTitle').focus();
    if (await act('/api/resources', { course: V.course, kind: $('resKind').value, title: val('resTitle'), anon: $('resAnon').checked })) { $('resTitle').value = ''; lastHtml = ''; render(true); }
  } else if (id === 'friendForm') {
    if (!val('friendName')) return $('friendName').focus();
    if (await act('/api/friends/add', { username: val('friendName') })) { $('friendName').value = ''; lastHtml = ''; render(true); toast('Request sent.'); }
  }
});

MODELS = await fetch('models/models.json').then(r => r.ok ? r.json() : {}).catch(() => ({}));
await refresh();
// Already signed in and opened an invite link: send the request straight away.
if (S && invite && invite !== S.me.username) { history.replaceState(null, '', location.pathname); if (await act('/api/friends/add', { username: invite })) toast(`Friend request sent to @${invite}.`); }
