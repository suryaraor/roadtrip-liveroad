// Roadtrip LiveRoad: plan trips (route + every town, river and sight along it), save them to the Google Sheet,
// then drive with the phone's GPS and hear the guide whenever you're near a stop.

const ALL_INTERESTS = ['History', 'Native American heritage', 'Culture', 'Historical events', 'Interesting facts',
    'Local stories', 'Inventions', 'Famous businesses', 'Food', 'Nature', 'Sports', 'Music', 'Architecture', 'Kids fun'];
const DEFAULT_INTERESTS = ['History', 'Native American heritage', 'Culture', 'Historical events', 'Interesting facts',
    'Local stories', 'Inventions', 'Famous businesses'];

const KINDS = {
    city: { label: 'Cities', one: 'City', icon: 'building-2', color: '#1f5f45', lead: 2.5, radius: 5, prio: 5 },
    town: { label: 'Towns', one: 'Town', icon: 'home', color: '#2e7d5b', lead: 1.5, radius: 3, prio: 3 },
    village: { label: 'Villages', one: 'Village', icon: 'map-pin', color: '#7a9a6c', lead: 0.8, radius: 1.5, prio: 1 },
    river: { label: 'Rivers', one: 'River crossing', icon: 'waves', color: '#1d6fa5', lead: 0.6, radius: 0.8, prio: 4 },
    history: { label: 'History', one: 'History', icon: 'castle', color: '#8a4b2a', lead: 1.2, radius: 2.5, prio: 4 },
    museum: { label: 'Museums', one: 'Museum', icon: 'landmark', color: '#6b3fa0', lead: 1.2, radius: 2.5, prio: 4 },
    attraction: { label: 'Attractions', one: 'Attraction', icon: 'star', color: '#e07a1f', lead: 1.2, radius: 2.5, prio: 3 },
    fun: { label: 'Fun', one: 'Fun stop', icon: 'ferris-wheel', color: '#d1495b', lead: 1.2, radius: 2.5, prio: 3 },
    view: { label: 'Views', one: 'Viewpoint', icon: 'camera', color: '#3f8f8f', lead: 1, radius: 2, prio: 2 },
    nature: { label: 'Nature', one: 'Nature', icon: 'tree-pine', color: '#4f7f2f', lead: 1.2, radius: 3, prio: 2 }
};
const kindInfo = (k) => KINDS[k] || KINDS.attraction;

const S = {
    trips: [],
    view: 'trips',
    remote: false,
    ai: false,
    plan: { start: null, via: [], end: null },
    draft: null,      // trip being reviewed on the Plan tab
    kindFilter: null,
    maps: {},
    noteJobs: {}      // tripId -> running note writer
};

// ---------- Local storage ----------
function loadLocal() {
    try { S.trips = JSON.parse(safeGet('rl_trips') || '[]'); } catch (e) { S.trips = []; }
}
function saveLocal() {
    try { localStorage.setItem('rl_trips', JSON.stringify(S.trips)); } catch (e) {
        showToast('This browser is out of space for trips; the sheet still has them.');
    }
}
const tripById = (id) => S.trips.find((t) => t.id === id);
const newId = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- Sheet rows <-> trips ----------
function tripToRow(t) {
    return {
        'Trip ID': t.id, 'Name': t.name, 'Start': t.start.label, 'Via': t.via.map((v) => v.label).join('; '),
        'End': t.end.label, 'Interests': (t.interests || []).join('; '), 'Miles': Math.round(t.miles),
        'Drive Hours': Math.round(t.hours * 10) / 10, 'Status': t.status || 'planned',
        'Places': t.places.length, 'Notes Ready': t.places.filter((p) => p.note).length,
        'Created At': t.createdAt, 'Return Of': t.returnOf || '',
        'Stops JSON': JSON.stringify({ start: t.start, via: t.via, end: t.end }), 'Route': t.route
    };
}
function placeToRow(p, i) {
    return {
        'Place ID': p.id, 'Order': i + 1, 'Name': p.name, 'Kind': p.kind, 'Mile': Math.round(p.mile * 10) / 10,
        'Off Route Miles': Math.round(p.off * 10) / 10, 'Lat': +p.lat.toFixed(5), 'Lng': +p.lng.toFixed(5),
        'Population': p.population || '', 'Wikipedia': p.wikipedia || '', 'Summary': p.summary || '',
        'Note': p.note || '', 'Note Source': p.noteSource || '', 'Include': p.include === false ? 'no' : 'yes'
    };
}
function tripFromRows(r, rows) {
    let stops = {};
    try { stops = JSON.parse(r['Stops JSON'] || '{}'); } catch (e) { /* old row */ }
    const split = (s) => String(s || '').split(/\s*;\s*/).filter(Boolean);
    return {
        id: String(r['Trip ID']),
        name: String(r['Name'] || ''),
        start: stops.start || { label: String(r['Start'] || '') },
        via: stops.via || split(r['Via']).map((label) => ({ label })),
        end: stops.end || { label: String(r['End'] || '') },
        interests: split(r['Interests']),
        miles: Number(r['Miles']) || 0,
        hours: Number(r['Drive Hours']) || 0,
        status: String(r['Status'] || 'planned'),
        createdAt: r['Created At'] || '',
        startedAt: r['Started At'] || '',
        lastMile: Number(r['Last Mile']) || 0,
        returnOf: String(r['Return Of'] || ''),
        route: String(r['Route'] || ''),
        synced: true,
        places: rows.sort((a, b) => Number(a['Order']) - Number(b['Order'])).map((x) => ({
            id: String(x['Place ID']), name: String(x['Name']), kind: String(x['Kind']),
            mile: Number(x['Mile']) || 0, off: Number(x['Off Route Miles']) || 0,
            lat: Number(x['Lat']), lng: Number(x['Lng']), population: Number(x['Population']) || 0,
            wikipedia: String(x['Wikipedia'] || ''), summary: String(x['Summary'] || ''),
            note: String(x['Note'] || ''), noteSource: String(x['Note Source'] || ''),
            include: String(x['Include'] || '').toLowerCase() !== 'no',
            playedAt: x['Played At'] || ''
        }))
    };
}

