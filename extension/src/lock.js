// Time-lock rules. Pure functions, shared by the content script, the popup and the tests.
(function (root) {
  // DEMO timings let you watch the lock work in a couple of minutes.
  // Set DEMO to false for real use: 24 hour wait, 15 minute window.
  const DEMO = true;
  const DELAY_MS = DEMO ? 60 * 1000 : 24 * 60 * 60 * 1000;
  const WINDOW_MS = DEMO ? 2 * 60 * 1000 : 15 * 60 * 1000;

  // Full access is never granted on the spot. A request opens a short window
  // only after DELAY_MS, then the lock closes again by itself.
  function lockStatus(requestedAt, now) {
    if (!requestedAt) return { state: 'locked' };
    const openAt = requestedAt + DELAY_MS;
    const closeAt = openAt + WINDOW_MS;
    if (now < openAt) return { state: 'pending', msLeft: openAt - now };
    if (now < closeAt) return { state: 'open', msLeft: closeAt - now };
    return { state: 'locked', expired: true };
  }

  // A newly added profile waits out the same delay, so the allowlist
  // cannot be used as an instant way around the block.
  function profileStatus(profile, now) {
    const activeAt = profile.addedAt + DELAY_MS;
    return now >= activeAt ? { active: true } : { active: false, msLeft: activeAt - now };
  }

  function activeProfileNames(profiles, now) {
    return new Set((profiles || []).filter((p) => profileStatus(p, now).active).map((p) => p.name));
  }

  const api = { DEMO, DELAY_MS, WINDOW_MS, lockStatus, profileStatus, activeProfileNames };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LockrLock = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
