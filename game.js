// מי המתחזה? – גרסת GitHub Pages
// הטלפון של המנהל מחזיק את המשחק. כל ההודעות עוברות דרך שרת MQTT ציבורי,
// כך שהחדר לא נעלם גם כשהמנהל יוצא לרגע מהאפליקציה (למשל כדי לשלוח קישור בוואטסאפ).

const MIN_PLAYERS = 3;
const VERSION = 5;
// כמה שרתי הודעות ציבוריים – אם אחד חסום או לא עובד, עוברים לבא בתור
const BROKERS = new URLSearchParams(location.search).get('broker')
  ? new URLSearchParams(location.search).get('broker').split(',')
  : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
let brokerUrl = BROKERS[0];
const TOPIC = (code) => 'mi-hamitchaze-il/v2/' + code;

// ---------- מאגר מילים לגילאי 5–12 ----------
const WORDS = {
  'חיות': ['כלב', 'חתול', 'פיל', 'ג׳ירפה', 'אריה', 'קוף', 'דולפין', 'פינגווין', 'ארנב', 'צב', 'פרפר', 'תנין', 'זברה', 'ינשוף', 'דבורה', 'סוס', 'פרה', 'נחש', 'קנגורו', 'תרנגולת'],
  'אוכל': ['פיצה', 'גלידה', 'בננה', 'תפוח', 'פלאפל', 'שוקולד', 'עוגה', 'פופקורן', 'ספגטי', 'חביתה', 'אבטיח', 'במבה', 'שניצל', 'תות', 'לחמנייה', 'ענבים', 'מרק', 'סלט', 'פנקייק', 'גזר'],
  'מקומות': ['בית ספר', 'ים', 'גן חיות', 'בית חולים', 'סופרמרקט', 'פארק', 'קולנוע', 'בריכה', 'ספרייה', 'מטוס', 'גן שעשועים', 'מדבר', 'יער', 'מסעדה', 'תחנת דלק', 'קרקס', 'חלל', 'מספרה', 'אוטובוס', 'חוף'],
  'חפצים בבית': ['מיטה', 'מקרר', 'טלוויזיה', 'כרית', 'מטרייה', 'מברשת שיניים', 'מספריים', 'שעון', 'מנורה', 'מראה', 'כיסא', 'מחשב', 'כוס', 'מפתח', 'כדור', 'עיפרון', 'ספר', 'שמיכה', 'כפית', 'תיק'],
  'מקצועות': ['רופא', 'מורה', 'שוטר', 'כבאי', 'טבח', 'טייס', 'וטרינר', 'צייר', 'זמר', 'נהג', 'אסטרונאוט', 'רופא שיניים', 'חקלאי', 'ספר', 'מלצר', 'קוסם', 'דייג', 'גנן', 'שחקן כדורגל', 'אופה'],
  'ספורט ומשחקים': ['כדורגל', 'כדורסל', 'שחייה', 'טניס', 'אופניים', 'מחבואים', 'קפיצה בחבל', 'קלפים', 'שחמט', 'כדורעף', 'ריצה', 'גלישה', 'החלקה על הקרח', 'ג׳ודו', 'באולינג', 'פאזל', 'קלאס', 'סקייטבורד', 'תופסת', 'לגו'],
  'כלי תחבורה': ['מכונית', 'רכבת', 'אונייה', 'מסוק', 'אופנוע', 'טרקטור', 'צוללת', 'רקטה', 'אמבולנס', 'כבאית', 'קורקינט', 'סירה', 'כדור פורח', 'משאית', 'מונית'],
  'טבע': ['שמש', 'ירח', 'קשת בענן', 'הר', 'נהר', 'עץ', 'פרח', 'שלג', 'גשם', 'כוכב', 'ענן', 'הר געש', 'מפל', 'אבן', 'עלה', 'ברק', 'מערה', 'אי', 'חול', 'רוח'],
};

// ---------- זהות השחקן ----------
let me = localStorage.getItem('imp_id');
if (!me) { me = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('imp_id', me); }

// =====================================================================
//                    לוגיקת המשחק (רצה אצל המנהל)
// =====================================================================
let S = null;            // מצב המשחק – קיים רק אצל המנהל
const presence = {};     // playerId -> true/false

function newState() {
  return {
    players: {}, order: [], hostId: me, phase: 'lobby',
    settings: { hint: true, imposters: 1, category: 'הכול' },
    round: null, used: [], scores: {}, roundNo: 0,
    roomId: Math.random().toString(36).slice(2, 10), seq: {}, errs: {},
  };
}
const rint = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isOnline = (id) => id === S.hostId || presence[id] === true;
const activeIds = () => S.order.filter(id => S.players[id]);

function pickWord() {
  const cats = S.settings.category === 'הכול' ? Object.keys(WORDS) : [S.settings.category];
  const pool = [];
  cats.forEach(c => WORDS[c].forEach(w => pool.push({ c, w })));
  let fresh = pool.filter(x => !S.used.includes(x.c + '|' + x.w));
  if (!fresh.length) { S.used = S.used.filter(k => !pool.some(x => x.c + '|' + x.w === k)); fresh = pool; }
  const p = fresh[rint(fresh.length)];
  S.used.push(p.c + '|' + p.w);
  return p;
}

