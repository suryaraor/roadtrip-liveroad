// Google Apps Script backend for Roadtrip LiveRoad
// Open the Google Sheet > Extensions > Apps Script > paste this file > Deploy as Web app
// (Execute as: Me, Who has access: Anyone). The Trips and Places tabs are created on first load,
// so an empty spreadsheet is enough.
//
// Script properties (Project Settings > Script properties), all optional:
//   ANTHROPIC_API_KEY  lets the backend write the tour-guide notes with Claude. Without it the page
//                      writes simpler notes from Wikipedia itself.
//   ACCESS_KEY         a passphrase. When set, the page must send the same key (it asks once and
//                      remembers it in that browser), so a stranger with the link can't read or edit trips.

const TRIPS_SHEET = 'Trips';
const PLACES_SHEET = 'Places';

// One row per trip. Stops JSON = the start, via and end points; Route = the road as an encoded polyline.
// Status: planned | active | done. Type "yes" in Deleted to hide a trip.
// Interests: what the guide should focus on, separated by ";" (e.g. History; Native American heritage; Inventions).
const TRIP_HEADERS = ['Trip ID', 'Name', 'Start', 'Via', 'End', 'Interests', 'Miles', 'Drive Hours', 'Status', 'Places',
  'Notes Ready', 'Created At', 'Started At', 'Finished At', 'Last Mile', 'Last Seen At', 'Return Of',
  'Stops JSON', 'Route', 'Deleted'];

// One row per place per trip, in road order. Mile = miles from the trip start.
// Include "no" = skip it on the drive. Edit a Note to change what the guide says (Note Source turns to "edited"
// only if you type it; the page never overwrites a note that is already there).
const PLACE_HEADERS = ['Trip ID', 'Place ID', 'Order', 'Name', 'Kind', 'Mile', 'Off Route Miles', 'Lat', 'Lng',
  'Population', 'Wikipedia', 'Summary', 'Note', 'Note Source', 'Include', 'Played At', 'Plays'];

const MODEL = 'claude-opus-5-5';
const NOTES_PER_CALL = 8;
const TEXT_MAX = 4000;

function doGet(e) {
  return respond(e.parameter || {}, (p) => {
    switch (p.action) {
      case 'getData': return getData();
      case 'ping': return { success: true, ai: !!apiKey() };
      default: return { success: false, error: 'Unknown action' };
    }
  });
}

// Writes come as POST with a JSON text body (text/plain, so the browser sends no CORS preflight)
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (err) { /* handled below */ }
  return respond(body, (p) => {
    switch (p.action) {
      case 'saveTrip': return withLock(() => saveTrip(p));
      case 'deleteTrip': return withLock(() => deleteTrip(p.tripId));
      case 'narrate': return narrate(p);
      case 'saveNotes': return withLock(() => saveNotes(p.tripId, p.notes || {}));
      case 'progress': return withLock(() => progress(p));
      default: return { success: false, error: 'Unknown action' };
    }
  });
}

