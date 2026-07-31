# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem.

Use GitHub's private reporting instead: go to the **Security** tab of this
repository and choose **Report a vulnerability**. If that is unavailable, open
a normal issue that says only "security report, please make contact" with no
details, and a private channel will be arranged.

Expect an acknowledgement within a few days. This is a personal project with no
paid on-call, so please size your expectations accordingly — but reports will
be taken seriously and credited unless you ask otherwise.

## Supported versions

The latest release only. There are no maintenance branches.

## Threat model

Worth stating plainly, because it shapes what counts as a vulnerability.

`inject.js` runs in the **page's own JavaScript world**. This is required:
`AudioContext.prototype.createMediaElementSource` can only be wrapped from
inside the page, and without that wrap the EQ cannot reach audio from players
that source their own media element (SoundCloud among them).

The consequence is that **the page can see and call anything `inject.js`
exposes.** A hostile page can post fake settings messages at it. There is no
origin check that would help — the content script and the page share an origin
by construction, so a check cannot tell them apart.

The mitigation is that settings are *values*, not capabilities, and every value
is clamped on arrival in both `content.js` and `inject.js`: gains to ±25 dB,
tone and preamp to ±12 dB, volume to 0–2. A malicious page can therefore make
your audio sound wrong. It cannot use the extension to escalate privileges,
read your storage, or reach other tabs — those all live in the isolated world,
behind the extension boundary.

### In scope

- Escaping the page's world into extension privileges
- Reading or writing `chrome.storage` from a page
- Cross-origin leakage of settings or of any extension state
- Anything that lets a page reach another tab through the extension
- Audio output that exceeds the clamped gain limits (a real hearing risk)

### Out of scope

- A page changing your EQ curve. Documented above; clamped by design.
- Missing `web_accessible_resources` hardening — the extension declares none.
- Findings that require the user to install a second, hostile extension.

## Hardening already in place

- No remote code, no `eval`, no remote fonts or scripts of any kind
- Only the `storage` permission beyond host access
- All incoming settings clamped at every intake path (storage, `onChanged`,
  runtime message, and `postMessage`)
- `postMessage` calls are pinned to the page's own origin rather than `*`
- Debug logging is off unless explicitly enabled, so nothing is written to the
  page console by default