function startRound() {
  const ids = activeIds();
  const nImp = Math.min(S.settings.imposters, ids.length >= 6 ? 2 : 1);
  const { c, w } = pickWord();
  S.roundNo++;
  S.round = { word: w, category: c, playerIds: ids, imposters: shuffle(ids).slice(0, nImp),
    starter: ids[rint(ids.length)], seen: [], votes: {}, result: null };
  S.phase = 'reveal';
}

// השוואת ניחוש למילה – סלחנית לאיות (כתיב מלא/חסר, אותיות סופיות, ה׳ הידיעה, ניקוד, רווחים)
function normWord(s) {
  return String(s || '').normalize('NFC').replace(/[\u0591-\u05C7]/g, '')
    .replace(/[םןץףך]/g, c => ({ 'ם': 'מ', 'ן': 'נ', 'ץ': 'צ', 'ף': 'פ', 'ך': 'כ' })[c])
    .replace(/[^\u05D0-\u05EAa-zA-Z0-9]/g, '').toLowerCase();
}
function guessMatches(guess, word) {
  const g = normWord(guess), w = normWord(word);
  if (!g) return false;
  const loose = (x) => x.replace(/[וי]/g, '');
  const forms = (x) => [x, x.startsWith('ה') ? x.slice(1) : x];
  return forms(g).some(a => forms(w).some(b => a === b || loose(a) === loose(b)));
}

function scoreRound(imposterWins) {
  const r = S.round;
  r.playerIds.forEach(id => { S.scores[id] = S.scores[id] || 0; });
  if (imposterWins) r.imposters.forEach(id => S.scores[id] += 2);
  else r.playerIds.filter(id => !r.imposters.includes(id)).forEach(id => S.scores[id]++);
}

