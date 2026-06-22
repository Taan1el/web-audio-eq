# Web Audio EQ

A lightweight Chrome (Manifest V3) extension that adds a real graphic equalizer
to any website's audio and video — SoundCloud, YouTube, Bandcamp, podcasts,
plain `<audio>`/`<video>`, anything that plays through the page.

Settings are global and persistent, and the EQ re-applies on every track change,
so your sound never resets between songs.

## Features

- **13-band graphic EQ** (25 Hz – 16 kHz) with a draggable response curve
- **Bass / Mid / Treble** shelves and a **Preamp** trim
- **Output volume** with a soft limiter to tame clipping on big boosts
- **Per-site on/off** — disable the EQ on sites you want left alone
- **Live spectrum visualizer** in the popup
- **Presets** for quick starting points
- Works in **all frames** and on **all sites** (`*://*/*`)

## How it works

The extension runs two cooperating scripts at `document_start`:

- `inject.js` runs in the page's own JavaScript world. Most players route audio
  through a single `AudioContext`, and some (notably SoundCloud) call
  `createMediaElementSource` on their own media element. An element can only be
  sourced once, so a second, competing `AudioContext` can never touch that audio.
  Instead, this script wraps `createMediaElementSource` and splices the EQ filter
  chain directly into the page's existing audio graph.
- `content.js` runs in the isolated extension world, owns settings + storage,
  and handles plain media elements that the page never sources itself. It also
  forwards settings to `inject.js` over `postMessage`.

Signal chain:

```
source → preamp → bass → mid → treble → 13 bands → volume → limiter → output
```

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select this folder
4. Pin the extension and open any site with audio

## Project layout

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest, content-script registration |
| `inject.js` | Main-world EQ splicer + detached-audio attacher |
| `content.js` | EQ engine for plain media, settings, storage bridge |
| `popup.html` / `popup.js` | Control panel: curve, sliders, presets, visualizer |
| `docs/equalizer-apo/` | Notes on an OS-level EQ fallback (EqualizerAPO) |

## Notes

This is a personal project. It uses only the `storage` permission and the host
access required to process audio on the pages you visit; it makes no network
requests and collects nothing.