// ---------- Sync ----------
async function sync() {
    if (!CONFIG.appsScriptUrl) { S.remote = false; renderHeader(); return; }
    try {
        const data = await api({ action: 'getData' });
        S.remote = true;
        S.ai = !!data.ai;
        const rowsByTrip = {};
        (data.places || []).forEach((p) => { (rowsByTrip[p['Trip ID']] = rowsByTrip[p['Trip ID']] || []).push(p); });
        const remote = (data.trips || []).map((r) => tripFromRows(r, rowsByTrip[r['Trip ID']] || []));
        const remoteIds = new Set(remote.map((t) => t.id));
        const localOnly = S.trips.filter((t) => !remoteIds.has(t.id) && !t.synced);
        // The sheet wins, but keep what this phone has heard since the last sync
        remote.forEach((t) => {
            const mine = tripById(t.id);
            if (!mine) return;
            const heard = {};
            mine.places.forEach((p) => { if (p.playedAt) heard[p.id] = p.playedAt; });
            t.places.forEach((p) => { if (!p.playedAt && heard[p.id]) p.playedAt = heard[p.id]; });
            t.lastMile = Math.max(t.lastMile, mine.lastMile || 0);
        });
        S.trips = remote.concat(localOnly);
        saveLocal();
        for (const t of localOnly) await pushTrip(t);
        showError('');
    } catch (e) {
        S.remote = false;
        if (/ACCESS_KEY/.test(e.message)) showError('The sheet needs the access key. Add it in Settings at the bottom of Trips.');
        else showToast(`Couldn't reach the sheet (${e.message}). Using the trips saved on this phone.`);
    }
    renderHeader();
}

async function pushTrip(t) {
    if (!S.remote) return false;
    const rows = t.places.map(placeToRow);
    const CH = 80;
    for (let i = 0; i === 0 || i < rows.length; i += CH) {
        await apiPost('saveTrip', { trip: tripToRow(t), places: rows.slice(i, i + CH), replace: i === 0 });
    }
    t.synced = true;
    saveLocal();
    return true;
}

// ---------- Header / tabs ----------
function renderHeader() {
    $('tripCount').textContent = S.trips.length;
    $('syncLabel').textContent = S.remote ? 'in sheet' : 'on phone';
    show('demoBanner', !S.remote);
    if (S.remote && !S.ai) {
        $('demoText').textContent = 'Connected to the sheet. Add ANTHROPIC_API_KEY in the Apps Script properties for richer guide notes; until then the guide uses Wikipedia.';
        show('demoBanner', true);
    } else {
        $('demoText').textContent = 'Trips are saved in this browser only. Connect the Google Sheet in Settings (bottom of Trips) to save them there and use them on your phone.';
    }
}

function setView(v) {
    S.view = v;
    document.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === v)));
    ['trips', 'plan', 'drive'].forEach((x) => show(`view-${x}`, x === v));
    safeSet('rl_view', v);
    if (v === 'trips') renderTrips();
    if (v === 'drive') renderDrive();
    setTimeout(() => Object.values(S.maps).forEach((m) => m.invalidateSize()), 50);
}

// ---------- Trips list ----------
function renderTrips() {
    const list = $('tripList');
    list.innerHTML = '';
    if (!S.trips.length) {
        list.appendChild(el('p', 'no-results', 'No trips yet. Plan your first one!'));
        return;
    }
    S.trips.forEach((t) => {
        const card = el('details', 'vcard');
        const head = el('summary', 'vcard-head');
        const ic = el('span', 'rank');
        ic.appendChild(icon(t.returnOf ? 'repeat' : 'route'));
        const info = el('span', 'info');
        info.appendChild(el('span', 'name', t.name));
        info.appendChild(el('span', 'sub', `${miles(t.miles)} mi · ${hoursText(t.hours)} · ${plural(t.places.filter((p) => p.include !== false).length, 'stop')}`));
        const status = el('span', `badge ${t.status === 'active' ? 'ok' : t.status === 'done' ? '' : 'warn'}`,
            t.status === 'active' ? 'On the road' : t.status === 'done' ? 'Done' : 'Planned');
        const chev = el('span', 'chev');
        chev.appendChild(icon('chevron-right'));
        head.append(ic, info, status, chev);
        card.appendChild(head);

        const body = el('div', 'vcard-body');
        body.appendChild(el('p', 'route-line', [t.start.label, ...t.via.map((v) => v.label), t.end.label].join('  →  ')));
        if (t.interests && t.interests.length) {
            const tags = el('div', 'tags');
            t.interests.forEach((x) => tags.appendChild(el('span', 'badge', x)));
            body.appendChild(tags);
        }
        const inc = t.places.filter((p) => p.include !== false);
        const ready = inc.filter((p) => p.note).length;
        const notes = el('p', 'muted small', S.remote && S.ai
            ? `Guide notes written: ${ready} of ${inc.length}${ready < inc.length ? ' (the rest are written as you drive, or tap below)' : ''}`
            : `Guide notes: ${ready ? `${ready} written, the rest` : 'all'} from Wikipedia${S.remote ? '' : ' until the sheet is connected'}`);
        body.appendChild(notes);
        if (t.lastMile && t.status !== 'done') body.appendChild(el('p', 'muted small', `Last seen at mile ${miles(t.lastMile)}`));

        const acts = el('div', 'card-actions');
        const go = el('button', 'primary-btn', '');
        go.type = 'button';
        go.append(icon('play'), document.createTextNode(t.status === 'active' ? ' Continue the trip' : ' Start the trip'));
        go.onclick = () => openDrive(t.id);
        body.appendChild(go);
        if (S.remote && S.ai && ready < inc.length) {
            const w = linkBtn('sparkles', S.noteJobs[t.id] ? 'Writing notes...' : 'Write all guide notes now', () => writeAllNotes(t.id, w));
            acts.appendChild(w);
        }
        const hasReturn = S.trips.some((x) => x.returnOf === t.id || t.returnOf === x.id);
        if (!hasReturn) acts.appendChild(linkBtn('repeat', 'Plan the drive back', () => makeReturn(t.id)));
        acts.appendChild(linkBtn('list', 'See the stops', () => {
            const box = body.querySelector('.place-list');
            if (box) { box.remove(); return; }
            const pl = el('div', 'place-list compact');
            t.places.filter((p) => p.include !== false).forEach((p) => pl.appendChild(placeRow(p, { note: true })));
            body.appendChild(pl);
        }));
        acts.appendChild(linkBtn('trash-2', 'Delete', () => deleteTrip(t.id), 'quiet'));
        body.appendChild(acts);
        card.appendChild(body);
        list.appendChild(card);
    });
}

