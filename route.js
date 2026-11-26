// Route building with free, keyless services that allow browser calls:
//   Photon (place search), OSRM (driving route), Overpass (towns and attractions near the road),
//   Wikipedia + Wikidata (short summaries the guide builds on).
const GEO = {
    photon: 'https://photon.komoot.io/api/',
    osrm: 'https://router.project-osrm.org/route/v1/driving/',
    // Public Overpass servers come and go; each query tries them in turn
    overpass: ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
        'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'],
    wiki: 'https://en.wikipedia.org/w/api.php',
    wikidata: 'https://www.wikidata.org/w/api.php'
};
const M_PER_MI = 1609.344;

// ---------- Geometry ([lat, lng] pairs) ----------
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
    const dLat = rad(b[0] - a[0]);
    const dLng = rad(b[1] - a[1]);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
    return 6371008.8 * 2 * Math.asin(Math.min(1, Math.sqrt(s)));
}

function cumulative(coords) {
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
    return cum;
}

// Closest point on the route to p, searching segments lo..hi. Returns { i, along (m), off (m) }.
function nearestOnRoute(route, p, lo, hi) {
    const c = route.coords;
    const cum = route.cum;
    lo = Math.max(0, lo || 0);
    hi = Math.min(c.length - 1, hi === undefined ? c.length - 1 : hi);
    const kx = 111320 * Math.cos(rad(p[0]));
    const ky = 110540;
    let best = { i: lo, along: cum[lo], off: Infinity };
    for (let i = lo; i < hi; i++) {
        const ax = (c[i][1] - p[1]) * kx, ay = (c[i][0] - p[0]) * ky;
        const bx = (c[i + 1][1] - p[1]) * kx, by = (c[i + 1][0] - p[0]) * ky;
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        let t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const x = ax + t * dx, y = ay + t * dy;
        const d = Math.sqrt(x * x + y * y);
        if (d < best.off) best = { i, along: cum[i] + t * (cum[i + 1] - cum[i]), off: d };
    }
    return best;
}

// Point at a distance along the route (for the demo drive)
function pointAt(route, meters) {
    const { coords, cum } = route;
    if (meters <= 0) return coords[0];
    if (meters >= cum[cum.length - 1]) return coords[coords.length - 1];
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (cum[mid] <= meters) lo = mid; else hi = mid;
    }
    const t = (meters - cum[lo]) / (cum[hi] - cum[lo] || 1);
    return [coords[lo][0] + t * (coords[hi][0] - coords[lo][0]), coords[lo][1] + t * (coords[hi][1] - coords[lo][1])];
}

// Douglas-Peucker, tolerance in meters
function simplify(coords, tol) {
    if (coords.length < 3) return coords.slice();
    const keep = new Uint8Array(coords.length);
    keep[0] = keep[coords.length - 1] = 1;
    const stack = [[0, coords.length - 1]];
    const kx = 111320 * Math.cos(rad(coords[0][0]));
    const ky = 110540;
    while (stack.length) {
        const [s, e] = stack.pop();
        const ax = coords[s][1] * kx, ay = coords[s][0] * ky;
        const dx = coords[e][1] * kx - ax, dy = coords[e][0] * ky - ay;
        const len = Math.hypot(dx, dy) || 1;
        let maxD = 0, idx = -1;
        for (let i = s + 1; i < e; i++) {
            const d = Math.abs(dy * (coords[i][1] * kx - ax) - dx * (coords[i][0] * ky - ay)) / len;
            if (d > maxD) { maxD = d; idx = i; }
        }
        if (maxD > tol && idx > 0) {
            keep[idx] = 1;
            stack.push([s, idx], [idx, e]);
        }
    }
    return coords.filter((_, i) => keep[i]);
}

// Google encoded polyline (precision 5), to keep the road in one sheet cell
function encodePolyline(coords) {
    let out = '', pLat = 0, pLng = 0;
    const enc = (v) => {
        v = v < 0 ? ~(v << 1) : v << 1;
        let s = '';
        while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
        return s + String.fromCharCode(v + 63);
    };
    coords.forEach(([lat, lng]) => {
        const a = Math.round(lat * 1e5), b = Math.round(lng * 1e5);
        out += enc(a - pLat) + enc(b - pLng);
        pLat = a; pLng = b;
    });
    return out;
}
function decodePolyline(str) {
    const coords = [];
    let i = 0, lat = 0, lng = 0;
    const dec = () => {
        let r = 0, sh = 0, b;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 0x1f) << sh; sh += 5; } while (b >= 0x20);
        return r & 1 ? ~(r >> 1) : r >> 1;
    };
    while (i < str.length) {
        lat += dec(); lng += dec();
        coords.push([lat / 1e5, lng / 1e5]);
    }
    return coords;
}

