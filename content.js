// content.js — runs inside every website's page (and frames).
// Routes every <audio>/<video> element through a 13-band graphic EQ (Web Audio)
// and re-hooks every NEW media element a site creates on track change, so the
// EQ never resets between songs.

(() => {
  "use strict";

  // Center frequencies (Hz) for the 13 bands — matches the UI columns.
  const BANDS = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
  const Q = 1.4; // ~1 octave wide per band

  // ---- Settings (single source of truth) ----
  const DEFAULTS = {
    enabled: true,
    volume: 1.0,                 // linear output gain, 0..2 (the left slider)
    preamp: 0,                   // input trim, dB
    bass: 0,                     // low-shelf, dB
    mid: 0,                      // mid peaking, dB
    treble: 0,                   // high-shelf, dB
    gains: new Array(BANDS.length).fill(0), // per-band graph gain in dB, -25..+25
    siteEnabled: {}              // per-domain on/off map { host: bool }
  };
  let settings = { ...DEFAULTS, gains: DEFAULTS.gains.slice() };

  function dbToGain(db) { return Math.pow(10, db / 20); }

  const HOST = location.hostname;
  function siteOn(map) { return !map || map[HOST] !== false; } // default: on

  let audioCtx = null;
  const hooked = new WeakSet();  // media elements already wired
  const graphs = [];             // one filter graph per element (for live updates)

  function ensureCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  // Push current settings into one graph.
  function applyToGraph(g) {
    const on = settings.enabled;
    g.out.gain.value = settings.volume; // volume always applies
    g.preamp.gain.value = on ? dbToGain(settings.preamp) : 1;
    g.bass.gain.value   = on ? settings.bass   : 0;
    g.mid.gain.value    = on ? settings.mid    : 0;
    g.treble.gain.value = on ? settings.treble : 0;
    for (let i = 0; i < g.filters.length; i++) {
      const v = Array.isArray(settings.gains) ? (settings.gains[i] || 0) : 0;
      g.filters[i].gain.value = on ? v : 0;
    }
    if (on) {
      g.comp.threshold.value = -3;
      g.comp.ratio.value = 12;
    } else {
      g.comp.threshold.value = 0;
      g.comp.ratio.value = 1;
    }
  }

  // Wire one element: src -> preamp -> tone -> 13 bands -> volume -> limiter -> out.
  function hook(el) {
    if (!el || hooked.has(el)) return;
    hooked.add(el);
    const ctx = ensureCtx();
    const src = ctx.createMediaElementSource(el);

    const preamp = ctx.createGain();
    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf"; bass.frequency.value = 150;
    const mid = ctx.createBiquadFilter();
    mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 1;
    const treble = ctx.createBiquadFilter();
    treble.type = "highshelf"; treble.frequency.value = 4000;

    const filters = BANDS.map((freq) => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking";
      f.frequency.value = freq;
      f.Q.value = Q;
      f.gain.value = 0;
      return f;
    });

    const out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    src.connect(preamp);
    let node = preamp;
    [bass, mid, treble, ...filters, out].forEach((n) => {
      node.connect(n);
      node = n;
    });
    out.connect(comp);
    comp.connect(ctx.destination);

    const g = { preamp, bass, mid, treble, filters, out, comp };
    graphs.push(g);
    applyToGraph(g);
  }

  function scan() {
    document.querySelectorAll("audio,video").forEach(hook);
  }

  function resume() {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (!m.addedNodes) continue;
      m.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.tagName === "AUDIO" || n.tagName === "VIDEO") hook(n);
        else if (n.querySelectorAll) n.querySelectorAll("audio,video").forEach(hook);
      });
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(scan, 1500);
  scan();

  ["click", "keydown", "play"].forEach((ev) =>
    document.addEventListener(ev, resume, true)
  );

  // ---- Load saved settings ----
  // These are global (shared across sites); only `enabled` is per-domain.
  const GLOBAL_KEYS = ["volume", "preamp", "bass", "mid", "treble"];

  chrome.storage.sync.get(DEFAULTS, (saved) => {
    GLOBAL_KEYS.forEach((k) => { settings[k] = saved[k]; });
    settings.gains = Array.isArray(saved.gains) ? saved.gains.slice() : DEFAULTS.gains.slice();
    settings.enabled = siteOn(saved.siteEnabled); // per-site on/off
    graphs.forEach(applyToGraph);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    GLOBAL_KEYS.forEach((k) => { if (changes[k]) settings[k] = changes[k].newValue; });
    if (changes.gains) settings.gains = changes.gains.newValue;
    if (changes.siteEnabled) settings.enabled = siteOn(changes.siteEnabled.newValue);
    graphs.forEach(applyToGraph);
    resume();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "live") return;
    GLOBAL_KEYS.forEach((k) => { if (msg.patch[k] !== undefined) settings[k] = msg.patch[k]; });
    if (msg.patch.gains !== undefined) settings.gains = msg.patch.gains;
    if (msg.patch.enabled !== undefined) settings.enabled = msg.patch.enabled;
    graphs.forEach(applyToGraph);
    resume();
  });
})();
