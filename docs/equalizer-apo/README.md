# EqualizerAPO — OS-level fallback (snapshot)

While debugging the extension's per-site conflicts on SoundCloud, a system-wide
EQ was set up with [EqualizerAPO](https://sourceforge.net/projects/equalizerapo/)
as a fallback. It applies a global bass boost at the OS mixer level, so it works
on SoundCloud regardless of any browser-extension conflict.

These files are a **copy** of the live config that lives at:
`C:\Program Files\EqualizerAPO\config\`

- `config.txt` — main config; flat GraphicEQ + `Include: bass_booster.txt`
- `bass_booster.txt` — low-shelf bass boost (LSC Fc 110 Hz, +6 dB, Q 0.7), -3 dB preamp headroom

The browser extension and EqualizerAPO are independent; either can EQ audio on
its own. The extension is per-tab/per-site and visual; EqualizerAPO is global.
