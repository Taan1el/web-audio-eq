// popup.js — builds the graphic EQ, handles dragging, presets, and talks to the
// content script. Live drag updates are messaged straight to the active tab
// (fast, no storage quota). Final values are persisted to chrome.storage.sync.

// Must stay in sync with content.js / inject.js.
const BANDS = [25, 40, 80, 125, 200, 400, 630, 1000, 2000, 3150, 5000, 10000, 16000];
const LABELS = ["25", "40", "80", "125", "200", "400", "630", "1k", "2k", "3.1k", "5k", "10k", "16k"];
const DB_MIN = -25, DB_MAX = 25;

const DEFAULTS = {
  enabled: true,
  volume: 1.0,
  preamp: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  gains: new Array(BANDS.length).fill(0)
};

// Bass Boost curve (warm low end), shaped for the band centers above.
const BASS_BOOST = [6, 7, 6, 4.5, 3, 1.5, 0, 0, 0, 0, 0, 0, 0];

// ---- SVG plot geometry ----
// These match the viewBox AND the rendered CSS size 1:1, so the plot never gets
// scaled non-uniformly and the round nodes stay round.
const W = 630, H = 208;
const PAD = { l: 34, r: 16, t: 12, b: 24 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;

const SVG_NS = "http://www.w3.org/2000/svg";

// Graceful fallback so the popup also renders in plain-HTML previews where the
// chrome.* extension APIs don't exist.
const HAS_CHROME = typeof chrome !== "undefined" && !!chrome.storage && !!chrome.storage.sync;
function getStore(defaults, cb) {
  if (HAS_CHROME) chrome.storage.sync.get(defaults, cb);
  else cb(defaults);
}
function setStore(obj) {
  if (HAS_CHROME) chrome.storage.sync.set(obj);
}
function getActiveHost(cb) {
  if (!HAS_CHROME || !chrome.tabs) { cb(""); return; }
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    let host = "";
    try { if (tabs[0] && tabs[0].url) host = new URL(tabs[0].url).hostname; } catch (e) {}
    cb(host);
  });
}

let settings = { ...DEFAULTS, gains: DEFAULTS.gains.slice() };
let presets = {};
let nodes = []; // circle elements per band
let currentHost = "";       // hostname of the active tab (for per-site on/off)
let siteEnabled = {};       // { host: bool } map

const svg = document.getElementById("eq");
const curve = document.createElementNS(SVG_NS, "path");

function xFor(i) { return PAD.l + (plotW * i) / (BANDS.length - 1); }
function yFor(db) { return PAD.t + plotH * (DB_MAX - db) / (DB_MAX - DB_MIN); }
function dbFromY(py) {
  const db = DB_MAX - ((py - PAD.t) / plotH) * (DB_MAX - DB_MIN);
  return Math.max(DB_MIN, Math.min(DB_MAX, db));
}

// Build static grid + axis labels once.
// Everything here is decorative: the band nodes carry the frequency and gain in
// their own labels, so an unhidden axis would just read as a wall of numbers.
function buildGrid() {
  const g = document.createElementNS(SVG_NS, "g");
  g.setAttribute("aria-hidden", "true");
  svg.appendChild(g);

  // Horizontal dB grid lines + labels.
  for (let db = DB_MIN; db <= DB_MAX; db += 5) {
    const y = yFor(db);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", PAD.l); line.setAttribute("x2", W - PAD.r);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("stroke-width", db === 0 ? 1.4 : 1);
    g.appendChild(line);

    // Rule every 5 dB, but only label every 10 — at this plot height the full
    // set of labels crowds into an unreadable stack.
    if (db % 10 !== 0) continue;
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", PAD.l - 6); t.setAttribute("y", y + 3);
    t.setAttribute("text-anchor", "end");
    t.textContent = db;
    g.appendChild(t);
  }
  // Vertical band ticks + frequency labels.
  for (let i = 0; i < BANDS.length; i++) {
    const x = xFor(i);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    line.setAttribute("y1", PAD.t); line.setAttribute("y2", H - PAD.b);
    line.setAttribute("stroke-width", 1);
    g.appendChild(line);

    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", H - PAD.b + 16);
    t.setAttribute("text-anchor", "middle");
    t.textContent = LABELS[i];
    g.appendChild(t);
  }
}

