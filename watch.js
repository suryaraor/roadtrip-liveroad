// The live /watch page: follow a trip from another phone. Reads the same Google Sheet as the car,
// moves the car on the map, and speaks each stop's note (in Telugu by default) when the car's guide does.
// Link: watch/?t=<Trip ID>&s=<Apps Script deployment ID>[&k=<access key>]

const W_KINDS = {
    city: ['City', 'building-2', '#1f5f45'], town: ['Town', 'home', '#2e7d5b'], village: ['Village', 'map-pin', '#7a9a6c'],
    river: ['River crossing', 'waves', '#1d6fa5'], history: ['History', 'castle', '#8a4b2a'], museum: ['Museum', 'landmark', '#6b3fa0'],
    attraction: ['Attraction', 'star', '#e07a1f'], fun: ['Fun stop', 'ferris-wheel', '#d1495b'], view: ['Viewpoint', 'camera', '#3f8f8f'],
    nature: ['Nature', 'tree-pine', '#4f7f2f']
};
const wk = (k) => W_KINDS[k] || W_KINDS.attraction;
const FRESH_MS = 4 * 60 * 1000;   // a note counts as "playing now" for this long after the car starts it
const POLL_MS = 15000;
const FULL_POLL_MS = 60000;       // when the sheet's script hasn't been updated yet (no "live" action)

const W = {
    id: '', trip: null, route: null, places: [], played: {}, live: {}, map: null, marker: null,
    listening: false, shown: null, spoken: null, full: false, timer: null
};

function wPlaces(rows) {
    return rows.sort((a, b) => Number(a['Order']) - Number(b['Order'])).map((x) => ({
        id: String(x['Place ID']), name: String(x['Name']), kind: String(x['Kind']), mile: Number(x['Mile']) || 0,
        off: Number(x['Off Route Miles']) || 0, lat: Number(x['Lat']), lng: Number(x['Lng']),
        population: Number(x['Population']) || 0, summary: String(x['Summary'] || ''), note: String(x['Note'] || ''),
        include: String(x['Include'] || '').toLowerCase() !== 'no', playedAt: x['Played At'] || ''
    })).filter((p) => p.include);
}

async function loadAll() {
    const data = await api({ action: 'getData' });
    const row = (data.trips || []).find((t) => String(t['Trip ID']) === W.id);
    if (!row) throw new Error(T('wBadLink'));
    W.trip = row;
    W.places = wPlaces((data.places || []).filter((p) => String(p['Trip ID']) === W.id));
    W.played = {};
    W.places.forEach((p) => { if (p.playedAt) W.played[p.id] = p.playedAt; });
    W.live = row;
    W.lastFull = Date.now();
    // The car may have taken a new road: redraw the map for it
    const rs = String(row['Route'] || '');
    if (rs !== W.routeStr) {
        W.routeStr = rs;
        W.route = routeFromCoords(decodePolyline(rs));
        if (W.map) { W.map.remove(); W.map = null; W.marker = null; }
    }
}

// One request at a time. A failure retries fast (5, 10, 20 s...) and only says "offline" after three in a row.
// The watchdog below restarts the loop if the phone froze the page's timers while the screen was off.
async function poll() {
    if (W.busy) return;
    W.busy = true;
    clearTimeout(W.timer);
    let ok = false;
    try {
        // In fallback mode, look again for the fast "live" action every 5 minutes (it appears once the script is redeployed)
        if (W.full && Date.now() - (W.lastProbe || 0) > 5 * 60000) {
            W.lastProbe = Date.now();
            try { await api({ action: 'live', tripId: W.id }); W.full = false; } catch (e) { /* still the old script */ }
        }
        // Every 3 minutes the full read too, to pick up a new road and its stops
        if (W.full || Date.now() - (W.lastFull || 0) > 3 * 60000) await loadAll();
        else {
            try {
                const res = await api({ action: 'live', tripId: W.id });
                W.live = res.trip;
                W.played = res.played || {};
            } catch (e) {
                if (!/Unknown action/.test(e.message)) throw e;
                W.full = true;  // older sheet script: fall back to the full read
                W.lastProbe = Date.now();
                await loadAll();
            }
        }
        ok = true;
        W.fails = 0;
        W.lastOk = Date.now();
    } catch (e) {
        W.fails = (W.fails || 0) + 1;
    }
    W.busy = false;
    try {
        if (ok) { showError(''); render(); checkNowPlaying(); }
        else if (W.fails >= 3 || !navigator.onLine) { $('liveBadge').textContent = T('wOffline'); $('liveBadge').className = 'badge bad'; }
        else { $('liveBadge').textContent = T('wReconnect'); $('liveBadge').className = 'badge warn'; }
    } catch (e) { /* a drawing problem shouldn't stop the updates */ }
    const wait = ok ? (W.full ? FULL_POLL_MS : POLL_MS) : Math.min(60000, 5000 * 2 ** (W.fails - 1));
    W.timer = setTimeout(poll, wait);
}

