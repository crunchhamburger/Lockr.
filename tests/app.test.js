// Server tests for the study spots app: accounts, friends, who sees which post, scores.
//   node --test tests/app.test.js
const test = require('node:test');
const assert = require('node:assert');

let createApp, rankScore;
test.before(async () => { ({ createApp, rankScore } = await import('../app/server.mjs')); });

async function start(opts) {
  const server = createApp(opts);
  await new Promise(r => server.listen(0, r));
  const base = `http://localhost:${server.address().port}`;
  const person = () => {
    let cookie = '';
    const call = async (path, body) => {
      const res = await fetch(base + path, body === undefined ? { headers: { cookie } } : { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(body) });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json() };
    };
    return { call, state: async () => (await call('/api/state')).body };
  };
  const signup = async (username, name = username) => { const p = person(); const r = await p.call('/api/signup', { username, name, password: 'correct horse' }); assert.equal(r.status, 200); return p; };
  return { base, person, signup, close: () => new Promise(r => { server.closeAllConnections(); server.close(r); }) };
}
const befriend = async (a, b, aName, bName) => { await a.call('/api/friends/add', { username: bName }); await b.call('/api/friends/add', { username: aName }); };

test('nothing is readable without signing in', async () => {
  const app = await start();
  assert.equal((await app.person().call('/api/state')).status, 401);
  assert.equal((await app.person().call('/api/posts', { text: 'hi' })).status, 401);
  await app.close();
});

test('sign up, sign in, wrong password, taken name', async () => {
  const app = await start();
  await app.signup('maya_k', 'Maya');
  const again = await app.person().call('/api/signup', { username: 'Maya_K', name: 'x', password: 'correct horse' });
  assert.equal(again.status, 409);
  const short = await app.person().call('/api/signup', { username: 'dev', name: 'Dev', password: 'short' });
  assert.equal(short.status, 400);
  const p = app.person();
  assert.equal((await p.call('/api/login', { username: 'maya_k', password: 'nope nope' })).status, 401);
  assert.equal((await p.call('/api/login', { username: '@Maya_K', password: 'correct horse' })).status, 200);
  assert.equal((await p.state()).me.name, 'Maya');
  await p.call('/api/logout', {});
  assert.equal((await p.call('/api/state')).status, 401);
  await app.close();
});

test('a friends post reaches friends and nobody else', async () => {
  const app = await start();
  const maya = await app.signup('maya', 'Maya'), dev = await app.signup('dev', 'Dev'), stranger = await app.signup('stranger');
  await maya.call('/api/friends/add', { username: 'dev' });
  assert.deepEqual((await dev.state()).incoming.map(u => u.username), ['maya']);
  await maya.call('/api/posts', { text: 'crerar tonight', spot: 'crerar', audience: 'friends', anon: false });
  assert.equal((await dev.state()).posts.length, 0, 'a pending request is not a friend yet');
  await dev.call('/api/friends/add', { username: 'maya' });
  const seen = (await dev.state()).posts;
  assert.equal(seen.length, 1);
  assert.deepEqual([seen[0].by, seen[0].friend, seen[0].audience, seen[0].spot], ['Maya', true, 'friends', 'crerar']);
  assert.equal((await stranger.state()).posts.length, 0);
  assert.equal((await stranger.call('/api/posts/vote', { id: seen[0].id, d: 1 })).status, 404, 'a stranger cannot vote on what they cannot see');
  await dev.call('/api/friends/remove', { id: (await dev.state()).friends[0].id });
  assert.equal((await dev.state()).posts.length, 0, 'unfriending hides it again');
  await app.close();
});

test('an anonymous campus post hides the name from everyone, friends included', async () => {
  const app = await start();
  const maya = await app.signup('maya', 'Maya'), dev = await app.signup('dev', 'Dev');
  await befriend(maya, dev, 'maya', 'dev');
  await maya.call('/api/posts', { text: 'where fun comes to die', audience: 'campus', anon: true });
  const p = (await dev.state()).posts[0];
  assert.match(p.by, /^anon /);
  assert.equal(p.friend, false);
  assert.ok(!JSON.stringify(p).includes('Maya'));
  assert.equal((await maya.state()).posts[0].mine, true);
  await app.close();
});

test('votes add up and only the author can delete', async () => {
  const app = await start();
  const a = await app.signup('aaa'), b = await app.signup('bbb');
  await a.call('/api/posts', { text: 'hello' });
  const id = (await a.state()).posts[0].id;
  await a.call('/api/posts/vote', { id, d: 1 }); await b.call('/api/posts/vote', { id, d: 1 }); await b.call('/api/posts/vote', { id, d: -1 });
  assert.equal((await a.state()).posts[0].votes, 0);
  await b.call('/api/posts/delete', { id });
  assert.equal((await a.state()).posts.length, 1);
  await a.call('/api/posts/delete', { id });
  assert.equal((await a.state()).posts.length, 0);
  await app.close();
});