function respond(p, handler) {
  let result;
  try {
    const want = PropertiesService.getScriptProperties().getProperty('ACCESS_KEY');
    result = want && String(p.key || '') !== want ? { success: false, error: 'ACCESS_KEY' } : handler(p);
  } catch (err) {
    result = { success: false, error: String(err) };
  }
  // JSONP so reads work from GitHub Pages without CORS
  if (p.callback && /^[\w.]+$/.test(p.callback)) {
    return ContentService.createTextOutput(`${p.callback}(${JSON.stringify(result)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function spreadsheet() {
  return SpreadsheetApp.getActiveSpreadsheet() ||
    SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
}

function apiKey() {
  return PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY') || '';
}

function ensureSheet(name, headers) {
  const ss = spreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// { head, rows } where rows are arrays; head maps header -> column index
function table(name, headers) {
  const sheet = ensureSheet(name, headers);
  const data = sheet.getDataRange().getValues();
  const head = {};
  data[0].forEach((h, i) => { head[String(h).trim()] = i; });
  return { sheet: sheet, head: head, rows: data.slice(1), width: data[0].length };
}

const isYes = v => /^(y|yes|true|1)$/i.test(String(v || '').trim());
const isNo = v => String(v || '').trim().toLowerCase() === 'no';
const iso = v => (v instanceof Date ? v.toISOString() : v);
// Text a person typed is stored as text, never as a formula
const safe = v => (typeof v === 'string' && /^[=+\-@]/.test(v) ? `'${v}` : v);
const clip = (v, n) => String(v === undefined || v === null ? '' : v).slice(0, n || TEXT_MAX);

function getData() {
  const t = table(TRIPS_SHEET, TRIP_HEADERS);
  const p = table(PLACES_SHEET, PLACE_HEADERS);
  const trips = t.rows.filter(r => r[t.head['Trip ID']] && !isYes(r[t.head['Deleted']])).map(r => {
    const o = {};
    TRIP_HEADERS.forEach(h => { if (h in t.head) o[h] = iso(r[t.head[h]]); });
    return o;
  });
  const wanted = {};
  trips.forEach(x => { wanted[x['Trip ID']] = true; });
  const places = p.rows.filter(r => wanted[r[p.head['Trip ID']]]).map(r => {
    const o = {};
    PLACE_HEADERS.forEach(h => { if (h in p.head) o[h] = iso(r[p.head[h]]); });
    return o;
  });
  return { success: true, trips: trips, places: places, ai: !!apiKey() };
}

// Upserts the trip row. With replace=true its places are replaced by `places`; otherwise `places` are appended
// (the page sends big trips in several calls). Notes already in the sheet for the same Place ID are kept.
function saveTrip(p) {
  const trip = p.trip || {};
  const id = String(trip['Trip ID'] || '').trim();
  if (!/^[\w-]{4,40}$/.test(id)) return { success: false, error: 'Bad trip id' };
  const t = table(TRIPS_SHEET, TRIP_HEADERS);
  const rowVals = TRIP_HEADERS.map(h => safe(h === 'Route' || h === 'Stops JSON' ? clip(trip[h], 49000) : clip(trip[h], 500)));
  const idx = t.rows.findIndex(r => String(r[t.head['Trip ID']]) === id);
  if (idx === -1) {
    t.sheet.appendRow(rowVals);
  } else {
    const existing = t.rows[idx];
    // Keep progress fields the page didn't send
    TRIP_HEADERS.forEach((h, j) => { if (trip[h] === undefined || trip[h] === null) rowVals[j] = existing[t.head[h]]; });
    t.sheet.getRange(idx + 2, 1, 1, TRIP_HEADERS.length).setValues([rowVals]);
  }

  const pl = table(PLACES_SHEET, PLACE_HEADERS);
  const known = {}; // Place ID -> existing note, so a re-saved or return trip reuses it
  pl.rows.forEach(r => {
    const n = r[pl.head['Note']];
    if (n) known[r[pl.head['Place ID']]] = [n, r[pl.head['Note Source']]];
  });
  const incoming = (p.places || []).map(x => PLACE_HEADERS.map(h => {
    let v = x[h];
    if (h === 'Trip ID') v = id;
    if ((h === 'Note' || h === 'Note Source') && !v && known[x['Place ID']]) v = known[x['Place ID']][h === 'Note' ? 0 : 1];
    return safe(h === 'Summary' || h === 'Note' ? clip(v) : clip(v, 300));
  }));
  if (p.replace) {
    const keep = pl.rows.filter(r => String(r[pl.head['Trip ID']]) !== id);
    const all = keep.map(r => PLACE_HEADERS.map(h => (h in pl.head ? r[pl.head[h]] : ''))).concat(incoming);
    const sheet = pl.sheet;
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
    if (all.length) sheet.getRange(2, 1, all.length, PLACE_HEADERS.length).setValues(all);
  } else if (incoming.length) {
    pl.sheet.getRange(pl.sheet.getLastRow() + 1, 1, incoming.length, PLACE_HEADERS.length).setValues(incoming);
  }
  SpreadsheetApp.flush();
  updateNotesReady(id);
  return { success: true };
}

function deleteTrip(tripId) {
  const t = table(TRIPS_SHEET, TRIP_HEADERS);
  const idx = t.rows.findIndex(r => String(r[t.head['Trip ID']]) === String(tripId));
  if (idx === -1) return { success: false, error: 'Trip not found' };
  t.sheet.getRange(idx + 2, t.head['Deleted'] + 1).setValue('yes');
  return { success: true };
}

function updateNotesReady(tripId) {
  const pl = table(PLACES_SHEET, PLACE_HEADERS);
  let total = 0, ready = 0;
  pl.rows.forEach(r => {
    if (String(r[pl.head['Trip ID']]) !== String(tripId)) return;
    total++;
    if (r[pl.head['Note']]) ready++;
  });
  const t = table(TRIPS_SHEET, TRIP_HEADERS);
  const idx = t.rows.findIndex(r => String(r[t.head['Trip ID']]) === String(tripId));
  if (idx === -1) return { total: total, ready: ready };
  t.sheet.getRange(idx + 2, t.head['Places'] + 1).setValue(total);
  t.sheet.getRange(idx + 2, t.head['Notes Ready'] + 1).setValue(ready);
  return { total: total, ready: ready };
}

// Writes notes to every row with the same Place ID that has no note yet (so the return trip gets them too).
// notes: { placeId: { note, source } }
function saveNotes(tripId, notes) {
  const pl = table(PLACES_SHEET, PLACE_HEADERS);
  const nc = pl.head['Note'], sc = pl.head['Note Source'];
  let written = 0;
  const touched = {};
  pl.rows.forEach((r, i) => {
    const n = notes[r[pl.head['Place ID']]];
    if (!n || !n.note || r[nc]) return;
    pl.sheet.getRange(i + 2, nc + 1).setValue(safe(clip(n.note)));
    pl.sheet.getRange(i + 2, sc + 1).setValue(clip(n.source || 'template', 40));
    touched[r[pl.head['Trip ID']]] = true;
    written++;
  });
  SpreadsheetApp.flush();
  Object.keys(touched).forEach(id => { if (id !== String(tripId)) updateNotesReady(id); });
  return Object.assign({ success: true, written: written }, updateNotesReady(tripId));
}

// Notes for the given place ids of a trip: reused when the sheet already has one, written by Claude otherwise.
function narrate(p) {
  const tripId = String(p.tripId || '');
  const ids = (p.ids || []).slice(0, NOTES_PER_CALL * 2).map(String);
  const t = table(TRIPS_SHEET, TRIP_HEADERS);
  const trip = t.rows.find(r => String(r[t.head['Trip ID']]) === tripId);
  if (!trip) return { success: false, error: 'Trip not found' };
  const pl = table(PLACES_SHEET, PLACE_HEADERS);
  const out = {};
  const need = [];
  const byId = {};
  pl.rows.forEach(r => {
    const pid = String(r[pl.head['Place ID']]);
    if (ids.indexOf(pid) === -1) return;
    if (r[pl.head['Note']]) out[pid] = { note: r[pl.head['Note']], source: r[pl.head['Note Source']] || 'claude' };
    if (String(r[pl.head['Trip ID']]) === tripId) byId[pid] = r;
  });
  ids.forEach(id => { if (!out[id] && byId[id]) need.push(byId[id]); });
  if (need.length && !apiKey()) return { success: false, error: 'NO_API_KEY', notes: out };
  if (need.length) {
    const ctx = {
      trip: trip[t.head['Name']], from: trip[t.head['Start']], to: trip[t.head['End']], via: trip[t.head['Via']],
      interests: 'Interests' in t.head ? trip[t.head['Interests']] : ''
    };
    const fresh = writeNotes(ctx, need.slice(0, NOTES_PER_CALL).map(r => ({
      id: String(r[pl.head['Place ID']]),
      name: r[pl.head['Name']],
      kind: r[pl.head['Kind']],
      mile: r[pl.head['Mile']],
      lat: r[pl.head['Lat']],
      lng: r[pl.head['Lng']],
      population: r[pl.head['Population']] || undefined,
      offRouteMiles: r[pl.head['Off Route Miles']] || undefined,
      wikipedia: r[pl.head['Summary']] || undefined
    })));
    const save = {};
    Object.keys(fresh).forEach(id => { save[id] = { note: fresh[id], source: 'claude' }; out[id] = save[id]; });
    withLock(() => saveNotes(tripId, save));
  }
  return { success: true, notes: out };
}

const GUIDE_SYSTEM = [
  'You are Miles, a road-trip tour guide riding along in the car. You have driven every highway in America,',
  'you know the stories behind small towns and big cities, and you love making people smile.',
  'Your notes are read aloud by text-to-speech to a family in a moving car as they pass each place.',
  '',
  'Write one note per place:',
  '- 70 to 120 words, spoken English, plain sentences. No lists, emojis, markdown, headings or parentheses.',
  '- Open by naming the place in a fresh way, and vary your openers across the batch.',
  '- Give one or two genuinely interesting, accurate facts. Prefer the Wikipedia text you are given.',
  '  If you are not sure a detail is true, leave it out. Never invent people, dates or numbers.',
  '- Be warm and playful, with one light, family-friendly joke or pun. Knowledgeable, never cheesy for long.',
  '- When it fits, add one quick local tip (a famous food or stop) only if it is well known.',
  '- The notes are reused for the drive in both directions: never say east, west, left, right, "coming up" or',
  '  "behind us", and do not assume where the car is heading next.',
  '- The driver must keep their eyes on the road. Invite passengers, not the driver, to look at things.',
  '- For a river, talk about the river and the crossing. For a small village, a single fun line about life',
  '  there or the region is fine when there is little to say.'
].join('\n');

function writeNotes(ctx, places) {
  const schema = {
    type: 'object',
    properties: {
      notes: {
        type: 'array',
        items: {
          type: 'object',
          properties: { id: { type: 'string' }, note: { type: 'string' } },
          required: ['id', 'note'],
          additionalProperties: false
        }
      }
    },
    required: ['notes'],
    additionalProperties: false
  };
  const interests = String(ctx.interests || '').split(/\s*;\s*/).filter(Boolean).join(', ');
  const user = 'Road trip: ' + ctx.trip + ' (from ' + ctx.from + (ctx.via ? ' via ' + ctx.via : '') + ' to ' + ctx.to + ').\n' +
    (interests ? 'The travelers love: ' + interests + '. Lead with whatever true story about each place best fits ' +
      'these interests (for example the Native American nations whose land it was, a historical event, a local ' +
      'incident, an invention or a well-known business that started there). Skip an interest when the place has ' +
      'nothing real to offer on it.\n' : '') +
    'Write a note for each of these places, returning the same id with each note:\n' + JSON.stringify(places);
  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: {
      'x-api-key': apiKey(),
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01'
    },
    payload: JSON.stringify({
      model: MODEL,
      max_tokens: 8000,
      system: GUIDE_SYSTEM,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schema } },
      fallbacks: 'default',
      messages: [{ role: 'user', content: user }]
    })
  });
  const code = res.getResponseCode();
  const body = JSON.parse(res.getContentText() || '{}');
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + ((body.error && body.error.message) || 'request failed'));
  if (body.stop_reason === 'refusal') throw new Error('Claude declined to write these notes');
  const text = (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const parsed = JSON.parse(text);
  const out = {};
  (parsed.notes || []).forEach(n => { if (n.id && n.note) out[String(n.id)] = String(n.note).trim(); });
  return out;
}

