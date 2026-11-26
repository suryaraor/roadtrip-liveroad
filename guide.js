// The voice of the guide: picks the friendliest English voice on the phone and reads notes sentence by
// sentence (some phones cut off long utterances). Also writes a backup note from Wikipedia when the sheet
// has no Claude key or the phone is offline.

const Voice = {
    voice: null,
    rate: 1.0,
    muted: false,
    session: 0,
    speaking: false,

    pick() {
        if (!('speechSynthesis' in window)) return;
        const all = speechSynthesis.getVoices().filter((v) => /^en[-_]/i.test(v.lang));
        const prefer = [/natural/i, /neural/i, /google us english/i, /samantha/i, /ava/i, /aria/i, /jenny/i, /allison/i, /zira/i];
        for (const re of prefer) {
            const v = all.find((x) => re.test(x.name) && /en[-_]US/i.test(x.lang)) || all.find((x) => re.test(x.name));
            if (v) { this.voice = v; return; }
        }
        this.voice = all.find((x) => /en[-_]US/i.test(x.lang)) || all[0] || null;
    },

    // Must first run inside a tap so phones allow audio later
    unlock() {
        if (!('speechSynthesis' in window)) return false;
        this.pick();
        const u = new SpeechSynthesisUtterance(' ');
        u.volume = 0;
        speechSynthesis.speak(u);
        return true;
    },

    speak(text, onEnd) {
        if (!('speechSynthesis' in window) || this.muted) { onEnd && onEnd(); return; }
        const id = ++this.session;
        speechSynthesis.cancel();
        const parts = String(text).match(/[^.!?]+[.!?]+["']?\s*|[^.!?]+$/g) || [String(text)];
        let i = 0;
        this.speaking = true;
        const next = () => {
            if (id !== this.session) return;
            if (i >= parts.length) { this.speaking = false; onEnd && onEnd(); return; }
            const u = new SpeechSynthesisUtterance(parts[i++].trim());
            if (this.voice) u.voice = this.voice;
            u.rate = this.rate;
            u.onend = next;
            u.onerror = next;
            speechSynthesis.speak(u);
        };
        next();
    },

    stop() {
        this.session++;
        this.speaking = false;
        if ('speechSynthesis' in window) speechSynthesis.cancel();
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
