// content.js — runs inside every soundcloud.com page.
// Routes every <audio> element through a 13-band graphic EQ (Web Audio) and
// re-hooks every NEW audio element SoundCloud creates on track change, so the
// EQ never resets between songs.

(() => {
  "use strict";

  // Center frequencies (Hz) for the 13 bands — matches the UI columns.
  const BANDS = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
  const Q = 1.4; // ~1 octave wide per band

  const DEFAULTS = {
    enabled: true,
    volume: 1.0,
    preamp: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    gains: new Array(BANDS.length).fill(0)
  };
  let settings = { ...DEFAULTS, gains: DEFAULTS.gains.slice() };

  function dbToGain(db) { return Math.pow(10, db / 20); }

  let audioCtx = null;
  const hooked = new WeakSet();
  const graphs = [];

  function ensureCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  function applyToGraph(g) {
    const on = settings.enabled;
    g.out.gain.value = settings.volume;
    g.preamp.gain.value = on ? dbToGain(settings.preamp) : 1;
    g.bass.gain.value   = on ? settings.bass   : 0;
    g.mid.gain.value    = on ? settings.mid    : 0;
    g.treble.gain.value = on ? settings.treble : 0;
    for (let i = 0; i < g.filters.length; i++) {
      const v = Array.isArray(settings.gains) ? (settings.gains[i] || 0) : 0;
      g.filters[i].gain.value = on ? v : 0;
    }
  }

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

    src.connect(preamp);
    let node = preamp;
    [bass, mid, treble, ...filters, out].forEach((n) => {
      node.connect(n);
      node = n;
    });
    out.connect(ctx.destination);

    const g = { preamp, bass, mid, treble, filters, out };
    graphs.push(g);
    applyToGraph(g);
  }

  function scan() {
    document.querySelectorAll("audio,video").forEach(hook);
  }

  // Catch new <audio> elements the instant SoundCloud adds them (track change).
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

  function resume() {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  }
  ["click", "keydown", "play"].forEach((ev) =>
    document.addEventListener(ev, resume, true)
  );

  chrome.storage.sync.get(DEFAULTS, (saved) => {
    settings = { ...settings, ...saved };
    settings.gains = Array.isArray(saved.gains) ? saved.gains.slice() : DEFAULTS.gains.slice();
    graphs.forEach(applyToGraph);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    Object.keys(changes).forEach((k) => { settings[k] = changes[k].newValue; });
    graphs.forEach(applyToGraph);
    resume();
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "live") return;
    Object.keys(msg.patch).forEach((k) => { settings[k] = msg.patch[k]; });
    graphs.forEach(applyToGraph);
    resume();
  });
})();