function finishVote() {
  const r = S.round, tally = {};
  Object.values(r.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter(k => tally[k] === max);
  const caught = max > 0 && top.length === 1 && r.imposters.includes(top[0]);
  r.result = { tally, top: max > 0 ? top : [], caught };
  scoreRound(!caught);
  S.phase = 'results';
}

function checkProgress() {
  const r = S.round; if (!r) return;
  const act = r.playerIds.filter(x => S.players[x]);
  if (S.phase === 'reveal' && act.every(x => r.seen.includes(x))) S.phase = 'discuss';
  if (S.phase === 'vote' && act.every(x => r.votes[x])) finishVote();
}

function hostOnly(id) { if (id !== S.hostId) throw 'רק המנהל יכול לעשות את זה'; }
function removePlayer(id) {
  if (!S.players[id] || id === S.hostId) return;
  delete S.players[id];
  S.order = S.order.filter(x => x !== id);
  checkProgress();
}

const actions = {
  join(id, b) {
    const n = String(b.name || '').trim().slice(0, 16);
    if (!n) throw 'צריך לכתוב שם';
    if (Object.entries(S.players).some(([pid, p]) => pid !== id && p.name === n)) throw 'השם הזה כבר תפוס';
    if (!S.players[id]) S.order.push(id);
    S.players[id] = { name: n };
  },
  leave(id) { removePlayer(id); },
  kick(id, b) {
    hostOnly(id); if (b.id === id) return;
    removePlayer(b.id);
    pub('s/' + b.id, { roomId: S.roomId, kicked: true });
  },
  settings(id, b) {
    hostOnly(id);
    if (typeof b.hint === 'boolean') S.settings.hint = b.hint;
    if ([1, 2].includes(b.imposters)) S.settings.imposters = b.imposters;
    if (b.category && (b.category === 'הכול' || WORDS[b.category])) S.settings.category = b.category;
  },
  start(id) { hostOnly(id); if (activeIds().length < MIN_PLAYERS) throw `צריך לפחות ${MIN_PLAYERS} שחקנים`; startRound(); },
  seen(id) { const r = S.round; if (S.phase !== 'reveal' || !r.playerIds.includes(id)) return; if (!r.seen.includes(id)) r.seen.push(id); checkProgress(); },
  discuss(id) { hostOnly(id); if (S.phase === 'reveal') S.phase = 'discuss'; },
  toVote(id) { hostOnly(id); if (S.phase === 'discuss' || S.phase === 'reveal') S.phase = 'vote'; },
  vote(id, b) {
    const r = S.round; if (S.phase !== 'vote' || !r.playerIds.includes(id)) return;
    if (!r.playerIds.includes(b.target) || b.target === id) throw 'אי אפשר להצביע על עצמך';
    r.votes[id] = b.target; checkProgress();
  },
  endVote(id) { hostOnly(id); if (S.phase === 'vote') finishVote(); },
  again(id) { hostOnly(id); startRound(); },
  lobby(id) { hostOnly(id); S.phase = 'lobby'; S.round = null; },
  resetScores(id) { hostOnly(id); S.scores = {}; },
  guess(id, b) {
    const r = S.round;
    if (!r || !['discuss', 'vote'].includes(S.phase) || !r.imposters.includes(id)) throw 'אי אפשר לנחש עכשיו';
    const text = String(b.text || '').trim().slice(0, 30);
    if (!text) throw 'צריך לכתוב ניחוש';
    const correct = guessMatches(text, r.word);
    r.guess = { by: id, text, correct };
    r.result = { tally: {}, top: [], caught: !correct, mode: 'guess' };
    Object.values(r.votes).forEach(t => { r.result.tally[t] = (r.result.tally[t] || 0) + 1; });
    scoreRound(correct);
    S.phase = 'results';
  },
  approveGuess(id) { // המנהל מאשר ניחוש שנפסל בגלל שגיאת כתיב
    hostOnly(id);
    const r = S.round;
    if (S.phase !== 'results' || !r.guess || r.guess.correct) return;
    r.playerIds.filter(x => !r.imposters.includes(x)).forEach(x => S.scores[x] = Math.max(0, (S.scores[x] || 0) - 1));
    r.imposters.forEach(x => S.scores[x] = (S.scores[x] || 0) + 2);
    r.guess.correct = true; r.guess.approved = true; r.result.caught = false;
  },
};

function view(pid) {
  const name = (id) => (S.players[id] ? S.players[id].name : '?');
  const out = {
    roomId: S.roomId, ack: S.seq[pid] || 0, error: S.errs[pid] || null,
    me: pid, isHost: pid === S.hostId, joined: !!S.players[pid], phase: S.phase,
    players: activeIds().map(id => ({ id, name: name(id), online: isOnline(id), host: id === S.hostId, score: S.scores[id] || 0 })),
    settings: S.settings, categories: ['הכול', ...Object.keys(WORDS)], minPlayers: MIN_PLAYERS, roundNo: S.roundNo,
  };
  const r = S.round;
  if (r && S.phase !== 'lobby') {
    const inRound = r.playerIds.includes(pid);
    out.round = {
      inRound, starter: name(r.starter), seenCount: r.seen.length, total: r.playerIds.length,
      iSeen: r.seen.includes(pid), votedCount: Object.keys(r.votes).length, myVote: r.votes[pid] || null,
      candidates: r.playerIds.map(id => ({ id, name: name(id) })), impCount: r.imposters.length,
      canGuess: ['discuss', 'vote'].includes(S.phase) && r.imposters.includes(pid),
    };
    if (inRound) {
      out.round.card = r.imposters.includes(pid)
        ? { imposter: true, hint: S.settings.hint ? r.category : null }
        : { imposter: false, word: r.word, category: r.category };
    }
    if (S.phase === 'results') {
      Object.assign(out.round, {
        word: r.word, category: r.category, imposterNames: r.imposters.map(name),
        result: {
          caught: r.result.caught, top: r.result.top.map(name), mode: r.result.mode || 'vote',
          guess: r.guess ? { name: name(r.guess.by), text: r.guess.text, correct: r.guess.correct, approved: !!r.guess.approved } : null,
          tally: r.playerIds.map(id => ({ name: name(id), votes: r.result.tally[id] || 0, imposter: r.imposters.includes(id) })).sort((a, b) => b.votes - a.votes),
        },
      });
    }
  }
  return out;
}

const lastSent = {};
function broadcast(extra) {
  try { localStorage.setItem('imp_host_state', JSON.stringify({ code: roomCode, S, t: Date.now() })); } catch (e) {}
  if (client && client.connected) {
    S.order.forEach(pid => {
      if (pid === me || !S.players[pid]) return;
      const v = JSON.stringify(view(pid));
      if (lastSent[pid] !== v) { lastSent[pid] = v; client.publish(TOPIC(roomCode) + '/s/' + pid, v, { qos: 1, retain: true }); }
    });
  }
  if (extra && !S.players[extra] && client && client.connected)
    client.publish(TOPIC(roomCode) + '/s/' + extra, JSON.stringify(view(extra)), { qos: 1, retain: false });
  st = view(me); render(true);
}

function hostAction(pid, action, body, seq) {
  if (seq) { if (seq <= (S.seq[pid] || 0)) { delete lastSent[pid]; broadcast(pid); return; } S.seq[pid] = seq; }
  try {
    if (!actions[action]) throw 'פעולה לא קיימת';
    if (action !== 'join' && !S.players[pid]) throw 'צריך להצטרף קודם';
    actions[action](pid, body || {});
    delete S.errs[pid];
  } catch (e) {
    const msg = typeof e === 'string' ? e : 'שגיאה';
    if (seq) S.errs[pid] = { seq, msg }; else { err = msg; }
  }
  broadcast(pid);
}

// =====================================================================
//                         רשת (MQTT)
// =====================================================================
let client = null, roomCode = null, role = null; // role: 'host' | 'guest'
let st = null, err = '', status = '', cardOpen = false, lastKey = '', lastRound = -1;
let hostAlive = true, guestMeta = null, pending = null, resendTimer = null, notFoundTimer = null;
const openDetails = new Set();

function pub(sub, obj, retain = true) {
  if (client) client.publish(TOPIC(roomCode) + '/' + sub, obj === '' ? '' : JSON.stringify(obj), { qos: 1, retain });
}

function connect(will) {
  if (client) { try { client.end(false); } catch (e) {} }
  client = mqtt.connect(brokerUrl, {
    clientId: 'mh_' + Math.random().toString(36).slice(2, 12), clean: true,
    reconnectPeriod: 1500, connectTimeout: 10000, keepalive: 20, will,
  });
  client.on('offline', () => { if (role) { status = 'אין חיבור לאינטרנט… מנסה שוב'; render(true); } });
  client.on('error', () => {});
  return client;
}

// אם הדף חזר מהרקע – מתחברים מחדש מיד
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && client && !client.connected) { try { client.reconnect(); } catch (e) {} }
});

