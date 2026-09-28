/**
 * SafeHouse · safety mesh tech demo
 *
 * REAL:      Santander docks + counts (TfL) · dockless bays (OpenStreetMap) · street lighting (OSM)
 *            reported crime on named streets (data.police.uk, Metropolitan Police) · area photos (Wikipedia)
 *            Street View · place autocomplete, cycling + walking routes (Google)
 *            trusted-contact texts + live location (SMS / WhatsApp + ntfy.sh)
 * MODELLED:  individual Lime / Forest / Voi bike positions (real fleet sizes at real bays, kept off water)
 *            bike camera / light actions
 * ALGORITHM: SafeScore, a time-aware route score from mesh coverage, lighting, reported crime and density
 */
"use strict";

// ============================================================================
// CONFIG: paste your Google key. Enable: Maps JavaScript, Routes, Geocoding, Places API (New)
// ============================================================================
const CONFIG = {
    GOOGLE_API_KEY: "AIzaSyAFSoTZo0HIqfpHG-F1pnkqd4VpnUSLFYQ",
    CENTER: { lat: 51.5074, lng: -0.1278 },
    BBOX: { s: 51.28, w: -0.51, n: 51.69, e: 0.33 },
    ZONE1: { s: 51.49, w: -0.19, n: 51.535, e: -0.07 },
    DEMO_ORIGIN: { lat: 51.5031, lng: -0.1132, name: "Waterloo" },
    OVERPASS: ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"],
    TFL: "https://api.tfl.gov.uk/BikePoint",
    POLICE: "https://data.police.uk/api/crimes-street",
    NTFY: "https://ntfy.sh",
    MESH_LINK_M: 300, MESH_MAX_LINKS: 4, COVER_M: 150,
    ON_STREET: 0.9, REFRESH_MS: 60_000,
    SPEEDUP: { ride: 25, walk: 12 },
    LIGHT_MIN_ZOOM: 15, ASSUMED_LIGHT: 0.7,
    SHARE_EVERY_MS: 5000,
};

const OPERATORS = {
    lime: {
        name: "Lime", letter: "L", hex: "#3DCC4A", rgb: [61, 204, 74], fleet: 27500, match: /\blime\b/i, seed: 11, live: false,
        app: { ios: "1199780189", android: "com.limebike", web: "https://www.li.me/" }
    },
    forest: {
        name: "Forest", letter: "F", hex: "#0E6B4F", rgb: [22, 128, 94], fleet: 20000, match: /forest/i, seed: 23, live: false,
        app: { ios: "6443626172", android: "app.humanforest", web: "https://www.forest.me/" }
    },
    voi: {
        name: "Voi", letter: "V", hex: "#F0544F", rgb: [240, 84, 79], fleet: 4000, match: /\bvoi\b/i, seed: 37, live: false,
        app: { ios: "1395921017", android: "io.voiapp.voi", web: "https://www.voi.com/" }
    },
    santander: {
        name: "Santander", letter: "S", hex: "#EC0000", rgb: [236, 0, 0], fleet: 12000, match: /santander|\btfl\b|cycle hire|barclays/i, seed: 53, live: true,
        app: { ios: "974792287", android: "uk.gov.tfl.cyclehire", web: "https://tfl.gov.uk/modes/cycling/santander-cycles" }
    },
};
const OP_KEYS = Object.keys(OPERATORS);
const DOCKLESS = ["lime", "forest", "voi"];
const SHARED_RGB = [142, 142, 147];
const DEMO_PLACES = ["King's Cross St Pancras", "Shoreditch High Street", "Camden Market", "Clapham Common", "Brixton", "Canary Wharf", "Hackney Central", "Peckham Rye"];

// personal-safety crime categories from data.police.uk
const CATS = {
    "violent-crime": { label: "Violence and sexual offences", short: "Violence", rgb: [255, 59, 48] },
    "robbery": { label: "Robbery", short: "Robbery", rgb: [255, 149, 0] },
    "theft-from-the-person": { label: "Theft from the person", short: "Theft (person)", rgb: [255, 204, 0] },
    "public-order": { label: "Public order", short: "Public order", rgb: [175, 82, 222] },
    "possession-of-weapons": { label: "Possession of weapons", short: "Weapons", rgb: [88, 86, 214] },
};
// nightlife areas studied in Pattern to Pavement (+ Wikipedia article for the photo)
const HUBS = [
    { name: "Shoreditch", wiki: "Shoreditch", lat: 51.5246, lng: -0.0776 },
    { name: "Soho", wiki: "Soho", lat: 51.5136, lng: -0.1331 },
    { name: "Brixton", wiki: "Brixton", lat: 51.4626, lng: -0.1149 },
    { name: "Camden Town", wiki: "Camden_Town", lat: 51.5392, lng: -0.1426 },
    { name: "Peckham", wiki: "Peckham", lat: 51.4739, lng: -0.0691 },
    { name: "Dalston", wiki: "Dalston", lat: 51.5465, lng: -0.0752 },
    { name: "Clapham", wiki: "Clapham", lat: 51.4618, lng: -0.1384 },
    { name: "Vauxhall", wiki: "Vauxhall", lat: 51.4861, lng: -0.1239 },
    { name: "Elephant & Castle", wiki: "Elephant_and_Castle", lat: 51.4943, lng: -0.1 },
    { name: "Whitechapel", wiki: "Whitechapel", lat: 51.5195, lng: -0.0597 },
];

// Thames centreline, Kew to Thamesmead [lng, lat], used to keep bikes and mesh links off the river
const THAMES = [
    [-0.2873, 51.4874], [-0.2785, 51.48], [-0.2694, 51.4735], [-0.26, 51.471], [-0.2526, 51.4719], [-0.244, 51.479], [-0.236, 51.486],
    [-0.2303, 51.4882], [-0.2255, 51.483], [-0.2215, 51.476], [-0.2175, 51.4705], [-0.2131, 51.4667], [-0.205, 51.4675], [-0.196, 51.4668],
    [-0.1878, 51.4659], [-0.183, 51.469], [-0.18, 51.4728], [-0.176, 51.478], [-0.1721, 51.481], [-0.1665, 51.4826], [-0.158, 51.484],
    [-0.1498, 51.4846], [-0.14, 51.4852], [-0.133, 51.4862], [-0.1267, 51.4878], [-0.1235, 51.491], [-0.1227, 51.4945], [-0.122, 51.498],
    [-0.1218, 51.5008], [-0.1205, 51.504], [-0.1197, 51.5064], [-0.117, 51.5087], [-0.111, 51.5096], [-0.1043, 51.5096], [-0.0985, 51.5096],
    [-0.0944, 51.5088], [-0.0877, 51.5079], [-0.081, 51.507], [-0.0754, 51.5055], [-0.068, 51.5048], [-0.06, 51.504], [-0.052, 51.504],
    [-0.044, 51.5062], [-0.037, 51.5075], [-0.031, 51.5055], [-0.028, 51.5], [-0.0265, 51.494], [-0.023, 51.489], [-0.016, 51.4862],
    [-0.009, 51.4858], [-0.003, 51.4895], [-0.001, 51.496], [-0.0015, 51.502], [0.002, 51.507], [0.01, 51.5075], [0.016, 51.504],
    [0.019, 51.4985], [0.03, 51.496], [0.05, 51.4965], [0.065, 51.4985], [0.09, 51.506], [0.11, 51.51],
];
// docks and lakes [lng, lat, radius m]
const WATER = [
    [-0.17, 51.5055, 110], [-0.165, 51.505, 110], [-0.174, 51.5068, 80], [-0.1575, 51.526, 100],
    [-0.023, 51.5055, 90], [-0.017, 51.506, 90], [-0.022, 51.5025, 80], [-0.016, 51.5025, 80], [-0.018, 51.4965, 110], [-0.023, 51.4945, 80],
    [-0.041, 51.494, 110], [-0.05, 51.4985, 70], [-0.055, 51.5075, 60],
    [0.018, 51.5078, 120], [0.03, 51.5085, 120], [0.042, 51.5075, 110], [0.055, 51.5075, 110], [0.07, 51.5075, 110],
];

// ============================================================================
// State
// ============================================================================
const S = {
    map: null, overlay: null,
    nodes: [], edges: [], grid: null,
    bikes: { lime: [], forest: [], voi: [], santander: [] },
    counts: { lime: 0, forest: 0, voi: 0, santander: 0 },
    visible: { lime: true, forest: true, voi: true, santander: true },
    meshOn: true, lightOn: false, night: false,
    baysSource: "osm", santanderLive: true, coverage: 0,
    lit: { ways: new Map(), tiles: new Set(), pending: new Set(), grid: null },
    crime: { grid: null, ids: new Set(), areas: [], month: null },
    tab: "explore", navOn: false,
    me: null, origin: null, dest: null,
    routes: [], selected: 0, routeKind: "ride",
    walk: { filter: "all", options: [], selected: 0, cache: null },
    nav: null,
    ins: { state: "idle", source: "police", month: null, incidents: [], hotspots: [], open: -1 },
    share: null, watch: null,
    sheetVisible: 0, snap: "half",
    pickedAt: 0, cache: {},
};
const invalidate = () => (S.cache = {});

// ============================================================================
// Utils
// ============================================================================
const M_LAT = 111320;
const M_LNG = 111320 * Math.cos((51.5 * Math.PI) / 180);
const toXY = (lng, lat) => [(lng - CONFIG.CENTER.lng) * M_LNG, (lat - CONFIG.CENTER.lat) * M_LAT];
const distM = (a, b) => Math.hypot((a[0] - b[0]) * M_LNG, (a[1] - b[1]) * M_LAT);
const $ = (id) => document.getElementById(id);
const haptic = (p = 8) => { try { navigator.vibrate && navigator.vibrate(p); } catch { /* */ } };
const fmtDist = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " km" : Math.max(10, Math.round(m / 10) * 10) + " m");
const fmtMin = (s) => Math.max(1, Math.round(s / 60));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const monthLabel = (m) => { if (!m) return ""; const [y, mo] = m.split("-").map(Number); return new Date(y, mo - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" }); };
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(navigator.userAgent);

function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

class Grid {
    constructor(cell) { this.cell = cell; this.m = new Map(); }
    add(it) {
        const [x, y] = toXY(it.lng, it.lat);
        const k = Math.floor(x / this.cell) + "," + Math.floor(y / this.cell);
        if (!this.m.has(k)) this.m.set(k, []);
        this.m.get(k).push(it);
    }
    near(lng, lat, r) {
        const [x, y] = toXY(lng, lat);
        const ix = Math.floor(x / this.cell), iy = Math.floor(y / this.cell), n = Math.ceil(r / this.cell), out = [];
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
            const arr = this.m.get(ix + i + "," + (iy + j));
            if (!arr) continue;
            for (const it of arr) { const d = distM([lng, lat], [it.lng, it.lat]); if (d <= r) out.push([it, d]); }
        }
        return out;
    }
}

function densify(path, step = 25) {
    const out = [];
    for (let i = 0; i < path.length - 1; i++) {
        const a = path[i], b = path[i + 1], n = Math.max(1, Math.ceil(distM(a, b) / step));
        for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    out.push(path[path.length - 1]);
    return out;
}

function idleShare(date = new Date()) {
    const h = date.getHours() + date.getMinutes() / 60;
    const c = [[0, 0.9], [6, 0.88], [7.5, 0.62], [9.5, 0.7], [12, 0.74], [14, 0.76], [17, 0.6], [19, 0.7], [21, 0.82], [24, 0.9]];
    for (let i = 0; i < c.length - 1; i++) if (h >= c[i][0] && h <= c[i + 1][0]) return c[i][1] + ((c[i + 1][1] - c[i][1]) * (h - c[i][0])) / (c[i + 1][0] - c[i][0]);
    return 0.8;
}

function readCache(key, maxAge) { try { const r = localStorage.getItem(key); if (!r) return null; const { t, v } = JSON.parse(r); return Date.now() - t < maxAge ? v : null; } catch { return null; } }
function writeCache(key, v) { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), v })); } catch { /* quota */ } }
const store = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};

async function fetchJson(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res.json();
}
async function pool(items, n, fn) {
    const out = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch((e) => (console.warn(e), null)); } }));
    return out;
}

let overpassChain = Promise.resolve();
function overpass(query) {
    const run = async () => {
        let err;
        for (const url of CONFIG.OVERPASS) {
            try { return await fetchJson(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "data=" + encodeURIComponent(query) }); }
            catch (e) { err = e; }
        }
        throw err;
    };
    const p = overpassChain.then(run, run);
    overpassChain = p.catch(() => { });
    return p;
}

// ============================================================================
// Water mask (keeps bikes, links and reports out of the Thames and docks)
// ============================================================================
function riverInfo(lng, lat) {
    const [px, py] = toXY(lng, lat);
    let best = { d: Infinity, side: 0 };
    for (let i = 0; i < THAMES.length - 1; i++) {
        const [ax, ay] = toXY(THAMES[i][0], THAMES[i][1]), [bx, by] = toXY(THAMES[i + 1][0], THAMES[i + 1][1]);
        const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
        if (d < best.d) best = { d, side: Math.sign(dx * (py - ay) - dy * (px - ax)) || 1 };
    }
    return best;
}
const inDock = (lng, lat) => WATER.some(([x, y, r]) => distM([lng, lat], [x, y]) < r);
const onWater = (lng, lat) => inDock(lng, lat) || riverInfo(lng, lat).d < 95;

