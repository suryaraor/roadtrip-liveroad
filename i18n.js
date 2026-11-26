// Language: Telugu by default for everyone (driver and anyone watching), English as an option in Settings.
// Guide notes in Telugu live in notes-te.json (keyed by Place ID); stops without one get a short Telugu note.

let LANG = (() => { try { return localStorage.getItem('rl_lang') || 'te'; } catch (e) { return 'te'; } })();
let NOTES_TE = {};

const STR = {
    en: {
        tagline: 'Your tour guide for every mile', trips: 'Trips', plan: 'Plan', drive: 'Drive',
        tripsHead: 'Your road trips', tripsSub: 'Tap a trip to see its stops, or start driving.',
        newTrip: 'Plan a new trip', settings: 'Settings', language: 'Language', voiceSpeed: 'Voice speed',
        testVoice: "Test the guide's voice", saveSync: 'Save & sync',
        driveEmpty: 'Pick a trip on the Trips tab and tap Start the trip.',
        gpsIdle: 'GPS starts with Start', guide: 'Your guide', ready: 'Ready when you are',
        readyText: "Tap Start. I'll talk whenever we're near a town, a river or something fun.",
        start: 'Start the trip', cont: 'Continue the trip', stop: 'Stop', demo: 'Demo drive (no GPS)',
        screenHint: 'Keep this screen on and the phone plugged in: phones pause web pages when the screen is off.',
        noSound: 'No sound? Tap to check', upNext: 'Up next', heard: 'Already heard', share: 'Share the live drive',
        mile: 'Mile {m}', toGo: '{m} mi to {c}', noMore: 'No more stops on this trip.', now: 'right about now',
        inMi: 'in {m} mi', onRoad: 'On the road', done: 'Done', planned: 'Planned', lastSeen: 'Last seen at mile {m}',
        stops: '{n} stops', seeStops: 'See the stops', planBack: 'Plan the drive back', del: 'Delete',
        hereWeGo: 'Here we go!', madeIt: 'You made it to {c}!',
        hello: "Hi there, I'm Miles, your guide from {a} to {b}. That's about {n} miles, and I've got stories for {k} stops along the way. Driver, you keep your eyes on the road, and I'll do the talking. Let's roll!",
        bye: "And that's a wrap! Welcome to {c}. {n} miles, {k} stories, and hopefully a few smiles. Thanks for riding with me. Stretch those legs, you earned it!",
        test: "Howdy! I'm Miles, your road-trip guide. Buckle up, grab a snack, and let's find some stories.",
        soundTest: 'Testing, testing. If you can hear me, the guide is ready to roll.',
        noTeVoice: '', shareNeedsSheet: 'Connect the Google Sheet in Settings first, so the watcher can follow along.',
        copied: 'Link copied. Send it to anyone who wants to ride along.',
        // watch page
        wTitle: 'Riding along', wListen: 'Tap to listen along', wListening: 'Listening along',
        wWaiting: 'Waiting for the car to start...', wSeen: 'Updated {t}', wAgo: '{n} min ago', wJust: 'just now', wOffline: 'offline', wReconnect: 'reconnecting...',
        wParked: 'The car is not on the road right now.', wFinished: 'They made it! The trip is done.',
        wBadLink: 'This link is missing the trip. Ask the driver to share it again.', wLoading: 'Loading the trip...',
        wOld: 'The guide last spoke about this stop:', wHint: 'Keep this page open to hear the guide at the same time as the car.'
    },
    te: {
        tagline: 'ప్రతి మైలుకీ మీ టూర్ గైడ్', trips: 'ప్రయాణాలు', plan: 'ప్లాన్', drive: 'డ్రైవ్',
        tripsHead: 'మీ రోడ్ ట్రిప్‌లు', tripsSub: 'ఆగే చోట్లు చూడటానికి ట్రిప్‌ను నొక్కండి, లేదా డ్రైవింగ్ మొదలుపెట్టండి.',
        newTrip: 'కొత్త ట్రిప్ ప్లాన్ చేయండి', settings: 'సెట్టింగ్‌లు', language: 'భాష', voiceSpeed: 'మాట వేగం',
        testVoice: 'గైడ్ గొంతు వినండి', saveSync: 'సేవ్ చేసి సింక్ చేయండి',
        driveEmpty: 'ప్రయాణాలు ట్యాబ్‌లో ఒక ట్రిప్ ఎంచుకుని "ప్రయాణం మొదలుపెట్టండి" నొక్కండి.',
        gpsIdle: 'Start నొక్కితే GPS మొదలవుతుంది', guide: 'మీ గైడ్', ready: 'నేను రెడీ!',
        readyText: 'Start నొక్కండి. ఊరు, నది, లేదా ఏదైనా సరదా చోటు దగ్గరకి రాగానే నేను మాట్లాడతాను.',
        start: 'ప్రయాణం మొదలుపెట్టండి', cont: 'ప్రయాణం కొనసాగించండి', stop: 'ఆపండి', demo: 'డెమో డ్రైవ్ (GPS లేకుండా)',
        screenHint: 'స్క్రీన్ ఆన్‌లో ఉంచండి, ఫోన్ ఛార్జింగ్‌లో పెట్టండి: స్క్రీన్ ఆఫ్ అయితే ఫోన్లు వెబ్ పేజీని ఆపేస్తాయి.',
        noSound: 'శబ్దం రావడం లేదా? ఇక్కడ నొక్కండి', upNext: 'తర్వాత వచ్చేవి', heard: 'ఇప్పటికే విన్నవి',
        share: 'లైవ్ డ్రైవ్ షేర్ చేయండి',
        mile: 'మైలు {m}', toGo: '{c}కి ఇంకా {m} మైళ్లు', noMore: 'ఈ ప్రయాణంలో ఇంకా ఆగే చోట్లు లేవు.', now: 'ఇప్పుడే',
        inMi: '{m} మైళ్లలో', onRoad: 'రోడ్డు మీద', done: 'పూర్తయింది', planned: 'ప్లాన్ చేశారు',
        lastSeen: 'చివరిసారి మైలు {m} దగ్గర', stops: '{n} చోట్లు', seeStops: 'ఆగే చోట్లు చూడండి',
        planBack: 'తిరుగు ప్రయాణం ప్లాన్ చేయండి', del: 'తొలగించండి',
        hereWeGo: 'పదండి, బయల్దేరుదాం!', madeIt: '{c} చేరుకున్నారు!',
        hello: 'నమస్కారం! నేను మైల్స్, {a} నుంచి {b} వరకు మీ గైడ్‌ని. దాదాపు {n} మైళ్ల దారి, దారిలో {k} చోట్ల గురించి కథలు చెప్తాను. డ్రైవర్ గారూ, మీ కళ్లు రోడ్డు మీదే ఉంచండి, మాటలు నేను చూసుకుంటాను. పదండి, బయల్దేరుదాం!',
        bye: 'అయిపోయింది! {c}కి స్వాగతం. {n} మైళ్లు, {k} కథలు, కొన్ని నవ్వులు కూడా. నాతో ప్రయాణించినందుకు ధన్యవాదాలు. కాళ్లు కాస్త చాపుకోండి, మీరు సంపాదించుకున్నారు!',
        test: 'నమస్కారం! నేను మైల్స్, మీ రోడ్ ట్రిప్ గైడ్‌ని. సీట్ బెల్ట్ పెట్టుకోండి, స్నాక్స్ తీసుకోండి, కథలు వెతుకుదాం పదండి.',
        soundTest: 'టెస్టింగ్, టెస్టింగ్. నా మాట మీకు వినిపిస్తే, గైడ్ రెడీ.',
        noTeVoice: 'ఈ ఫోన్‌లో తెలుగు వాయిస్ లేదు, అందుకే గైడ్ ఇంగ్లీషులో మాట్లాడుతుంది. Android: Settings > Text-to-speech > Google > Telugu ఇన్‌స్టాల్ చేయండి.',
        shareNeedsSheet: 'ముందు సెట్టింగ్‌లలో Google Sheet కనెక్ట్ చేయండి, అప్పుడే చూసేవాళ్లు ఫాలో అవ్వగలరు.',
        copied: 'లింక్ కాపీ అయింది. మీతో పాటు ప్రయాణించాలనుకునే వాళ్లకి పంపండి.',
        wTitle: 'మీతో పాటు ప్రయాణం', wListen: 'వినడానికి ఇక్కడ నొక్కండి', wListening: 'వింటున్నారు',
        wWaiting: 'కారు బయల్దేరడం కోసం ఎదురుచూస్తున్నాం...', wSeen: '{t} అప్‌డేట్ అయింది', wAgo: '{n} నిమిషాల క్రితం',
        wJust: 'ఇప్పుడే', wOffline: 'కనెక్షన్ లేదు', wReconnect: 'మళ్ళీ కలుపుతున్నాం...', wParked: 'కారు ఇప్పుడు రోడ్డు మీద లేదు.', wFinished: 'చేరుకున్నారు! ప్రయాణం పూర్తయింది.',
        wBadLink: 'ఈ లింక్‌లో ట్రిప్ లేదు. డ్రైవర్‌ని మళ్ళీ షేర్ చేయమనండి.', wLoading: 'ట్రిప్ లోడ్ అవుతోంది...',
        wOld: 'గైడ్ చివరిగా మాట్లాడింది ఈ చోటు గురించి:', wHint: 'కారులో ఉన్నవాళ్లతో పాటే గైడ్ మాటలు వినాలంటే ఈ పేజీని తెరిచే ఉంచండి.'
    }
};