function linkBtn(ic, text, onClick, extra) {
    const b = el('button', `link-btn ${extra || ''}`);
    b.type = 'button';
    b.append(icon(ic), document.createTextNode(` ${text}`));
    b.onclick = onClick;
    return b;
}

function placeRow(p, opts) {
    const k = kindInfo(p.kind);
    const row = el('div', `place ${p.include === false ? 'off' : ''}`);
    const dot = el('span', 'place-icon');
    dot.style.background = k.color;
    dot.appendChild(icon(k.icon));
    const info = el('div', 'place-info');
    const top = el('div', 'place-name', p.name);
    info.appendChild(top);
    const bits = [k.one, `mile ${miles(p.mile)}`];
    if (p.off >= 0.5 && p.kind !== 'river') bits.push(`${miles(p.off)} mi off the road`);
    if (p.population) bits.push(`pop. ${p.population.toLocaleString('en-US')}`);
    info.appendChild(el('div', 'place-sub', opts && opts.distance !== undefined ? opts.distance : bits.join(' · ')));
    if (opts && opts.note && (p.note || p.summary)) {
        const d = el('details', 'place-note');
        d.appendChild(el('summary', '', p.note ? 'What the guide says' : 'Wikipedia'));
        d.appendChild(el('p', '', p.note || p.summary));
        info.appendChild(d);
    }
    row.append(dot, info);
    if (opts && opts.toggle) {
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = p.include !== false;
        cb.setAttribute('aria-label', `Include ${p.name}`);
        cb.onchange = () => { p.include = cb.checked; row.classList.toggle('off', !cb.checked); updateReviewSub(); };
        row.appendChild(cb);
    }
    return row;
}

async function deleteTrip(id) {
    const t = tripById(id);
    if (!t) return;
    S.trips = S.trips.filter((x) => x.id !== id);
    saveLocal();
    renderTrips();
    renderHeader();
    if (S.remote) {
        try { await apiPost('deleteTrip', { tripId: id }); } catch (e) { /* not in the sheet yet */ }
    }
    showToast(`Deleted "${t.name}". To bring it back, clear "yes" in its Deleted cell in the sheet.`);
}

// ---------- Return trip ----------
function reversedTrip(t) {
    const coords = decodePolyline(t.route).reverse();
    return {
        id: newId(),
        name: `${shortName(t.end.label)} → ${shortName(t.start.label)}`,
        start: t.end, end: t.start, via: t.via.slice().reverse(),
        interests: (t.interests || []).slice(),
        miles: t.miles, hours: t.hours, status: 'planned', createdAt: new Date().toISOString(),
        returnOf: t.id, route: encodePolyline(coords), lastMile: 0, synced: false,
        places: t.places.map((p) => Object.assign({}, p, { mile: Math.max(0, t.miles - p.mile), playedAt: '' }))
            .sort((a, b) => a.mile - b.mile)
    };
}

async function makeReturn(id) {
    const t = tripById(id);
    if (!t) return;
    const r = reversedTrip(t);
    S.trips.push(r);
    saveLocal();
    renderTrips();
    renderHeader();
    try { await pushTrip(r); } catch (e) { showToast(`Saved on this phone; the sheet said: ${e.message}`); }
    renderHeader();
    showToast(`Added "${r.name}" with the same ${t.places.length} stops in reverse.`);
}

const shortName = (label) => String(label || '').split(',')[0].trim();