// Place a point near an anchor on land: same bank as the anchor and never closer to the river than it
function landNear(anchor, spread, r) {
    const ri = anchor.river || (anchor.river = riverInfo(anchor.lng, anchor.lat));
    for (let t = 0; t < 8; t++) {
        const lng = anchor.lng + (gauss(r) * spread) / M_LNG, lat = anchor.lat + (gauss(r) * spread) / M_LAT;
        if (inDock(lng, lat)) continue;
        if (ri.d > 700) return [lng, lat];
        const pi = riverInfo(lng, lat);
        if (pi.side === ri.side && pi.d >= Math.min(ri.d, Math.max(95, ri.d - 3))) return [lng, lat];
    }
    return [anchor.lng, anchor.lat];
}

// ============================================================================
// Data: bays and docks
// ============================================================================
async function loadBays() {
    const cached = readCache("sh_bays_v3", 7 * 864e5);
    if (cached) return cached;
    splash("Mapping London's bike bays\nFirst launch only, about 20 seconds");
    try {
        const { s, w, n, e } = CONFIG.BBOX;
        const json = await overpass(`[out:json][timeout:90];(
      nwr["amenity"="bicycle_rental"](${s},${w},${n},${e});
      nwr["amenity"="bicycle_parking"]["operator"~"lime|forest|voi",i](${s},${w},${n},${e});
    );out center tags;`);
        const bays = [], dedupe = new Grid(20);
        for (const el of json.elements || []) {
            const lat = el.lat ?? el.center?.lat, lng = el.lon ?? el.center?.lon;
            if (lat == null) continue;
            const t = el.tags || {};
            const txt = [t.operator, t.network, t.brand, t.name].filter(Boolean).join(" ");
            if (OPERATORS.santander.match.test(txt)) continue;
            if (t.bicycle_rental === "docking_station" && !txt) continue;
            let op = "shared";
            for (const k of DOCKLESS) if (OPERATORS[k].match.test(txt)) { op = k; break; }
            if (dedupe.near(lng, lat, 8).length) continue;
            const bay = { lng, lat, op, name: t.name || "" };
            dedupe.add(bay); bays.push(bay);
        }
        if (bays.length < 80) throw new Error("Too few bays: " + bays.length);
        writeCache("sh_bays_v3", bays);
        return bays;
    } catch (err) {
        console.warn("Overpass unavailable, simulating bays.", err);
        S.baysSource = "sim";
        return simulateBays();
    }
}

function simulateBays() {
    const hubs = [
        [51.5145, -0.127, 60], [51.523, -0.085, 45], [51.5035, -0.1135, 40], [51.539, -0.1426, 30], [51.464, -0.115, 28],
        [51.48, -0.178, 22], [51.545, -0.055, 28], [51.5305, -0.1238, 30], [51.5155, -0.0922, 35], [51.505, -0.0235, 22],
        [51.4965, -0.144, 25], [51.5094, -0.1967, 20], [51.462, -0.138, 22], [51.483, -0.13, 20], [51.556, -0.1178, 18],
        [51.5462, -0.1036, 20], [51.475, -0.04, 15], [51.5118, -0.223, 12], [51.4613, -0.168, 15], [51.539, -0.002, 12],
    ];
    const r = mulberry32(7), out = [];
    for (const [lat, lng, n] of hubs) for (let i = 0, tries = 0; i < n && tries < n * 6; tries++) {
        const p = { lat: lat + gauss(r) * 0.006, lng: lng + gauss(r) * 0.009 };
        if (onWater(p.lng, p.lat) || riverInfo(p.lng, p.lat).d < 150) continue;
        const roll = r();
        out.push({ ...p, op: roll < 0.55 ? "shared" : roll < 0.78 ? "lime" : roll < 0.95 ? "forest" : "voi", name: "" });
        i++;
    }
    return out;
}

async function loadDocks() {
    try {
        const places = await fetchJson(CONFIG.TFL);
        S.santanderLive = true;
        return places.map((p) => {
            const pr = (k) => Number((p.additionalProperties || []).find((a) => a.key === k)?.value || 0);
            return { lng: p.lon, lat: p.lat, op: "santander", name: p.commonName, total: pr("NbBikes"), ebikes: pr("NbEBikes"), docks: pr("NbDocks") };
        });
    } catch (err) {
        console.warn("TfL unavailable, simulating docks.", err);
        S.santanderLive = false;
        const r = mulberry32(99);
        return simulateBays().slice(0, 780).map((b) => ({ ...b, op: "santander", name: "Docking station", total: Math.round(r() * 18), ebikes: Math.round(r() * 3), docks: 20 }));
    }
}

async function refreshDockCounts() {
    if (!S.santanderLive) return;
    try {
        const fresh = await loadDocks(), byName = new Map(fresh.map((d) => [d.name, d]));
        for (const n of S.nodes) if (n.op === "santander" && byName.has(n.name)) { const f = byName.get(n.name); n.total = f.total; n.ebikes = f.ebikes; }
    } catch { /* keep */ }
}

// ============================================================================
// Mesh + bikes
// ============================================================================
function buildMesh() {
    S.grid = new Grid(CONFIG.MESH_LINK_M);
    S.nodes.forEach((n, i) => { n.id = i; n.degree = 0; n.river = riverInfo(n.lng, n.lat); S.grid.add(n); });
    const seen = new Set();
    S.edges = [];
    const crossesRiver = (a, b) => a.river.d < 800 && b.river.d < 800 && a.river.side !== b.river.side;
    for (const n of S.nodes) {
        const near = S.grid.near(n.lng, n.lat, CONFIG.MESH_LINK_M).filter(([m]) => m !== n && !crossesRiver(n, m)).sort((a, b) => a[1] - b[1]).slice(0, CONFIG.MESH_MAX_LINKS);
        for (const [m] of near) {
            const key = n.id < m.id ? n.id + "-" + m.id : m.id + "-" + n.id;
            if (seen.has(key)) continue;
            seen.add(key); n.degree++; m.degree++;
            S.edges.push({ a: [n.lng, n.lat], b: [m.lng, m.lat] });
        }
    }
    const { s, w, n, e } = CONFIG.ZONE1;
    let cells = 0, cov = 0;
    for (let lat = s; lat <= n; lat += 100 / M_LAT) for (let lng = w; lng <= e; lng += 100 / M_LNG) {
        if (onWater(lng, lat)) continue;
        cells++; if (S.grid.near(lng, lat, CONFIG.COVER_M).length) cov++;
    }
    S.coverage = cells ? cov / cells : 0;
}

function generateBikes() {
    const idle = idleShare();
    for (const k of DOCKLESS) {
        const op = OPERATORS[k];
        const n = Math.round(op.fleet * CONFIG.ON_STREET * idle);
        let cands = S.nodes.filter((b) => b.op === k || b.op === "shared");
        if (!cands.length) cands = S.nodes.filter((b) => b.op !== "santander");
        const cum = []; let acc = 0;
        for (const b of cands) {
            const d = distM([b.lng, b.lat], [CONFIG.CENTER.lng, CONFIG.CENTER.lat]) / 1000;
            acc += (b.op === k ? 2 : 1) * (Math.exp(-d / 6) + 0.15);
            cum.push(acc);
            b.counts = b.counts || {}; b.counts[k] = 0;
        }
        const r = mulberry32(op.seed), pts = [];
        for (let i = 0; i < n; i++) {
            const x = r() * acc;
            let lo = 0, hi = cum.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
            const bay = cands[lo], inBay = r() < 0.78;
            pts.push({ p: landNear(bay, inBay ? 8 : 90, r), op: k });
            if (inBay) bay.counts[k]++;
        }
        S.bikes[k] = pts; S.counts[k] = n;
    }
    const r = mulberry32(OPERATORS.santander.seed), pts = [];
    let total = 0;
    for (const d of S.nodes) if (d.op === "santander") {
        total += d.total || 0;
        for (let i = 0; i < (d.total || 0); i++) pts.push({ p: [d.lng + (gauss(r) * 4) / M_LNG, d.lat + (gauss(r) * 4) / M_LAT], op: "santander" });
    }
    S.bikes.santander = pts; S.counts.santander = total;
    invalidate();
}

const nodeBikes = (n, filter = "all") => {
    if (n.op === "santander") return filter === "all" || filter === "santander" ? n.total || 0 : 0;
    if (filter === "all") return Object.values(n.counts || {}).reduce((a, b) => a + b, 0);
    if (filter === "santander") return 0;
    return n.counts?.[filter] || 0;
};
const nodeOps = (n) => (n.op === "santander" ? ["santander"] : DOCKLESS.filter((k) => n.counts?.[k]));

// ============================================================================
// Street lighting (OSM lit=*)
// ============================================================================
const LIGHT_TILE = 0.02;
function litValue(v) {
    v = (v || "").toLowerCase();
    if (v === "no" || v === "disused") return 0;
    if (v === "limited" || v === "interval") return 0.6;
    if (v === "yes" || v === "24/7" || v === "automatic" || v === "sunset-sunrise" || /^\d/.test(v)) return 1;
    return null;
}
function tilesFor(b, size) {
    const out = [];
    for (let y = Math.floor(b.s / size); y <= Math.floor(b.n / size); y++) for (let x = Math.floor(b.w / size); x <= Math.floor(b.e / size); x++) out.push([x, y]);
    return out;
}
async function ensureLighting(b, maxTiles = 12) {
    if (!S.lit.grid) S.lit.grid = new Grid(50);
    const need = tilesFor(b, LIGHT_TILE).filter(([x, y]) => !S.lit.tiles.has(x + "," + y) && !S.lit.pending.has(x + "," + y));
    if (!need.length) return true;
    if (need.length > maxTiles) return false;
    const xs = need.map((t) => t[0]), ys = need.map((t) => t[1]);
    const bb = { s: Math.min(...ys) * LIGHT_TILE, n: (Math.max(...ys) + 1) * LIGHT_TILE, w: Math.min(...xs) * LIGHT_TILE, e: (Math.max(...xs) + 1) * LIGHT_TILE };
    need.forEach(([x, y]) => S.lit.pending.add(x + "," + y));
    $("fab-light")?.classList.add("loading");
    try {
        const json = await overpass(`[out:json][timeout:30];way["highway"]["lit"](${bb.s},${bb.w},${bb.n},${bb.e});out tags geom;`);
        for (const el of json.elements || []) {
            if (el.type !== "way" || !el.geometry || S.lit.ways.has(el.id)) continue;
            const lit = litValue(el.tags?.lit);
            if (lit === null) continue;
            const path = el.geometry.map((g) => [g.lon, g.lat]);
            S.lit.ways.set(el.id, { path, lit });
            for (const p of densify(path, 15)) S.lit.grid.add({ lng: p[0], lat: p[1], lit });
        }
        need.forEach(([x, y]) => S.lit.tiles.add(x + "," + y));
        delete S.cache.lit;
        return true;
    } catch (e) { console.warn("Lighting fetch failed", e); return false; }
    finally {
        need.forEach(([x, y]) => S.lit.pending.delete(x + "," + y));
        if (!S.lit.pending.size) $("fab-light")?.classList.remove("loading");
    }
}
function lightAt(lng, lat) {
    if (!S.lit.grid) return null;
    const near = S.lit.grid.near(lng, lat, 22);
    if (!near.length) return null;
    near.sort((a, b) => a[1] - b[1]);
    return near[0][0].lit;
}
let lightTimer;
function refreshLighting() {
    if (!S.lightOn || !S.map) return;
    clearTimeout(lightTimer);
    lightTimer = setTimeout(async () => {
        if (S.map.getZoom() < CONFIG.LIGHT_MIN_ZOOM) { $("light-stats").textContent = "Zoom in closer to load street lighting"; return; }
        const b = S.map.getBounds();
        if (!b) return;
        const ne = b.getNorthEast(), sw = b.getSouthWest();
        $("light-stats").textContent = "Loading lighting for this area…";
        await ensureLighting({ s: sw.lat(), w: sw.lng(), n: ne.lat(), e: ne.lng() });
        updateLightStats();
        render();
    }, 350);
}
function updateLightStats() {
    let lit = 0, unlit = 0;
    for (const w of S.lit.ways.values()) (w.lit > 0 ? lit++ : unlit++);
    $("light-stats").textContent = S.lit.ways.size ? `${lit.toLocaleString()} lit and ${unlit.toLocaleString()} unlit streets mapped` : "Lit streets in yellow, unlit in red";
}

