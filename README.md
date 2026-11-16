# Lockr

Instagram, messages only. A Chrome extension that keeps DMs and blocks the feed, Reels, Explore and Stories.

## Try it

1. Open `chrome://extensions`, turn on **Developer mode**.
2. Click **Load unpacked** and pick the `extension/` folder.
3. Go to instagram.com. You land in your inbox, and the feed links are gone.

Works in Chrome, Edge, Brave and Arc on a computer.

## How it decides

Every Instagram URL goes through one function, `classify()` in `extension/src/policy.js`. The default is to block.

| URL | Result |
|---|---|
| `/direct/...` | Allowed: messages |
| `/accounts/...`, login and security pages | Allowed |
| `/p/<id>/`, `/reel/<id>/` | Allowed: one post, e.g. shared in a DM or a mention |
| `/<username>/` on your allowed list | Allowed |
| `/`, `/explore/`, `/reels/`, `/stories/`, any other profile, anything unknown | Sent back to the inbox |

`extension/src/content.js` enforces it: the page stays hidden until the URL is approved, and the URL is re-checked twice a second because Instagram changes pages without reloading.

## The lock

Rules live in `extension/src/lock.js`.

- Full access is never instant. You request it, wait, get a short window, and it locks again by itself.
- A newly allowed profile waits the same delay before it works. Removing one is instant.
- `DEMO = true` uses a 1 minute wait and 2 minute window. Set it to `false` for 24 hours and 15 minutes.

## Tests

```bash
node --test tests/unit.test.js
```

```bash
node tests/e2e.js
```

The second one loads the extension into Chromium against a mock instagram.com. It has not been run against the real, logged-in site.

## Study Spots (the app)

A second project in this repo: rank UChicago study spots, see where friends are locked in, post to friends or to campus, and trade notes by class. `prototype/spots.html` was the first sketch with invented numbers; `app/` is the real one, where every score, count and post comes from people using it.

```bash
node app/server.mjs
```

Then open http://localhost:8787. It needs Node 22.13 or newer and nothing else: no packages to install. `PORT` changes the port, `LOCKR_DB` the database file (default `app/data/lockr.db`).

For friends on other phones to use it, the server has to run somewhere they can reach, over HTTPS, with a disk that survives restarts for the database file.

How it works:

- **Accounts.** Username and password. Passwords are stored as scrypt hashes, sign-in is an HttpOnly cookie.
- **Friends.** Add by username or share your invite link (`/?add=you`). The other person accepts.
- **Posts.** "Everyone on campus" or "Friends only". Friends-only posts go to accepted friends and nobody else. Any post can go out under your anonymous handle, which hides your name from friends too.
- **Live.** Open pages hold one event stream; when anything changes they reload their data, so a friend's post appears without a refresh.
- **Scores.** A spot's score is the average of what each person's head-to-head ranking gives it. Meters are averages of ratings. "Locked in" counts open check-ins; one nobody ends stops counting after 8 hours.
- **Anonymous mode** (on by default) keeps your name off check-ins and the friends leaderboard.

The 3D building models in `app/public/models/` are made with Tencent's Hunyuan3D from one photograph each:

```bash
HF_TOKEN=hf_xxx node tools/hunyuan3d.mjs photo.jpg raw.glb --v21
```

```bash
node tools/shrink-model.mjs raw.glb app/public/models/reg.glb
```

Then list the file and the photo's credit in `app/public/models/models.json`; a building with no entry shows no model. `--v21` uses the Hunyuan3D-2.1 demo, the one that textures. A free Hugging Face account's daily GPU allowance covers one textured model a day, so only Mansueto has one so far.

```bash
node --test tests/app.test.js
```

Not built yet: password reset, reporting or moderating posts, blocking a user. The course list and the floor sketches are hand-written and need checking against the real thing.