const KIND_TE = {
    city: 'నగరం', town: 'పట్టణం', village: 'గ్రామం', river: 'నది దాటుతున్నాం', history: 'చరిత్ర', museum: 'మ్యూజియం',
    attraction: 'ఆకర్షణ', fun: 'సరదా చోటు', view: 'వ్యూ పాయింట్', nature: 'ప్రకృతి'
};

function T(key, vars) {
    const s = (STR[LANG] && STR[LANG][key] !== undefined ? STR[LANG][key] : STR.en[key]) || '';
    return s.replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}

// The English line, used when the phone has no Telugu voice
function englishOf(key, vars) {
    return STR.en[key].replace(/\{(\w+)\}/g, (m, k) => (vars && vars[k] !== undefined ? vars[k] : m));
}

function setLang(l) {
    LANG = l === 'en' ? 'en' : 'te';
    try { localStorage.setItem('rl_lang', LANG); } catch (e) { /* private mode */ }
    document.documentElement.lang = LANG;
    applyI18n();
}

// Static text: elements with data-i18n="key" get their text replaced (icons inside are kept)
function applyI18n() {
    document.documentElement.lang = LANG;
    document.querySelectorAll('[data-i18n]').forEach((e) => {
        const text = T(e.dataset.i18n);
        const svg = e.querySelector(':scope > svg');
        e.textContent = '';
        if (svg) e.append(svg, document.createTextNode(` ${text}`));
        else e.textContent = text;
    });
}