// ============================================================================
// Reported crime (data.police.uk, Metropolitan Police street-level data)
// ============================================================================
function toCrime(c) {
    if (!CATS[c.category]) return null;
    const lat = parseFloat(c.location?.latitude), lng = parseFloat(c.location?.longitude);
    if (!isFinite(lat)) return null;
    return { id: c.id, lat, lng, cat: c.category, street: (c.location?.street?.name || "").replace(/^On or near /i, ""), outcome: c.outcome_status?.category || "Under investigation", month: c.month };
}
function addCrimes(list) {
    if (!S.crime.grid) S.crime.grid = new Grid(60);
    for (const c of list) {
        if (!c || S.crime.ids.has(c.id)) continue;
        S.crime.ids.add(c.id); S.crime.grid.add(c);
        if (!S.crime.month || c.month > S.crime.month) S.crime.month = c.month;
    }
}
// only the five personal-safety categories: a fraction of the size of "all-crime"
async function policeQuery(params) {
    const lists = await pool(Object.keys(CATS), 3, (cat) => fetchJson(`${CONFIG.POLICE}/${cat}?${params}`));
    return lists.filter(Boolean).flat().map(toCrime).filter(Boolean);
}
const inArea = (a, lng, lat) => (a.r ? distM([lng, lat], [a.lng, a.lat]) <= a.r : lat >= a.s && lat <= a.n && lng >= a.w && lng <= a.e);
const crimeKnownAt = (lng, lat) => S.crime.areas.some((a) => inArea(a, lng, lat));
async function ensureCrimeArea(b) {
    const corners = [[b.w, b.s], [b.w, b.n], [b.e, b.s], [b.e, b.n]];
    if (corners.every(([x, y]) => crimeKnownAt(x, y))) return true;
    try {
        addCrimes(await policeQuery(`poly=${b.s},${b.w}:${b.n},${b.w}:${b.n},${b.e}:${b.s},${b.e}`));
        S.crime.areas.push(b);
        return true;
    } catch (e) { console.warn("Police data unavailable for this area", e); return false; }
}

// ============================================================================
// Rendering
// ============================================================================
function render() {
    if (!S.overlay) return;
    const L = [], night = S.night, insights = S.tab === "insights" && !S.navOn;
    const meshCol = night ? [110, 215, 255] : [0, 122, 255];

    if (S.lightOn && S.lit.ways.size) {
        if (!S.cache.lit) S.cache.lit = [...S.lit.ways.values()];
        const col = (w) => (w.lit >= 1 ? [255, 204, 0] : w.lit > 0 ? [255, 159, 10] : [255, 69, 58]);
        if (night) L.push(new deck.PathLayer({ id: "lit-glow", data: S.cache.lit.filter((w) => w.lit > 0), getPath: (d) => d.path, getColor: [255, 204, 0, 45], getWidth: 12, widthUnits: "pixels", capRounded: true }));
        L.push(new deck.PathLayer({ id: "lit", data: S.cache.lit, getPath: (d) => d.path, getColor: (d) => [...col(d), 215], getWidth: 3, widthUnits: "pixels", capRounded: true, jointRounded: true }));
    }

    if (S.meshOn && !insights) {
        L.push(new deck.ScatterplotLayer({ id: "coverage", data: S.nodes, getPosition: (d) => [d.lng, d.lat], getRadius: CONFIG.COVER_M, radiusUnits: "meters", getFillColor: [...meshCol, night ? 20 : 13], stroked: false }));
        L.push(new deck.LineLayer({ id: "mesh", data: S.edges, getSourcePosition: (d) => d.a, getTargetPosition: (d) => d.b, getColor: [...meshCol, night ? 120 : 85], getWidth: 1.2, widthUnits: "pixels" }));
    }

    if (!insights) {
        if (!S.cache.bikes) { let b = []; for (const k of OP_KEYS) if (S.visible[k]) b = b.concat(S.bikes[k]); S.cache.bikes = b; }
        L.push(new deck.ScatterplotLayer({ id: "bikes", data: S.cache.bikes, getPosition: (d) => d.p, getFillColor: (d) => OPERATORS[d.op].rgb, getRadius: 3.2, radiusUnits: "meters", radiusMinPixels: 1.3, radiusMaxPixels: 4.5 }));
    }

    const nodeVisible = (n) => (n.op === "shared" ? DOCKLESS.some((k) => S.visible[k]) : S.visible[n.op]);
    if (!S.cache.nodes) S.cache.nodes = S.nodes.filter(nodeVisible);
    L.push(new deck.ScatterplotLayer({
        id: "nodes", data: S.cache.nodes, pickable: !insights,
        getPosition: (d) => [d.lng, d.lat],
        getRadius: (d) => 7 + Math.min(9, Math.sqrt(nodeBikes(d)) * 1.6), radiusUnits: "meters", radiusMinPixels: 2.4, radiusMaxPixels: 11,
        getFillColor: (d) => [...(d.op === "shared" ? SHARED_RGB : OPERATORS[d.op].rgb), insights ? 60 : 255],
        stroked: !insights, getLineColor: [255, 255, 255], lineWidthMinPixels: 1.2,
        onClick: (info) => { if (info.object) { S.pickedAt = Date.now(); showCallout(info.object, info.x, info.y); } },
        updateTriggers: { getFillColor: [insights], getRadius: [S.counts.santander, S.counts.lime] },
    }));

    if (insights) {
        const hs = S.ins.hotspots;
        L.push(new deck.ScatterplotLayer({ id: "incidents", data: S.ins.incidents, getPosition: (d) => [d.lng, d.lat], getRadius: 12, radiusUnits: "meters", radiusMinPixels: 2, getFillColor: (d) => (d.cat === "safehouse-sos" ? [0, 122, 255, 230] : [...(CATS[d.cat]?.rgb || [255, 149, 0]), 150]) }));
        L.push(new deck.ScatterplotLayer({ id: "hot", data: hs, getPosition: (d) => [d.lng, d.lat], getRadius: (d, { index }) => (index === S.ins.open ? 260 : 200), radiusUnits: "meters", getFillColor: [255, 59, 48, 40], stroked: true, getLineColor: [255, 59, 48, 220], lineWidthMinPixels: 2, updateTriggers: { getRadius: [S.ins.open] } }));
        L.push(new deck.TextLayer({ id: "hot-n", data: hs, getPosition: (d) => [d.lng, d.lat], getText: (d, { index }) => String(index + 1), getSize: 15, getColor: [255, 255, 255], fontWeight: 800, background: true, getBackgroundColor: [255, 59, 48], backgroundPadding: [6, 3] }));
    }

    if (S.routes.length && (S.tab === "ride" || S.tab === "walk" || S.navOn)) {
        const sel = S.routes[S.selected], others = S.routes.filter((_, i) => i !== S.selected);
        const walk = S.routeKind === "walk";
        L.push(new deck.PathLayer({ id: "routes-alt", data: others, getPath: (d) => d.path, getColor: night ? [140, 140, 150, 200] : [150, 150, 160, 210], getWidth: 6, widthUnits: "pixels", capRounded: true, jointRounded: true }));
        L.push(new deck.PathLayer({ id: "route-casing", data: [sel], getPath: (d) => d.path, getColor: [255, 255, 255], getWidth: 11, widthUnits: "pixels", capRounded: true, jointRounded: true }));
        L.push(new deck.PathLayer({ id: "route-sel", data: [sel], getPath: (d) => d.path, getColor: walk ? [175, 82, 222] : [0, 122, 255], getWidth: 7, widthUnits: "pixels", capRounded: true, jointRounded: true }));
        if (sel.unlitRuns?.length) L.push(new deck.PathLayer({ id: "route-unlit", data: sel.unlitRuns, getPath: (d) => d, getColor: [255, 159, 10], getWidth: 7, widthUnits: "pixels", capRounded: true }));
        if (sel.safetyPoints) L.push(new deck.ScatterplotLayer({ id: "safety-points", data: sel.safetyPoints, getPosition: (d) => [d.lng, d.lat], getRadius: 22, radiusUnits: "meters", radiusMinPixels: 5, stroked: true, filled: false, getLineColor: [52, 199, 89, 230], lineWidthMinPixels: 2 }));
    }

    if (S.tab === "walk" && !S.navOn && S.walk.options.length) {
        L.push(new deck.ScatterplotLayer({ id: "walk-opts", data: S.walk.options, getPosition: (d) => [d.node.lng, d.node.lat], getRadius: (d, { index }) => (index === S.walk.selected ? 16 : 11), radiusUnits: "pixels", filled: false, stroked: true, getLineColor: (d, { index }) => (index === S.walk.selected ? [175, 82, 222] : [175, 82, 222, 120]), lineWidthMinPixels: 3, updateTriggers: { getRadius: [S.walk.selected], getLineColor: [S.walk.selected] } }));
    }

    if (S.watch?.trail.length) L.push(new deck.PathLayer({ id: "watch-trail", data: [S.watch.trail], getPath: (d) => d, getColor: S.watch.sos ? [255, 59, 48, 200] : [0, 122, 255, 180], getWidth: 5, widthUnits: "pixels", capRounded: true }));

    const pins = [];
    if (S.me && !S.navOn) pins.push({ p: [S.me.lng, S.me.lat], c: [0, 122, 255], r: 7 });
    if (S.origin && S.routes.length && !S.navOn) pins.push({ p: [S.origin.lng, S.origin.lat], c: [0, 122, 255], r: 7 });
    if (S.dest && S.routeKind === "ride" && S.routes.length) pins.push({ p: [S.dest.lng, S.dest.lat], c: [255, 59, 48], r: 8 });
    if (S.nav) pins.push({ p: S.nav.pos, c: S.routeKind === "walk" ? [175, 82, 222] : [0, 122, 255], r: 9 });
    if (S.watch?.last) pins.push({ p: [S.watch.last.lng, S.watch.last.lat], c: S.watch.sos ? [255, 59, 48] : [0, 122, 255], r: 10 });
    L.push(new deck.ScatterplotLayer({ id: "pins", data: pins, getPosition: (d) => d.p, getFillColor: (d) => d.c, getRadius: (d) => d.r, radiusUnits: "pixels", stroked: true, getLineColor: [255, 255, 255], lineWidthMinPixels: 3 }));

    S.overlay.setProps({ layers: L });
}
let renderQueued = false;
const renderSoon = () => { if (renderQueued) return; renderQueued = true; requestAnimationFrame(() => { renderQueued = false; render(); }); };

