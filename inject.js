// inject.js — runs in the PAGE's own JS world (world: "MAIN") at document_start.
//
// Two jobs:
//
// 1) DETACHED-AUDIO ATTACHER (for plain players): some players `new Audio()` a
//    detached element that's never put in the DOM. content.js (isolated world)
//    can only hook elements that are in the document, so we append playing ones.
//
// 2) WEB-AUDIO SPLICER (the SoundCloud fix): SoundCloud builds its OWN
//    AudioContext and calls `createMediaElementSource(el)` on its streaming
//    <audio> ITSELF. An element can be sourced only ONCE, ever — so content.js
//    creating a second source throws `InvalidStateError: ... already connected`
//    and the EQ never touches SoundCloud audio. The cure: since we run at
//    document_start (BEFORE SoundCloud makes its context), we wrap
//    `AudioContext.prototype.createMediaElementSource`. When SoundCloud creates
//    its source node, we splice our EQ chain (preamp→bass/mid/treble→13 bands→
//    volume→limiter) between that source and wherever SoundCloud connects it —
//    i.e. the EQ lives INSIDE SoundCloud's own graph instead of a rival context.
//
// EQ settings come from content.js (which owns chrome.storage) via postMessage.

(() => {
  "use strict";

  // ---------- EQ engine (mirrors content.js, but in the page's context) ----------
  const BANDS = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
  const Q = 1.4;
  function dbToGain(db) { return Math.pow(10, db / 20); }

  let settings = {
    enabled: true,
    volume: 1.0,
    preamp: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    gains: new Array(BANDS.length).fill(0)
  };
  const graphs = []; // EQ chains spliced into the page's own context

  function applyToGraph(g) {
    const on = settings.enabled;
    g.out.gain.value = settings.volume;
    g.preamp.gain.value = on ? dbToGain(settings.preamp) : 1;
    g.bass.gain.value = on ? settings.bass : 0;
    g.mid.gain.value = on ? settings.mid : 0;
    g.treble.gain.value = on ? settings.treble : 0;
    for (let i = 0; i < g.filters.length; i++) {
      const v = Array.isArray(settings.gains) ? (settings.gains[i] || 0) : 0;
      g.filters[i].gain.value = on ? v : 0;
    }
    if (on) { g.comp.threshold.value = -3; g.comp.ratio.value = 12; }
    else { g.comp.threshold.value = 0; g.comp.ratio.value = 1; }
  }

  // Build the EQ node chain inside `ctx`; returns {input, output, ...nodes}.
  function buildChain(ctx) {
    const preamp = ctx.createGain();
    const bass = ctx.createBiquadFilter(); bass.type = "lowshelf"; bass.frequency.value = 150;
    const mid = ctx.createBiquadFilter(); mid.type = "peaking"; mid.frequency.value = 1000; mid.Q.value = 1;
    const treble = ctx.createBiquadFilter(); treble.type = "highshelf"; treble.frequency.value = 4000;
    const filters = BANDS.map((freq) => {
      const f = ctx.createBiquadFilter();
      f.type = "peaking"; f.frequency.value = freq; f.Q.value = Q; f.gain.value = 0;
      return f;
    });
    const out = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 6; comp.attack.value = 0.003; comp.release.value = 0.25;

    // internal wiring: preamp -> bass -> mid -> treble -> 13 bands -> out -> comp
    let node = preamp;
    [bass, mid, treble, ...filters, out, comp].forEach((n) => { node.connect(n); node = n; });

    const g = { preamp, bass, mid, treble, filters, out, comp, input: preamp, output: comp };
    graphs.push(g);
    applyToGraph(g);
    return g;
  }

  function postState() {
    try { window.postMessage({ __eq: "state", hooked: graphs.length }, "*"); } catch (e) {}
  }

  // ---------- THE SPLICE: wrap createMediaElementSource ----------
  function patch(ctor) {
    if (!ctor || !ctor.prototype || ctor.prototype.__eqPatched) return;
    const proto = ctor.prototype;
    const origCreate = proto.createMediaElementSource;
    if (typeof origCreate !== "function") return;
    const origConnect = AudioNode.prototype.connect;
    const origDisconnect = AudioNode.prototype.disconnect;

    proto.createMediaElementSource = function (el) {
      // Let the page get its real source node — exactly what it expects.
      const srcNode = origCreate.call(this, el);
      try {
        const g = buildChain(this);
        // Route the real source into our EQ chain's input.
        origConnect.call(srcNode, g.input);
        // Redirect the page's future connect/disconnect to our chain OUTPUT, so
        // wherever the page "connects the source" the audio actually flows
        // source -> EQ -> (page's target). The page is none the wiser.
        srcNode.connect = function () { return origConnect.apply(g.output, arguments); };
        srcNode.disconnect = function () { return origDisconnect.apply(g.output, arguments); };
        try { if (el && el.dataset) el.dataset.eqMainHooked = "1"; } catch (e) {}
        postState();
        console.log("[EQ] spliced EQ into the page's own audio graph (createMediaElementSource)");
      } catch (e) {
        console.warn("[EQ] splice failed:", e && e.message);
      }
      return srcNode;
    };
    proto.__eqPatched = true;
  }

  patch(window.AudioContext);
  patch(window.webkitAudioContext);

  // Receive EQ settings from content.js (which has chrome.storage access).
  window.addEventListener("message", (e) => {
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.__eq !== "settings" || !d.settings) return;
    const s = d.settings;
    ["enabled", "volume", "preamp", "bass", "mid", "treble"].forEach((k) => {
      if (s[k] !== undefined) settings[k] = s[k];
    });
    if (Array.isArray(s.gains)) settings.gains = s.gains.slice();
    graphs.forEach(applyToGraph);
  });

  // ---------- Detached-audio attacher (plain players, unchanged behavior) ----------
  function attach(el) {
    try {
      if (!el || el.tagName !== "AUDIO") return;
      if (el.dataset.eqAttached) return;
      if (el.isConnected) return;
      const hasMedia = el.currentSrc || el.src || el.srcObject || el.readyState > 0;
      if (!hasMedia) return;
      el.dataset.eqAttached = "1";
      el.style.display = "none";
      (document.body || document.documentElement).appendChild(el);
      console.log("[EQ] force-attached a PLAYING detached AUDIO so it can be hooked");
    } catch (e) {}
  }

  function watch(el) {
    try {
      if (!el || el.tagName !== "AUDIO") return;
      const onPlay = () => attach(el);
      el.addEventListener("playing", onPlay);
      el.addEventListener("play", onPlay);
    } catch (e) {}
  }

  const RealAudio = window.Audio;
  if (typeof RealAudio === "function") {
    window.Audio = new Proxy(RealAudio, {
      construct(target, args) {
        const el = Reflect.construct(target, args);
        watch(el);
        return el;
      }
    });
  }

  const realCreate = Document.prototype.createElement;
  Document.prototype.createElement = new Proxy(realCreate, {
    apply(target, thisArg, args) {
      const el = Reflect.apply(target, thisArg, args);
      const name = args[0];
      if (typeof name === "string" && name.toLowerCase() === "audio") watch(el);
      return el;
    }
  });

  console.log("[EQ] main-world injector active (EQ splicer + detached-audio attacher)");
})();
