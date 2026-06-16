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
  console.log("[EQ] content script running on", HOST, "| frame:", window.top === window ? "top" : "iframe");

  let audioCtx = null;
  let analyser = null;           // shared FFT node for the popup visualizer
  let analyserData = null;
  const hooked = new WeakSet();  // media elements already wired
  const graphs = [];             // one filter graph per element (for live updates)
  let conflicts = 0;             // elements another audio extension grabbed first

  function ensureCtx() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    }
    return audioCtx;
  }

  // Lazily create one shared AnalyserNode and feed every graph into it. It has no
  // onward connection, so it only reads the signal — it doesn't alter the audio.
  function ensureAnalyser() {
    const ctx = ensureCtx();
    if (!analyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.8;
      analyserData = new Uint8Array(analyser.frequencyBinCount);
      graphs.forEach((g) => { try { g.comp.connect(analyser); } catch (e) {} });
    }
    return analyser;
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

    // CROSS-INSTANCE GUARD. A MediaElementSource can be created only ONCE per
    // element, ever. If THIS extension already hooked it — including a now-dead
    // ("orphaned") content-script instance left behind when the extension was
    // reloaded while the page stayed open — a second createMediaElementSource
    // throws "already connected". The dataset flag lives on the shared DOM
    // element, so every content-script instance (live or orphan) can see it.
    // Skip silently: it's our own prior hook, NOT a rival audio extension.
    if (el.dataset.eqHooked) { hooked.add(el); return; }

    const ctx = ensureCtx();
    let src;
    try {
      src = ctx.createMediaElementSource(el);
    } catch (e) {
      const dup = /already connected/i.test((e && e.message) || "");
      // "already connected" with no rival extension = an orphaned old copy of us.
      // Don't mislabel it as an external conflict.
      if (!dup) {
        console.warn("[EQ] could NOT hook", el.tagName, "— another audio extension grabbed it first?", e && e.message);
        conflicts++;
      }
      hooked.add(el);
      return;
    }
    el.dataset.eqHooked = "1"; // mark so no other instance double-hooks it
    hooked.add(el);
    console.log("[EQ] hooked", el.tagName, "| ctx:", ctx.state);

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

    // CRITICAL: a freshly created AudioContext is "suspended". On MSE players
    // (SoundCloud) the hooked element's media pipeline is gated on ctx state, so
    // a suspended ctx stalls it (buffered=0, readyState=0, no playback/no detect).
    // The page already had a user gesture (the play click), so resume() succeeds
    // here even though we're outside the gesture call stack.
    if (ctx.state === "suspended") {
      ctx.resume().then(() => console.log("[EQ] ctx resumed at hook:", ctx.state)).catch(() => {});
    }

    const g = { preamp, bass, mid, treble, filters, out, comp };
    graphs.push(g);
    if (analyser) { try { comp.connect(analyser); } catch (e) {} } // feed the visualizer
    applyToGraph(g);
  }

  let scanLogged = false;
  function scan() {
    const els = document.querySelectorAll("audio,video");
    if (els.length && !scanLogged) {
      console.log("[EQ] found", els.length, "media element(s) on", HOST);
      scanLogged = true;
    }
    els.forEach(hook);
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

  // Popup diagnostics: report whether audio is actually being processed so the
  // popup can show a plain-language status instead of failing silently.
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.type !== "status") return;
    const reply = () => sendResponse({
      running: true,
      media: document.querySelectorAll("audio,video").length,
      hooked: graphs.length,
      conflicts,
      ctx: audioCtx ? audioCtx.state : "none",
      enabled: settings.enabled
    });
    // FRAME RACE FIX: content.js runs in EVERY frame (all_frames). The popup
    // broadcasts "status" to all of them, but Chrome delivers only the FIRST
    // reply to the popup's callback. SoundCloud (and most sites) keep the audio
    // in the TOP frame while empty ad/widget iframes have none — and an empty
    // iframe often answers first, masking the real "Active" frame. So a frame
    // that actually HAS media replies instantly (wins the race); empty frames
    // reply late, only used when no frame has any media.
    const media = document.querySelectorAll("audio,video").length;
    if (media > 0) reply();
    else setTimeout(reply, 150);
    return true; // async sendResponse
  });

  // ---- Spectrum visualizer: stream FFT data to the popup over a port ----
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "spectrum") return;
    ensureAnalyser();
    resume();
    const N = 64; // number of bars sent to the popup
    let raf = 0;
    const tick = () => {
      if (!analyser) return;
      analyser.getByteFrequencyData(analyserData);
      const bins = analyser.frequencyBinCount;
      const bars = new Array(N);
      for (let b = 0; b < N; b++) {
        let f0 = Math.floor(Math.pow(bins, b / N));
        let f1 = Math.floor(Math.pow(bins, (b + 1) / N));
        if (f1 <= f0) f1 = f0 + 1;
        let max = 0;
        for (let i = f0; i < f1 && i < bins; i++) if (analyserData[i] > max) max = analyserData[i];
        bars[b] = max;
      }
      try { port.postMessage(bars); } catch (e) { return; }
      raf = requestAnimationFrame(tick);
    };
    tick();
    port.onDisconnect.addListener(() => cancelAnimationFrame(raf));
  });
})();