// ============================================================================
// Map styles + layers (single source of truth for every on/off control)
// ============================================================================
const STYLE_LIGHT = [
    { elementType: "geometry", stylers: [{ color: "#f2f2f4" }] }, { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#8a8a8e" }] }, { elementType: "labels.text.stroke", stylers: [{ color: "#f2f2f4" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] }, { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#e1eee1" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] }, { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] }, { featureType: "road", elementType: "geometry", stylers: [{ color: "#ffffff" }] },
    { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#a1a1a6" }] }, { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#e6e6ea" }] }, { featureType: "water", elementType: "geometry", stylers: [{ color: "#cde2f2" }] },
    { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
];
const STYLE_NIGHT = [
    { elementType: "geometry", stylers: [{ color: "#16181d" }] }, { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { elementType: "labels.text.fill", stylers: [{ color: "#6f7179" }] }, { elementType: "labels.text.stroke", stylers: [{ color: "#16181d" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] }, { featureType: "poi.park", elementType: "geometry", stylers: [{ visibility: "on" }, { color: "#1b2620" }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] }, { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "administrative.neighborhood", stylers: [{ visibility: "off" }] }, { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2c33" }] },
    { featureType: "road.local", elementType: "labels", stylers: [{ visibility: "off" }] }, { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#383b44" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: "#0c1822" }] }, { featureType: "water", elementType: "labels", stylers: [{ visibility: "off" }] },
];
const LAYER_NAMES = { mesh: "Safety mesh", light: "Street lighting", night: "Night map" };
function layerState(name) { return name === "mesh" ? S.meshOn : name === "light" ? S.lightOn : S.night; }
function setLayer(name, on, quiet = false) {
    if (name === "mesh") S.meshOn = on;
    if (name === "night") {
        S.night = on;
        document.body.classList.toggle("night", on);
        S.map?.setOptions({ styles: on ? STYLE_NIGHT : STYLE_LIGHT });
    }
    if (name === "light") {
        S.lightOn = on;
        if (on && S.map) { if (S.map.getZoom() < CONFIG.LIGHT_MIN_ZOOM) S.map.setZoom(CONFIG.LIGHT_MIN_ZOOM); refreshLighting(); }
    }
    document.querySelectorAll(`[data-layer="${name}"]`).forEach((el) => (el.tagName === "INPUT" ? (el.checked = on) : el.classList.toggle("on", on)));
    if (!quiet) { haptic(); toast(`${LAYER_NAMES[name]} ${on ? "on" : "off"}`); }
    renderSoon();
}

// ============================================================================
// Boot
// ============================================================================
async function initMap() {
    const h = new Date().getHours();
    const startNight = h >= 19 || h < 7 || window.matchMedia("(prefers-color-scheme: dark)").matches;
    S.map = new google.maps.Map($("map"), {
        center: CONFIG.CENTER, zoom: 14, styles: startNight ? STYLE_NIGHT : STYLE_LIGHT,
        disableDefaultUI: true, gestureHandling: "greedy", clickableIcons: false, keyboardShortcuts: false,
        restriction: { latLngBounds: { north: 51.75, south: 51.22, west: -0.62, east: 0.42 }, strictBounds: false },
    });
    S.overlay = new deck.GoogleMapsOverlay({ interleaved: false });
    S.overlay.setMap(S.map);
    setLayer("night", startNight, true);
    setLayer("mesh", true, true);
    wireUI();
    setSnap("half", false);

    const params = new URLSearchParams(location.search);
    if (params.get("watch")) startWatch(params.get("watch"), params.get("n") || "Your contact");

    splash("Loading live docks and bike bays");
    const [bays, docks] = await Promise.all([loadBays(), loadDocks()]);
    splash("Linking the safety mesh");
    S.nodes = bays.concat(docks);
    buildMesh();
    generateBikes();
    render();
    updateExplore();
    hideSplash();
    startMyLocation();

    // warm up the slower things in the background so tabs feel instant later
    setTimeout(() => { placesLib(); loadInsights(); }, 800);

    setInterval(async () => {
        await refreshDockCounts();
        generateBikes();
        if (!S.nav) render();
        updateExplore();
    }, CONFIG.REFRESH_MS);
}
window.initMap = initMap;

// ============================================================================
// Location
// ============================================================================
const inLondon = (p) => p && p.lat > CONFIG.BBOX.s && p.lat < CONFIG.BBOX.n && p.lng > CONFIG.BBOX.w && p.lng < CONFIG.BBOX.e;
function startMyLocation() {
    if (!navigator.geolocation) return;
    navigator.geolocation.watchPosition((p) => {
        const pos = { lat: p.coords.latitude, lng: p.coords.longitude, name: "Your location" };
        if (inLondon(pos)) { S.me = pos; if (!S.nav) renderSoon(); }
    }, () => { }, { enableHighAccuracy: true, maximumAge: 10000 });
}
let demoToastShown = false;
async function getOrigin() {
    if (S.me) return S.me;
    const pos = await new Promise((res) => {
        if (!navigator.geolocation) return res(null);
        navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, name: "Your location" }), () => res(null), { enableHighAccuracy: true, timeout: 5000, maximumAge: 30000 });
    });
    if (inLondon(pos)) { S.me = pos; return pos; }
    if (!demoToastShown) { toast(`Starting from ${CONFIG.DEMO_ORIGIN.name} for the demo`); demoToastShown = true; }
    return { ...CONFIG.DEMO_ORIGIN };
}
function currentPos() {
    if (S.nav) return { lng: S.nav.pos[0], lat: S.nav.pos[1] };
    return S.me || S.origin || CONFIG.DEMO_ORIGIN;
}

// ============================================================================
// Search with live autocomplete (Places API New), recents, geocoder fallback
// ============================================================================
let placesPromise = null, sessionToken = null, sugSeq = 0, sugTimer, sugItems = [], sugIndex = -1, placesWarned = false;
function placesLib() {
    if (!placesPromise) placesPromise = google.maps.importLibrary("places").catch((e) => (console.warn("Places library unavailable", e), null));
    return placesPromise;
}
async function fetchSuggestions(q) {
    const lib = await placesLib();
    if (!lib?.AutocompleteSuggestion) return null;
    sessionToken = sessionToken || new lib.AutocompleteSessionToken();
    const o = S.me || CONFIG.DEMO_ORIGIN;
    const { suggestions } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
        input: q, sessionToken, region: "gb", language: "en-GB", origin: { lat: o.lat, lng: o.lng },
        locationRestriction: { north: CONFIG.BBOX.n, south: CONFIG.BBOX.s, east: CONFIG.BBOX.e, west: CONFIG.BBOX.w },
    });
    return suggestions.filter((s) => s.placePrediction).slice(0, 6).map((s) => {
        const p = s.placePrediction;
        return { kind: "place", pred: p, main: p.mainText?.text || p.text?.text, matches: p.mainText?.matches || [], second: p.secondaryText?.text || "", dist: p.distanceMeters };
    });
}
function boldMatches(text, matches) {
    if (!matches?.length) return esc(text);
    let out = "", last = 0;
    for (const m of matches) { out += esc(text.slice(last, m.startOffset)) + "<b>" + esc(text.slice(m.startOffset, m.endOffset)) + "</b>"; last = m.endOffset; }
    return out + esc(text.slice(last));
}
const recents = () => store.get("sh_recent", []);
function saveRecent(d) {
    const list = recents().filter((r) => r.name !== d.name);
    list.unshift({ name: d.name, second: d.second || "", lat: d.lat, lng: d.lng });
    store.set("sh_recent", list.slice(0, 5));
}
function renderSuggestions(items, head) {
    sugItems = items; sugIndex = -1;
    const pinSvg = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
    const clockSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
    const searchSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>';
    $("suggest").innerHTML = (head ? `<div class="sug-head">${head}</div>` : "") + items.map((it, i) => `
    <button class="sug" data-i="${i}">
      <span class="pin ${it.kind !== "place" ? "recent" : ""}">${it.kind === "recent" ? clockSvg : it.kind === "query" ? searchSvg : pinSvg}</span>
      <span class="grow"><div class="main">${it.kind === "place" ? boldMatches(it.main, it.matches) : esc(it.main)}</div>${it.second ? `<div class="second">${esc(it.second)}</div>` : ""}</span>
      ${it.dist ? `<span class="dist">${fmtDist(it.dist)}</span>` : ""}
    </button>`).join("");
    $("suggest").querySelectorAll(".sug").forEach((el) => el.addEventListener("click", () => pickSuggestion(sugItems[Number(el.dataset.i)])));
}
function showRecents() {
    const r = recents();
    renderSuggestions(r.map((x) => ({ kind: "recent", main: x.name, second: x.second, lat: x.lat, lng: x.lng })), r.length ? "Recents" : "");
}
function onSearchInput() {
    const q = $("dest-input").value.trim();
    $("dest-x").hidden = !q;
    clearTimeout(sugTimer);
    if (!q) { showRecents(); return; }
    sugTimer = setTimeout(async () => {
        const seq = ++sugSeq;
        let items = null;
        try { items = await fetchSuggestions(q); } catch (e) { console.warn("Autocomplete failed", e); }
        if (seq !== sugSeq) return; // a newer keystroke won
        if (!items) {
            if (!placesWarned) { console.info("Enable 'Places API (New)' on your key for live suggestions."); placesWarned = true; }
            items = [];
        }
        items.push({ kind: "query", main: `Search for "${q}"`, q });
        renderSuggestions(items);
    }, 140);
}
async function pickSuggestion(it) {
    if (!it) return;
    haptic();
    const input = $("dest-input");
    input.value = it.kind === "query" ? it.q : it.main;
    input.blur();
    searchMode(false);
    rideStatus("Finding that place…");
    try {
        let dest;
        if (it.kind === "place") {
            const place = it.pred.toPlace();
            await place.fetchFields({ fields: ["displayName", "location", "formattedAddress"] });
            dest = { lat: place.location.lat(), lng: place.location.lng(), name: place.displayName || it.main, second: it.second };
            sessionToken = null;
        } else if (it.kind === "recent") dest = { lat: it.lat, lng: it.lng, name: it.main, second: it.second };
        else dest = await geocode(it.q);
        saveRecent(dest);
        planRide(dest);
    } catch (e) {
        console.warn(e);
        rideStatus("Couldn't find that place. Try another search, or tap the map.");
    }
}
function searchMode(on) {
    $("suggest").hidden = !on;
    $("ride-idle").hidden = on;
    $("route-list").hidden = on;
    $("ride-go-wrap").hidden = on || !S.routes.length;
    $("ride-cancel").hidden = !on;
    if (on) { setSnap("full"); if (!$("dest-input").value.trim()) showRecents(); else onSearchInput(); }
}

// ============================================================================
// Routing + SafeScore
// ============================================================================
function geocode(q) {
    return new Promise((res, rej) => {
        new google.maps.Geocoder().geocode({ address: q, bounds: { north: CONFIG.BBOX.n, south: CONFIG.BBOX.s, east: CONFIG.BBOX.e, west: CONFIG.BBOX.w }, componentRestrictions: { country: "GB" } }, (r, st) => {
            if (st === "OK" && r[0]) { const l = r[0].geometry.location; res({ lat: l.lat(), lng: l.lng(), name: r[0].formatted_address.split(",")[0] }); } else rej(new Error(st));
        });
    });
}
async function routesApi(o, d, mode, via) {
    const ll = (p) => ({ location: { latLng: { latitude: p.lat, longitude: p.lng } } });
    const body = { origin: ll(o), destination: ll(d), travelMode: mode, computeAlternativeRoutes: !via, polylineEncoding: "GEO_JSON_LINESTRING", units: "METRIC" };
    if (via) body.intermediates = [{ ...ll(via), via: true }];
    const json = await fetchJson("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Goog-Api-Key": CONFIG.GOOGLE_API_KEY, "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.polyline.geoJsonLinestring" },
        body: JSON.stringify(body),
    });
    if (!json.routes?.length) throw new Error("No routes");
    return json.routes.map((r) => ({ path: r.polyline.geoJsonLinestring.coordinates, seconds: parseInt(r.duration, 10), meters: r.distanceMeters }));
}
function directionsLegacy(o, d, mode, via) {
    return new Promise((res, rej) => {
        new google.maps.DirectionsService().route({
            origin: o, destination: d, travelMode: mode === "WALK" ? google.maps.TravelMode.WALKING : google.maps.TravelMode.BICYCLING,
            provideRouteAlternatives: !via, waypoints: via ? [{ location: via, stopover: false }] : [],
        }, (r, st) => {
            if (st !== "OK") return rej(new Error(st));
            res(r.routes.map((rt) => ({ path: rt.overview_path.map((p) => [p.lng(), p.lat()]), seconds: rt.legs.reduce((s, l) => s + l.duration.value, 0), meters: rt.legs.reduce((s, l) => s + l.distance.value, 0) })));
        });
    });
}
async function getRoutes(o, d, mode = "BICYCLE", via) {
    try { return await routesApi(o, d, mode, via); }
    catch (e) { console.warn("Routes API failed, trying legacy Directions", e); return directionsLegacy(o, d, mode, via); }
}
function routeBBox(routes, pad = 0.003) {
    const pts = routes.flatMap((r) => r.path);
    return { s: Math.min(...pts.map((p) => p[1])) - pad, n: Math.max(...pts.map((p) => p[1])) + pad, w: Math.min(...pts.map((p) => p[0])) - pad, e: Math.max(...pts.map((p) => p[0])) + pad };
}

// SafeScore weights shift with the time of day: lighting matters far more at night
function safeWeights(date = new Date()) {
    const h = date.getHours(), night = h >= 19 || h < 7;
    return night ? { mesh: 0.35, light: 0.3, crime: 0.25, dens: 0.1, night } : { mesh: 0.45, light: 0.1, crime: 0.3, dens: 0.15, night };
}
function scoreRoute(route) {
    const pts = densify(route.path);
    const covered = [], light = [], crimeAt = [], points = new Set(), crimes = new Set(), unlitRuns = [];
    let hits = 0, density = 0, lightSum = 0, unlitM = 0, run = null, crimeKnown = 0;
    for (const p of pts) {
        const near = S.grid.near(p[0], p[1], CONFIG.COVER_M);
        covered.push(near.length > 0);
        if (near.length) { hits++; density += near.length; near.forEach(([n]) => points.add(n)); }
        const l = lightAt(p[0], p[1]);
        light.push(l);
        lightSum += l === null ? CONFIG.ASSUMED_LIGHT : l;
        if (l === 0) { unlitM += 25; (run = run || []).push(p); } else if (run) { if (run.length > 1) unlitRuns.push(run); run = null; }
        let c = 0;
        if (S.crime.grid && crimeKnownAt(p[0], p[1])) {
            crimeKnown++;
            const cn = S.crime.grid.near(p[0], p[1], 60);
            c = cn.length; cn.forEach(([x]) => crimes.add(x));
        }
        crimeAt.push(c);
    }
    if (run && run.length > 1) unlitRuns.push(run);
    const km = Math.max(0.2, route.meters / 1000), w = safeWeights();
    const mesh = hits / pts.length, lightMean = lightSum / pts.length, dens = Math.min(1, density / pts.length / 5);
    const hasCrime = crimeKnown > pts.length * 0.5;
    const perKm = crimes.size / km, crimeScore = hasCrime ? 1 - Math.min(1, perKm / 30) : 0.6;
    Object.assign(route, {
        samples: pts, covered, light, crimeAt, coverShare: mesh, lightMean, unlitM, unlitRuns,
        safetyPoints: [...points], crimeNear: hasCrime ? crimes.size : null, crimeScore, weights: w,
        score: Math.round(100 * (w.mesh * mesh + w.light * lightMean + w.crime * crimeScore + w.dens * dens)),
    });
    return route;
}
function pickSafeVia(o, d) {
    const straight = distM([o.lng, o.lat], [d.lng, d.lat]);
    if (straight < 900) return null;
    const mid = { lng: (o.lng + d.lng) / 2, lat: (o.lat + d.lat) / 2 };
    const near = S.grid.near(mid.lng, mid.lat, Math.min(700, straight / 3));
    if (!near.length) return null;
    near.sort((a, b) => b[0].degree - a[0].degree || a[1] - b[1]);
    return { lat: near[0][0].lat, lng: near[0][0].lng };
}
async function enrichRoutes(routes, statusFn) {
    statusFn?.("Checking lighting and reported crime along each route…");
    const bb = routeBBox(routes, 0.002);
    await Promise.all([ensureLighting(routeBBox(routes), 40), ensureCrimeArea(bb)]);
    routes.forEach(scoreRoute);
}