// ---------- Plan: stop inputs ----------
function stopInput(container, placeholder, getVal, setVal, removable, onRemove, moveUp, moveDown) {
    container.innerHTML = '';
    const wrap = el('div', 'stop-input');
    const pin = el('span', 'stop-pin');
    pin.appendChild(icon(container.id === 'endRow' ? 'flag' : container.id === 'startRow' ? 'navigation' : 'map-pin'));
    const input = el('input', 'text-input');
    input.type = 'text';
    input.placeholder = placeholder;
    input.autocomplete = 'off';
    input.value = getVal() ? getVal().label : '';
    const sug = el('div', 'suggest');
    sug.style.display = 'none';
    let timer, lastQ = '';
    input.oninput = () => {
        setVal(input.value.trim() ? { label: input.value.trim() } : null);
        clearTimeout(timer);
        const q = input.value.trim();
        if (q.length < 3) { sug.style.display = 'none'; return; }
        timer = setTimeout(async () => {
            lastQ = q;
            let res = [];
            try { res = await geocode(q); } catch (e) { return; }
            if (lastQ !== input.value.trim()) return;
            sug.innerHTML = '';
            res.forEach((r) => {
                const b = el('button', 'suggest-item', r.label);
                b.type = 'button';
                b.onmousedown = (ev) => ev.preventDefault();
                b.onclick = () => {
                    setVal({ label: r.label, lat: r.lat, lng: r.lng });
                    input.value = r.label;
                    sug.style.display = 'none';
                };
                sug.appendChild(b);
            });
            sug.style.display = res.length ? '' : 'none';
        }, 350);
    };
    input.onblur = () => setTimeout(() => { sug.style.display = 'none'; }, 150);
    wrap.append(pin, input);
    if (moveUp) wrap.appendChild(iconBtn('arrow-up', 'Move up', moveUp));
    if (moveDown) wrap.appendChild(iconBtn('arrow-down', 'Move down', moveDown));
    if (removable) wrap.appendChild(iconBtn('x', 'Remove', onRemove));
    container.append(wrap, sug);
}

function iconBtn(ic, label, onClick) {
    const b = el('button', 'icon-btn');
    b.type = 'button';
    b.setAttribute('aria-label', label);
    b.appendChild(icon(ic));
    b.onclick = onClick;
    return b;
}

function renderPlanForm() {
    const P = S.plan;
    stopInput($('startRow'), 'Starting point, e.g. Kansas City, MO', () => P.start, (v) => { P.start = v; });
    const vr = $('viaRows');
    vr.innerHTML = '';
    P.via.forEach((v, i) => {
        const row = el('div', 'stop-row');
        row.id = `via${i}`;
        vr.appendChild(row);
        stopInput(row, 'A city on the way', () => P.via[i], (x) => { P.via[i] = x; }, true,
            () => { P.via.splice(i, 1); renderPlanForm(); },
            i > 0 ? () => { [P.via[i - 1], P.via[i]] = [P.via[i], P.via[i - 1]]; renderPlanForm(); } : null,
            i < P.via.length - 1 ? () => { [P.via[i + 1], P.via[i]] = [P.via[i], P.via[i + 1]]; renderPlanForm(); } : null);
    });
    stopInput($('endRow'), 'Destination, e.g. Columbus, OH', () => P.end, (v) => { P.end = v; });
    renderInterests();
}

function renderInterests() {
    const box = $('interestChips');
    box.innerHTML = '';
    ALL_INTERESTS.forEach((x) => {
        const b = el('button', 'chip', x);
        b.type = 'button';
        b.setAttribute('aria-pressed', String(S.interests.includes(x)));
        b.onclick = () => {
            S.interests = S.interests.includes(x) ? S.interests.filter((y) => y !== x) : S.interests.concat(x);
            safeSet('rl_interests', JSON.stringify(S.interests));
            b.setAttribute('aria-pressed', String(S.interests.includes(x)));
        };
        box.appendChild(b);
    });
}

async function resolveStop(s, what) {
    if (!s || !s.label) throw new Error(`Please pick ${what}.`);
    if (isFinite(s.lat) && isFinite(s.lng)) return s;
    const res = await geocode(s.label);
    if (!res.length) throw new Error(`Couldn't find "${s.label}". Try adding the state, e.g. "Columbus, OH".`);
    return { label: res[0].label, lat: res[0].lat, lng: res[0].lng };
}

function setBuild(step, frac) {
    $('buildStep').textContent = step;
    $('buildBar').style.width = `${Math.round(frac * 100)}%`;
}

async function buildDraft() {
    showError('');
    const P = S.plan;
    let start, end, via;
    try {
        start = await resolveStop(P.start, 'a starting point');
        via = [];
        for (const v of P.via) if (v && v.label) via.push(await resolveStop(v, 'the city on the way'));
        end = await resolveStop(P.end, 'a destination');
    } catch (e) { showError(e.message); return; }
    P.start = start; P.via = via; P.end = end;
    show('planForm', false);
    show('buildProgress', true);
    show('planReview', false);
    try {
        setBuild('Finding the best driving route...', 0.05);
        const r = await driveRoute([start, ...via, end]);
        const route = routeFromCoords(r.coords);
        setBuild('Looking for towns, rivers and sights along the road...', 0.1);
        const places = await placesAlong(route, (i, n) => setBuild(`Scanning the road: ${i} of ${n} stretches done (the free map servers can be slow)...`, 0.1 + 0.6 * (i / n)));
        if (places.missedMiles) showToast(`The map servers skipped about ${Math.round(places.missedMiles)} miles of road. You can rebuild later to fill them in.`);
        setBuild(`Found ${places.length} places. Reading up on them in Wikipedia...`, 0.72);
        await addSummaries(places, (i, n) => setBuild(`Reading Wikipedia (${i} of ${n})...`, 0.72 + 0.25 * (n ? i / n : 1)));
        places.forEach((p) => { p.include = defaultInclude(p); });
        const name = $('tripName').value.trim() || `${shortName(start.label)} → ${shortName(end.label)}`;
        S.draft = {
            id: newId(), name, start, via, end, interests: S.interests.slice(),
            // The free router is slow on interstates; cap at a 62 mph average
            miles: r.meters / M_PER_MI, hours: Math.min(r.seconds / 3600, r.meters / M_PER_MI / 62),
            status: 'planned', createdAt: new Date().toISOString(),
            route: packRoute(r.coords), coords: r.coords, places, synced: false, lastMile: 0
        };
        S.kindFilter = null;
        renderReview();
    } catch (e) {
        show('planForm', true);
        showError(e.message);
    } finally {
        show('buildProgress', false);
    }
}