// Smooth curve through the nodes (Catmull-Rom -> cubic bezier).
function curvePath() {
  const pts = settings.gains.map((g, i) => [xFor(i), yFor(g)]);
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function bandName(i) {
  return BANDS[i] >= 1000 ? BANDS[i] / 1000 + " kilohertz" : BANDS[i] + " hertz";
}

function buildNodes() {
  curve.setAttribute("class", "curve");
  svg.appendChild(curve);

  for (let i = 0; i < BANDS.length; i++) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", "node");
    c.setAttribute("cx", xFor(i));
    c.setAttribute("r", 6);
    c.dataset.i = i;
    // Each dot is a slider in its own right, so it gets slider semantics and a
    // tab stop. Without this the curve is mouse-only.
    c.setAttribute("tabindex", "0");
    c.setAttribute("role", "slider");
    c.setAttribute("aria-label", bandName(i) + " band");
    c.setAttribute("aria-valuemin", DB_MIN);
    c.setAttribute("aria-valuemax", DB_MAX);
    c.addEventListener("pointerdown", startDrag);
    c.addEventListener("keydown", onNodeKey);
    svg.appendChild(c);
    nodes.push(c);
  }
}

// Redraw curve + node positions from current gains.
function redraw() {
  curve.setAttribute("d", curvePath());
  for (let i = 0; i < nodes.length; i++) {
    const g = settings.gains[i];
    nodes[i].setAttribute("cy", yFor(g));
    nodes[i].setAttribute("aria-valuenow", g);
    // Bare numbers read as ambiguous; spell out the unit and the sign.
    nodes[i].setAttribute("aria-valuetext", (g > 0 ? "+" : "") + g.toFixed(1) + " decibels");
  }
}

// ---- Keyboard control of the curve ----
// Arrows nudge by 0.5 dB (the drag step), PageUp/Down by 5, Home flattens the
// band and End jumps to the limit. Left/Right move focus between bands, which
// is what a horizontal row of sliders is expected to do.
function onNodeKey(e) {
  const i = parseInt(e.currentTarget.dataset.i, 10);
  const step = e.shiftKey ? 2 : 0.5;
  let g = settings.gains[i];

  switch (e.key) {
    case "ArrowUp": g += step; break;
    case "ArrowDown": g -= step; break;
    case "PageUp": g += 5; break;
    case "PageDown": g -= 5; break;
    case "Home": g = 0; break;
    case "End": g = g >= 0 ? DB_MAX : DB_MIN; break;
    case "ArrowLeft":
    case "ArrowRight": {
      const next = i + (e.key === "ArrowRight" ? 1 : -1);
      if (nodes[next]) { nodes[next].focus(); e.preventDefault(); }
      return;
    }
    default: return;
  }

  e.preventDefault();
  settings.gains[i] = Math.round(Math.max(DB_MIN, Math.min(DB_MAX, g)) * 2) / 2;
  redraw();
  sendLive({ gains: settings.gains });
  persist({ gains: settings.gains });
}

// ---- Dragging ----
let dragIdx = -1;
function startDrag(e) {
  dragIdx = parseInt(e.currentTarget.dataset.i, 10);
  e.currentTarget.setPointerCapture(e.pointerId);
  e.currentTarget.addEventListener("pointermove", onDrag);
  e.currentTarget.addEventListener("pointerup", endDrag);
}
function onDrag(e) {
  if (dragIdx < 0) return;
  const rect = svg.getBoundingClientRect();
  // Map screen Y to viewBox Y (svg height is scaled via CSS).
  const py = ((e.clientY - rect.top) / rect.height) * H;
  settings.gains[dragIdx] = Math.round(dbFromY(py) * 2) / 2; // 0.5 dB steps
  redraw();
  sendLive({ gains: settings.gains });
}
function endDrag(e) {
  const el = e.currentTarget;
  el.removeEventListener("pointermove", onDrag);
  el.removeEventListener("pointerup", endDrag);
  dragIdx = -1;
  persist({ gains: settings.gains });
}