let planSeq = 0;
async function planRide(dest) {
    const seq = ++planSeq;
    S.dest = dest; S.routeKind = "ride";
    hideCallout();
    searchMode(false);
    rideStatus(`Finding safe routes to ${dest.name}…`);
    $("route-list").innerHTML = '<div class="skel"></div><div class="skel"></div>';
    $("ride-go-wrap").hidden = true;
    try {
        S.origin = await getOrigin();
        const [base, viaRoutes] = await Promise.all([
            getRoutes(S.origin, dest, "BICYCLE"),
            (async () => { const via = pickSafeVia(S.origin, dest); return via ? getRoutes(S.origin, dest, "BICYCLE", via).catch(() => []) : []; })(),
        ]);
        let routes = base.concat(viaRoutes);
        routes = routes.filter((r, i) => !routes.slice(0, i).some((q) => Math.abs(q.meters - r.meters) < 40 && Math.abs(q.seconds - r.seconds) < 30));
        if (seq !== planSeq) return;
        fitTo(routes.flatMap((r) => r.path));
        await enrichRoutes(routes, rideStatus);
        if (seq !== planSeq) return;
        routes.sort((a, b) => b.score - a.score || a.seconds - b.seconds);
        const fastest = routes.reduce((m, r) => (r.seconds < m.seconds ? r : m), routes[0]);
        routes.forEach((r, i) => { r.safest = i === 0; r.fastest = r === fastest; });
        S.routes = routes; S.selected = 0;
        renderRouteList();
        render();
        const w = routes[0].weights;
        rideStatus(`${routes.length} route${routes.length > 1 ? "s" : ""} to ${dest.name}, ranked by SafeScore${w.night ? " (night weighting)" : ""}`);
    } catch (err) {
        console.error(err);
        $("route-list").innerHTML = "";
        rideStatus("Couldn't get routes. Check that Routes API is enabled on your key.");
    }
}
function ringSvg(score) {
    const col = score >= 75 ? "#34c759" : score >= 55 ? "#ff9f0a" : "#ff3b30", C = 2 * Math.PI * 17;
    return `<svg class="ring" viewBox="0 0 44 44"><circle cx="22" cy="22" r="17" fill="none" stroke="rgba(127,127,127,.2)" stroke-width="5"/><circle cx="22" cy="22" r="17" fill="none" stroke="${col}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * score) / 100} ${C}" transform="rotate(-90 22 22)"/><text x="22" y="26.5" text-anchor="middle" font-size="12.5" font-weight="700" fill="currentColor">${score}</text></svg>`;
}
function factorsHtml(r) {
    return `<div class="factors"><span>Mesh <b>${Math.round(r.coverShare * 100)}</b></span><span>Light <b>${Math.round(r.lightMean * 100)}</b></span><span>Crime <b>${r.crimeNear == null ? "–" : Math.round(r.crimeScore * 100)}</b></span></div>`;
}
function renderRouteList() {
    $("route-list").innerHTML = S.routes.map((r, i) => {
        const pills = [
            r.safest ? '<span class="pill safe">Safest</span>' : "",
            r.fastest ? '<span class="pill fast">Fastest</span>' : "",
            r.unlitM >= 100 ? `<span class="pill warn">${fmtDist(r.unlitM)} unlit</span>` : '<span class="pill lit">Well lit</span>',
            r.crimeNear != null && r.crimeNear / Math.max(0.2, r.meters / 1000) > 20 ? `<span class="pill risk">${r.crimeNear} reports nearby</span>` : "",
        ].join("");
        return `<button class="opt ${i === S.selected ? "sel" : ""}" data-i="${i}">
      <div class="time">${fmtMin(r.seconds)}<small> min</small></div>
      <div class="mid"><div class="lab">${pills}</div>
      <div class="meta">${(r.meters / 1000).toFixed(1)} km · ${r.safetyPoints.length} SafeHouse points${r.crimeNear != null ? ` · ${r.crimeNear} police reports within 60 m (${monthLabel(S.crime.month)})` : ""}</div>
      ${factorsHtml(r)}</div>
      ${ringSvg(r.score)}</button>`;
    }).join("");
    $("route-list").querySelectorAll(".opt").forEach((el) => el.addEventListener("click", () => { haptic(); S.selected = Number(el.dataset.i); renderRouteList(); renderSoon(); }));
    $("ride-go-wrap").hidden = false;
    $("ride-go").textContent = S.routes[S.selected].safest ? "Start safest route" : "Start this route";
}
function fitTo(coords) {
    const b = new google.maps.LatLngBounds();
    coords.forEach(([lng, lat]) => b.extend({ lat, lng }));
    const desktop = window.innerWidth >= 900;
    S.map.fitBounds(b, desktop ? { top: 80, bottom: 40, left: 440, right: 90 } : { top: 90, bottom: S.sheetVisible + 20, left: 30, right: 74 });
}

// ============================================================================
// Walk me to a bike
// ============================================================================
async function findBikes(force = false) {
    const o = await getOrigin();
    S.origin = o; S.routeKind = "walk";
    const key = `${S.walk.filter}|${o.lat.toFixed(3)},${o.lng.toFixed(3)}`;
    if (!force && S.walk.cache?.key === key && Date.now() - S.walk.cache.t < 90_000) {
        S.walk.options = S.walk.cache.options;
        selectWalk(S.walk.selected || 0, true);
        return;
    }
    $("walk-list").innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    $("walk-go-wrap").hidden = true;
    S.routes = []; renderSoon();
    $("walk-sub").textContent = `From ${o.name}, ranked by distance, mesh links, lighting and reported crime`;
    const f = S.walk.filter;
    await Promise.all([
        ensureLighting({ s: o.lat - 0.012, n: o.lat + 0.012, w: o.lng - 0.018, e: o.lng + 0.018 }, 8),
        ensureCrimeArea({ s: o.lat - 0.012, n: o.lat + 0.012, w: o.lng - 0.018, e: o.lng + 0.018 }),
    ]);
    const cands = S.grid.near(o.lng, o.lat, 1500)
        .filter(([n]) => nodeBikes(n, f) > 0)
        .map(([n, d]) => {
            const light = lightAt(n.lng, n.lat), crime = S.crime.grid ? S.crime.grid.near(n.lng, n.lat, 80).length : 0;
            return { node: n, d, cost: d + (4 - Math.min(4, n.degree)) * 70 + (light === 0 ? 250 : 0) + crime * 25 };
        })
        .sort((a, b) => a.cost - b.cost).slice(0, 3);
    if (!cands.length) {
        $("walk-list").innerHTML = '<div class="hint">No bikes within 1.5 km for this filter. Try another operator.</div>';
        renderSoon(); return;
    }
    await Promise.all(cands.map(async (c) => {
        try { c.route = (await getRoutes(o, { lat: c.node.lat, lng: c.node.lng }, "WALK"))[0]; }
        catch { c.route = { path: [[o.lng, o.lat], [c.node.lng, c.node.lat]], meters: c.d * 1.3, seconds: (c.d * 1.3) / 1.35 }; }
        scoreRoute(c.route);
    }));
    S.walk.options = cands; S.walk.cache = { key, t: Date.now(), options: cands };
    selectWalk(0, true);
}
function nodeTitle(n) {
    if (n.op === "santander") return n.name;
    if (n.op === "shared") return "Shared e-bike bay";
    return `${OPERATORS[n.op].name} bay`;
}
function renderWalkList() {
    const f = S.walk.filter;
    $("walk-list").innerHTML = S.walk.options.map((c, i) => {
        const n = c.node, ops = nodeOps(n).filter((k) => f === "all" || f === k);
        const breakdown = n.op === "santander" ? `${n.total} Santander${n.ebikes ? ` (${n.ebikes} e-bikes)` : ""}` : ops.map((k) => `${n.counts[k]} ${OPERATORS[k].name}`).join(" · ");
        const pills = [`<span class="pill safe">${n.degree} mesh links</span>`, c.route.unlitM >= 60 ? `<span class="pill warn">${fmtDist(c.route.unlitM)} unlit</span>` : '<span class="pill lit">Lit path</span>'].join("");
        const unlock = ops[0] ? `<button class="open-app" data-app="${ops[0]}">Unlock in ${OPERATORS[ops[0]].name}</button>` : "";
        return `<div class="opt ${i === S.walk.selected ? "sel" : ""}" data-i="${i}" role="button" tabindex="0">
      <div class="time">${fmtMin(c.route.seconds)}<small> min</small></div>
      <div class="mid"><div class="lab">${esc(nodeTitle(n))}</div>
      <div class="meta">${breakdown} · ${fmtDist(c.route.meters)} walk</div>
      <div class="lab" style="margin-top:5px">${pills}</div>${unlock}</div>
      ${ringSvg(c.route.score)}</div>`;
    }).join("");
    $("walk-list").querySelectorAll(".opt").forEach((el) => el.addEventListener("click", (e) => {
        const app = e.target.closest("[data-app]");
        if (app) { e.stopPropagation(); openApp(app.dataset.app); return; }
        haptic(); selectWalk(Number(el.dataset.i));
    }));
    $("walk-go-wrap").hidden = false;
}
function selectWalk(i, fit = false) {
    S.walk.selected = i;
    const c = S.walk.options[i];
    if (!c) return;
    S.routes = [c.route]; S.selected = 0;
    S.dest = { lat: c.node.lat, lng: c.node.lng, name: nodeTitle(c.node) };
    renderWalkList();
    if (fit) fitTo(S.walk.options.flatMap((o) => o.route.path));
    renderSoon();
}

// ============================================================================
// Open the operator's own app (App Store / Play Store IDs verified)
// ============================================================================
function openApp(k) {
    const o = OPERATORS[k];
    if (!o) return;
    haptic(12);
    if (isIOS) {
        // Opens the App Store listing; it shows "Open" if the app is already installed
        window.location.href = `https://apps.apple.com/gb/app/id${o.app.ios}`;
    } else if (isAndroid) {
        // Launches the app directly if installed, otherwise its Play Store page
        const fallback = encodeURIComponent(`https://play.google.com/store/apps/details?id=${o.app.android}`);
        window.location.href = `intent://#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${o.app.android};S.browser_fallback_url=${fallback};end`;
    } else {
        toast(`On a phone this opens the ${o.name} app`);
        window.open(o.app.web, "_blank", "noopener");
    }
}