function updateReviewSub() {
    const d = S.draft;
    if (!d) return;
    const on = d.places.filter((p) => p.include !== false);
    $('reviewSub').textContent = `${miles(d.miles)} miles, about ${hoursText(d.hours)} of driving. ${plural(on.length, 'stop')} ticked for the guide.`;
}

function renderReview() {
    const d = S.draft;
    show('planReview', true);
    $('reviewTitle').textContent = d.name;
    updateReviewSub();
    // Kind chips with counts
    const chips = $('kindChips');
    chips.innerHTML = '';
    const counts = {};
    d.places.forEach((p) => { counts[p.kind] = (counts[p.kind] || 0) + 1; });
    const all = el('button', 'chip', `All ${d.places.length}`);
    all.setAttribute('aria-pressed', String(!S.kindFilter));
    all.onclick = () => { S.kindFilter = null; renderReview(); };
    chips.appendChild(all);
    Object.keys(KINDS).filter((k) => counts[k]).forEach((k) => {
        const b = el('button', 'chip', `${KINDS[k].label} ${counts[k]}`);
        b.setAttribute('aria-pressed', String(S.kindFilter === k));
        b.onclick = () => { S.kindFilter = k; renderReview(); };
        chips.appendChild(b);
    });
    const list = $('placeList');
    list.innerHTML = '';
    d.places.filter((p) => !S.kindFilter || p.kind === S.kindFilter)
        .forEach((p) => list.appendChild(placeRow(p, { toggle: true, note: true })));
    drawMap('planMap', d.coords || decodePolyline(d.route), d.places);
}

function drawMap(id, coords, places) {
    if (typeof L === 'undefined') return null;
    let m = S.maps[id];
    if (!m) {
        m = S.maps[id] = L.map(id, { zoomControl: true, attributionControl: true });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 18, attribution: '&copy; OpenStreetMap'
        }).addTo(m);
        m._layers2 = L.layerGroup().addTo(m);
    }
    m._layers2.clearLayers();
    const line = L.polyline(coords, { color: '#1f5f45', weight: 5, opacity: 0.85 }).addTo(m._layers2);
    places.filter((p) => p.include !== false).forEach((p) => {
        L.circleMarker([p.lat, p.lng], {
            radius: p.kind === 'city' ? 7 : p.kind === 'village' ? 4 : 5,
            color: '#fff', weight: 1.5, fillColor: kindInfo(p.kind).color, fillOpacity: 0.95
        }).bindTooltip(p.name).addTo(m._layers2);
    });
    setTimeout(() => { m.invalidateSize(); m.fitBounds(line.getBounds(), { padding: [16, 16] }); }, 60);
    return m;
}

async function saveDraft() {
    const d = S.draft;
    if (!d) return;
    const btn = $('saveTripBtn');
    btn.disabled = true;
    btn.textContent = 'Saving...';
    const trip = Object.assign({}, d);
    delete trip.coords;
    const made = [trip];
    if ($('withReturn').checked) made.push(reversedTrip(trip));
    S.trips.push(...made);
    saveLocal();
    try {
        for (const t of made) await pushTrip(t);
    } catch (e) {
        showToast(`Saved on this phone. The sheet said: ${e.message}`);
    }
    btn.disabled = false;
    btn.innerHTML = '';
    btn.append(icon('check'), document.createTextNode(' Looks good, save the trip'));
    S.draft = null;
    S.plan = { start: null, via: [], end: null };
    $('tripName').value = '';
    show('planReview', false);
    show('planForm', true);
    renderPlanForm();
    renderHeader();
    setView('trips');
    showToast(made.length > 1 ? `Saved "${made[0].name}" and the drive back.` : `Saved "${made[0].name}".`);
    if (S.remote && S.ai) writeAllNotes(made[0].id);
}

// ---------- Guide notes (Claude, through the sheet) ----------
function applyNotes(notes) {
    // Same place, same note, in every trip (so the drive back gets them too)
    S.trips.forEach((t) => t.places.forEach((p) => {
        const n = notes[p.id];
        if (n && n.note && !p.note) { p.note = n.note; p.noteSource = n.source || 'claude'; }
    }));
    saveLocal();
}

async function requestNotes(tripId, ids) {
    try {
        const res = await apiPost('narrate', { tripId, ids });
        applyNotes(res.notes || {});
        return true;
    } catch (e) {
        if (e.data && e.data.error === 'NO_API_KEY') { S.ai = false; renderHeader(); }
        return false;
    }
}

