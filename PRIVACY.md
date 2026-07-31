# Privacy Policy

**Web Audio EQ collects nothing, sends nothing, and has no servers.**

Last updated: 2026-07-31

## What is collected

Nothing. There is no analytics, no telemetry, no crash reporting, no
advertising identifier, and no account.

## What is stored

Your EQ settings — band gains, tone shelves, preamp, volume, saved presets, and
the per-site on/off list — are written to `chrome.storage.sync`. That is
Chrome's own storage. If you are signed into Chrome it syncs between your
browsers through your Google account, exactly as your bookmarks do. The
extension author never sees it and has no way to.

Nothing else is stored. Audio is never recorded, buffered to disk, or
transmitted; it is processed in real time inside the tab and discarded.

## Network requests

The extension makes none. There are no remote fonts, no CDN scripts, and no API
calls. You can verify this: open DevTools on the popup, or on any page with the
extension running, and watch the Network tab.

## Permissions, and why each one exists

| Permission | Why |
| --- | --- |
| `storage` | Save your EQ settings so they survive a browser restart. |
| `*://*/*` (host access) | Audio processing happens inside the page. The Web Audio API can only reach a page's audio from a script running on that page, so the content scripts must be allowed to run on any site where you want the EQ to work. |

The host permission is broad because the feature is broad — "equalize any site"
requires access to any site. It is **not** used to read page content, track
browsing, or inject anything into the page beyond the audio filter chain. The
full source is in this repository; `content.js` and `inject.js` are the only
scripts that run on your pages, and they are short enough to read end to end.

## Third parties

There are none. Nothing is shared, sold, or disclosed, because nothing is
collected.

## Removing your data

Uninstalling the extension removes its `chrome.storage` data. To clear settings
without uninstalling, open the popup and use **Reset**, then delete any saved
presets.

## Changes

Material changes to this policy will be recorded in `CHANGELOG.md` and this
file's "Last updated" date.

## Contact

Open an issue on the GitHub repository.
