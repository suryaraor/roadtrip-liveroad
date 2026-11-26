// The voice of the guide: picks the friendliest English voice on the phone and reads notes sentence by
// sentence (some phones cut off long utterances). Also writes a backup note from Wikipedia when the sheet
// has no Claude key or the phone is offline.

// While the guide talks, ask the phone to quiet other audio (music, podcasts) and give it back afterwards.
// A web page cannot control other apps directly, so this plays a short, silent, looping clip: the phone
// treats it as a brief interruption, lowers or pauses the other app, and restores it when the clip stops.
// iPhone (Safari 16.4+) also gets the Audio Session hint 'transient-solo' = pause others, resume after.
const Focus = {
    el: null,
    held: false,
    releaseTimer: null,
    on: (() => { try { return localStorage.getItem('rt_duck') !== 'off'; } catch (e) { return true; } })(),

    silentWav() {
        const rate = 8000, n = rate / 2;                     // half a second: short clips get "transient" focus
        const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
        const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        str(36, 'data'); v.setUint32(40, n * 2, true);
        return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
    },

    // Must run inside a tap so the phone allows the clip to play later on its own
    prime() {
        if (this.el) return;
        try {
            const a = new Audio(this.silentWav());
            a.loop = true;
            a.setAttribute('playsinline', '');
            this.el = a;
            const p = a.play();
            if (p && p.then) p.then(() => { if (!this.held) a.pause(); }).catch(() => {});
            else if (!this.held) a.pause();
        } catch (e) { this.el = null; }
    },

    session(type) {
        try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* not supported */ }
    },

    take() {
        clearTimeout(this.releaseTimer);
        if (!this.on || this.held) return;
        this.held = true;
        this.session('transient-solo');
        if (this.el) { try { const p = this.el.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ } }
    },

    // A short wait so back-to-back notes don't make the music jump up and down between them
    release(now) {
        clearTimeout(this.releaseTimer);
        const go = () => {
            if (!this.held) return;
            this.held = false;
            if (this.el) { try { this.el.pause(); this.el.currentTime = 0; } catch (e) { /* ignore */ } }
            this.session('auto');
        };
        if (now) go(); else this.releaseTimer = setTimeout(go, 1500);
    },

    set(on) {
        this.on = !!on;
        try { localStorage.setItem('rt_duck', on ? 'on' : 'off'); } catch (e) { /* private mode */ }
        if (!on) this.release(true);
    }
};

const Voice = {
    voice: null,
    rate: 1.0,
    muted: false,
    session: 0,
    speaking: false,

    teVoice: null,

    pick() {
        if (!('speechSynthesis' in window)) return;
        const voices = speechSynthesis.getVoices();
        const te = voices.filter((v) => /^te[-_]?/i.test(v.lang));
        this.teVoice = te.find((v) => /google/i.test(v.name)) || te[0] || null;
        const all = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
        const prefer = [/natural/i, /neural/i, /google us english/i, /samantha/i, /ava/i, /aria/i, /jenny/i, /allison/i, /zira/i];
        for (const re of prefer) {
            const v = all.find((x) => re.test(x.name) && /en[-_]US/i.test(x.lang)) || all.find((x) => re.test(x.name));
            if (v) { this.voice = v; return; }
        }
        this.voice = all.find((x) => /en[-_]US/i.test(x.lang)) || all[0] || null;
    },

    keep: [],      // Chrome can garbage-collect a playing utterance and never fire its end event
    watchdog: null,
    lastError: '',

    // Phones only allow speech that starts from a tap. Call this from the tap, before any await.
    unlock() {
        if (!('speechSynthesis' in window)) return false;
        this.pick();
        try { speechSynthesis.resume(); } catch (e) { /* older browsers */ }
        Focus.prime();
        return true;
    },

    // Speaks in Telugu when the phone has a Telugu voice; otherwise falls back to the English text
    say(text, lang, english, onEnd) {
        if (lang === 'te') {
            if (!this.teVoice) this.pick();
            if (!this.teVoice && english) { this.noTelugu = true; return this.speak(english, onEnd, 'en'); }
        }
        return this.speak(text, onEnd, lang);
    },

    speak(text, onEnd, lang) {
        const finish = () => { Focus.release(); if (onEnd) setTimeout(onEnd, 0); };
        if (!('speechSynthesis' in window) || this.muted) { finish(); return; }
        Focus.take();
        const synth = speechSynthesis;
        const id = ++this.session;
        clearTimeout(this.watchdog);
        if (synth.speaking || synth.pending) synth.cancel();
        if (!this.voice) this.pick();
        const tel = lang === 'te';
        const voice = tel ? this.teVoice : this.voice;
        const parts = (String(text).match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) || [String(text)]).map((s) => s.trim()).filter(Boolean);
        let i = 0;
        this.speaking = true;
        this.keep = [];
        const next = () => {
            if (id !== this.session) return;
            clearTimeout(this.watchdog);
            if (i >= parts.length) { this.speaking = false; finish(); return; }
            const u = new SpeechSynthesisUtterance(parts[i++]);
            this.keep.push(u);
            u.lang = (voice && voice.lang) || (tel ? 'te-IN' : 'en-US');
            if (voice) u.voice = voice;
            u.rate = this.rate;
            let moved = false;
            const done = (ev) => {
                if (moved) return;
                moved = true;
                if (ev && ev.error && ev.error !== 'interrupted' && ev.error !== 'canceled') this.lastError = ev.error;
                next();
            };
            u.onend = done;
            u.onerror = done;
            // If the end event never comes, move on after a generous guess at the sentence's length
            const words = u.text.split(/\s+/).length;
            this.watchdog = setTimeout(() => { if (id === this.session) done(); }, (words / (tel ? 1.4 : 2.2) / this.rate) * 1000 + 6000);
            synth.speak(u);
            // Chrome sometimes starts the queue paused
            if (synth.paused) synth.resume();
        };
        next();
    },

    stop() {
        this.session++;
        this.speaking = false;
        clearTimeout(this.watchdog);
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        Focus.release();
    },

    // For the "No sound?" check
    diagnose() {
        if (!('speechSynthesis' in window)) return 'This browser has no speech engine. Try Chrome (Android) or Safari (iPhone).';
        const n = speechSynthesis.getVoices().length;
        const bits = [];
        if (this.muted) bits.push('The guide is muted in the app (speaker button).');
        if (!n) bits.push('The phone has not loaded any voices yet.');
        if (this.lastError) bits.push(`Last speech error: ${this.lastError}.`);
        bits.push(`Using ${this.voice ? this.voice.name : 'the default voice'} (${n} voices).`);
        bits.push(this.teVoice ? `Telugu voice: ${this.teVoice.name}.` : 'No Telugu voice on this phone.');
        return bits.join(' ');
    }
};
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => Voice.pick();