// ============================================================================
// Simulated navigation (ride or walk)
// ============================================================================
function startNav() {
    const r = S.routes[S.selected];
    if (!r) return;
    haptic(15);
    S.navOn = true;
    S.nav = { route: r, pos: r.samples[0], t0: performance.now() };
    showPanel("nav");
    $("seg").style.display = "none";
    $("search-pill").classList.add("away");
    $("fabs").style.opacity = "0";
    $("fabs").style.pointerEvents = "none";
    $("nav-banner").hidden = false;
    $("nav-arrive").hidden = true;
    $("nav-share").hidden = false;
    $("nav-share").textContent = S.share ? "Send link to " + (contact().name || "your contact") : "Share live trip";
    setSnap("peek");
    S.map.setZoom(16);
    S.map.panTo({ lat: r.samples[0][1], lng: r.samples[0][0] });
    const c = contact();
    if (store.get("sh_auto", false) && c.phone) { startSharing("trip"); toast(`Sharing this trip with ${c.name}`); }
    requestAnimationFrame(navStep);
}
function runAhead(arr, i, test) { let m = 0; for (let j = i; j < arr.length && test(arr[j], j); j++) m += 25; return m; }
function navStep(now) {
    if (!S.nav) return;
    const r = S.nav.route, speed = r.meters / r.seconds;
    const i = Math.min(r.samples.length - 1, Math.floor((((now - S.nav.t0) / 1000) * speed * CONFIG.SPEEDUP[S.routeKind]) / 25));
    S.nav.pos = r.samples[i];
    const banner = $("nav-banner");
    if (r.light[i] === 0) {
        banner.className = "banner dark"; $("nb-t").textContent = "Unlit stretch";
        $("nb-s").textContent = `Lighting returns in ${fmtDist(runAhead(r.light, i, (v) => v === 0))} · stay alert`;
    } else if (r.crimeAt[i] >= 4) {
        banner.className = "banner risk"; $("nb-t").textContent = "Higher-risk stretch";
        $("nb-s").textContent = `${r.crimeAt[i]} incidents reported here last month`;
    } else if (!r.covered[i]) {
        banner.className = "banner out"; $("nb-t").textContent = "Mesh gap ahead";
        $("nb-s").textContent = `Back in coverage in ${fmtDist(runAhead(r.covered, i, (v) => !v))}`;
    } else {
        banner.className = "banner in"; $("nb-t").textContent = "Inside the safety mesh";
        $("nb-s").textContent = `SafeHouse point within ${CONFIG.COVER_M} m · covered for ${fmtDist(runAhead(r.covered, i, (v) => v))}`;
    }
    const leftM = Math.max(0, r.meters - i * 25), leftS = leftM / speed;
    $("nav-eta").textContent = fmtMin(leftS) + " min";
    $("nav-meta").textContent = `${fmtDist(leftM)} left · arrive ${new Date(Date.now() + leftS * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    if (i % 4 === 0) S.map.panTo({ lat: S.nav.pos[1], lng: S.nav.pos[0] });
    render();
    if (i >= r.samples.length - 1) return arrive();
    requestAnimationFrame(navStep);
}
function arrive() {
    haptic([20, 40, 20]);
    $("nav-eta").textContent = "Arrived";
    $("nav-meta").textContent = S.routeKind === "walk" ? `You're at ${S.dest?.name || "your bike"}` : `You've arrived at ${S.dest?.name || "your destination"}`;
    $("nav-banner").className = "banner in";
    $("nb-t").textContent = "You've arrived safely";
    $("nb-s").textContent = S.share ? "Your contact has been told you've arrived" : "Trip complete";
    if (S.share) { publishShare({ type: "arrived" }); setTimeout(stopSharing, 1500); }
    const node = S.routeKind === "walk" ? S.walk.options[S.walk.selected]?.node : null;
    if (node) {
        const op = nodeOps(node)[0] || (node.op === "shared" ? "lime" : node.op);
        $("nav-arrive").dataset.app = op;
        $("nav-arrive").textContent = `Open ${OPERATORS[op].name} to unlock`;
        $("nav-arrive").hidden = false;
        $("nav-share").hidden = true;
    }
    S.nav = null;
    render();
}
function endNav() {
    S.nav = null; S.navOn = false;
    if (S.share && S.share.reason === "trip") stopSharing();
    $("nav-banner").hidden = true;
    $("seg").style.display = "";
    $("search-pill").classList.remove("away");
    $("fabs").style.opacity = ""; $("fabs").style.pointerEvents = "";
    showTab(S.routeKind === "walk" ? "walk" : "ride");
    setSnap("half");
    render();
}

// ============================================================================
// Trusted contact + live location (SMS / WhatsApp + ntfy.sh)
// ============================================================================
const contact = () => store.get("sh_contact", { me: "", name: "", phone: "" });
function normPhone(p) {
    let d = (p || "").replace(/[^\d+]/g, "");
    if (d.startsWith("00")) d = "+" + d.slice(2);
    if (d.startsWith("07")) d = "+44" + d.slice(1);
    return d;
}
const smsHref = (phone, body) => `sms:${normPhone(phone)}${isIOS ? "&" : "?"}body=${encodeURIComponent(body)}`;
const waHref = (phone, body) => `https://wa.me/${normPhone(phone).replace("+", "")}?text=${encodeURIComponent(body)}`;
const newTopic = () => "safehouse-" + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
const appUrl = () => location.origin + location.pathname;
const watchLink = (topic) => `${appUrl()}?watch=${topic}&n=${encodeURIComponent(contact().me || "Your contact")}`;

async function publish(topic, payload, opts = {}) {
    const qs = new URLSearchParams();
    if (opts.title) qs.set("title", opts.title);
    if (opts.priority) qs.set("priority", opts.priority);
    if (opts.tags) qs.set("tags", opts.tags);
    try { await fetch(`${CONFIG.NTFY}/${topic}?${qs}`, { method: "POST", body: JSON.stringify(payload) }); }
    catch (e) { console.warn("Live share publish failed", e); }
}
function publishShare(extra = {}) {
    if (!S.share) return;
    const p = currentPos(), me = contact().me || "Someone", sos = S.share.reason === "sos";
    publish(S.share.topic, { type: sos ? "sos" : "trip", name: me, lat: p.lat, lng: p.lng, t: Date.now(), ...extra },
        sos ? { title: `SOS from ${me}`, priority: "urgent", tags: "rotating_light" } : { title: `${me} is sharing a trip` });
}
function startSharing(reason) {
    if (S.share) { if (reason === "sos") S.share.reason = "sos"; publishShare(); return S.share; }
    S.share = { topic: newTopic(), reason, started: Date.now() };
    publishShare();
    S.share.timer = setInterval(publishShare, CONFIG.SHARE_EVERY_MS);
    $("nav-share").textContent = "Send link to " + (contact().name || "your contact");
    return S.share;
}
function stopSharing() {
    if (!S.share) return;
    publishShare({ type: "ended" });
    clearInterval(S.share.timer);
    S.share = null;
    $("nav-share").textContent = "Share live trip";
}
function shareMessage(kind) {
    const c = contact(), p = currentPos(), link = watchLink(S.share.topic);
    const maps = `https://maps.google.com/?q=${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    return kind === "sos"
        ? `SOS from ${c.me || "me"} via SafeHouse. I need help. Live location: ${link}\nLast known: ${maps}`
        : `${c.me || "I"}'m sharing my trip with you on SafeHouse. Follow me live: ${link}`;
}
function openText(kind) {
    const c = contact();
    if (!c.phone) { openSettings(); toast("Add a trusted contact first"); return; }
    if (!S.share) startSharing(kind === "sos" ? "sos" : "trip");
    window.location.href = smsHref(c.phone, shareMessage(kind));
}

async function startWatch(topic, name) {
    S.watch = { topic, name, trail: [], last: null, sos: false, ended: false };
    $("watch-banner").hidden = false;
    $("search-pill").classList.add("away");
    $("wb-initial").textContent = (name[0] || "?").toUpperCase();
    $("wb-t").textContent = `Following ${name}`;
    const handle = (m) => {
        let p; try { p = JSON.parse(m.message); } catch { return; }
        if (typeof p.lat === "number") { S.watch.last = p; S.watch.trail.push([p.lng, p.lat]); }
        if (p.type === "sos") S.watch.sos = true;
        if (p.type === "arrived") S.watch.ended = "arrived";
        else if (p.safe) S.watch.ended = "safe";
        else if (p.type === "ended" && !S.watch.ended) S.watch.ended = "ended";
        updateWatch();
    };
    try {
        const txt = await (await fetch(`${CONFIG.NTFY}/${topic}/json?poll=1&since=2h`)).text();
        txt.split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === "message").forEach(handle);
    } catch (e) { console.warn(e); }
    const es = new EventSource(`${CONFIG.NTFY}/${topic}/sse`);
    es.onmessage = (e) => { const m = JSON.parse(e.data); if (m.event === "message") { handle(m); if (S.watch.sos) haptic([100, 50, 100]); } };
    setInterval(updateWatch, 5000);
}
function updateWatch() {
    const w = S.watch;
    if (!w) return;
    if (w.last) {
        const ago = Math.round((Date.now() - w.last.t) / 1000);
        $("wb-s").textContent = w.ended === "arrived" ? "Arrived safely" : w.ended === "safe" ? "Says they're safe now" : w.ended ? "Stopped sharing" : w.sos ? `Needs help · updated ${ago}s ago` : `Live · updated ${ago < 60 ? ago + "s" : Math.round(ago / 60) + " min"} ago`;
        $("wb-dir").href = `https://www.google.com/maps/dir/?api=1&destination=${w.last.lat},${w.last.lng}`;
        if (S.map) S.map.panTo({ lat: w.last.lat, lng: w.last.lng });
    }
    $("watch-banner").className = "banner " + (w.sos && !w.ended ? "alert" : "in");
    $("wb-t").textContent = w.sos && !w.ended ? `SOS from ${w.name}` : `Following ${w.name}`;
    renderSoon();
}

function openSettings() {
    const c = contact();
    $("set-me").value = c.me; $("set-name").value = c.name; $("set-phone").value = c.phone;
    $("set-auto").checked = store.get("sh_auto", false);
    $("set-pick").hidden = !("contacts" in navigator && "ContactsManager" in window);
    $("modal-safety").hidden = false;
}
function saveSettings() {
    const c = { me: $("set-me").value.trim(), name: $("set-name").value.trim() || "your contact", phone: $("set-phone").value.trim() };
    if (c.phone && normPhone(c.phone).replace(/\D/g, "").length < 10) { toast("That number looks too short"); return false; }
    store.set("sh_contact", c);
    store.set("sh_auto", $("set-auto").checked);
    $("btn-safety").classList.toggle("set", !!c.phone);
    return true;
}
function triggerSOS() {
    haptic([60, 40, 60]);
    const here = currentPos();
    const near = S.grid ? S.grid.near(here.lng, here.lat, 600).sort((a, b) => a[1] - b[1]) : [];
    $("sos-1").textContent = near[0] ? `Nearest bike point located, ${Math.round(near[0][1])} m away` : "Nearest bike point located";
    $("sos-sub").textContent = `${Math.min(near.length, 6)} SafeHouse points nearby activated`;
    startSharing("sos");
    const c = contact();
    $("sos-4").textContent = c.phone ? `Live location ready to send to ${c.name}` : "Live location sharing started";
    $("sos-text").textContent = c.phone ? `Text ${c.name} my live location` : "Add a trusted contact";
    $("sos-wa").href = c.phone ? waHref(c.phone, shareMessage("sos")) : "#";
    $("sos-wa").style.display = c.phone ? "" : "none";
    const m = $("modal-sos");
    m.hidden = false;
    m.querySelectorAll(".step").forEach((s, i) => { s.classList.remove("done"); setTimeout(() => s.classList.add("done"), 250 + i * 380); });
    const mine = store.get("sh_reports", []);
    mine.push({ id: "sos-" + Date.now(), lng: here.lng, lat: here.lat, cat: "safehouse-sos", street: "SafeHouse SOS", outcome: "Reported via SafeHouse", month: new Date().toISOString().slice(0, 7) });
    store.set("sh_reports", mine.slice(-50));
    if (S.ins.state === "ready") buildHotspots();
}

// ============================================================================
// Pattern to Pavement: real police reports on named streets
// ============================================================================
let insightsPromise = null;
function loadInsights() {
    if (insightsPromise) return insightsPromise;
    S.ins.state = "loading";
    if (S.tab === "insights") renderInsights();
    insightsPromise = (async () => {
        const cached = readCache("sh_police_v2", 3 * 864e5);
        let list = cached;
        if (!list) {
            try {
                const results = await pool(HUBS, 3, (h) => policeQuery(`lat=${h.lat}&lng=${h.lng}`));
                list = results.filter(Boolean).flat();
                if (list.length < 50) throw new Error("Too little police data");
                writeCache("sh_police_v2", list);
            } catch (e) {
                console.warn("Police API unavailable, using simulated reports", e);
                S.ins.source = "sim";
                list = simulateReports();
            }
        }
        addCrimes(list.filter((c) => !c.sim));
        if (S.ins.source === "police") HUBS.forEach((h) => S.crime.areas.push({ lat: h.lat, lng: h.lng, r: 1600 }));
        const seen = new Set();
        S.ins.base = list.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
        S.ins.month = list.reduce((m, c) => (c.month > m ? c.month : m), "");
        buildHotspots();
        S.ins.state = "ready";
        if (S.tab === "insights") { renderInsights(); renderSoon(); }
    })();
    return insightsPromise;
}
function simulateReports() {
    const r = mulberry32(404), out = [], cats = Object.keys(CATS), month = new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 7);
    const streets = ["High Street", "Station Road", "Church Street", "Market Row", "Nightclub", "Parking Area"];
    for (const h of HUBS) for (let i = 0; i < 120; i++) {
        const lat = h.lat + (gauss(r) * 350) / M_LAT, lng = h.lng + (gauss(r) * 350) / M_LNG;
        if (onWater(lng, lat)) continue;
        out.push({ id: `sim-${h.name}-${i}`, lat, lng, cat: cats[Math.floor(r() * r() * cats.length)], street: streets[Math.floor(r() * streets.length)], outcome: "Investigation complete; no suspect identified", month, sim: true });
    }
    return out;
}
const GENERIC_STREET = /^(parking area|supermarket|nightclub|petrol station|shopping area|sports\/recreation area|pedestrian subway|further\/higher educational building|theatre\/concert hall|conference\/exhibition centre|bus\/coach station|police station|hospital|park\/open space|hotel\/motel|university|underground station|railway station)$/i;
function buildHotspots() {
    const all = (S.ins.base || []).concat(store.get("sh_reports", []));
    for (const c of all) if (c.inMesh === undefined) c.inMesh = S.grid ? S.grid.near(c.lng, c.lat, CONFIG.COVER_M).length > 0 : false;
    S.ins.incidents = all;
    const cells = new Map();
    for (const c of all) {
        const [x, y] = toXY(c.lng, c.lat), k = Math.floor(x / 220) + "," + Math.floor(y / 220);
        if (!cells.has(k)) cells.set(k, []);
        cells.get(k).push(c);
    }
    S.ins.hotspots = [...cells.values()].sort((a, b) => b.length - a.length).slice(0, 8).map((list) => {
        const lat = list.reduce((s, c) => s + c.lat, 0) / list.length, lng = list.reduce((s, c) => s + c.lng, 0) / list.length;
        const streets = {};
        list.forEach((c) => { if (c.street) streets[c.street] = (streets[c.street] || 0) + 1; });
        const ranked = Object.entries(streets).sort((a, b) => b[1] - a[1]);
        const street = (ranked.find(([s]) => !GENERIC_STREET.test(s)) || ranked[0] || ["Unnamed street"])[0];
        const hub = HUBS.reduce((best, h) => (distM([h.lng, h.lat], [lng, lat]) < distM([best.lng, best.lat], [lng, lat]) ? h : best), HUBS[0]);
        const cats = {};
        list.forEach((c) => (cats[c.cat] = (cats[c.cat] || 0) + 1));
        return {
            lat, lng, list, count: list.length, street, hub, cats,
            gap: list.filter((c) => !c.inMesh).length / list.length,
            violent: (cats["violent-crime"] || 0) / list.length,
            acquisitive: ((cats["robbery"] || 0) + (cats["theft-from-the-person"] || 0)) / list.length,
            mine: list.filter((c) => c.cat === "safehouse-sos").length,
            unlit: null,
        };
    });
}