// Trip progress from the phone: status, how far along, and which places were just played
function progress(p) {
  const tripId = String(p.tripId || '');
  const t = table(TRIPS_SHEET, TRIP_HEADERS);
  const idx = t.rows.findIndex(r => String(r[t.head['Trip ID']]) === tripId);
  if (idx === -1) return { success: false, error: 'Trip not found' };
  const row = idx + 2;
  const now = new Date();
  const set = (h, v) => t.sheet.getRange(row, t.head[h] + 1).setValue(v);
  if (p.status && /^(planned|active|done)$/.test(p.status)) {
    const was = String(t.rows[idx][t.head['Status']]);
    set('Status', p.status);
    if (p.status === 'active' && was !== 'active' && !t.rows[idx][t.head['Started At']]) set('Started At', now);
    if (p.status === 'done') set('Finished At', now);
  }
  if (p.lastMile !== undefined && isFinite(Number(p.lastMile))) {
    set('Last Mile', Math.round(Number(p.lastMile) * 10) / 10);
    set('Last Seen At', now);
  }
  const played = (p.played || []).map(String);
  if (played.length) {
    const pl = table(PLACES_SHEET, PLACE_HEADERS);
    pl.rows.forEach((r, i) => {
      if (String(r[pl.head['Trip ID']]) !== tripId || played.indexOf(String(r[pl.head['Place ID']])) === -1) return;
      pl.sheet.getRange(i + 2, pl.head['Played At'] + 1).setValue(now);
      pl.sheet.getRange(i + 2, pl.head['Plays'] + 1).setValue((Number(r[pl.head['Plays']]) || 0) + 1);
    });
  }
  return { success: true };
}

// Run once from the editor to test your Claude key: View > Logs shows a sample note.
function testGuide() {
  const notes = writeNotes({ trip: 'Test', from: 'Kansas City, MO', to: 'Columbus, OH', via: 'St. Louis' },
    [{ id: 't1', name: 'Boonville', kind: 'town', lat: 38.97, lng: -92.74 }]);
  Logger.log(notes);
}