function wakeUp() {
    if (document.visibilityState !== 'visible') return;
    if ('speechSynthesis' in window) speechSynthesis.resume();
    if (W.trip) poll();
}

function placeById(id) { return W.places.find((p) => p.id === id); }

function carMile() { return Number(W.live['Last Mile']) || 0; }

function carPos() {
    const lat = Number(W.live['Last Lat']), lng = Number(W.live['Last Lng']);
    if (lat && lng) return [lat, lng];
    return W.route && W.route.coords.length ? pointAt(W.route, carMile() * M_PER_MI) : null;
}

function agoText(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    if (!iso || !isFinite(ms)) return '';
    const n = Math.round(ms / 60000);
    return n < 1 ? T('wJust') : T('wAgo', { n });
}

function render() {
    const t = W.trip;
    if (!t) return;
    const total = Number(t['Miles']) || 0;
    const end = String(t['End'] || '').split(',')[0];
    const route = [t['Start'], ...String(t['Via'] || '').split(/\s*;\s*/).filter(Boolean), t['End']].map((x) => String(x).split(',')[0]);
    $('wTrip').textContent = t['Name'];
    $('driveTitle').textContent = t['Name'];
    $('driveSub').textContent = `${miles(total)} mi · ${route.join(' → ')}`;
    const m = carMile();
    $('driveBar').style.width = `${total ? Math.min(100, (m / total) * 100).toFixed(1) : 0}%`;
    $('mileNow').textContent = T('mile', { m: miles(m) });
    $('mileLeft').textContent = T('toGo', { m: miles(Math.max(0, total - m)), c: end });

    const status = String(W.live['Status'] || t['Status'] || '');
    const seen = W.live['Last Seen At'];
    const fresh = seen && Date.now() - new Date(seen).getTime() < 10 * 60000;
    const badge = $('liveBadge');
    if (status === 'done') { badge.textContent = T('done'); badge.className = 'badge'; }
    else if (status === 'active' && fresh) { badge.textContent = `● LIVE · ${agoText(seen)}`; badge.className = 'badge ok'; }
    else if (seen) { badge.textContent = T('wSeen', { t: agoText(seen) }); badge.className = 'badge warn'; }
    else { badge.textContent = T('planned'); badge.className = 'badge warn'; }
    if (!W.shown) {
        $('nowName').textContent = status === 'done' ? T('wFinished') : status === 'active' && fresh ? T('onRoad') : status === 'active' ? T('wParked') : T('wWaiting');
    }

    const nextStop = renderNextBar(W.places, m, wDone, (kd) => { const x = wk(kd); return { icon: x[1], color: x[2], one: x[0] }; });
    drawWatchMap(nextStop);
    const up = $('upNext');
    up.innerHTML = '';
    const next = W.places.filter((p) => !wDone(p)).slice(0, 6);
    if (!next.length) up.appendChild(el('p', 'no-results', T('noMore')));
    next.forEach((p) => {
        const dist = p.mile - m;
        up.appendChild(wRow(p, `${kindName(p.kind, wk(p.kind)[0])} · ${dist <= 0.3 ? T('now') : T('inMi', { m: miles(dist) })}`));
    });
    // Done = heard in the car, or the car is already past it (newest first)
    const done = W.places.filter(wDone).sort((a, b) => b.mile - a.mile);
    $('playedCount').textContent = done.length;
    const pl = $('playedList');
    pl.innerHTML = '';
    done.forEach((p) => {
        const r = wRow(p, `✓ ${W.played[p.id] ? T('heardOne') : T('passed')} · ${T('mile', { m: miles(p.mile) })}`, true);
        r.classList.add('done');
        const b = el('button', 'icon-btn');
        b.type = 'button';
        b.setAttribute('aria-label', `Play ${p.name}`);
        b.appendChild(icon('play'));
        b.onclick = () => { Voice.unlock(); showPlace(p); speakPlace(p); };
        r.appendChild(b);
        pl.appendChild(r);
    });
}

