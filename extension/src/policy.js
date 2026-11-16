// URL policy: decides whether an Instagram path may be shown.
// Default is deny. Anything not explicitly allowed goes back to the inbox.
(function (root) {
  const INBOX = '/direct/inbox/';

  // Messaging, plus the pages needed to log in and manage the account.
  const ALWAYS_ALLOWED = new Set([
    'direct', 'accounts', 'challenge', 'two_factor', 'auth_platform', 'oauth', 'legal',
  ]);

  // One specific post or reel, e.g. something a friend sent or tagged you in.
  // Note '/reel/<id>/' (one item) is allowed, '/reels/' (the endless feed) is not.
  const SINGLE_ITEM = new Set(['p', 'reel', 'tv']);

  // First path segments that are Instagram sections, never usernames.
  const RESERVED = new Set([
    ...ALWAYS_ALLOWED, ...SINGLE_ITEM,
    'explore', 'reels', 'stories', 'web', 'api', 'graphql', 'about', 'developer',
    'directory', 'emails', 'press', 'privacy', 'session', 'ads', 'your_activity',
  ]);

  function normalizeUsername(input) {
    const name = String(input || '').trim().replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
    if (!/^[a-z0-9._]{1,30}$/.test(name) || RESERVED.has(name)) return null;
    return name;
  }

  // ctx: { unlocked: boolean, profiles: Set<string> of active allowlisted usernames }
  function classify(pathname, ctx) {
    if (ctx && ctx.unlocked) return { allow: true, reason: 'unlock window is open' };

    const seg = String(pathname || '/').toLowerCase().split('/').filter(Boolean);
    if (seg.length === 0) return { allow: false, reason: 'home feed' };

    const first = seg[0];
    if (ALWAYS_ALLOWED.has(first)) return { allow: true, reason: 'messages or account page' };
    if (SINGLE_ITEM.has(first) && seg[1]) return { allow: true, reason: 'single post' };
    if (RESERVED.has(first)) return { allow: false, reason: 'blocked section: ' + first };

    // Otherwise the first segment is a username.
    if (SINGLE_ITEM.has(seg[1]) && seg[2]) return { allow: true, reason: 'single post' };
    if (ctx && ctx.profiles && ctx.profiles.has(first)) {
      return { allow: true, reason: 'allowlisted profile' };
    }
    return { allow: false, reason: 'profile not on your list' };
  }

  const api = { INBOX, classify, normalizeUsername };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LockrPolicy = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