// ---------- מנהל ----------
function createRoom(name, code, restored, bi = 0) {
  if (bi >= BROKERS.length) {
    const c0 = client; client = null; try { c0 && c0.end(true); } catch (e) {}
    role = null; status = ''; S = null; sessionStorage.removeItem('imp_session');
    err = 'לא הצלחתי להתחבר לשרת המשחק. בדקו שיש אינטרנט ונסו שוב (אפשר גם לנסות בלי WiFi, עם נתונים סלולריים).';
    render(true); return;
  }
  role = 'host';
  roomCode = code || String(1000 + rint(9000));
  brokerUrl = BROKERS[bi];
  status = 'פותח חדר…' + (bi ? ` (ניסיון ${bi + 1})` : ''); err = ''; render(true);
  if (!restored) { S = newState(); actions.join(me, { name }); }
  S.hostId = me;
  const base = TOPIC(roomCode);
  const meta = (alive) => JSON.stringify({ roomId: S.roomId, alive, t: Date.now() });
  const c = connect({ topic: base + '/meta', payload: meta(false), qos: 1, retain: true });
  let checked = !!restored;
  const failTimer = setTimeout(() => { if (!c.connected && client === c) { c.end(true); createRoom(name, roomCode, true, bi + 1); } }, 7000);
  c.on('connect', () => {
    clearTimeout(failTimer);
    if (!checked) {
      // לוודא שהקוד לא תפוס ע"י חדר אחר
      let busy = false;
      c.subscribe(base + '/meta', { qos: 1 });
      c.on('message', function chk(t, p) {
        if (t !== base + '/meta' || !p.length) return;
        try { const m = JSON.parse(p.toString()); if (m.roomId !== S.roomId && Date.now() - m.t < 6 * 3600e3) busy = true; } catch (e) {}
      });
      setTimeout(() => {
        if (busy) { c.end(true); client = null; createRoom(name, null, true, bi); return; }
        checked = true; hostReady(c, base, meta);
      }, 1500);
    } else hostReady(c, base, meta);
  });
}

function hostReady(c, base, meta) {
  status = '';
  c.publish(base + '/meta', meta(true), { qos: 1, retain: true });
  c.subscribe([base + '/in/+', base + '/presence/+'], { qos: 1 });
  c.removeAllListeners('message');
  c.on('message', (t, p) => {
    const s = p.toString();
    if (t.startsWith(base + '/presence/')) {
      const pid = t.slice((base + '/presence/').length);
      const on = s === 'on';
      if (presence[pid] !== on) { presence[pid] = on; if (S.players[pid]) { delete lastSent[pid]; broadcast(); } }
    } else if (t.startsWith(base + '/in/') && s) {
      const pid = t.slice((base + '/in/').length);
      try { const m = JSON.parse(s); hostAction(pid, m.action, m.body, m.seq); } catch (e) {}
    }
  });
  sessionStorage.setItem('imp_session', JSON.stringify({ role: 'host', code: roomCode, name: S.players[me].name, broker: brokerUrl }));
  setUrl(roomCode);
  Object.keys(lastSent).forEach(k => delete lastSent[k]);
  broadcast();
  keepAwake();
}

// ---------- שחקן ----------
function joinRoom(name, code) {
  role = 'guest'; roomCode = code; guestMeta = null;
  status = 'מחפש את חדר ' + code + '…'; err = ''; render(true);
  const probes = []; let done = false, anyConnected = false;
  const finish = (url) => {
    if (done) return; done = true; clearTimeout(timer);
    probes.forEach(p => { try { p.end(true); } catch (e) {} });
    if (role !== 'guest' || roomCode !== code) return;
    if (url) { brokerUrl = url; joinOn(name, code); return; }
    role = null; status = ''; sessionStorage.removeItem('imp_session');
    err = anyConnected ? 'לא נמצא חדר עם הקוד ' + code + '. בדקו את הקוד.' : 'לא הצלחתי להתחבר לשרת המשחק. בדקו שיש אינטרנט ונסו שוב.';
    render(true);
  };
  const timer = setTimeout(() => finish(null), 9000);
  BROKERS.forEach(url => {
    const p = mqtt.connect(url, { clientId: 'mhp_' + Math.random().toString(36).slice(2, 12), clean: true, reconnectPeriod: 0, connectTimeout: 8000 });
    probes.push(p);
    p.on('error', () => {});
    p.on('connect', () => { anyConnected = true; p.subscribe(TOPIC(code) + '/meta', { qos: 1 }); });
    p.on('message', (t, m) => { if (m.length) finish(url); });
  });
}