function kindName(kind, english) {
    return LANG === 'te' ? (KIND_TE[kind] || KIND_TE.attraction) : english;
}

async function loadTeluguNotes(base) {
    try {
        const r = await fetch(`${base || ''}notes-te.json?v=1`);
        if (r.ok) NOTES_TE = await r.json();
    } catch (e) { /* offline: the Telugu template still works */ }
}

const TE_OPEN = {
    city: ['పెద్ద నగరం వచ్చేసింది! ఇది {n}.', 'అందరికీ నమస్కారం, ఇది {n} నగరం.'],
    town: ['ఇదిగో {n} పట్టణం వస్తోంది.', '{n} కి ఒక హాయ్ చెప్పండి!'],
    village: ['కన్ను మూసి తెరిచేలోపు దాటేస్తాం: ఇది {n}.', 'చిన్న ఊరు, పెద్ద మనసు: {n}.'],
    river: ['బ్రిడ్జ్ టైమ్! మనం {n} దాటుతున్నాం.', 'కింద నీళ్లు, పైన మన కారు: ఇది {n}.'],
    museum: ['దగ్గర్లోనే {n} ఉంది, చరిత్ర ఇష్టపడేవాళ్ల కోసం.'],
    fun: ['దగ్గర్లో ఒక సరదా చోటు: {n}!'],
    view: ['ప్యాసింజర్లూ, చూడండి: {n}.'],
    history: ['రోడ్డు పక్కన కొంచెం చరిత్ర: {n}.'],
    nature: ['ప్రకృతి బ్రేక్: దగ్గర్లో {n} ఉంది.'],
    attraction: ['దారిలో ఒక విశేషం: {n}.']
};
const TE_CLOSE = ['డ్రైవర్ గారూ, కళ్లు రోడ్డు మీదే!', 'ఇంకో మైలు, ఇంకో కథ.', 'స్నాక్స్ ఆప్షనల్, నవ్వులు తప్పనిసరి!', 'పదండి, ముందుకు సాగుదాం.'];

function teluguTemplate(p) {
    const kind = TE_OPEN[p.kind] ? p.kind : 'attraction';
    const h = typeof hashOf === 'function' ? hashOf(String(p.id)) : 0;
    const open = TE_OPEN[kind][h % TE_OPEN[kind].length].replace('{n}', p.name);
    const pop = p.population > 0 ? `ఇక్కడ దాదాపు ${Number(p.population).toLocaleString('en-IN')} మంది ఉంటారు.` : '';
    return [open, pop, TE_CLOSE[h % TE_CLOSE.length]].filter(Boolean).join(' ');
}

// What the guide says for a stop, in the chosen language: { text, lang }
function noteFor(p) {
    const en = p.note || (typeof templateNote === 'function' ? templateNote(p) : p.name);
    if (LANG !== 'te') return { text: en, lang: 'en', en };
    return { text: NOTES_TE[p.id] || teluguTemplate(p), lang: 'te', en };
}