const wikiCache = {};
function wikiPhoto(title) {
    if (!wikiCache[title]) {
        wikiCache[title] = fetchJson(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)
            .then((j) => ({ thumb: j.thumbnail?.source, full: j.originalimage?.source || j.thumbnail?.source, page: j.content_urls?.mobile?.page }))
            .catch(() => ({}));
    }
    return wikiCache[title];
}

function renderInsights() {
    if (S.ins.state !== "ready") {
        $("ins-stats").innerHTML = '<div class="skel" style="grid-column:1/-1;height:70px"></div>';
        $("hotspots").innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div>';
        $("ins-src").textContent = "Loading the latest Metropolitan Police street-level data…";
        return;
    }
    const all = S.ins.incidents, n = all.length || 1, real = S.ins.source === "police";
    const violent = all.filter((c) => c.cat === "violent-crime").length / n;
    const gap = all.filter((c) => !c.inMesh).length / n;
    $("ins-sub").textContent = real ? `Police reports from ${monthLabel(S.ins.month)}, turned into action` : "Simulated reports (police data unavailable)";
    $("ins-stats").innerHTML = `
    <div class="stat"><div class="v">${all.length.toLocaleString()}</div><div class="k">safety reports in 10 nightlife areas</div></div>
    <div class="stat"><div class="v">${Math.round(violent * 100)}%</div><div class="k">violence or sexual offences</div></div>
    <div class="stat"><div class="v">${Math.round(gap * 100)}%</div><div class="k">outside the safety mesh</div></div>`;
    $("ins-title").textContent = `Hotspots · ${monthLabel(S.ins.month)}`;
    const sent = store.get("sh_sent", {});
    $("hotspots").innerHTML = S.ins.hotspots.map((h, i) => {
        const open = i === S.ins.open, key = h.lat.toFixed(4) + "," + h.lng.toFixed(4);
        const topCat = Object.entries(h.cats).sort((a, b) => b[1] - a[1])[0];
        const catLabel = CATS[topCat?.[0]]?.short || "SafeHouse SOS";
        return `<div class="hot">
      <button class="hot-head" data-i="${i}">
        <div class="hot-thumb"><img data-wiki="${h.hub.wiki}" alt="" /><span>${i + 1}</span></div>
        <div class="grow"><div class="rt">${esc(h.street)}</div><div class="rs">${esc(h.hub.name)} · ${h.count} reports · mostly ${catLabel.toLowerCase()}${h.mine ? ` · ${h.mine} from you` : ""}</div></div>
        <svg class="chev" width="10" height="16" viewBox="0 0 10 16" style="transform:rotate(${open ? 90 : 0}deg);transition:transform .25s"><path d="M2 2l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
      </button>
      ${open ? hotBody(h, i, sent[key]) : ""}
    </div>`;
    }).join("");
    $("hotspots").querySelectorAll("img[data-wiki]").forEach(async (img) => { const p = await wikiPhoto(img.dataset.wiki); if (p.thumb) img.src = p.thumb; });
    $("hotspots").querySelectorAll(".hot-head").forEach((el) => el.addEventListener("click", () => openHotspot(Number(el.dataset.i))));
    $("hotspots").querySelectorAll("[data-report]").forEach((el) => el.addEventListener("click", () => sendReport(Number(el.dataset.report))));
    $("hotspots").querySelectorAll("[data-copy]").forEach((el) => el.addEventListener("click", async () => {
        try { await navigator.clipboard.writeText(reportText(S.ins.hotspots[Number(el.dataset.copy)])); toast("Report copied"); } catch { toast("Couldn't copy"); }
    }));
    $("ins-src").innerHTML = real
        ? `Source: <a href="https://data.police.uk" target="_blank" rel="noopener">data.police.uk</a>, Metropolitan Police street-level crime, ${monthLabel(S.ins.month)}. Locations are anonymised to the nearest street point. Area photos from Wikipedia. SOS presses made on this device are added in blue.`
        : "Police data couldn't be reached, so these reports are simulated for the demo.";
}
function hotBody(h, i, sentAt) {
    const cats = Object.entries(h.cats).sort((a, b) => b[1] - a[1]);
    const records = h.list.filter((c) => c.cat !== "safehouse-sos").slice(0, 4);
    return `<div class="hot-body">
    <div class="pano" id="pano-${i}"><span class="credit">Loading Street View…</span></div>
    <div class="kv">
      <div><b>${Math.round(h.violent * 100)}%</b>violence or sexual offences<div class="bar"><i style="width:${h.violent * 100}%;background:#ff3b30"></i></div></div>
      <div><b>${Math.round(h.gap * 100)}%</b>outside the mesh<div class="bar"><i style="width:${h.gap * 100}%;background:#ff9f0a"></i></div></div>
      <div><b>${Math.round(h.acquisitive * 100)}%</b>robbery or theft from the person</div>
      <div><b>${h.unlit == null ? "…" : Math.round(h.unlit * 100) + "%"}</b>of mapped streets unlit</div>
    </div>
    <div class="cats">${cats.map(([k, v]) => `<div class="cr"><div>${esc(CATS[k]?.label || "SafeHouse SOS")}<div class="bar"><i style="width:${(v / h.count) * 100}%;background:rgb(${(CATS[k]?.rgb || [0, 122, 255]).join(",")})"></i></div></div><b style="text-align:right">${v}</b></div>`).join("")}</div>
    <div class="records">${records.map((c) => `<div class="record"><span class="cdot" style="background:rgb(${CATS[c.cat].rgb.join(",")})"></span><div><b>${esc(CATS[c.cat].label)}</b><div>On or near ${esc(c.street)} · ${monthLabel(c.month)}</div><div class="o">${esc(c.outcome)}</div></div></div>`).join("")}</div>
    <div class="recs">${recommendations(h).map((t) => `<div class="rec">${t}</div>`).join("")}</div>
    ${sentAt ? `<div class="sent">Report sent ${new Date(sentAt).toLocaleDateString("en-GB")}</div>` : ""}
    <div class="btn-row"><button class="btn small go" data-report="${i}">Send to council</button><button class="btn small" data-copy="${i}">Copy report</button></div>
  </div>`;
}
function recommendations(h) {
    const recs = [];
    if (h.gap > 0.4) recs.push(`Extend the mesh: ${Math.round(h.gap * 100)}% of reports fall outside SafeHouse coverage, so a bike bay or beacon point here would close the gap.`);
    if (h.unlit != null && h.unlit > 0.25) recs.push("Street lighting audit: a significant share of nearby mapped streets are unlit.");
    if (h.violent > 0.5) recs.push("Violence dominates here: prioritise visible safety infrastructure such as lighting, sightlines and staffed late-night routes.");
    if (h.acquisitive > 0.3) recs.push("High robbery and theft from the person: improve sightlines and lighting at transport exits and bike bays.");
    if (h.count >= 60) recs.push("Street and junction review with the borough highways and community safety teams, given the volume of reports.");
    if (!recs.length) recs.push("Monitor: report volume is moderate and spread across categories.");
    return recs;
}
async function openHotspot(i) {
    haptic();
    S.ins.open = S.ins.open === i ? -1 : i;
    const h = S.ins.hotspots[i];
    renderInsights();
    renderSoon();
    if (S.ins.open !== i) return;
    S.map.panTo({ lat: h.lat, lng: h.lng });
    S.map.setZoom(16);
    showStreetView(h, i);
    if (h.unlit == null) {
        await ensureLighting({ s: h.lat - 0.004, n: h.lat + 0.004, w: h.lng - 0.006, e: h.lng + 0.006 }, 4);
        let lit = 0, un = 0;
        for (const w of S.lit.ways.values()) { const m = w.path[Math.floor(w.path.length / 2)]; if (distM(m, [h.lng, h.lat]) < 400) (w.lit > 0 ? lit++ : un++); }
        h.unlit = lit + un ? un / (lit + un) : 0;
        if (S.ins.open === i) { renderInsights(); showStreetView(h, i); }
    }
}
function showStreetView(h, i) {
    const el = $("pano-" + i);
    if (!el) return;
    const fallback = async () => {
        const p = await wikiPhoto(h.hub.wiki);
        el.innerHTML = p.full ? `<img src="${p.full}" alt="${esc(h.hub.name)}"/><span class="credit">Photo: Wikipedia</span>` : "";
    };
    try {
        new google.maps.StreetViewService().getPanorama({ location: { lat: h.lat, lng: h.lng }, radius: 80, source: google.maps.StreetViewSource.OUTDOOR }, (data, status) => {
            if (status !== "OK" || !$("pano-" + i)) return fallback();
            const from = data.location.latLng;
            const heading = (Math.atan2((h.lng - from.lng()) * M_LNG, (h.lat - from.lat()) * M_LAT) * 180) / Math.PI;
            el.innerHTML = '<span class="credit">Google Street View</span>';
            new google.maps.StreetViewPanorama(el, {
                pano: data.location.pano, pov: { heading, pitch: 2 }, zoom: 0.4,
                disableDefaultUI: true, clickToGo: false, linksControl: false, panControl: false, zoomControl: false,
                addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false, showRoadLabels: false,
            });
        });
    } catch { fallback(); }
}
function reportText(h) {
    const real = S.ins.source === "police";
    const cats = Object.entries(h.cats).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${CATS[k]?.label || "SafeHouse SOS presses"}: ${v}`);
    return [
        `SafeHouse · Pattern to Pavement report`,
        `Location: on or near ${h.street}, ${h.hub.name}`,
        `Map: https://maps.google.com/?q=${h.lat.toFixed(5)},${h.lng.toFixed(5)}`,
        ``,
        `Personal-safety reports in ${monthLabel(S.ins.month)}: ${h.count}`,
        ...cats,
        ``,
        `Outside SafeHouse mesh coverage: ${Math.round(h.gap * 100)}%`,
        h.unlit != null ? `Unlit mapped streets nearby: ${Math.round(h.unlit * 100)}%` : "",
        ``,
        `Recommended actions:`,
        ...recommendations(h).map((r) => `- ${r}`),
        ``,
        real ? `Source: data.police.uk (Metropolitan Police street-level crime, ${monthLabel(S.ins.month)}). Locations are anonymised by the police to the nearest street point.` : `Note: report data is simulated for demonstration.`,
        `Generated by SafeHouse, a student prototype (Imperial College London / Royal College of Art, IDE).`,
    ].join("\n");
}
function sendReport(i) {
    const h = S.ins.hotspots[i];
    const sent = store.get("sh_sent", {});
    sent[h.lat.toFixed(4) + "," + h.lng.toFixed(4)] = Date.now();
    store.set("sh_sent", sent);
    window.location.href = `mailto:?subject=${encodeURIComponent(`Safety report: ${h.street}, ${h.hub.name}`)}&body=${encodeURIComponent(reportText(h))}`;
    setTimeout(() => { renderInsights(); showStreetView(h, i); }, 600);
}