function wDone(p) { return !!W.played[p.id] || p.mile < carMile() - 1; }

function wRow(p, sub, withNote) {
    const k = wk(p.kind);
    const row = el('div', 'place');
    const dot = el('span', 'place-icon');
    dot.style.background = k[2];
    dot.appendChild(icon(k[1]));
    const info = el('div', 'place-info');
    info.appendChild(el('div', 'place-name', p.name));
    info.appendChild(el('div', 'place-sub', sub));
    if (withNote) {
        const d = el('details', 'place-note');
        d.appendChild(el('summary', '', LANG === 'te' ? 'గైడ్ ఏమంటాడు' : 'What the guide says'));
        d.appendChild(el('p', '', noteFor(p).text));
        info.appendChild(d);
    }
    row.append(dot, info);
    return row;
}

function drawWatchMap(nextStop) {
    if (typeof L === 'undefined' || !W.route) return;
    if (!W.map) {
        W.map = L.map('driveMap', { zoomControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '&copy; OpenStreetMap' }).addTo(W.map);
        // Road still ahead: faint and dashed; the part already driven is drawn solid on top
        const line = L.polyline(W.route.coords, { color: '#1f5f45', weight: 5, opacity: 0.45, dashArray: '8 8' }).addTo(W.map);
        W.doneLine = L.polyline([], { color: '#1f5f45', weight: 6, opacity: 0.95 }).addTo(W.map);
        W.pm = {};
        W.places.forEach((p) => {
            W.pm[p.id] = L.circleMarker([p.lat, p.lng], {
                radius: p.kind === 'city' ? 7 : p.kind === 'village' ? 4 : 5,
                color: '#fff', weight: 1.5, fillColor: wk(p.kind)[2], fillOpacity: 0.95
            }).bindTooltip(p.name).addTo(W.map);
        });
        W.routeBounds = line.getBounds();
        W.map.fitBounds(W.routeBounds, { padding: [16, 16] });
        MapView.fitted = '';
    }
    W.doneLine.setLatLngs(routeUpTo(W.route, carMile() * M_PER_MI));
    W.places.forEach((p) => {
        const mk = W.pm[p.id];
        const d = wDone(p);
        if (!mk || mk._done === d) return;
        mk._done = d;
        mk.setStyle(d ? { fillColor: '#9aa59f', fillOpacity: 0.7 } : { fillColor: wk(p.kind)[2], fillOpacity: 0.95 });
        mk.setTooltipContent(d ? `✓ ${p.name}` : p.name);
    });
    const pos = carPos();
    if (!pos) return;
    if (!W.marker) W.marker = L.circleMarker(pos, { radius: 9, color: '#fff', weight: 3, fillColor: '#e07a1f', fillOpacity: 1 }).addTo(W.map);
    W.marker.setLatLng(pos);
    MapView.apply(W.map, carMile() > 0 ? pos : null, nextStop, W.routeBounds);
}

// What is the car's guide talking about right now?
function currentPlace() {
    const id = String(W.live['Now Playing'] || '');
    const at = W.live['Now Playing At'];
    if (id && at && Date.now() - new Date(at).getTime() < FRESH_MS) return placeById(id) || null;
    if ('Now Playing At' in W.live && at && Date.now() - new Date(at).getTime() < FRESH_MS) return null; // just finished
    // Older sheet script: the newest stop marked as heard in the last few minutes
    let best = null, bestAt = 0;
    Object.keys(W.played).forEach((pid) => {
        const t = new Date(W.played[pid]).getTime();
        if (t > bestAt) { bestAt = t; best = pid; }
    });
    return best && Date.now() - bestAt < FRESH_MS ? placeById(best) : null;
}

