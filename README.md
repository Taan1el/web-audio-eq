# Web Audio EQ

A real 13-band graphic equalizer for any website's audio and video — SoundCloud,
YouTube, Bandcamp, podcasts, plain `<audio>` and `<video>`, anything that plays
through the page.

[![CI](https://github.com/Taan1el/web-audio-eq/actions/workflows/ci.yml/badge.svg)](https://github.com/Taan1el/web-audio-eq/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-4285F4.svg)](manifest.json)

Settings are global and persistent, and the EQ re-applies on every track change,
so your sound never resets between songs.

<!-- Replace with a real capture: the popup over SoundCloud, curve shaped, spectrum running. -->
<!-- ![The popup, showing a shaped response curve over a live spectrum](docs/screenshot.png) -->

## Features

- **13-band graphic EQ** at ISO centers (25 Hz – 16 kHz), ±25 dB, with a
  draggable response curve
- **Bass / Mid / Treble** shelves and a **Preamp** trim
- **Output volume** with a soft limiter to tame clipping on big boosts
- **Per-site on/off** — disable the EQ on sites you want left alone
- **Live spectrum visualizer** behind the curve
- **Presets** for quick starting points
- **Fully keyboard-operable**, with the bands exposed as labelled sliders
- Works in **all frames** and on **all sites** (`*://*/*`)

## Install

### From source (unpacked)

1. Clone or download this repository
2. Open `chrome://extensions`
3. Turn on **Developer mode** (top right)
4. Click **Load unpacked** and select the folder
5. Pin the extension, then open a site with audio and press play

Requires Chrome 111 or later — that is the version that introduced the
main-world content scripts this depends on.

### From the Chrome Web Store

Not yet published. See [`docs/store-listing.md`](docs/store-listing.md) for the
prepared listing.

## Using it

Drag any point on the curve to boost or cut that band. The fader on the left is
output volume; the four sliders underneath are broad shelves layered on top of
the thirteen bands.

Everything works from the keyboard:

| Key | Action |
| --- | --- |
| `Tab` | Move to the next band |
| `←` `→` | Move between bands |
| `↑` `↓` | Adjust by 0.5 dB |
| `Shift` + `↑` `↓` | Adjust by 2 dB |
| `PageUp` / `PageDown` | Adjust by 5 dB |
| `Home` | Flatten this band |
| `End` | Jump to the limit |

> **Loud audio damages hearing and speakers.** A +25 dB boost is genuinely loud.
> Raise levels gradually, and use the Preamp to pull the signal down before
> pushing a band up.

## How it works

Two scripts cooperate, both at `document_start`:

- **`inject.js`** runs in the page's own JavaScript world. Most players route
  audio through a single `AudioContext`, and some — SoundCloud among them — call
  `createMediaElementSource` on their own media element. An element can only be
  sourced once, so a second, competing `AudioContext` can never touch that
  audio. This script wraps `createMediaElementSource` and splices the filter
  chain directly into the page's existing graph instead of building a rival one.
- **`content.js`** runs in the isolated extension world. It owns settings and
  storage, handles plain media elements the page never sources itself, and
  forwards settings to `inject.js` over `postMessage`.

Signal chain:

```
source → preamp → bass → mid → treble → 13 bands → volume → limiter → output
```

Running in the page's world is what makes the SoundCloud case work, and it also
means the page can see everything `inject.js` exposes. That trade-off, and the
clamping that bounds it, is written up in [SECURITY.md](SECURITY.md).

## Troubleshooting

**Read the status line at the bottom of the popup first.** It names the problem
in plain language, and it keeps re-checking rather than reporting a stale state.

| Status | What to do |
| --- | --- |
| *Not running on this tab* | The page loaded before the extension did. Hard-refresh with `Ctrl+Shift+R`, then reopen the popup. |
| *Blocked: another audio extension grabbed the sound* | Two extensions cannot both process the same audio. Disable the other one and refresh. |
| *Waiting for playback* | Nothing is playing yet. Press play. |
| *Stale audio hook from an old tab session* | Close the tab entirely with `Ctrl+W` and open the site in a new one. |

For anything else, turn on the trace — run `localStorage.setItem("__eqDebug", "1")`
in the page console, hard-refresh, and the `[EQ]` lines will show what it found
and what it hooked. Include that output in a bug report.

## Development

No build step and no dependencies. The repository is the extension.

```sh
node tools/check.mjs        # band-list parity, manifest consistency, no remote assets
node tools/make-icons.mjs   # re-render icons/ from source
```

After editing `content.js` or `inject.js`, reload the extension **and**
hard-refresh the page — both run at `document_start`, so a page loaded earlier
keeps the old copy. Popup changes only need the popup reopened.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the constraints worth knowing before
changing anything, including the ones that fail silently.

## Project layout

| Path | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, content-script registration |
| `inject.js` | Main-world EQ splicer + detached-audio attacher |
| `content.js` | EQ engine for plain media, settings, storage bridge |
| `popup.html` / `popup.js` | Control panel: curve, sliders, presets, visualizer |
| `tools/check.mjs` | Repository invariant checks, also run by CI |
| `tools/make-icons.mjs` | Renders `icons/` from code, so the mark is a diff |
| `docs/store-listing.md` | Chrome Web Store copy and submission checklist |
| `docs/equalizer-apo/` | Notes on an OS-level EQ fallback (EqualizerAPO) |

## Privacy

No data collection, no analytics, no servers, and zero network requests. Your
settings live in Chrome's own `storage.sync` and nowhere else. Full detail in
[PRIVACY.md](PRIVACY.md).

## License

[Apache-2.0](LICENSE)
