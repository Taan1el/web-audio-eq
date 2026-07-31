# Chrome Web Store listing

Copy-paste source for the developer dashboard, with each field's limit noted so
nothing gets silently truncated at submission.

---

## Name

*Limit: 75 characters. Currently 45.*

```
Web Audio EQ — 13-Band Equalizer for Any Site
```

## Short description

*Limit: 132 characters. Currently 120. This is the line shown in search results,
so it has to stand alone.*

```
A real 13-band graphic equalizer for any website's audio and video. Settings persist and re-apply on every track change.
```

## Category

Tools *(not Accessibility — the audio processing is the product; the keyboard
and screen-reader support is table stakes, not the pitch.)*

## Language

English

---

## Detailed description

*Limit: 16,000 characters. Plain text — the store strips markdown, so the
structure below relies on line breaks and dashes only.*

```
Most browser "equalizers" are a bass slider and a volume boost. This is an
actual graphic EQ: thirteen bands from 25 Hz to 16 kHz, each one adjustable
across a ±25 dB range by dragging its point on a response curve.

It works on any site that plays sound — SoundCloud, YouTube, Bandcamp, podcast
players, embedded video, plain audio and video tags. Your settings are global
and persistent, and the EQ re-applies itself every time the track changes, so
your sound never resets between songs.


WHAT YOU GET

- 13-band graphic EQ at ISO-standard centers, with a draggable response curve
- Bass, Mid and Treble shelves layered over the bands for quick broad shaping
- Preamp trim, so you can pull the input down before boosting and avoid clipping
- Output volume with a soft limiter that catches peaks on large boosts
- Live spectrum analyser behind the curve, so you can see what you are shaping
- Presets — save a curve, name it, recall it
- Per-site on/off, remembered per domain, for sites you would rather leave alone


THE SOUNDCLOUD PROBLEM

Most audio extensions fail on SoundCloud, and the reason is structural. A media
element can only be connected to the Web Audio API once. SoundCloud connects its
own player first, so any extension that arrives afterward and opens a second
audio context finds the door already closed, and silently does nothing.

This extension takes a different route: it splices its filter chain into the
page's existing audio graph rather than trying to build a competing one. That is
also why it can process audio that other tools cannot reach.


PRIVACY

No data collection. No analytics. No accounts. No servers.

The extension makes zero network requests — there are no remote fonts, scripts
or API calls, and you can confirm that yourself in the Network tab.

Your EQ settings are saved with Chrome's own storage, which means they follow
your Chrome profile between devices if you have sync turned on. Nobody else can
see them.

The extension requests access to all sites because audio processing has to
happen inside the page itself. That access is used for exactly one thing:
attaching the filter chain to the audio playing there. Page content is never
read, and browsing is never tracked. The source is public if you want to check.


ACCESSIBILITY

Everything is reachable from the keyboard. Tab to a band on the curve and use
the arrow keys to move it; Shift for coarse steps, Home to flatten that band.
The bands are exposed as labelled sliders, so a screen reader announces the
frequency and the gain in decibels.


BEFORE YOU START

Loud audio damages hearing and speakers, and a +25 dB boost is genuinely loud.
Raise levels gradually, and use the Preamp to pull the signal down before you
push a band up.

If a page was already open when you installed, refresh it — the extension has to
be present before the audio starts to reach it.
```

---

## Privacy practices (dashboard form)

The store requires a justification for each permission. Keep these in sync with
PRIVACY.md.

**Single purpose:**

```
Apply a user-configurable audio equalizer to sound played by web pages.
```

**Justification — `storage`:**

```
Saves the user's equalizer settings — band gains, tone controls, volume, saved
presets and the per-site on/off list — so they persist across browser restarts
instead of resetting on every page load.
```

**Justification — host permission (`*://*/*`):**

```
Audio processing must happen inside the page that is playing the audio: the Web
Audio API can only reach a media element from a script running in that page.
The extension therefore needs to run its content scripts wherever the user wants
the equalizer active, which is any site that plays sound. The access is used
only to attach the audio filter chain. No page content is read or transmitted.
```

**Remote code:** No, the extension does not use remote code.

**Data usage disclosures:** none of the categories apply. Nothing is collected,
transmitted, or sold.

---

## Assets checklist

| Asset | Size | Required | Notes |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | Yes | `icons/icon128.png` |
| Screenshot | 1280×800 or 640×400 PNG | Yes, at least 1 | The popup on a real site. 1280×800 looks far better in the listing. |
| Small promo tile | 440×280 PNG | Optional | Needed to be considered for featuring |
| Marquee promo tile | 1400×560 PNG | Optional | Featuring only |

Screenshots to take:

1. The popup open over SoundCloud, with a shaped curve and the spectrum running
   — the primary shot, and the one that has to sell the product on its own
2. The status line reading Active, showing the diagnostic actually works
3. A saved preset being recalled
4. The Guide tab, which shows the keyboard controls

Do not include a browser window frame or the surrounding desktop; crop tightly
to the popup with just enough page behind it to give context.

---

## Submission notes

- The zip is built by the `package` job in CI — download the artifact rather
  than zipping by hand, so the excluded files match every time.
- The upload must not contain `docs/`, `tools/`, `.github/` or the markdown
  files. They add review surface and provide nothing to a user.
- Review takes anywhere from a day to a couple of weeks. Broad host permissions
  attract a closer look, which is what the justification text above is for.
- A privacy policy URL is mandatory with these permissions. Point it at
  `PRIVACY.md` in the public repository.