async function writeAllNotes(tripId, btn) {
    const t = tripById(tripId);
    if (!t || S.noteJobs[tripId] || !S.remote) return;
    if (!t.synced) await pushTrip(t);
    S.noteJobs[tripId] = true;
    const todo = t.places.filter((p) => p.include !== false && !p.note).map((p) => p.id);
    const total = todo.length;
    let done = 0;
    const batches = [];
    for (let i = 0; i < todo.length; i += 8) batches.push(todo.slice(i, i + 8));
    const worker = async () => {
        while (batches.length) {
            const b = batches.shift();
            await requestNotes(tripId, b);
            done += b.length;
            if (btn) btn.lastChild.textContent = ` Writing notes ${Math.min(done, total)} of ${total}...`;
        }
    };
    await Promise.all([worker(), worker(), worker()]);
    delete S.noteJobs[tripId];
    if (S.view === 'trips') renderTrips();
    showToast(`Guide notes ready for "${t.name}".`);
}

// ---------- Drive ----------
const D = {
    trip: null, route: null, watchId: null, demoTimer: null, wake: null,
    mile: 0, lastIdx: null, pos: null, queue: [], current: null, done: new Set(),
    playedSince: [], lastPush: 0, prefetched: new Set(), running: false, marker: null, demoMile: 0
};

function openDrive(id) {
    const t = tripById(id);
    if (!t) return;
    if (D.running && D.trip && D.trip.id !== id) stopDrive();
    D.trip = t;
    D.route = routeFromCoords(decodePolyline(t.route));
    D.mile = t.lastMile || 0;
    D.done = new Set(t.places.filter((p) => p.playedAt).map((p) => p.id));
    D.queue = [];
    D.current = null;
    safeSet('rl_driveTrip', id);
    setView('drive');
}

function renderDrive() {
    const t = D.trip;
    show('driveEmpty', !t);
    show('driveBody', !!t);
    if (!t) return;
    $('driveTitle').textContent = t.name;
    $('driveSub').textContent = `${miles(t.miles)} miles · ${[t.start.label, ...t.via.map((v) => v.label), t.end.label].map(shortName).join(' → ')}`;
    const m = drawMap('driveMap', D.route.coords, t.places);
    if (m && D.pos) placeMarker();
    renderDriveStatus();
    renderStartBtn();
}

function renderStartBtn() {
    const b = $('startBtn');
    b.innerHTML = '';
    if (D.running) {
        b.classList.add('stop');
        b.append(icon('square'), document.createTextNode(' Stop'));
    } else {
        b.classList.remove('stop');
        b.append(icon('play'), document.createTextNode(D.trip && D.trip.status === 'active' ? ' Continue the trip' : ' Start the trip'));
    }
    $('demoBtn').style.display = D.running ? 'none' : '';
    $('muteBtn').innerHTML = '';
    $('muteBtn').appendChild(icon(Voice.muted ? 'volume-x' : 'volume-2'));
}

function included() {
    return D.trip.places.filter((p) => p.include !== false);
}

function renderDriveStatus() {
    const t = D.trip;
    const frac = t.miles ? Math.min(1, D.mile / t.miles) : 0;
    $('driveBar').style.width = `${(frac * 100).toFixed(1)}%`;
    $('mileNow').textContent = `Mile ${miles(D.mile)}`;
    $('mileLeft').textContent = `${miles(Math.max(0, t.miles - D.mile))} mi to ${shortName(t.end.label)}`;
    const up = $('upNext');
    up.innerHTML = '';
    const next = included().filter((p) => !D.done.has(p.id) && p.mile >= D.mile - 1).slice(0, 6);
    if (!next.length) up.appendChild(el('p', 'no-results', 'No more stops on this trip.'));
    next.forEach((p) => {
        const dist = p.mile - D.mile;
        const when = dist <= 0.3 ? 'right about now' : `in ${miles(dist)} mi`;
        up.appendChild(placeRow(p, { distance: `${kindInfo(p.kind).one} · ${when}` }));
    });
    const played = included().filter((p) => D.done.has(p.id));
    $('playedCount').textContent = played.length;
    const pl = $('playedList');
    pl.innerHTML = '';
    played.slice().reverse().forEach((p) => {
        const r = placeRow(p, { note: true });
        r.appendChild(iconBtn('play', `Play ${p.name} again`, () => playPlace(p, true)));
        pl.appendChild(r);
    });
}

function placeMarker() {
    const m = S.maps.driveMap;
    if (!m || !D.pos) return;
    if (!D.marker || !m.hasLayer(D.marker)) {
        D.marker = L.circleMarker(D.pos, { radius: 9, color: '#fff', weight: 3, fillColor: '#e07a1f', fillOpacity: 1 }).addTo(m);
    }
    D.marker.setLatLng(D.pos);
    if (D.running) m.panTo(D.pos, { animate: true });
}

