// Enforcement. Runs on every instagram.com page before the page renders.
(function () {
  if (window.top !== window) return;
  const { lockStatus, activeProfileNames } = globalThis.LockrLock;
  const { classify, INBOX } = globalThis.LockrPolicy;
  const html = document.documentElement;

  // Fail closed: keep the page hidden until settings are loaded and the URL is checked.
  html.classList.add('lockr-checking');

  let settings = null;

  function enforce() {
    if (!settings) return;
    const now = Date.now();
    const unlocked = lockStatus(settings.unlockRequestedAt, now).state === 'open';
    const decision = classify(location.pathname, {
      unlocked,
      profiles: activeProfileNames(settings.profiles, now),
    });
    html.classList.toggle('lockr-on', !unlocked);
    if (decision.allow) {
      html.classList.remove('lockr-checking');
    } else {
      html.classList.add('lockr-checking');
      location.replace(INBOX);
    }
  }

  chrome.storage.local.get({ unlockRequestedAt: null, profiles: [] }, (stored) => {
    settings = stored;
    enforce();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !settings) return;
    for (const key of Object.keys(changes)) settings[key] = changes[key].newValue;
    enforce();
  });

  // Instagram changes pages without reloading, so the URL is re-checked continuously.
  // The timer also re-locks the page the moment an unlock window runs out.
  if (window.navigation) window.navigation.addEventListener('navigatesuccess', enforce);
  setInterval(enforce, 500);
})();
