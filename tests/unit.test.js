const test = require('node:test');
const assert = require('node:assert');
const { classify, normalizeUsername } = require('../extension/src/policy.js');
const { DELAY_MS, WINDOW_MS, lockStatus, activeProfileNames } = require('../extension/src/lock.js');

const locked = { unlocked: false, profiles: new Set(['nasa']) };
const allowed = (p, ctx = locked) => classify(p, ctx).allow;

test('messages and account pages are allowed', () => {
  for (const p of ['/direct/inbox/', '/direct/t/123/', '/accounts/login/', '/challenge/abc/']) assert.ok(allowed(p), p);
});

test('feed, explore, reels and stories are blocked', () => {
  for (const p of ['/', '', '/explore/', '/explore/tags/cats/', '/reels/', '/reels/Cabc/', '/stories/friend/123/']) assert.ok(!allowed(p), p);
});

test('a single shared post or reel is allowed', () => {
  for (const p of ['/p/Cabc/', '/reel/Cabc/', '/friend/p/Cabc/', '/friend/reel/Cabc/']) assert.ok(allowed(p), p);
  assert.ok(!allowed('/p/'));
});

test('profiles are blocked unless allowlisted', () => {
  assert.ok(allowed('/nasa/'));
  assert.ok(allowed('/NASA/tagged/'));
  assert.ok(!allowed('/memepage/'));
  assert.ok(!allowed('/something/unknown/deep/'));
});

test('everything is allowed while the unlock window is open', () => {
  assert.ok(allowed('/explore/', { unlocked: true, profiles: new Set() }));
});

test('usernames are validated', () => {
  assert.strictEqual(normalizeUsername(' @Nasa/ '), 'nasa');
  assert.strictEqual(normalizeUsername('explore'), null);
  assert.strictEqual(normalizeUsername('reels'), null);
  assert.strictEqual(normalizeUsername('bad name'), null);
});

test('lock goes locked -> pending -> open -> locked', () => {
  const t = 1_000_000;
  assert.strictEqual(lockStatus(null, t).state, 'locked');
  assert.strictEqual(lockStatus(t, t).state, 'pending');
  assert.strictEqual(lockStatus(t, t + DELAY_MS - 1).state, 'pending');
  assert.strictEqual(lockStatus(t, t + DELAY_MS).state, 'open');
  assert.strictEqual(lockStatus(t, t + DELAY_MS + WINDOW_MS - 1).state, 'open');
  assert.strictEqual(lockStatus(t, t + DELAY_MS + WINDOW_MS).state, 'locked');
});

test('a new profile only becomes active after the delay', () => {
  const t = 1_000_000;
  const profiles = [{ name: 'nasa', addedAt: t }];
  assert.ok(!activeProfileNames(profiles, t + DELAY_MS - 1).has('nasa'));
  assert.ok(activeProfileNames(profiles, t + DELAY_MS).has('nasa'));
});