// ---- Talk to the content script ----
function sendLive(patch) {
  if (!HAS_CHROME || !chrome.tabs) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "live", patch }, () => chrome.runtime.lastError);
  });
}
let persistTimer = null;
function persist(obj) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => setStore(obj), 200);
}

// ---- Volume slider ----
const volume = document.getElementById("volume");
const volumeVal = document.getElementById("volumeVal");
function volumeLabel() {
  if (volumeVal) volumeVal.textContent = Math.round(settings.volume * 100) + "%";
}
volume.addEventListener("input", () => {
  settings.volume = parseFloat(volume.value);
  volumeLabel();
  sendLive({ volume: settings.volume });
  persist({ volume: settings.volume });
});

// ---- Tone sliders: bass / mid / treble / preamp (dB) ----
const TONE = ["bass", "mid", "treble", "preamp"];
function toneLabel(name) {
  const el = document.getElementById(name + "Val");
  if (el) el.textContent = (settings[name] > 0 ? "+" : "") + Number(settings[name]).toFixed(1);
}
TONE.forEach((name) => {
  const sl = document.getElementById(name);
  sl.addEventListener("input", () => {
    settings[name] = parseFloat(sl.value);
    toneLabel(name);
    sendLive({ [name]: settings[name] });
    persist({ [name]: settings[name] });
  });
});

// ---- Buttons ----
const stopBtn = document.getElementById("stopBtn");
function refreshStopBtn() {
  const where = currentHost || "This Tab";
  stopBtn.textContent = (settings.enabled ? "Stop EQing " : "Start EQing ") + where;
  stopBtn.classList.toggle("on", !settings.enabled);
}
stopBtn.addEventListener("click", () => {
  settings.enabled = !settings.enabled;
  if (currentHost) siteEnabled[currentHost] = settings.enabled; // remember per site
  refreshStopBtn();
  sendLive({ enabled: settings.enabled });
  setStore({ siteEnabled });
});

document.getElementById("reset").addEventListener("click", () => {
  settings.gains = new Array(BANDS.length).fill(0);
  TONE.forEach((n) => {
    settings[n] = 0;
    document.getElementById(n).value = 0;
    toneLabel(n);
  });
  redraw();
  const patch = { gains: settings.gains, bass: 0, mid: 0, treble: 0, preamp: 0 };
  sendLive(patch);
  setStore(patch);
});

document.getElementById("bassBoost").addEventListener("click", () => {
  settings.gains = BASS_BOOST.slice();
  redraw();
  sendLive({ gains: settings.gains });
  setStore({ gains: settings.gains });
});

// ---- Presets ----
const nameInput = document.getElementById("presetName");
const presetList = document.getElementById("presetList");

function refreshPresetList() {
  presetList.innerHTML = "";
  Object.keys(presets).forEach((name) => {
    const o = document.createElement("option");
    o.value = name;
    presetList.appendChild(o);
  });
}
document.getElementById("savePreset").addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name) return;
  presets[name] = {
    gains: settings.gains.slice(),
    bass: settings.bass, mid: settings.mid, treble: settings.treble, preamp: settings.preamp
  };
  setStore({ presets });
  refreshPresetList();
});
document.getElementById("deletePreset").addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name || !presets[name]) return;
  delete presets[name];
  setStore({ presets });
  refreshPresetList();
});
// Selecting/typing an existing preset name loads it.
nameInput.addEventListener("change", () => {
  const name = nameInput.value.trim();
  const p = presets[name];
  if (!p) return;
  const obj = Array.isArray(p) ? { gains: p } : p; // back-compat with old presets
  settings.gains = (obj.gains || DEFAULTS.gains).slice();
  TONE.forEach((n) => {
    if (obj[n] !== undefined) {
      settings[n] = obj[n];
      document.getElementById(n).value = obj[n];
      toneLabel(n);
    }
  });
  redraw();
  const patch = {
    gains: settings.gains,
    bass: settings.bass, mid: settings.mid, treble: settings.treble, preamp: settings.preamp
  };
  sendLive(patch);
  setStore(patch);
});

