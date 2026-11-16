const { DEMO, DELAY_MS, WINDOW_MS, lockStatus, profileStatus } = LockrLock;
const { normalizeUsername } = LockrPolicy;
const $ = (id) => document.getElementById(id);
let settings = { unlockRequestedAt: null, profiles: [] };

function fmt(ms) {
  const s = Math.ceil(ms / 1000);
  if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return s + 's';
}

function save(patch) {
  Object.assign(settings, patch);
  chrome.storage.local.set(patch, render);
}

function render() {
  const now = Date.now();
  const lock = lockStatus(settings.unlockRequestedAt, now);
  if (lock.state === 'locked') {
    $('status').textContent = 'Locked: messages only';
    $('detail').textContent = 'Full Instagram opens ' + fmt(DELAY_MS) + ' after you ask, for ' + fmt(WINDOW_MS) + '.';
    $('unlock').textContent = 'Request full access';
  } else if (lock.state === 'pending') {
    $('status').textContent = 'Full access in ' + fmt(lock.msLeft);
    $('detail').textContent = 'Still messages only until then.';
    $('unlock').textContent = 'Cancel request';
  } else {
    $('status').textContent = 'Full access open';
    $('detail').textContent = 'Locks again in ' + fmt(lock.msLeft) + '.';
    $('unlock').textContent = 'Lock now';
  }

  const list = $('profiles');
  list.textContent = '';
  for (const p of settings.profiles) {
    const li = document.createElement('li');
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = '@' + p.name;
    const wait = document.createElement('span');
    wait.className = 'wait';
    const st = profileStatus(p, now);
    wait.textContent = st.active ? '' : 'in ' + fmt(st.msLeft);
    const rm = document.createElement('button');
    rm.textContent = 'Remove';
    rm.onclick = () => save({ profiles: settings.profiles.filter((x) => x.name !== p.name) });
    li.append(who, wait, rm);
    list.append(li);
  }
  $('demo').textContent = DEMO ? 'Demo timings are on (short waits).' : '';
}

$('unlock').onclick = () => {
  const lock = lockStatus(settings.unlockRequestedAt, Date.now());
  save({ unlockRequestedAt: lock.state === 'locked' ? Date.now() : null });
};

$('add').onsubmit = (e) => {
  e.preventDefault();
  const name = normalizeUsername($('name').value);
  if (!name) return ($('error').textContent = 'That is not a valid username.');
  if (settings.profiles.some((p) => p.name === name)) return ($('error').textContent = 'Already on the list.');
  $('error').textContent = '';
  $('name').value = '';
  save({ profiles: [...settings.profiles, { name, addedAt: Date.now() }] });
};

chrome.storage.local.get(settings, (stored) => {
  settings = stored;
  render();
  setInterval(render, 1000);
});