function joinOn(name, code) {
  status = 'מתחבר לחדר ' + code + '…'; render(true);
  const base = TOPIC(code);
  const c = connect({ topic: base + '/presence/' + me, payload: 'off', qos: 1, retain: true });
  sessionStorage.setItem('imp_session', JSON.stringify({ role: 'guest', code, name }));
  c.on('connect', () => {
    c.publish(base + '/presence/' + me, 'on', { qos: 1, retain: true });
    c.subscribe([base + '/meta', base + '/s/' + me], { qos: 1 });
    if (guestMeta && st && st.joined) { status = ''; render(true); }
    if (pending) sendPending();
  });
  c.on('message', (t, p) => {
    const s = p.toString();
    if (t === base + '/meta') {
      if (!s) { if (guestMeta) { leaveLocal(); err = 'החדר נסגר'; render(true); } return; }
      const m = JSON.parse(s);
      const first = !guestMeta;
      if (guestMeta && guestMeta.roomId !== m.roomId) { st = null; }
      guestMeta = m; hostAlive = m.alive;
      status = (st && st.joined) ? '' : (m.alive ? 'מצטרף למשחק…' : 'המנהל יצא לרגע מהמשחק… ההצטרפות תושלם כשיחזור');
      if (first) { setUrl(code); send('join', { name }); }
      render(true);
    } else if (s) {
      const v = JSON.parse(s);
      if (!guestMeta || v.roomId !== guestMeta.roomId) return; // הודעה ישנה מחדר קודם
      if (v.kicked) { leaveLocal(); err = 'הוצאת מהמשחק'; render(true); return; }
      if (v.closed) { leaveLocal(); err = 'החדר נסגר'; render(true); return; }
      st = v; if (v.joined) status = '';
      if (pending && v.ack >= pending.seq) {
        if (v.error && v.error.seq === pending.seq) {
          err = v.error.msg;
          if (pending.action === 'join') { const e = err; leaveLocal(); err = e; }
        } else if (err && !err.startsWith('אין')) err = '';
        pending = null; clearInterval(resendTimer);
      }
      render(false);
    }
  });
}

function sendPending() {
  if (client && client.connected && pending)
    client.publish(TOPIC(roomCode) + '/in/' + me, JSON.stringify(pending), { qos: 1 });
}

function send(action, body = {}) {
  if (role === 'host') { hostAction(me, action, body, 0); return; }
  if (!client) { err = 'אין חיבור'; render(true); return; }
  pending = { seq: Date.now(), action, body };
  sendPending();
  clearInterval(resendTimer);
  resendTimer = setInterval(sendPending, 3000); // שולחים שוב עד שהמנהל מאשר
}

function leaveLocal() {
  clearInterval(resendTimer); clearTimeout(notFoundTimer); pending = null;
  if (client) {
    if (role === 'guest') client.publish(TOPIC(roomCode) + '/presence/' + me, '', { qos: 1, retain: true });
    const c = client; setTimeout(() => { try { c.end(false); } catch (e) {} }, 400);
  }
  client = null; role = null; st = null; S = null; guestMeta = null; status = '';
  sessionStorage.removeItem('imp_session');
  setUrl(null);
}

// המסך של המנהל לא נכבה בזמן המשחק (אם הדפדפן תומך)
let wakeLock = null;
async function keepAwake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && role === 'host') keepAwake(); });