test('bad posts are refused', async () => {
  const app = await start();
  const a = await app.signup('aaa');
  assert.equal((await a.call('/api/posts', { text: '   ' })).status, 400);
  assert.equal((await a.call('/api/posts', { text: 'x'.repeat(241) })).status, 400);
  assert.equal((await a.call('/api/posts', { text: 'ok', spot: 'not-a-spot' })).status, 400);
  const form = await fetch(app.base + '/api/posts', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'text=hi' });
  assert.equal(form.status, 415);
  await app.close();
});

test('scores come from rankings, meters from ratings', async () => {
  const app = await start();
  const a = await app.signup('aaa'), b = await app.signup('bbb');
  assert.equal(rankScore(0, 3), 10); assert.equal(rankScore(2, 3), 5); assert.equal(rankScore(0, 1), 10);
  await a.call('/api/rank', { list: ['mansueto', 'crerar', 'exlibris'] });
  await b.call('/api/rank', { list: ['crerar', 'mansueto'] });
  let s = (await a.state()).spots;
  assert.equal(s.mansueto.score, 7.5); assert.equal(s.crerar.score, 8.75); assert.equal(s.exlibris.score, 5); assert.equal(s.harper.score, null);
  assert.equal((await a.call('/api/rank', { list: ['mansueto', 'mansueto'] })).status, 400);
  await a.call('/api/rate', { spot: 'crerar', lockin: 9, larp: 2, yap: 1, outlets: 8 });
  await b.call('/api/rate', { spot: 'crerar', lockin: 7, larp: 4, yap: 3, outlets: 6 });
  s = (await b.state()).spots;
  assert.deepEqual(s.crerar.meters, { lockin: 8, larp: 3, yap: 2, outlets: 7 });
  assert.equal(s.crerar.raters, 2); assert.equal(s.crerar.myRating.lockin, 7);
  assert.equal((await a.call('/api/rate', { spot: 'crerar', lockin: 11, larp: 2, yap: 1, outlets: 8 })).status, 400);
  await app.close();
});

test('locking in counts for everyone, names only for friends who are not anonymous', async () => {
  let t = Date.parse('2026-11-16T18:00:00Z');
  const app = await start({ now: () => t });
  const maya = await app.signup('maya', 'Maya'), dev = await app.signup('dev', 'Dev'), stranger = await app.signup('stranger');
  await befriend(maya, dev, 'maya', 'dev');
  await maya.call('/api/session/start', { spot: 'reg5' });
  assert.equal((await stranger.state()).spots.reg5.here, 1);
  assert.deepEqual((await dev.state()).spots.reg5.friendsHere, [], 'Maya is anonymous by default');
  await maya.call('/api/me', { anon: false });
  assert.deepEqual((await dev.state()).spots.reg5.friendsHere, ['Maya']);
  assert.deepEqual((await stranger.state()).spots.reg5.friendsHere, []);
  t += 2 * 3600e3;
  await maya.call('/api/session/end', {});
  const m = await maya.state();
  assert.equal(m.session, null); assert.equal(m.stats.weekHours, 2); assert.equal(m.stats.streak, 1); assert.equal(m.spots.reg5.here, 0);
  assert.deepEqual((await dev.state()).board.map(b => [b.name, b.hours]), [['Maya', 2], ['Dev', 0]]);
  await dev.call('/api/session/start', { spot: 'harper' });
  t += 9 * 3600e3;
  assert.equal((await dev.state()).spots.harper.here, 0, 'a check-in nobody ended stops counting');
  await app.close();
});

test('the gem counter is one per person per day', async () => {
  const app = await start();
  const a = await app.signup('aaa'), b = await app.signup('bbb');
  await a.call('/api/gem', { spot: 'harper' }); await b.call('/api/gem', { spot: 'harper' });
  assert.equal((await a.state()).spots.harper.gems, 2);
  await a.call('/api/gem', { spot: 'harper' });
  const s = (await a.state()).spots.harper;
  assert.equal(s.gems, 1); assert.equal(s.gemmed, false);
  await app.close();
});

test('class resources are shared with everyone', async () => {
  const app = await start();
  const a = await app.signup('aaa', 'Ana'), b = await app.signup('bbb');
  await a.call('/api/resources', { course: 'MATH 15300', kind: 'Notes', title: 'Series tests on one page', anon: false });
  assert.equal((await a.call('/api/resources', { course: 'FAKE 101', kind: 'Notes', title: 'x' })).status, 400);
  const r = (await b.state()).resources[0];
  assert.deepEqual([r.by, r.course, r.votes], ['Ana', 'MATH 15300', 0]);
  await b.call('/api/resources/vote', { id: r.id });
  assert.equal((await a.state()).resources[0].votes, 1);
  await app.close();
});

test('the page is served and paths cannot climb out of it', async () => {
  const app = await start();
  const page = await fetch(app.base + '/');
  assert.equal(page.status, 200); assert.match(await page.text(), /Lockr Study Spots/);
  const res = await new Promise((resolve, reject) => require('node:http').get(app.base + '/..%2fserver.mjs', resolve).on('error', reject));
  assert.notEqual(res.statusCode, 200);
  await app.close();
});