async function startDrive(demo) {
    const t = D.trip;
    if (!t) return;
    Voice.unlock();
    D.running = true;
    D.demo = !!demo;
    if (t.status !== 'active') {
        t.status = 'active';
        t.startedAt = new Date().toISOString();
        saveLocal();
        pushProgress({ status: 'active' });
    }
    try { if ('wakeLock' in navigator) D.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* not allowed */ }
    renderStartBtn();
    // Anything already behind us when we start is skipped quietly
    D.skipBehind = true;
    const hello = `Hi there, I'm Miles, your guide from ${shortName(t.start.label)} to ${shortName(t.end.label)}. ` +
        `That's about ${Math.round(t.miles)} miles, and I've got stories for ${included().length} stops along the way. ` +
        `Driver, you keep your eyes on the road, and I'll do the talking. Let's roll!`;
    showNow({ name: 'Here we go!', kind: 'intro' }, hello);
    const intro = { id: '_intro' };
    D.current = intro;
    Voice.speak(hello, () => { if (D.current === intro) D.current = null; pump(); });
    if (demo) {
        D.demoMile = D.mile;
        $('gpsBadge').textContent = 'Demo';
        $('gpsBadge').className = 'badge warn';
        D.demoTimer = setInterval(() => {
            if (D.current) return; // pause the demo car while the guide talks
            D.demoMile += 1.5;
            if (D.demoMile > t.miles + 0.5) { clearInterval(D.demoTimer); return; }
            const p = pointAt(D.route, D.demoMile * M_PER_MI);
            onFix(p[0], p[1], 20);
        }, 700);
        const p0 = pointAt(D.route, D.demoMile * M_PER_MI);
        onFix(p0[0], p0[1], 20);
    } else if ('geolocation' in navigator) {
        $('gpsBadge').textContent = 'Finding GPS...';
        $('gpsBadge').className = 'badge warn';
        D.watchId = navigator.geolocation.watchPosition(
            (pos) => onFix(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy, pos.coords.speed),
            (err) => {
                $('gpsBadge').textContent = 'GPS blocked';
                $('gpsBadge').className = 'badge bad';
                showError(err.code === 1
                    ? 'Location is blocked. Allow location for this site (browser settings > Site settings > Location), then tap Start again.'
                    : `Can't get your location yet (${err.message}). Keep the screen on; it usually comes back.`);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 }
        );
    } else {
        showError('This browser has no GPS access. Try Chrome or Safari on your phone.');
    }
}

function stopDrive() {
    D.running = false;
    if (D.watchId !== null) navigator.geolocation.clearWatch(D.watchId);
    D.watchId = null;
    clearInterval(D.demoTimer);
    D.demoTimer = null;
    Voice.stop();
    D.current = null;
    D.queue = [];
    if (D.wake) { D.wake.release().catch(() => {}); D.wake = null; }
    $('gpsBadge').textContent = 'GPS off';
    $('gpsBadge').className = 'badge';
    if (!D.demo) pushProgress({});
    renderStartBtn();
}

function onFix(lat, lng, accuracy, speed) {
    if (!D.running) return;
    const t = D.trip;
    const p = [lat, lng];
    D.pos = p;
    showError('');
    const badge = $('gpsBadge');
    if (!D.demo) {
        badge.textContent = speed > 1 ? `${Math.round(speed * 2.237)} mph` : `GPS ±${Math.round(accuracy || 0)} m`;
        badge.className = 'badge ok';
    }
    // Where are we on the road? Search near the last match first, then everywhere.
    let hit = null;
    if (D.lastIdx !== null) hit = nearestOnRoute(D.route, p, D.lastIdx - 300, D.lastIdx + 600);
    if (!hit || hit.off > 1500) hit = nearestOnRoute(D.route, p);
    const onRoad = hit.off < 3 * M_PER_MI;
    if (onRoad) {
        D.lastIdx = hit.i;
        D.mile = hit.along / M_PER_MI;
    }
    const placesNow = included();
    placesNow.forEach((pl) => {
        if (D.done.has(pl.id) || D.queue.includes(pl) || (D.current && D.current.id === pl.id)) return;
        const k = kindInfo(pl.kind);
        if (onRoad && D.mile > pl.mile + 2 && D.skipBehind) { D.done.add(pl.id); return; }
        const near = haversine(p, [pl.lat, pl.lng]) / M_PER_MI <= Math.max(k.radius, pl.off + 1);
        const due = onRoad && D.mile >= pl.mile - k.lead && D.mile <= pl.mile + 1.5;
        if (near || due) D.queue.push(pl);
    });
    D.skipBehind = false;
    if (t.miles && D.mile >= t.miles - 0.6 && t.status !== 'done' && !D.finishing) finishTrip();
    prefetchNotes();
    placeMarker();
    renderDriveStatus();
    pump();
    if (!D.demo && Date.now() - D.lastPush > 180000) pushProgress({});
}

// Picks the next stop to talk about: the most interesting one that's still close
function pump() {
    if (D.current || !D.queue.length || !D.running) return;
    D.queue = D.queue.filter((p) => D.mile - p.mile < (kindInfo(p.kind).prio >= 4 ? 8 : 4));
    if (!D.queue.length) return;
    // Too many waiting: drop villages first
    if (D.queue.length > 3) {
        D.queue.sort((a, b) => kindInfo(b.kind).prio - kindInfo(a.kind).prio || a.mile - b.mile);
        D.queue.splice(3).forEach((p) => D.done.add(p.id));
    }
    D.queue.sort((a, b) => a.mile - b.mile);
    playPlace(D.queue.shift());
}

function playPlace(p, replay) {
    const text = p.note || templateNote(p);
    D.current = p;
    showNow(p, text);
    Voice.speak(text, () => {
        if (D.current === p) D.current = null;
        if (!replay) markPlayed(p);
        renderDriveStatus();
        setTimeout(pump, 1200);
    });
    if (replay && !D.running) setTimeout(() => { if (D.current === p) D.current = null; }, 100);
}

function showNow(p, text) {
    const k = p.kind === 'intro' ? { one: 'Your guide', icon: 'smile', color: '#e07a1f' } : kindInfo(p.kind);
    $('nowCard').classList.remove('idle');
    $('nowLabel').textContent = p.kind === 'intro' ? 'Your guide' : `${k.one}${p.mile !== undefined ? ` · mile ${miles(p.mile)}` : ''}`;
    $('nowName').textContent = p.name;
    $('nowText').textContent = text;
    const ic = $('nowIcon');
    ic.innerHTML = '';
    ic.style.background = k.color;
    ic.appendChild(icon(k.icon));
}