// ---- Tabs ----
// Roving tabindex: one Tab press enters the tablist, then arrows move between
// tabs. Tabbing through every tab to reach the controls would be tedious.
const tabEls = [...document.querySelectorAll(".tab")];
function selectTab(tab, focus) {
  tabEls.forEach((t) => {
    const on = t === tab;
    t.classList.toggle("active", on);
    t.setAttribute("aria-selected", on ? "true" : "false");
    t.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll(".pane").forEach((p) => p.classList.remove("active"));
  document.querySelector(`.pane[data-pane="${tab.dataset.tab}"]`).classList.add("active");
  if (focus) tab.focus();
}
tabEls.forEach((tab, i) => {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (e) => {
    let next = null;
    if (e.key === "ArrowRight") next = tabEls[(i + 1) % tabEls.length];
    else if (e.key === "ArrowLeft") next = tabEls[(i - 1 + tabEls.length) % tabEls.length];
    else if (e.key === "Home") next = tabEls[0];
    else if (e.key === "End") next = tabEls[tabEls.length - 1];
    if (!next) return;
    e.preventDefault();
    selectTab(next, true);
  });
});

// ---- Spectrum visualizer ----
// Opens a port to the active tab's content script; it streams FFT bars which we
// draw on a canvas behind the EQ curve.
const canvas = document.getElementById("spectrum");
const cctx = canvas.getContext("2d");
let specPort = null;
let specOn = false;

function sizeCanvas() {
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(r.width));
  canvas.height = Math.max(1, Math.round(r.height));
  barGrad = null; // gradient is tied to the old width
}
// Cached because the gradient only changes when the canvas is resized.
let barGrad = null;
function barGradient(Wd) {
  if (!barGrad) {
    barGrad = cctx.createLinearGradient(0, 0, Wd, 0);
    barGrad.addColorStop(0, "rgba(255, 92, 87, 0.26)");
    barGrad.addColorStop(0.5, "rgba(244, 114, 182, 0.24)");
    barGrad.addColorStop(1, "rgba(192, 132, 252, 0.26)");
  }
  return barGrad;
}
function drawBars(bars) {
  if (!cctx) return;
  const Wd = canvas.width, Hd = canvas.height;
  cctx.clearRect(0, 0, Wd, Hd);
  const n = bars.length, bw = Wd / n;
  cctx.fillStyle = barGradient(Wd);
  for (let i = 0; i < n; i++) {
    const h = (bars[i] / 255) * Hd;
    cctx.fillRect(i * bw, Hd - h, bw * 0.85, h);
  }
}
function startSpectrum() {
  if (!HAS_CHROME || !chrome.tabs) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    sizeCanvas();
    try { specPort = chrome.tabs.connect(tabs[0].id, { name: "spectrum" }); }
    catch (e) { return; }
    specPort.onMessage.addListener(drawBars);
    specPort.onDisconnect.addListener(() => { specPort = null; });
  });
}
function stopSpectrum() {
  if (specPort) { try { specPort.disconnect(); } catch (e) {} specPort = null; }
  if (cctx) cctx.clearRect(0, 0, canvas.width, canvas.height);
}
document.getElementById("spectrumBtn").addEventListener("click", (e) => {
  specOn = !specOn;
  e.currentTarget.classList.toggle("on", specOn);
  if (specOn) startSpectrum(); else stopSpectrum();
  setStore({ spectrum: specOn });
});