function routeFromCoords(coords) {
    return { coords, cum: cumulative(coords) };
}

// Encoded road for the sheet: as detailed as fits in one cell
function packRoute(coords) {
    for (const tol of [15, 30, 60, 120, 250]) {
        const s = encodePolyline(simplify(coords, tol));
        if (s.length < 45000) return s;
    }
    return encodePolyline(simplify(coords, 500));
}

// ---------- Network helpers ----------
async function getJSON(url, opts) {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${new URL(url).host} said ${r.status}`);
    return r.json();
}
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------- Place search ----------
async function geocode(q) {
    const url = `${GEO.photon}?${new URLSearchParams({ q, limit: 7, lang: 'en' })}`;
    const j = await getJSON(url);
    const seen = new Set();
    // Cities and towns before buildings that merely contain the name (e.g. a university in St. Louis)
    const rank = (p) => (p.type === 'city' ? 0 : p.osm_key === 'place' ? 1 : p.osm_key === 'boundary' ? 2 : 3);
    const feats = (j.features || []).map((f, i) => ({ f, i })).sort((a, b) =>
        rank(a.f.properties || {}) - rank(b.f.properties || {}) || a.i - b.i).map((x) => x.f);
    return feats.map((f) => {
        const p = f.properties || {};
        const [lng, lat] = f.geometry.coordinates;
        const parts = [p.name, p.city && p.city !== p.name ? p.city : '', p.state, p.countrycode === 'US' ? '' : p.country];
        const label = parts.filter(Boolean).join(', ');
        return { name: p.name || label, label, lat, lng };
    }).filter((x) => x.label && !seen.has(x.label) && seen.add(x.label));
}

// ---------- Driving route ----------
async function driveRoute(stops) {
    const path = stops.map((s) => `${s.lng.toFixed(5)},${s.lat.toFixed(5)}`).join(';');
    const j = await getJSON(`${GEO.osrm}${path}?overview=full&geometries=geojson&steps=false`);
    if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error('No driving route found between those places');
    const r = j.routes[0];
    const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    return { coords, meters: r.distance, seconds: r.duration };
}

// ---------- Places near the road ----------
// Kind -> how close to the road it must be (meters) to make the list
const KIND_RADIUS = { city: 9000, town: 5000, village: 2500, attraction: 3000, museum: 3000, fun: 4000, view: 3000, history: 3000, nature: 5000, river: 300 };

// A plain bounding-box query is cheap for the free servers (an "around the road line" query times out on long
// trips); distance to the road is filtered here afterwards.
function overpassQuery(bbox) {
    return `[out:json][timeout:90][bbox:${bbox.join(',')}];
(
  node["place"~"^(city|town|village)$"]["name"];
  nwr["tourism"~"^(attraction|museum|viewpoint|theme_park|zoo|aquarium|gallery)$"]["name"];
  nwr["historic"]["name"]["wikidata"];
  nwr["natural"~"^(peak|waterfall|cave_entrance|spring|bay)$"]["name"]["wikidata"];
  nwr["leisure"~"^(park|nature_reserve)$"]["name"]["wikidata"];
  nwr["boundary"~"^(national_park|protected_area)$"]["name"]["wikidata"];
)->.a;
.a out tags center;
way["waterway"="river"]["name"];
out tags geom;`;
}

function kindOf(t) {
    if (t.place === 'city' || t.place === 'town' || t.place === 'village') return t.place;
    if (t.waterway === 'river') return 'river';
    if (t.tourism === 'museum' || t.tourism === 'gallery') return 'museum';
    if (t.tourism === 'zoo' || t.tourism === 'aquarium' || t.tourism === 'theme_park') return 'fun';
    if (t.tourism === 'viewpoint') return 'view';
    if (t.historic) return 'history';
    if (t.natural || t.leisure || t.boundary) return 'nature';
    return 'attraction';
}

// The server that answered last goes first next time
let overpassFirst = 0;
async function overpass(query) {
    let lastErr;
    const n = GEO.overpass.length;
    for (let attempt = 0; attempt < n; attempt++) {
        const k = (overpassFirst + attempt) % n;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 75000);
        try {
            const r = await fetch(GEO.overpass[k], { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
            if (!r.ok) throw new Error(`server said ${r.status}`);
            const j = await r.json();
            if (j.remark && /runtime error|timed out/i.test(j.remark)) throw new Error(j.remark);
            overpassFirst = k;
            return j;
        } catch (e) {
            lastErr = e.name === 'AbortError' ? new Error('timed out') : e;
            if (attempt >= n - 1) await sleep(3000);
        } finally {
            clearTimeout(timer);
        }
    }
    throw new Error(`Could not load places along the road (${lastErr && lastErr.message}). The free map servers are busy; try again in a minute.`);
}

// Splits the road into ~50 km pieces and asks Overpass for each, two at a time. onStep(done, n) reports
// progress. A piece that keeps failing is skipped; result.missedMiles says how much of the road that was.
async function placesAlong(route, onStep) {
    const total = route.cum[route.cum.length - 1];
    const CHUNK = 50000;
    const n = Math.max(1, Math.ceil(total / CHUNK));
    const found = new Map();
    const pieces = [];
    for (let k = 0; k < n; k++) {
        const from = k * CHUNK - 2000, to = (k + 1) * CHUNK + 2000;
        let iLo = -1, iHi = -1;
        route.cum.forEach((d, i) => { if (d >= from && d <= to) { if (iLo < 0) iLo = i; iHi = i; } });
        if (iLo >= 0 && iHi - iLo >= 1) pieces.push({ k, iLo, iHi, tries: 0 });
    }
    let done = 0, missed = 0;
    onStep && onStep(0, n);
    const queue = pieces.slice();
    const worker = async () => {
        while (queue.length) {
            const pc = queue.shift();
            try {
                take(await overpass(overpassQuery(bboxOf(route.coords.slice(pc.iLo, pc.iHi + 1)))), pc.iLo, pc.iHi);
                done++;
            } catch (e) {
                if (++pc.tries < 3) { queue.push(pc); await sleep(5000); continue; }
                missed++;
                done++;
            }
            onStep && onStep(done, n);
            await sleep(800); // be polite to the free Overpass servers
        }
    };
    await Promise.all([worker(), worker()]);
    if (missed === pieces.length) throw new Error('The free map servers are too busy right now. Please try again in a few minutes.');
    const out = [...found.values()].sort((a, b) => a.mile - b.mile);
    out.missedMiles = (missed * CHUNK) / M_PER_MI;
    return out;

    function bboxOf(piece) {
        const lats = piece.map((p) => p[0]), lngs = piece.map((p) => p[1]);
        const padLat = 0.085, padLng = 0.085 / Math.cos(rad(lats[0]));
        return [Math.min(...lats) - padLat, Math.min(...lngs) - padLng, Math.max(...lats) + padLat, Math.max(...lngs) + padLng].map((v) => v.toFixed(4));
    }

    function take(j, iLo, iHi) {
        (j.elements || []).forEach((el) => {
            const t = el.tags || {};
            if (!t.name) return;
            const kind = kindOf(t);
            let lat, lng, off, along;
            if (kind === 'river') {
                // Where the road crosses the river: the road point closest to the river line
                let best = null;
                (el.geometry || []).forEach((g) => {
                    if (!g) return;
                    const hit = nearestOnRoute(route, [g.lat, g.lon], iLo, iHi);
                    if (!best || hit.off < best.off) best = Object.assign(hit, { lat: g.lat, lng: g.lon });
                });
                if (!best || best.off > 400) return;
                ({ lat, lng, off, along } = best);
            } else {
                lat = el.lat !== undefined ? el.lat : el.center && el.center.lat;
                lng = el.lon !== undefined ? el.lon : el.center && el.center.lon;
                if (lat === undefined) return;
                const hit = nearestOnRoute(route, [lat, lng]);
                off = hit.off; along = hit.along;
            }
            if (off > (KIND_RADIUS[kind] || 3000)) return;
            const id = `${el.type[0]}${el.id}`;
            const wp = t.wikipedia && /^en:/.test(t.wikipedia) ? t.wikipedia.slice(3) : '';
            const key = kind === 'river' ? `river:${t.name}:${Math.round(along / 5000)}` : t.wikidata || `${kind}:${t.name.toLowerCase()}`;
            const place = {
                id, key, name: t.name, kind, lat, lng,
                mile: along / M_PER_MI,
                off: off / M_PER_MI,
                population: Number(String(t.population || '').replace(/[^\d]/g, '')) || 0,
                wikipedia: wp, wikidata: t.wikidata || '', summary: ''
            };
            const prev = found.get(key);
            if (!prev || place.off < prev.off) found.set(key, place);
        });
    }
}

// Which places are ticked by default (everything else stays in the list, unticked):
// - every city and town; villages that are on Wikipedia or have 400+ people
// - rivers with a Wikipedia article, once per crossing
// - sights (museums, history, parks...) with a Wikipedia summary close to the road, at most one per 4 miles,
//   so the guide isn't talking nonstop through downtowns
const SIGHT_GAP_MILES = 4;
function defaultInclude(p) {
    if (p.kind === 'city' || p.kind === 'town') return true;
    if (p.kind === 'village') return p.population >= 400 || !!p.wikipedia;
    if (p.kind === 'river') return !!p.wikipedia;
    const maxOff = p.kind === 'nature' || p.kind === 'view' ? 1.5 : 2;
    return !!p.summary && p.off <= maxOff;
}

function curate(places) {
    places.forEach((p) => { p.include = defaultInclude(p); });
    // One note per river crossing, even when the river is mapped as several pieces
    const rivers = places.filter((p) => p.kind === 'river' && p.include).sort((a, b) => a.mile - b.mile);
    rivers.forEach((p, i) => {
        if (rivers.slice(0, i).some((q) => q.include && q.name === p.name && Math.abs(q.mile - p.mile) < 10)) p.include = false;
    });
    // Sights: best first (longer summary, closer to the road, kind), then drop any too close to a better one
    const sightPrio = { history: 3, museum: 3, attraction: 2, fun: 2, nature: 1, view: 1 };
    const score = (p) => (sightPrio[p.kind] || 1) * 2 + Math.min(p.summary.length, 800) / 200 - p.off;
    const kept = [];
    places.filter((p) => p.include && sightPrio[p.kind]).sort((a, b) => score(b) - score(a)).forEach((p) => {
        if (kept.some((q) => Math.abs(q.mile - p.mile) < SIGHT_GAP_MILES)) p.include = false;
        else kept.push(p);
    });
    return places;
}

// ---------- Wikipedia summaries ----------
async function addSummaries(places, onStep) {
    // Wikidata ids -> English Wikipedia titles, for places tagged with wikidata only
    const needTitle = places.filter((p) => !p.wikipedia && p.wikidata);
    for (let i = 0; i < needTitle.length; i += 50) {
        const batch = needTitle.slice(i, i + 50);
        try {
            const j = await getJSON(`${GEO.wikidata}?${new URLSearchParams({
                action: 'wbgetentities', ids: batch.map((p) => p.wikidata).join('|'), props: 'sitelinks',
                sitefilter: 'enwiki', format: 'json', origin: '*'
            })}`);
            batch.forEach((p) => {
                const e = j.entities && j.entities[p.wikidata];
                const link = e && e.sitelinks && e.sitelinks.enwiki;
                if (link) p.wikipedia = link.title;
            });
        } catch (e) { /* summaries are a bonus */ }
    }
    const withTitle = places.filter((p) => p.wikipedia);
    for (let i = 0; i < withTitle.length; i += 20) {
        onStep && onStep(i, withTitle.length);
        const batch = withTitle.slice(i, i + 20);
        const base = {
            action: 'query', prop: 'extracts', exintro: 1, explaintext: 1, exsentences: 5, exlimit: 20,
            redirects: 1, titles: batch.map((p) => p.wikipedia).join('|'), format: 'json', origin: '*'
        };
        if (i) await sleep(400); // Wikipedia throttles fast bursts
        try {
            const map = {};
            const byTitle = {};
            // Wikipedia returns only some extracts per call and a "continue" token for the rest
            let cont = {};
            for (let round = 0; round < 10; round++) {
                const url = `${GEO.wiki}?${new URLSearchParams({ ...base, ...cont })}`;
                let j;
                try { j = await getJSON(url); } catch (e) { await sleep(3000); j = await getJSON(url); }
                const q = j.query || {};
                (q.normalized || []).forEach((x) => { map[x.from] = x.to; });
                (q.redirects || []).forEach((x) => { map[x.from] = x.to; });
                Object.values(q.pages || {}).forEach((pg) => { if (pg.extract) byTitle[pg.title] = pg.extract; });
                if (!j.continue || !j.continue.excontinue) break;
                cont = j.continue;
            }
            batch.forEach((p) => {
                let t = p.wikipedia;
                for (let hops = 0; map[t] && hops < 3; hops++) t = map[t];
                if (byTitle[t]) p.summary = byTitle[t].replace(/\s+/g, ' ').trim().slice(0, 900);
            });
        } catch (e) { /* keep going */ }
    }
    onStep && onStep(withTitle.length, withTitle.length);
    return places;
}