function markPlayed(p) {
    D.done.add(p.id);
    p.playedAt = new Date().toISOString();
    D.playedSince.push(p.id);
    saveLocal();
    if (!D.demo && D.playedSince.length >= 3) pushProgress({});
}

function pushProgress(extra) {
    const t = D.trip;
    if (!t || !S.remote) return;
    t.lastMile = D.mile;
    saveLocal();
    const played = D.playedSince.splice(0);
    D.lastPush = Date.now();
    apiPost('progress', Object.assign({ tripId: t.id, lastMile: D.mile, played }, extra), { keepalive: true })
        .catch(() => { D.playedSince.push(...played); });
}

function finishTrip() {
    const t = D.trip;
    D.finishing = true;
    t.status = 'done';
    saveLocal();
    if (!D.demo) pushProgress({ status: 'done' });
    const bye = `And that's a wrap! Welcome to ${shortName(t.end.label)}. ${Math.round(t.miles)} miles, ${D.done.size} stories, ` +
        `and hopefully a few smiles. Thanks for riding with me. Stretch those legs, you earned it!`;
    const after = () => { D.finishing = false; stopDrive(); };
    const say = () => { showNow({ name: `You made it to ${shortName(t.end.label)}!`, kind: 'intro' }, bye); Voice.speak(bye, after); };
    if (D.current) { const wait = setInterval(() => { if (!D.current) { clearInterval(wait); say(); } }, 1000); } else say();
}

// Keep notes for the next stops ready (the sheet writes them with Claude)
function prefetchNotes() {
    if (!S.remote || !S.ai || !D.trip.synced) return;
    const ids = included().filter((p) => !p.note && !D.done.has(p.id) && p.mile >= D.mile - 1 && !D.prefetched.has(p.id))
        .slice(0, 8).map((p) => p.id);
    if (ids.length < 3 && ids.length && included().filter((p) => !p.note && p.mile >= D.mile).length > ids.length) return;
    if (!ids.length) return;
    ids.forEach((id) => D.prefetched.add(id));
    requestNotes(D.trip.id, ids);
}

// ---------- Wiring ----------
function prefillFromUrl() {
    const q = new URLSearchParams(location.search);
    if (!q.get('from') && !q.get('to')) return false;
    const lab = (s) => (s ? { label: s } : null);
    S.plan = { start: lab(q.get('from')), via: q.getAll('via').map(lab), end: lab(q.get('to')) };
    if (q.get('name')) $('tripName').value = q.get('name');
    return true;
}

function init() {
    loadLocal();
    try { S.interests = JSON.parse(safeGet('rl_interests') || 'null') || DEFAULT_INTERESTS.slice(); } catch (e) { S.interests = DEFAULT_INTERESTS.slice(); }
    const fromUrl = prefillFromUrl();
    renderPlanForm();
    renderHeader();
    document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
    $('newTrip').onclick = () => setView('plan');
    $('addVia').onclick = () => { S.plan.via.push(null); renderPlanForm(); };
    $('buildBtn').onclick = buildDraft;
    $('backToForm').onclick = () => { show('planReview', false); show('planForm', true); };
    $('saveTripBtn').onclick = saveDraft;
    $('startBtn').onclick = () => (D.running ? stopDrive() : startDrive(false));
    $('demoBtn').onclick = () => startDrive(true);
    $('replayBtn').onclick = () => { if (D.current && D.current.id !== '_intro') playPlace(D.current, true); else if (D.trip) { const last = included().filter((p) => D.done.has(p.id)).pop(); if (last) playPlace(last, true); } };
    $('skipBtn').onclick = () => { const c = D.current; Voice.stop(); if (c && c.id) { if (c.id !== '_intro') markPlayed(c); D.current = null; } setTimeout(pump, 300); };
    $('muteBtn').onclick = () => { Voice.muted = !Voice.muted; if (Voice.muted) Voice.stop(); D.current = null; renderStartBtn(); pump(); };

    $('urlInput').value = CONFIG.appsScriptUrl;
    $('keyInput').value = CONFIG.accessKey;
    $('saveUrlBtn').onclick = async () => {
        CONFIG.appsScriptUrl = $('urlInput').value.trim();
        CONFIG.accessKey = $('keyInput').value.trim();
        safeSet('rl_appsScriptUrl', CONFIG.appsScriptUrl || null);
        safeSet('rl_accessKey', CONFIG.accessKey || null);
        await sync();
        renderTrips();
        showToast(S.remote ? 'Connected to the Google Sheet.' : 'Saved. Could not reach the sheet yet.');
    };
    const rate = Number(safeGet('rl_rate')) || 1;
    Voice.rate = rate;
    $('rateInput').value = rate;
    $('rateInput').oninput = () => { Voice.rate = Number($('rateInput').value); safeSet('rl_rate', String(Voice.rate)); };
    $('testVoice').onclick = () => { Voice.unlock(); Voice.speak("Howdy! I'm Miles, your road-trip guide. Buckle up, grab a snack, and let's find some stories."); };

    document.addEventListener('visibilitychange', async () => {
        if (document.visibilityState === 'visible' && D.running && !D.wake && 'wakeLock' in navigator) {
            try { D.wake = await navigator.wakeLock.request('screen'); } catch (e) { /* ignore */ }
        }
    });

    const lastTrip = safeGet('rl_driveTrip');
    if (lastTrip && tripById(lastTrip)) openDrive(lastTrip);
    setView(fromUrl ? 'plan' : (safeGet('rl_view') || 'trips'));
    sync().then(() => {
        if (D.trip) D.trip = tripById(D.trip.id) || D.trip;
        if (S.view === 'trips') renderTrips();
    });
}

init();
