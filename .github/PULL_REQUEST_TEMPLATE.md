## What this changes

<!-- And why. The diff covers what; the why is the part that gets lost. -->

## How it was tested

CI can lint the code but cannot hear anything, so this part matters. Tick what
you actually tried:

- [ ] SoundCloud (the `createMediaElementSource` splice path)
- [ ] YouTube (plain `<video>`, nested frames)
- [ ] A bare `<audio>` tag
- [ ] Skipped to the next track and confirmed the EQ still applied
- [ ] Popup keyboard path: Tab to a band, arrows move it, value announced

Browser and version:

## Checklist

- [ ] `BANDS` and `Q` are still identical across `content.js`, `inject.js` and
      `popup.js` (or were changed in all three together)
- [ ] Any new setting is clamped on every intake path
- [ ] The popup still measures under 600px tall
- [ ] No new network requests, remote fonts, or dependencies