// ============================================================================
// Explore panel
// ============================================================================
function renderCards() {
    $("cards").innerHTML = OP_KEYS.map((k) => {
        const o = OPERATORS[k];
        return `<button class="card" id="card-${k}" data-k="${k}"><div class="top"><span class="badge" style="background:${o.hex}">${o.letter}</span><span class="tag" id="tag-${k}"></span></div><div class="n" id="n-${k}">–</div><div class="l">${o.name}</div></button>`;
    }).join("");
    document.querySelectorAll(".card").forEach((el) => el.addEventListener("click", () => {
        haptic();
        const k = el.dataset.k;
        S.visible[k] = !S.visible[k];
        el.classList.toggle("off", !S.visible[k]);
        invalidate(); renderSoon(); updateExplore();
    }));
}
function updateExplore() {
    let total = 0;
    for (const k of OP_KEYS) {
        animateNumber($("n-" + k), S.counts[k]);
        if (S.visible[k]) total += S.counts[k];
        const live = k === "santander" ? S.santanderLive : OPERATORS[k].live;
        const tag = $("tag-" + k);
        tag.textContent = live ? "Live" : "Sim";
        tag.className = "tag " + (live ? "live" : "sim");
    }
    animateNumber($("total"), total);
    $("updated").textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} · ${Math.round(idleShare() * 100)}% of fleet idle`;
    $("mesh-stats").textContent = `${S.nodes.length.toLocaleString()} points · ${S.edges.length.toLocaleString()} links · ${Math.round(S.coverage * 100)}% of Zone 1`;
    const bays = S.nodes.filter((n) => n.op !== "santander").length;
    $("sources").textContent = `Bays: ${bays.toLocaleString()} from ${S.baysSource === "osm" ? "OpenStreetMap" : "a simulated layout"} · Docks: ${S.santanderLive ? "TfL live feed" : "simulated"} · Lighting: OpenStreetMap · Crime: data.police.uk · Dockless bike positions modelled from real fleet sizes.`;
}
function animateNumber(el, to) {
    if (!el) return;
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (from === to) { el.textContent = to.toLocaleString(); return; }
    const t0 = performance.now();
    const step = (now) => {
        const t = Math.min(1, (now - t0) / 500), e = 1 - Math.pow(1 - t, 3);
        el.textContent = Math.round(from + (to - from) * e).toLocaleString();
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
}

// ============================================================================
// Callout
// ============================================================================
function showCallout(n, x, y) {
    haptic();
    const el = $("callout");
    const col = n.op === "shared" ? "#8e8e93" : OPERATORS[n.op].hex;
    const ops = nodeOps(n);
    const detail = n.op === "santander"
        ? `${n.total} bikes docked${n.ebikes ? ` (${n.ebikes} e-bikes)` : ""} · ${n.docks} docks · live`
        : ops.length ? ops.map((k) => `${n.counts[k]} ${OPERATORS[k].name}`).join(" · ") + " parked" : "No bikes parked right now";
    const l = lightAt(n.lng, n.lat);
    const apps = (ops.length ? ops : n.op === "shared" ? [] : [n.op]).map((k) => `<button data-app="${k}" style="background:${OPERATORS[k].hex}">Open ${OPERATORS[k].name}</button>`).join("");
    el.innerHTML = `<div class="c-t"><span class="c-dot" style="background:${col}"></span>${esc(nodeTitle(n))}</div>
    <div class="c-s">${detail}<br>Linked to ${n.degree} nearby SafeHouse points${l === 0 ? "<br>Street here is mapped as unlit" : l ? "<br>Street here is lit" : ""}</div>
    <div class="c-f"><span>SOS button</span><span>Camera</span><span>Beacon light</span></div>
    ${apps ? `<div class="c-apps">${apps}</div>` : ""}`;
    el.querySelectorAll("[data-app]").forEach((b) => b.addEventListener("click", () => openApp(b.dataset.app)));
    const desktop = window.innerWidth >= 900;
    el.style.left = Math.max(125, Math.min(window.innerWidth - 125, x + (desktop ? 0 : 0))) + "px";
    el.style.top = Math.max(200, y) + "px";
    el.hidden = false;
}
const hideCallout = () => ($("callout").hidden = true);

// ============================================================================
// Sheet (draggable, snapping) + tabs
// ============================================================================
function sheetHeights() {
    const vh = window.innerHeight, desktop = window.innerWidth >= 900;
    return desktop ? { peek: 150, half: Math.round(vh * 0.62), full: vh - 32 } : { peek: 150, half: Math.round(vh * 0.47), full: Math.round(vh * 0.88) };
}
function setSnap(name, animate = true) {
    const h = sheetHeights(), sheet = $("sheet");
    S.snap = name;
    sheet.style.height = h.full + "px";
    if (!animate) sheet.classList.add("dragging");
    sheet.style.transform = `translateY(${h.full - h[name]}px)`;
    S.sheetVisible = h[name];
    $("sheet-body").style.maxHeight = h[name] - $("sheet-top").offsetHeight + "px";
    if (!animate) requestAnimationFrame(() => sheet.classList.remove("dragging"));
}
function wireSheetDrag() {
    const top = $("sheet-top"), sheet = $("sheet");
    let startY = 0, startT = 0, lastY = 0, lastT = 0, vel = 0, dragging = false, moved = false;
    const currentT = () => { const m = /translateY\(([-\d.]+)px\)/.exec(sheet.style.transform); return m ? parseFloat(m[1]) : 0; };
    top.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        dragging = true; moved = false; startY = lastY = e.clientY; startT = currentT(); lastT = performance.now(); vel = 0;
        sheet.classList.add("dragging"); top.setPointerCapture(e.pointerId);
    });
    top.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        if (Math.abs(e.clientY - startY) > 3) moved = true;
        const h = sheetHeights();
        sheet.style.transform = `translateY(${Math.max(0, Math.min(h.full - h.peek, startT + (e.clientY - startY)))}px)`;
        const now = performance.now();
        vel = (e.clientY - lastY) / Math.max(1, now - lastT); lastY = e.clientY; lastT = now;
    });
    const end = () => {
        if (!dragging) return;
        dragging = false; sheet.classList.remove("dragging");
        const h = sheetHeights(), visible = h.full - currentT();
        let target;
        if (!moved) target = S.snap === "peek" ? "half" : S.snap === "half" ? "full" : "half"; // tap the grabber to cycle
        else if (vel > 0.45) target = visible > h.half + 40 ? "half" : "peek";
        else if (vel < -0.45) target = visible < h.half - 40 ? "half" : "full";
        else target = ["peek", "half", "full"].reduce((best, k) => (Math.abs(h[k] - visible) < Math.abs(h[best] - visible) ? k : best), "half");
        haptic(6);
        setSnap(target);
    };
    top.addEventListener("pointerup", end);
    top.addEventListener("pointercancel", end);
    window.addEventListener("resize", () => setSnap(S.snap, false));
}
function showPanel(name) {
    ["explore", "ride", "walk", "insights", "nav"].forEach((p) => ($("panel-" + p).hidden = p !== name));
    $("sheet-body").scrollTop = 0;
}
function showTab(tab) {
    const prev = S.tab;
    S.tab = tab;
    const idx = ["explore", "ride", "walk", "insights"].indexOf(tab);
    $("seg-thumb").style.transform = `translateX(${idx * 100}%)`;
    showPanel(tab);
    hideCallout();
    if (prev !== tab && (prev === "ride" || prev === "walk")) S.routes = [];
    if (tab === "ride") {
        searchMode(false);
        if (S.dest && S.routeKind === "ride" && prev !== "ride" && !S.navOn) planRide(S.dest);
    }
    if (tab === "walk") findBikes();
    if (tab === "insights") {
        S.ins.open = -1;
        loadInsights();
        renderInsights();
        S.map.setZoom(12); S.map.panTo({ lat: 51.5, lng: -0.1 });
    }
    if (S.snap === "peek") setSnap("half");
    renderSoon();
}

// ============================================================================
// Wiring
// ============================================================================
function wireUI() {
    renderCards();
    wireSheetDrag();
    $("btn-safety").classList.toggle("set", !!contact().phone);

    document.querySelectorAll("#seg button").forEach((b) => b.addEventListener("click", () => { haptic(); if (S.tab !== b.dataset.tab) showTab(b.dataset.tab); }));

    // every on/off control goes through setLayer, so fab + switch always agree
    document.querySelectorAll(".fab[data-layer]").forEach((b) => b.addEventListener("click", () => setLayer(b.dataset.layer, !layerState(b.dataset.layer))));
    document.querySelectorAll('input[type=checkbox][data-layer]').forEach((i) => i.addEventListener("change", () => setLayer(i.dataset.layer, i.checked)));

    $("place-chips").innerHTML = DEMO_PLACES.map((p) => `<button class="chip">${p}</button>`).join("");
    $("place-chips").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => pickSuggestion({ kind: "query", q: c.textContent, main: c.textContent })));
    $("op-chips").innerHTML = [["all", "All"], ...OP_KEYS.map((k) => [k, OPERATORS[k].name])].map(([k, l]) => `<button class="chip ${k === "all" ? "on" : ""}" data-k="${k}">${l}</button>`).join("");
    $("op-chips").querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
        haptic();
        S.walk.filter = c.dataset.k;
        $("op-chips").querySelectorAll(".chip").forEach((x) => x.classList.toggle("on", x === c));
        findBikes();
    }));

    const input = $("dest-input");
    $("search-pill").addEventListener("click", () => { haptic(); showTab("ride"); searchMode(true); setTimeout(() => input.focus(), 60); });
    input.addEventListener("focus", () => searchMode(true));
    input.addEventListener("input", onSearchInput);
    input.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            sugIndex = Math.max(-1, Math.min(sugItems.length - 1, sugIndex + (e.key === "ArrowDown" ? 1 : -1)));
            $("suggest").querySelectorAll(".sug").forEach((el, i) => el.classList.toggle("hl", i === sugIndex));
        } else if (e.key === "Enter") {
            e.preventDefault();
            const q = input.value.trim();
            if (sugIndex >= 0) pickSuggestion(sugItems[sugIndex]);
            else if (sugItems[0] && sugItems[0].kind === "place") pickSuggestion(sugItems[0]);
            else if (q) pickSuggestion({ kind: "query", q, main: q });
        } else if (e.key === "Escape") { input.blur(); searchMode(false); setSnap("half"); }
    });
    $("dest-x").addEventListener("click", () => { input.value = ""; onSearchInput(); input.focus(); });
    $("ride-cancel").addEventListener("click", () => { input.blur(); searchMode(false); setSnap("half"); });

    $("ride-go").addEventListener("click", startNav);
    $("walk-go").addEventListener("click", startNav);
    $("nav-end").addEventListener("click", endNav);
    $("nav-share").addEventListener("click", () => openText("trip"));
    $("nav-arrive").addEventListener("click", (e) => openApp(e.currentTarget.dataset.app));
    $("sos").addEventListener("click", triggerSOS);

    $("sos-text").addEventListener("click", () => openText("sos"));
    $("sos-safe").addEventListener("click", () => {
        if (S.share) { publishShare({ type: "ended", safe: true }); stopSharing(); }
        $("modal-sos").hidden = true;
        toast("Glad you're safe. Sharing stopped.");
    });

    $("btn-safety").addEventListener("click", () => { haptic(); openSettings(); });
    $("modal-safety").querySelectorAll("[data-close]").forEach((el) => el.addEventListener("click", () => ($("modal-safety").hidden = true)));
    $("set-save").addEventListener("click", () => { if (saveSettings()) { $("modal-safety").hidden = true; toast("Trusted contact saved"); } });
    $("set-test").addEventListener("click", () => {
        if (!saveSettings()) return;
        const c = contact();
        if (!c.phone) { toast("Add a mobile number first"); return; }
        window.location.href = smsHref(c.phone, `Hi ${c.name}, I've added you as my trusted contact on SafeHouse. If I press SOS you'll get a text with my live location.`);
    });
    $("set-pick").addEventListener("click", async () => {
        try { const [c] = await navigator.contacts.select(["name", "tel"], { multiple: false }); if (c) { $("set-name").value = c.name?.[0] || ""; $("set-phone").value = c.tel?.[0] || ""; } } catch { /* cancelled */ }
    });

    $("btn-locate").addEventListener("click", async () => { haptic(); const o = await getOrigin(); S.map.panTo(o); S.map.setZoom(16); renderSoon(); });

    S.map.addListener("click", (e) => setTimeout(() => {
        if (Date.now() - S.pickedAt < 300) return;
        hideCallout();
        if (S.tab === "ride" && !S.navOn) { $("dest-input").value = "Dropped pin"; planRide({ lat: e.latLng.lat(), lng: e.latLng.lng(), name: "dropped pin" }); }
    }, 0));
    S.map.addListener("dragstart", hideCallout);
    S.map.addListener("idle", refreshLighting);
}
const rideStatus = (t) => ($("ride-status").textContent = t, $("ride-idle").hidden = false);

// ============================================================================
// Helpers + boot
// ============================================================================
function splash(msg) { const el = $("splash-msg"); if (el) el.textContent = msg; }
function hideSplash() {
    const el = $("splash");
    if (!el) return;
    const elapsed = performance.now();
    // let the logo animation finish at least once before revealing the app
    setTimeout(() => { el.classList.add("fade"); setTimeout(() => el.remove(), 500); }, Math.max(0, 1600 - elapsed));
}
let toastTimer;
function toast(msg) {
    const el = $("toast");
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}
(function boot() {
    if (!window.deck) { splash("Couldn't load the map renderer. Check your internet connection."); return; }
    if (CONFIG.GOOGLE_API_KEY.startsWith("YOUR_")) { splash("Add your Google API key at the top of safehous.js"); return; }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.GOOGLE_API_KEY}&callback=initMap&v=weekly&loading=async`;
    s.async = true;
    s.onerror = () => splash("Couldn't load Google Maps. Check your API key.");
    document.head.appendChild(s);
})();