// =====================================================================
//                              תצוגה
// =====================================================================
const COLORS = ['#ffd23f','#3ddc97','#4cc9f0','#ff9f1c','#c77dff','#ff5d8f','#90e0ef','#b5e48c','#f4a261','#e9c46a','#a0c4ff','#ffadad'];
const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color = (id) => { const i = st.players.findIndex(p => p.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const avatar = (p) => `<span class="av" style="background:${color(p.id)}">${esc(p.name[0] || '?')}</span>`;
function setUrl(code) {
  const q = new URLSearchParams(location.search);
  if (code) q.set('room', code); else q.delete('room');
  const s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
}
const joinLink = () => { const q = new URLSearchParams(location.search); q.set('room', roomCode); return location.origin + location.pathname + '?' + q; };

function render(force) {
  const active = document.activeElement;
  if (!force && active && active.tagName === 'INPUT') return;
  if (st && st.roundNo !== lastRound) { lastRound = st.roundNo; cardOpen = false; }
  const key = JSON.stringify(st) + err + status + cardOpen + role;
  if (!force && key === lastKey) return;
  lastKey = key;

  let h = `<h1>מי <span>המתחזה</span>? 🕵️</h1>`;
  if (err) h += `<div class="err">${esc(err)}</div>`;
  if (status) h += `<div class="panel big">⏳ ${esc(status)}</div>`;
  if (role === 'guest' && st && st.joined && !hostAlive) h += `<div class="panel big">📴 המנהל יצא לרגע מהמשחק… ממתינים שיחזור</div>`;

  if (!st || !st.joined) { if (!status) h += homeView(); }
  else if (st.phase === 'lobby') h += lobbyView();
  else if (st.round && !st.round.inRound) h += `<div class="panel big">🎬 סיבוב כבר התחיל!<div class="note">תיכנס/י לסיבוב הבא</div></div>`;
  else if (st.phase === 'reveal') h += revealView();
  else if (st.phase === 'discuss') h += discussView();
  else if (st.phase === 'vote') h += voteView();
  else if (st.phase === 'results') h += resultsView();

  app.innerHTML = h;
  bind();
}

function homeView() {
  const saved = localStorage.getItem('imp_name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  return `<p class="sub">משחק מסיבה לכל המשפחה – כל אחד בטלפון שלו</p>
  <div class="panel">
    <h2>איך קוראים לך?</h2>
    <input id="nameInput" type="text" maxlength="16" placeholder="השם שלי" value="${esc(saved)}" autocomplete="off">
  </div>
  <div class="panel">
    <h2>🔑 הצטרפות לחדר</h2>
    <input id="codeInput" type="text" inputmode="numeric" maxlength="4" placeholder="קוד חדר (4 ספרות)" value="${esc(urlRoom)}" autocomplete="off">
    <button id="joinBtn">🚀 הצטרפות</button>
  </div>
  <div class="panel">
    <h2>👑 או – פתיחת חדר חדש</h2>
    <div class="note" style="margin:0">מי שפותח את החדר הוא המנהל. בזמן המשחק כדאי שהדף יישאר פתוח אצלו.</div>
    <button id="createBtn" class="green">✨ פתיחת חדר חדש</button>
  </div>
  ${rulesPanel()}
  <div class="note">גרסה ${VERSION}</div>`;
}

function playersList(canKick) {
  return `<ul class="players">${st.players.map(p => `
    <li>${avatar(p)}<span class="nm ${p.online ? '' : 'off'}">${esc(p.name)}${p.id === me ? ' (אני)' : ''}${p.online ? '' : ' 💤'}</span>
    ${p.score ? `<span>⭐ ${p.score}</span>` : ''}
    ${p.host ? '<span class="tag">מנהל</span>' : ''}
    ${canKick && p.id !== me ? `<button class="x" data-kick="${p.id}" title="הוצאה">✕</button>` : ''}</li>`).join('')}</ul>`;
}

function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); }
  catch (e) { return ''; }
}

function lobbyView() {
  const n = st.players.length, need = st.minPlayers - n;
  let h = `<p class="sub">חדר ההמתנה</p>`;
  h += `<div class="panel" style="text-align:center"><div class="big">קוד החדר</div>
    <div class="code">${esc(roomCode)}</div>
    ${st.isHost ? `<div class="qr">${qrSvg(joinLink())}</div><div class="note">סרקו כדי להצטרף, או הכניסו את הקוד באתר</div>
      <button class="ghost" id="shareBtn">📤 שיתוף קישור</button>` : ''}</div>`;
  h += `<div class="panel"><h2>שחקנים (${n})</h2>${playersList(st.isHost)}</div>`;
  if (st.isHost) {
    const s = st.settings;
    h += `<div class="panel"><h2>⚙️ הגדרות</h2>
      <div class="row"><span>נושא המילים</span><select id="catSel">${st.categories.map(c => `<option ${c === s.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
      <div class="row"><span>רמז למתחזה (הנושא)</span><div class="seg"><button data-hint="1" class="${s.hint ? 'on' : ''}">כן</button><button data-hint="0" class="${!s.hint ? 'on' : ''}">לא</button></div></div>
      <div class="row"><span>מספר מתחזים</span><div class="seg"><button data-imp="1" class="${s.imposters === 1 ? 'on' : ''}">1</button><button data-imp="2" class="${s.imposters === 2 ? 'on' : ''}">2</button></div></div>
      ${s.imposters === 2 ? '<div class="note">2 מתחזים רק כשיש 6 שחקנים ומעלה</div>' : ''}
      <button id="startBtn" class="green" ${need > 0 ? 'disabled' : ''}>▶️ מתחילים!</button>
      ${need > 0 ? `<div class="note">צריך עוד ${need} ${need === 1 ? 'שחקן' : 'שחקנים'} כדי להתחיל (לפחות ${st.minPlayers})</div>` : ''}
      ${st.players.some(p => p.score) ? '<button class="ghost" id="resetBtn">איפוס ניקוד</button>' : ''}
    </div>`;
  } else {
    h += `<div class="panel big">⏳ מחכים שהמנהל יתחיל…<div class="note">${need > 0 ? `צריך עוד ${need} ${need === 1 ? 'שחקן' : 'שחקנים'}` : 'כולם מוכנים!'}</div></div>`;
  }
  h += rulesPanel() + `<button class="ghost" id="leaveBtn">${st.isHost ? 'סגירת החדר' : 'יציאה מהמשחק'}</button>`;
  return h;
}

function cardHtml() {
  const c = st.round.card;
  const back = c.imposter
    ? `<div class="face back imp"><div class="emoji">🕵️</div><div class="word">אתה המתחזה!</div>
        ${c.hint ? `<div class="cat">רמז – הנושא: ${esc(c.hint)}</div>` : '<div class="cat">אין רמז – תקשיב/י טוב!</div>'}
        <p>אל תגלה/י לאף אחד 🤫<br>נסה/י לנחש מה המילה</p></div>`
    : `<div class="face back"><div class="lbl">המילה הסודית:</div><div class="word">${esc(c.word)}</div>
        <div class="cat">נושא: ${esc(c.category)}</div><p>אל תגיד/י את המילה בקול! 🤐</p></div>`;
  return `<div class="cardwrap"><div class="flip ${cardOpen ? 'open' : ''}" data-card="1">
    <div class="face front"><div class="q">❓</div><p>${cardOpen ? '' : 'לחצו כדי לראות את הקלף'}</p></div>${back}</div></div>
    <div class="note">${cardOpen ? 'לחצו שוב על הקלף כדי להסתיר' : 'ודאו שאף אחד לא מציץ 👀'}</div>`;
}

function revealView() {
  const r = st.round;
  let h = `<p class="sub">סיבוב ${st.roundNo} · כל אחד מסתכל על הקלף שלו</p>${cardHtml()}
    <div class="progress"><div style="width:${100 * r.seenCount / r.total}%"></div></div>
    <div class="note">${r.seenCount} מתוך ${r.total} ראו את הקלף</div>`;
  h += !r.iSeen ? `<button id="seenBtn" class="green">✅ ראיתי, אני מוכן/ה</button>` : `<div class="note">מחכים לשאר השחקנים…</div>`;
  if (st.isHost) h += `<button class="ghost" id="skipBtn">להמשיך בלי לחכות לכולם</button>`;
  return h;
}

function discussView() {
  const r = st.round;
  return `<div class="starter">🎤 מתחיל/ה: <b>${esc(r.starter)}</b><br>ממשיכים בסיבוב לפי הסדר</div>
  <div class="panel"><h2>🗣️ זמן לרמזים!</h2>
    <ol class="tips">
      <li>כל אחד אומר <b>מילה אחת</b> שקשורה למילה הסודית.</li>
      <li>לא קל מדי – שהמתחזה לא יבין!</li>
      <li>לא קשה מדי – שלא יחשדו בך!</li>
      <li>אפשר לעשות 2–3 סיבובים של רמזים.</li>
    </ol></div>
  <details class="panel"><summary>להציץ שוב בקלף שלי</summary>${cardHtml()}</details>
  ${guessPanel()}
  ${st.isHost ? '<button id="voteBtn" class="pink">🗳️ עוברים להצבעה</button>' : '<div class="note">המנהל יעביר להצבעה כשתהיו מוכנים</div>'}`;
}

let guessDraft = '', guessConfirm = false;
function guessPanel() {
  if (!st.round.canGuess) return '';
  return `<div class="panel guess"><h2>🤔 גילית את המילה?</h2>
    <div class="note" style="margin:0 0 10px">אפשר לנחש <b>פעם אחת</b>: ניחוש נכון – ניצחת! ניחוש לא נכון – השחקנים מנצחים.</div>
    <input id="guessInput" type="text" maxlength="30" placeholder="המילה היא…" value="${esc(guessDraft)}" autocomplete="off">
    ${guessConfirm
      ? `<button id="guessGo" class="pink">✅ בטוח/ה! לשלוח את "${esc(guessDraft)}"</button><button class="ghost" id="guessCancel">רגע, לא בטוח/ה</button>`
      : `<button id="guessBtn">🎯 אני יודע/ת את המילה!</button>`}
  </div>`;
}

function voteView() {
  const r = st.round;
  let h = `<div class="panel"><h2>🗳️ מי ${r.impCount > 1 ? 'אחד המתחזים' : 'המתחזה'}?</h2>
    <div class="vote-list">${r.candidates.filter(c => c.id !== me).map(c =>
      `<button data-vote="${c.id}" class="${r.myVote === c.id ? 'sel' : ''}">${avatar(c)} ${esc(c.name)} ${r.myVote === c.id ? ' ✔' : ''}</button>`).join('')}</div>
    <div class="progress"><div style="width:${100 * r.votedCount / r.total}%"></div></div>
    <div class="note">${r.votedCount} מתוך ${r.total} הצביעו${r.myVote ? ' · אפשר לשנות עד שכולם מצביעים' : ''}</div></div>`;
  h += guessPanel();
  if (st.isHost) h += `<button class="ghost" id="endVoteBtn">לסיים הצבעה עכשיו</button>`;
  return h;
}

function resultsView() {
  const r = st.round, res = r.result;
  const win = (r.card && r.card.imposter) ? !res.caught : res.caught;
  const g = res.guess;
  const title = g ? (g.correct ? '😈 המתחזה ניחש את המילה!' : '🎉 המתחזה טעה בניחוש – השחקנים ניצחו!')
                  : (res.caught ? '🎉 תפסתם את המתחזה!' : '😈 המתחזה ניצח!');
  let h = `<div class="banner ${res.caught ? 'win' : 'lose'}">${title}</div>
    <div class="panel big">${win ? '🏆 ניצחת בסיבוב הזה!' : '💪 בפעם הבאה!'}</div>
    <div class="panel reveal-word">המילה הייתה <b>${esc(r.word)}</b>(${esc(r.category)})
      <p>🕵️ ${r.imposterNames.length > 1 ? 'המתחזים היו' : 'המתחזה היה/תה'}: <b style="font-size:1.5rem;display:inline;color:var(--pink)">${r.imposterNames.map(esc).join(' ו')}</b></p></div>
    ${g ? `<div class="panel big">🎯 ${esc(g.name)} ניחש/ה: <b>"${esc(g.text)}"</b> ${g.correct ? '✔' : '✘'}
        ${g.approved ? '<div class="note">המנהל אישר את הניחוש</div>' : ''}
        ${st.isHost && !g.correct ? '<button class="ghost" id="approveBtn">זה בעצם נכון (רק שגיאת כתיב) – לאשר</button>' : ''}</div>` : ''}
    ${g ? '' : `<div class="panel"><h2>תוצאות ההצבעה</h2><ul class="players tally">${res.tally.map(t =>
      `<li><span class="nm">${t.imposter ? '🕵️ ' : ''}${esc(t.name)}</span><span class="v">${t.votes} קולות</span></li>`).join('')}</ul>
      ${!res.caught && res.top.length > 1 ? '<div class="note">היה תיקו – אז המתחזה חמק!</div>' : ''}</div>`}
    <div class="panel"><h2>⭐ ניקוד</h2>${playersList(false)}<div class="note">השחקנים ניצחו = נקודה לכל אחד · המתחזה ניצח = 2 נקודות למתחזה</div></div>`;
  h += st.isHost ? `<button id="againBtn" class="green">🔄 סיבוב חדש</button><button class="ghost" id="lobbyBtn">חזרה לחדר ההמתנה</button>`
                 : `<div class="note">מחכים שהמנהל יתחיל סיבוב חדש…</div>`;
  return h;
}

function rulesPanel() {
  return `<details class="panel"><summary><b>📖 איך משחקים?</b></summary>
  <ol class="tips">
    <li>כל השחקנים מקבלים את אותה מילה סודית – חוץ מהמתחזה!</li>
    <li>המתחזה לא יודע את המילה (אולי רק את הנושא).</li>
    <li>כל אחד בתורו אומר מילה אחת שקשורה למילה הסודית.</li>
    <li>בסוף כולם מצביעים: מי המתחזה?</li>
    <li>תפסתם אותו? ניצחתם! הוא חמק? המתחזה ניצח!</li>
    <li>🎯 המתחזה יכול בכל רגע לנחש את המילה (פעם אחת): ניחש נכון – הוא מנצח, טעה – השחקנים מנצחים.</li>
  </ol></details>`;
}

function leaveGame() {
  if (role === 'host') {
    if (!confirmLeave()) return;
    S.order.forEach(pid => { if (pid !== me) pub('s/' + pid, { roomId: S.roomId, closed: true }); });
    pub('meta', '');
    localStorage.removeItem('imp_host_state');
  } else send('leave');
  setTimeout(() => { leaveLocal(); render(true); }, 300);
}
let leaveArmed = 0;
function confirmLeave() { // אישור בלחיצה כפולה במקום חלון קופץ
  if (Date.now() - leaveArmed < 3000) return true;
  leaveArmed = Date.now(); err = 'לחצו שוב כדי לסגור את החדר לכולם'; render(true); return false;
}

function bind() {
  const $ = id => document.getElementById(id);
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  const getName = () => { const n = $('nameInput').value.trim(); if (!n) { err = 'צריך לכתוב שם'; render(true); return null; } localStorage.setItem('imp_name', n); return n; };
  on('joinBtn', () => {
    const n = getName(); if (!n) return;
    const code = ($('codeInput').value || '').replace(/\D/g, '');
    if (code.length !== 4) { err = 'קוד החדר הוא 4 ספרות'; render(true); return; }
    err = ''; joinRoom(n, code);
  });
  on('createBtn', () => { const n = getName(); if (!n) return; err = ''; createRoom(n); });
  on('shareBtn', async () => {
    const link = joinLink();
    try { if (navigator.share) await navigator.share({ title: 'מי המתחזה?', text: 'בואו לשחק! קוד חדר: ' + roomCode, url: link }); else { await navigator.clipboard.writeText(link); err = 'הקישור הועתק ✔'; render(true); } } catch (e) {}
  });
  on('startBtn', () => send('start'));
  on('againBtn', () => send('again'));
  on('lobbyBtn', () => send('lobby'));
  on('resetBtn', () => send('resetScores'));
  on('leaveBtn', leaveGame);
  on('seenBtn', () => { cardOpen = false; send('seen'); });
  on('skipBtn', () => send('discuss'));
  on('voteBtn', () => send('toVote'));
  on('endVoteBtn', () => send('endVote'));
  const gi = $('guessInput');
  if (gi) gi.oninput = () => { guessDraft = gi.value; if (guessConfirm) { guessConfirm = false; render(true); $('guessInput').focus(); } };
  on('guessBtn', () => { guessDraft = ($('guessInput').value || '').trim(); if (!guessDraft) { err = 'צריך לכתוב ניחוש'; render(true); return; } err = ''; guessConfirm = true; render(true); });
  on('guessCancel', () => { guessConfirm = false; render(true); });
  on('guessGo', () => { guessConfirm = false; send('guess', { text: guessDraft }); guessDraft = ''; });
  on('approveBtn', () => send('approveGuess'));
  document.querySelectorAll('[data-card]').forEach(c => c.onclick = () => { cardOpen = !cardOpen; render(true); });
  document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => send('kick', { id: b.dataset.kick }));
  document.querySelectorAll('[data-vote]').forEach(b => b.onclick = () => send('vote', { target: b.dataset.vote }));
  document.querySelectorAll('[data-hint]').forEach(b => b.onclick = () => send('settings', { hint: b.dataset.hint === '1' }));
  document.querySelectorAll('[data-imp]').forEach(b => b.onclick = () => send('settings', { imposters: +b.dataset.imp }));
  const cs = $('catSel'); if (cs) cs.onchange = () => send('settings', { category: cs.value });
  document.querySelectorAll('details').forEach(d => {
    const k = d.querySelector('summary').textContent;
    if (openDetails.has(k)) d.open = true;
    d.ontoggle = () => d.open ? openDetails.add(k) : openDetails.delete(k);
  });
}

// ---------- התחלה: חזרה אוטומטית אחרי רענון הדף ----------
(function boot() {
  if (typeof mqtt === 'undefined') { err = 'לא הצלחתי לטעון את רכיב החיבור – בדקו חיבור לאינטרנט ורעננו'; render(true); return; }
  let sess = null;
  try { sess = JSON.parse(sessionStorage.getItem('imp_session')); } catch (e) {}
  if (sess && sess.role === 'host') {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('imp_host_state')); } catch (e) {}
    if (saved && saved.code === sess.code && Date.now() - saved.t < 6 * 3600e3) { S = saved.S; createRoom(sess.name, sess.code, true, Math.max(0, BROKERS.indexOf(sess.broker))); return; }
  }
  if (sess && sess.role === 'guest') { joinRoom(sess.name, sess.code); return; }
  render(true);
})();