// ---- Audio status diagnostics ----
// Pings the active tab's content script and shows, in plain language, whether
// audio is actually being processed. Click the line to re-check.
const statusLine = document.getElementById("statusLine");
function setStatus(text, cls) {
  if (!statusLine) return;
  statusLine.textContent = text;
  statusLine.className = "status " + (cls || "");
}
// Auto-poll: SoundCloud (and similar players) attach + hook their audio LAZILY,
// a few seconds after you press play. A one-shot ping at popup-open time can
// therefore catch a transient "no media yet" / "not hooked yet" state and look
// broken even though the EQ engages moments later. So we keep re-checking on a
// timer until we reach the steady "Active" state (or the popup closes).
let statusTimer = null;
function stopStatusPoll() { if (statusTimer) { clearTimeout(statusTimer); statusTimer = null; } }
function scheduleStatusPoll() { stopStatusPoll(); statusTimer = setTimeout(pingStatus, 1500); }

function pingStatus() {
  if (!HAS_CHROME || !chrome.tabs) {
    setStatus("Preview mode — load as a real extension to process audio.", "warnx");
    return;
  }
  stopStatusPoll();
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab) { setStatus("No active tab.", "bad"); return; }
    let answered = false;
    try {
      chrome.tabs.sendMessage(tab.id, { type: "status" }, (resp) => {
        answered = true;
        if (chrome.runtime.lastError || !resp) {
          setStatus("Not running on this tab. Hard-refresh the page (Ctrl+Shift+R), then reopen.", "bad");
          scheduleStatusPoll(); // content script may still be loading
          return;
        }
        if (resp.conflicts > 0 && resp.hooked === 0) {
          setStatus("Blocked: another audio extension grabbed the sound. Disable it (e.g. AIRS) + refresh.", "bad");
        } else if (resp.media === 0) {
          setStatus("Waiting for playback… press play on a track.", "warnx");
          scheduleStatusPoll();
        } else if (resp.hooked === 0 && resp.staleHooks > 0) {
          setStatus("Stale audio hook from an old tab session. CLOSE this tab (Ctrl+W) and open SoundCloud in a NEW tab.", "bad");
        } else if (resp.hooked === 0) {
          setStatus("Found " + resp.media + " media, hooking…", "warnx");
          scheduleStatusPoll();
        } else if (resp.ctx !== "running") {
          setStatus("Hooked " + resp.hooked + " — starting audio…", "warnx");
          scheduleStatusPoll();
        } else if (!resp.enabled) {
          setStatus("Hooked & running, but EQ is OFF for this site. Click Start EQing above.", "warnx");
        } else {
          setStatus("Active: EQ is processing " + resp.hooked + " stream(s).", "good");
          // steady state reached — stop polling
        }
      });
    } catch (e) {
      setStatus("Not running on this tab. Hard-refresh the page, then reopen.", "bad");
      return;
    }
    // If the callback never fires (no content script), show guidance + retry.
    setTimeout(() => {
      if (!answered) { setStatus("Not running on this tab. Hard-refresh the page (Ctrl+Shift+R), then reopen.", "bad"); scheduleStatusPoll(); }
    }, 800);
  });
}
window.addEventListener("unload", stopStatusPoll);
if (statusLine) statusLine.addEventListener("click", pingStatus);

// ---- Init ----
buildGrid();
buildNodes();
getActiveHost((host) => {
  currentHost = host;
  getStore({ ...DEFAULTS, siteEnabled: {}, presets: {}, spectrum: false }, (s) => {
    siteEnabled = s.siteEnabled || {};
    settings.enabled = host ? (siteEnabled[host] !== false) : true; // per-site
    settings.volume = s.volume;
    settings.gains = Array.isArray(s.gains) && s.gains.length === BANDS.length
      ? s.gains.slice()
      : DEFAULTS.gains.slice();
    presets = s.presets || {};
    volume.value = settings.volume;
    volumeLabel();
    TONE.forEach((n) => {
      settings[n] = s[n];
      document.getElementById(n).value = s[n];
      toneLabel(n);
    });
    refreshStopBtn();
    refreshPresetList();
    redraw();
    if (s.spectrum) {
      specOn = true;
      document.getElementById("spectrumBtn").classList.add("on");
      startSpectrum();
    }
    pingStatus();
  });
});
