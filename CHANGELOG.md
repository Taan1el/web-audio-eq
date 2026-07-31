# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] — 2026-07-31

First release prepared for public distribution.

### Added

- Extension icons at 16/32/48/128, generated from `tools/make-icons.mjs` rather
  than committed as opaque binaries, so a change to the mark is a readable diff
- Keyboard control of the response curve: `Tab` to a band, arrows to move it
  (`Shift` for coarse, `PageUp`/`PageDown` for 5 dB), `Home` to flatten it
- Screen-reader support throughout — the band nodes are labelled sliders that
  announce their gain, the tab strip has proper tablist semantics, and the
  status line announces itself when it changes
- A percent readout under the volume fader
- `minimum_chrome_version: 111`, the version that introduced `world: "MAIN"`
  content scripts
- Repository checks in CI covering band-list drift, manifest consistency, icon
  freshness, and the no-network-requests guarantee
- LICENSE (Apache-2.0), PRIVACY.md, SECURITY.md, CONTRIBUTING.md and
  CODE_OF_CONDUCT.md

### Changed

- The popup was redesigned as a dark rack face: glass panels over a neutral
  chassis, a coral-to-violet gradient carrying the curve, spectrum and active
  states, a segmented tab strip, and a status pill with a state dot
- The layout now fits Chrome's 600px popup ceiling. It previously measured
  ~745px, which put the status line below the fold where nobody saw it
- dB gridlines are labelled every 10 dB instead of every 5; at the new plot
  height the full set collided into an unreadable stack

### Fixed

- **SoundCloud is processed again.** A media element can only be passed to
  `createMediaElementSource` once, and SoundCloud calls it on its own element
  first, so a second `AudioContext` could never reach that audio. The EQ chain
  is now spliced into the page's existing audio graph instead of competing with
  it
- Band centers moved to ISO-preferred values (25, 40, 80, 125, 200, 400, 630,
  1k, 2k, 3.15k, 5k, 10k, 16k) with `Q` matched to the resulting ~0.78-octave
  spacing. **Curves saved before this release will sound different** — the
  filters they were drawn against have moved

### Security

- Every setting is clamped on arrival at all four intake paths — storage read,
  `storage.onChanged`, runtime message and `postMessage`. `inject.js` runs in
  the page's world, so the page can send it anything; see SECURITY.md for why
  clamping rather than an origin check is the real boundary
- `postMessage` targets the page's own origin instead of `*`
- Console output is off unless `__eqDebug` is set, so the extension writes
  nothing to a page's console by default

## [1.1.0] — earlier

### Added

- Expanded from SoundCloud-only to all sites and all frames, covering both
  `<audio>` and `<video>`
- Per-site on/off, remembered across sessions
- Spectrum visualizer, Guide/About tabs, and a plain-language status line that
  names why audio isn't being processed
- A soft-limiter stage after the volume control, to tame clipping on large
  boosts

### Fixed

- A DOM flood caused by attaching to SoundCloud's pool of empty `Audio()`
  objects, which made tracks auto-skip
- Several status-line misreports: a frame race, a stale "waiting for playback"
  state, a false "blocked by another extension", and a permanent "stale hook"
  that came from trusting a `dataset` flag left behind by a previous session
- A playback stall caused by leaving the `AudioContext` suspended at hook time

## [1.0.0] — earlier

- Initial release: 13-band graphic EQ with bass/mid/treble/preamp for
  SoundCloud, re-applied on track change so settings survive between songs
