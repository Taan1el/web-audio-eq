# Contributing

Thanks for taking a look. This is a small, dependency-free extension, so
getting set up takes about a minute.

## Running it locally

There is no build step. The repository *is* the extension.

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select this folder
4. After editing `content.js` or `inject.js`, click the reload icon on the
   extension card **and hard-refresh the page** (`Ctrl+Shift+R`). Both scripts
   run at `document_start`, so a page loaded before the reload keeps the old
   copy.

Editing `popup.html` / `popup.js` only requires closing and reopening the
popup.

### Debug logging

Both scripts are silent by default. To turn on the trace, run this in the
console of the page you are testing:

```js
localStorage.setItem("__eqDebug", "1");
```

Then hard-refresh. Set it to `"0"` or remove it to go quiet again.

## What to know before changing things

**The band list is duplicated in three files** — `content.js`, `inject.js` and
`popup.js` — and they must stay identical. There is no shared module because
the three run in three different worlds (isolated, main, and extension page)
and MV3 content scripts cannot import across that boundary without a build
step, which this project deliberately does not have. If you change `BANDS`,
change all three, and update `Q` to match the new spacing.

**Settings arriving from anywhere are untrusted.** `inject.js` runs in the
page's world, so the page can send it anything. Every intake path clamps.
If you add a setting, clamp it too — see `SECURITY.md` for why this is the real
boundary.

**The popup has a hard 600px height budget.** Chrome clips action popups past
that and the rest disappears behind a scrollbar. The current layout lands at
587px. If you add a control, something else has to give.

**No network requests, ever.** No remote fonts, no CDNs, no analytics. The
privacy policy makes this claim in writing, so a single `<link>` to Google
Fonts would make the project's own documentation false.

## Testing

There is no automated test suite; audio behaviour is hard to assert without a
browser. Before opening a PR, please check by hand:

- **SoundCloud** — the hard case. It sources its own media element, so it
  exercises the `createMediaElementSource` splice rather than the plain path.
- **YouTube** — plain `<video>`, and a different frame structure.
- **A bare `<audio>` tag** on a local HTML file — the simple path.
- **Track change** — skip to the next song and confirm the EQ still applies.
  This regressing is the single most common failure mode.
- **The popup keyboard path** — Tab to a band node, arrow it up and down, and
  confirm the value is announced and the audio follows.

CI runs a syntax check and a manifest lint; it cannot hear anything.

## Commit style

Small commits, each one a complete thought. Subject in the imperative under
~72 characters, prefixed `feat:` / `fix:` / `docs:` / `chore:` / `a11y:` /
`harden:`.

Bodies should explain **why**, not what — the diff already covers what. If a
change involved a non-obvious constraint (a Chrome version floor, a popup size
cap, a browser API that only works from one world), that constraint belongs in
the commit message, because that is where the next person will look for it.

## Pull requests

Say what you changed, how you tested it, and which sites you tried. Screenshots
help for anything visual. Draft PRs are welcome if you want a read before
finishing.