function checkNowPlaying() {
    const p = currentPlace();
    if (!p) return;
    if (W.shown !== p.id) showPlace(p);
    if (W.listening && W.spoken !== p.id) speakPlace(p);
}

function showPlace(p) {
    W.shown = p.id;
    const k = wk(p.kind);
    $('nowCard').classList.remove('idle');
    $('nowLabel').textContent = `${kindName(p.kind, k[0])} · ${T('mile', { m: miles(p.mile) })}`;
    $('nowName').textContent = p.name;
    $('nowText').textContent = noteFor(p).text;
    const ic = $('nowIcon');
    ic.innerHTML = '';
    ic.style.background = k[2];
    ic.appendChild(icon(k[1]));
}

function speakPlace(p) {
    W.spoken = p.id;
    const n = noteFor(p);
    Voice.say(n.text, n.lang, n.en);
}

function renderListen() {
    const b = $('listenBtn');
    b.innerHTML = '';
    b.append(icon(W.listening ? 'volume-2' : 'headphones'), document.createTextNode(` ${W.listening ? T('wListening') : T('wListen')}`));
    b.classList.toggle('ghost-btn', W.listening);
    b.classList.toggle('primary-btn', !W.listening);
    $('muteBtn').innerHTML = '';
    $('muteBtn').appendChild(icon(Voice.muted ? 'volume-x' : 'volume-2'));
}

async function initWatch() {
    if (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
        return;
    }
    const q = new URLSearchParams(location.search);
    W.id = q.get('t') || '';
    const s = q.get('s') || '';
    applyI18n();
    $('langSelect').value = LANG;
    $('langSelect').onchange = () => {
        setLang($('langSelect').value);
        renderListen();
        render();
        const p = W.shown && placeById(W.shown);
        if (p) showPlace(p);
    };
    renderListen();
    if (!W.id || !/^[\w-]+$/.test(s)) { showError(T('wBadLink')); return; }
    CONFIG.appsScriptUrl = `https://script.google.com/macros/s/${s}/exec`;
    CONFIG.accessKey = q.get('k') || '';

    $('listenBtn').onclick = () => {
        Voice.unlock();
        Voice.muted = false;
        W.listening = !W.listening;
        if (W.listening) {
            const p = currentPlace();
            if (p) { showPlace(p); speakPlace(p); }
            else Voice.say(T('soundTest'), LANG, STR.en.soundTest);
            if (LANG === 'te' && !Voice.teVoice) setTimeout(() => showToast(T('noTeVoice')), 1200);
        } else Voice.stop();
        renderListen();
    };
    $('muteBtn').onclick = () => { Voice.muted = !Voice.muted; if (Voice.muted) Voice.stop(); renderListen(); };
    $('replayBtn').onclick = () => { const p = W.shown && placeById(W.shown); if (p) { Voice.unlock(); speakPlace(p); } };
    document.addEventListener('visibilitychange', wakeUp);
    window.addEventListener('pageshow', wakeUp);
    window.addEventListener('online', () => { W.fails = 0; wakeUp(); });
    window.addEventListener('focus', () => { if (W.lastOk && Date.now() - W.lastOk > POLL_MS) wakeUp(); });
    // Watchdog: if no update has landed for a while and nothing is in flight, the timer was lost; start again
    setInterval(() => {
        if (!W.trip || W.busy || document.visibilityState !== 'visible') return;
        const every = W.full ? FULL_POLL_MS : POLL_MS;
        if (!W.lastOk || Date.now() - W.lastOk > every * 2 + 35000) poll();
        else render(); // keeps "LIVE · 2 min ago" ticking between updates
    }, 15000);

    await loadTeluguNotes('../');
    try {
        await loadAll();
        W.lastOk = Date.now();
    } catch (e) {
        showError(/ACCESS_KEY/.test(e.message) ? T('wBadLink') : e.message);
        W.timer = setTimeout(initWatchRetry, 30000);
        return;
    }
    // Whatever was playing before the page opened is shown, not spoken
    const p = currentPlace();
    if (p) { showPlace(p); W.spoken = p.id; }
    render();
    poll();
}

async function initWatchRetry() {
    try { await loadAll(); W.lastOk = Date.now(); showError(''); render(); poll(); } catch (e) { W.timer = setTimeout(initWatchRetry, 15000); }
}

initWatch();
