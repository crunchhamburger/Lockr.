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
