// popup.js — builds the graphic EQ, handles dragging, presets, and talks to the
// content script. Live drag updates are messaged straight to the active tab
// (fast, no storage quota). Final values are persisted to chrome.storage.sync.

const BANDS = [5, 10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120, 10240, 20480];
const LABELS = ["5", "10", "20", "40", "80", "160", "320", "640", "1280", "2560", "5120", "10240", "20480"];
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

const BASS_BOOST = [4, 6, 8, 9, 8, 5, 2, 0, 0, 0, 0, 0, 0];

const W = 660, H = 380;
const PAD = { l: 34, r: 16, t: 18, b: 34 };
const plotW = W - PAD.l - PAD.r;
const plotH = H - PAD.t - PAD.b;
const SVG_NS = "http://www.w3.org/2000/svg";

let settings = { ...DEFAULTS, gains: DEFAULTS.gains.slice() };
let presets = {};
let nodes = [];

const svg = document.getElementById("eq");
const curve = document.createElementNS(SVG_NS, "path");

function xFor(i) { return PAD.l + (plotW * i) / (BANDS.length - 1); }
function yFor(db) { return PAD.t + plotH * (DB_MAX - db) / (DB_MAX - DB_MIN); }
function dbFromY(py) {
  const db = DB_MAX - ((py - PAD.t) / plotH) * (DB_MAX - DB_MIN);
  return Math.max(DB_MIN, Math.min(DB_MAX, db));
}

function buildGrid() {
  for (let db = DB_MIN; db <= DB_MAX; db += 5) {
    const y = yFor(db);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", PAD.l); line.setAttribute("x2", W - PAD.r);
    line.setAttribute("y1", y); line.setAttribute("y2", y);
    line.setAttribute("stroke-width", db === 0 ? 1.4 : 1);
    svg.appendChild(line);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", PAD.l - 6); t.setAttribute("y", y + 3);
    t.setAttribute("text-anchor", "end");
    t.textContent = db;
    svg.appendChild(t);
  }
  for (let i = 0; i < BANDS.length; i++) {
    const x = xFor(i);
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    line.setAttribute("y1", PAD.t); line.setAttribute("y2", H - PAD.b);
    line.setAttribute("stroke-width", 1);
    svg.appendChild(line);
    const t = document.createElementNS(SVG_NS, "text");
    t.setAttribute("x", x); t.setAttribute("y", H - PAD.b + 16);
    t.setAttribute("text-anchor", "middle");
    t.textContent = LABELS[i];
    svg.appendChild(t);
  }
}

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

function buildNodes() {
  curve.setAttribute("class", "curve");
  svg.appendChild(curve);
  for (let i = 0; i < BANDS.length; i++) {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("class", "node");
    c.setAttribute("cx", xFor(i));
    c.setAttribute("r", 6);
    c.dataset.i = i;
    c.addEventListener("pointerdown", startDrag);
    svg.appendChild(c);
    nodes.push(c);
  }
}

function redraw() {
  curve.setAttribute("d", curvePath());
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].setAttribute("cy", yFor(settings.gains[i]));
  }
}

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
  const py = ((e.clientY - rect.top) / rect.height) * H;
  settings.gains[dragIdx] = Math.round(dbFromY(py) * 2) / 2;
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

function sendLive(patch) {
  if (!chrome.tabs) return;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, { type: "live", patch }, () => chrome.runtime.lastError);
  });
}
let persistTimer = null;
function persist(obj) {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => chrome.storage.sync.set(obj), 200);
}

const volume = document.getElementById("volume");
volume.addEventListener("input", () => {
  settings.volume = parseFloat(volume.value);
  sendLive({ volume: settings.volume });
  persist({ volume: settings.volume });
});

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

const stopBtn = document.getElementById("stopBtn");
function refreshStopBtn() {
  stopBtn.textContent = settings.enabled ? "Stop EQing" : "Start EQing";
  stopBtn.classList.toggle("on", !settings.enabled);
}
stopBtn.addEventListener("click", () => {
  settings.enabled = !settings.enabled;
  refreshStopBtn();
  sendLive({ enabled: settings.enabled });
  chrome.storage.sync.set({ enabled: settings.enabled });
});

document.getElementById("reset").addEventListener("click", () => {
  settings.gains = new Array(BANDS.length).fill(0);
  TONE.forEach((n) => { settings[n] = 0; document.getElementById(n).value = 0; toneLabel(n); });
  redraw();
  const patch = { gains: settings.gains, bass: 0, mid: 0, treble: 0, preamp: 0 };
  sendLive(patch);
  chrome.storage.sync.set(patch);
});

document.getElementById("bassBoost").addEventListener("click", () => {
  settings.gains = BASS_BOOST.slice();
  redraw();
  sendLive({ gains: settings.gains });
  chrome.storage.sync.set({ gains: settings.gains });
});

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
  chrome.storage.sync.set({ presets });
  refreshPresetList();
});
document.getElementById("deletePreset").addEventListener("click", () => {
  const name = nameInput.value.trim();
  if (!name || !presets[name]) return;
  delete presets[name];
  chrome.storage.sync.set({ presets });
  refreshPresetList();
});
nameInput.addEventListener("change", () => {
  const name = nameInput.value.trim();
  const p = presets[name];
  if (!p) return;
  settings.gains = (p.gains || DEFAULTS.gains).slice();
  TONE.forEach((n) => {
    if (p[n] !== undefined) { settings[n] = p[n]; document.getElementById(n).value = p[n]; toneLabel(n); }
  });
  redraw();
  const patch = { gains: settings.gains, bass: settings.bass, mid: settings.mid, treble: settings.treble, preamp: settings.preamp };
  sendLive(patch);
  chrome.storage.sync.set(patch);
});

// ---- Init ----
buildGrid();
buildNodes();
chrome.storage.sync.get({ ...DEFAULTS, presets: {} }, (s) => {
  settings.volume = s.volume;
  settings.enabled = s.enabled;
  settings.gains = Array.isArray(s.gains) && s.gains.length === BANDS.length ? s.gains.slice() : DEFAULTS.gains.slice();
  presets = s.presets || {};
  volume.value = settings.volume;
  TONE.forEach((n) => { settings[n] = s[n]; document.getElementById(n).value = s[n]; toneLabel(n); });
  refreshStopBtn();
  refreshPresetList();
  redraw();
});
