// Shared helpers: config, DOM shortcuts and the Apps Script API (same pattern as ku-accomodation and
// isha-kc-volunteers: JSONP for reads; JSON POST for writes, which can be large).
// Paste the deployed /exec URL into appsScriptUrl to bake it in for everyone; until then each browser can
// connect a sheet from the Settings box (saved in that browser only). Trips are also kept in the browser,
// so the page works offline on the road and syncs when the sheet is reachable.
const CONFIG = {
    appsScriptUrl: safeGet('rl_appsScriptUrl') || '',
    accessKey: safeGet('rl_accessKey') || ''
};
let jsonpCounter = 0;

function safeGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
}
function safeSet(k, v) {
    try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* private mode */ }
}

const $ = (id) => document.getElementById(id);

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
}

function show(id, on) {
    $(id).style.display = on ? '' : 'none';
}

function showError(msg) {
    const e = $('errorMessage');
    e.textContent = msg;
    show('errorMessage', !!msg);
}

let toastTimer;
function showToast(msg) {
    const e = $('toast');
    e.textContent = msg;
    show('toast', true);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => show('toast', false), 5000);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const miles = (m) => (m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString('en-US'));
const hoursText = (h) => {
    const hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return hh ? `${hh} h ${mm} min` : `${mm} min`;
};

// ---------- API ----------
function jsonpRequest(params) {
    return new Promise((resolve, reject) => {
        const cb = `rlJsonpCb_${Date.now()}_${jsonpCounter++}`;
        const script = document.createElement('script');
        const cleanup = () => { delete window[cb]; script.remove(); };
        const timer = setTimeout(() => { cleanup(); reject(new Error('Request timed out')); }, 30000);
        window[cb] = (data) => { clearTimeout(timer); cleanup(); resolve(data); };
        script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error('Unable to reach the Google Sheet')); };
        const q = { ...params, callback: cb };
        if (CONFIG.accessKey) q.key = CONFIG.accessKey;
        script.src = `${CONFIG.appsScriptUrl}?${new URLSearchParams(q)}`;
        document.body.appendChild(script);
    });
}

async function api(params) {
    const data = await jsonpRequest(params);
    if (!data.success) throw new Error(data.error || 'Request failed');
    return data;
}

// A string body is sent as text/plain, so there's no CORS preflight; Apps Script's reply allows any origin.
async function apiPost(action, body, opts) {
    const r = await fetch(CONFIG.appsScriptUrl, {
        method: 'POST',
        body: JSON.stringify({ action, key: CONFIG.accessKey || undefined, ...body }),
        keepalive: !!(opts && opts.keepalive)
    });
    const data = await r.json();
    if (!data.success) {
        const err = new Error(data.error || 'Request failed');
        err.data = data;
        throw err;
    }
    return data;
}