// ---------- Backup notes (no AI): Wikipedia + a friendly frame ----------
function hashOf(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return Math.abs(h);
}
const pickFor = (id, list, salt) => list[hashOf(id + (salt || '')) % list.length];

const OPENERS = {
    city: ['Big city alert! Welcome to {n}.', 'Ladies and gentlemen, this is {n}.', 'Say hello to {n}!'],
    town: ['Here comes {n}.', 'Wave hello to {n}, folks.', 'This little spot on the map is {n}.'],
    village: ['Blink and you might miss it: this is {n}.', 'Tiny town, big heart: {n}.', 'Population: friendly. Welcome to {n}.'],
    river: ['Bridge time! We are crossing the {n}.', 'Water below, wheels above: this is the {n}.'],
    museum: ['Culture check: nearby is {n}.', 'For the history buffs in the back, {n} is close by.'],
    fun: ['Fun stop nearby: {n}!', 'Somebody in this car would love {n}.'],
    view: ['Passengers, a viewpoint: {n}.', 'Scenery break, courtesy of {n}.'],
    history: ['A little history on the side of the road: {n}.', 'Story time: {n}.'],
    nature: ['Nature break: {n} is close by.', 'Fresh air alert: {n}.'],
    attraction: ['Roadside treasure: {n}.', 'Worth a mention: {n}.']
};
const CLOSERS = [
    'Driver, eyes on the road. Passengers, you are in charge of looking.',
    'Snacks are optional, smiles are mandatory.',
    'Another mile, another story.',
    'Put that one in the trip journal!',
    'Somebody hand the driver a snack.',
    'And just like that, we are rolling on.'
];
const QUIPS = {
    city: 'Plenty to eat here if anyone is getting hangry.',
    town: 'The kind of place where the diner coffee is always on.',
    village: 'I bet everybody here knows everybody, and their dog too.',
    river: 'Rivers like this one built the towns we have been driving through.',
    museum: 'Rainy-day plan, saved for next time.',
    fun: 'Add it to the someday list.',
    view: 'Phones up, passengers, not you, driver.',
    history: 'If these fields could talk, they would have stories.',
    nature: 'Mother Nature showing off a little.',
    attraction: 'Road trips are made of stops like this.'
};

function firstSentences(text, n) {
    const s = String(text || '').replace(/\s*\([^)]*\)/g, '').match(/[^.!?]+[.!?]+/g) || [];
    return s.slice(0, n).join(' ').trim();
}

function templateNote(p) {
    const kind = OPENERS[p.kind] ? p.kind : 'attraction';
    const open = pickFor(p.id, OPENERS[kind]).replace('{n}', p.name);
    let body = firstSentences(p.summary, kind === 'village' ? 1 : 2);
    if (!body && p.population > 0) body = `About ${Number(p.population).toLocaleString('en-US')} people call it home.`;
    const quip = QUIPS[kind];
    const close = pickFor(p.id, CLOSERS, 'c');
    return [open, body, quip, close].filter(Boolean).join(' ');
}

// Any tap on the page (Start, Skip, the map...) is enough to let the quiet-the-music clip play later
['pointerdown', 'touchend', 'click'].forEach((ev) => document.addEventListener(ev, () => Focus.prime(), { once: true, capture: true, passive: true }));
