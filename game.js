// מי המתחזה? – גרסת GitHub Pages
// הטלפון של המנהל מחזיק את המשחק. כל ההודעות עוברות דרך שרת MQTT ציבורי,
// כך שהחדר לא נעלם גם כשהמנהל יוצא לרגע מהאפליקציה (למשל כדי לשלוח קישור בוואטסאפ).

const MIN_PLAYERS = 3;
const VERSION = 6;
// כמה שרתי הודעות ציבוריים – אם אחד חסום או לא עובד, עוברים לבא בתור
const BROKERS = new URLSearchParams(location.search).get('broker')
  ? new URLSearchParams(location.search).get('broker').split(',')
  : ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
let brokerUrl = BROKERS[0];
const TOPIC = (code) => 'mi-hamitchaze-il/v2/' + code;

// מאגר המילים נמצא בקובץ words.js

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
    settings: { hint: true, imposters: 1, category: 'הכול', pictures: true },
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
  cats.forEach(c => WORDS[c].words.forEach(([w, e]) => pool.push({ c, w, e })));
  let fresh = pool.filter(x => !S.used.includes(x.c + '|' + x.w));
  if (!fresh.length) { S.used = S.used.filter(k => !pool.some(x => x.c + '|' + x.w === k)); fresh = pool; }
  const p = fresh[rint(fresh.length)];
  S.used.push(p.c + '|' + p.w);
  return p;
}

function startRound() {
  const ids = activeIds();
  const nImp = Math.min(S.settings.imposters, ids.length >= 6 ? 2 : 1);
  const { c, w, e } = pickWord();
  S.roundNo++;
  S.round = { word: w, emoji: e, category: c, playerIds: ids, imposters: shuffle(ids).slice(0, nImp),
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
    if (typeof b.pictures === 'boolean') S.settings.pictures = b.pictures;
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
    settings: S.settings, categories: ['הכול', ...Object.keys(WORDS)], catIcons: Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, v.icon])), minPlayers: MIN_PLAYERS, roundNo: S.roundNo,
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
      const pics = S.settings.pictures !== false;
      const catIcon = WORDS[r.category] ? WORDS[r.category].icon : '';
      out.round.card = r.imposters.includes(pid)
        ? { imposter: true, hint: S.settings.hint ? r.category : null, catIcon: S.settings.hint && pics ? catIcon : null }
        : { imposter: false, word: r.word, category: r.category, emoji: pics ? r.emoji : null, catIcon: pics ? catIcon : null };
    }
    if (S.phase === 'results') {
      Object.assign(out.round, {
        word: r.word, emoji: r.emoji, category: r.category, imposterNames: r.imposters.map(name),
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
//  נבנתה לפי WCAG 2.2 רמה AA / ת״י 5568, ISO 9241-110 ועקרונות שימושיות
// =====================================================================
const COLORS = ['#ffd23f','#3ddc97','#4cc9f0','#ff9f1c','#c77dff','#ff8fb1','#90e0ef','#b5e48c','#f4a261','#e9c46a','#a0c4ff','#ffadad'];
const app = document.getElementById('app');
const live = document.getElementById('live');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color = (id) => { const i = st.players.findIndex(p => p.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const avatar = (p) => `<span class="av" aria-hidden="true" style="background:${color(p.id)}">${esc(p.name[0] || '?')}</span>`;
const pic = (emoji, label, cls = 'pic') => !emoji ? '' : label
  ? `<span class="${cls}" role="img" aria-label="${esc(label)}">${emoji}</span>`
  : `<span class="${cls}" aria-hidden="true">${emoji}</span>`;
function setUrl(code) {
  const q = new URLSearchParams(location.search);
  if (code) q.set('room', code); else q.delete('room');
  const s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : ''));
}
const joinLink = () => { const q = new URLSearchParams(location.search); q.set('room', roomCode); return location.origin + location.pathname + '?' + q; };

// ---------- הכרזות לקורא מסך (aria-live) ----------
let lastAnnounced = '';
function announce(msg) {
  if (!msg || msg === lastAnnounced) return;
  lastAnnounced = msg;
  live.textContent = '';
  setTimeout(() => { live.textContent = msg; }, 60);
}
const PHASE_NAMES = { lobby: 'חדר ההמתנה', reveal: 'שלב 1: הסתכלו על הקלף', discuss: 'שלב 2: זמן לרמזים', vote: 'שלב 3: הצבעה', results: 'שלב 4: תוצאות' };

// ---------- גודל טקסט (WCAG 1.4.4) ----------
const SIZES = [{ v: 100, n: 'רגיל' }, { v: 120, n: 'גדול' }, { v: 140, n: 'גדול מאוד' }];
let sizeIdx = Math.min(2, Math.max(0, +(localStorage.getItem('imp_size') || 0)));
const applySize = () => { document.documentElement.style.fontSize = SIZES[sizeIdx].v + '%'; };
applySize();

// ---------- השמעת מילה (Web Speech API) ----------
let heVoice = null;
function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const v = speechSynthesis.getVoices();
  heVoice = v.find(x => /^(he|iw)/i.test(x.lang)) || null;
}
if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function speak(text) {
  if (!('speechSynthesis' in window)) { err = 'הדפדפן הזה לא יכול להשמיע מילים. אפשר לבקש ממבוגר להקריא בשקט.'; render(true); return; }
  pickVoice();
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = heVoice ? heVoice.lang : 'he-IL';
  if (heVoice) u.voice = heVoice;
  u.rate = 0.8; u.volume = 0.7;
  u.onerror = () => { err = 'לא הצלחתי להשמיע. ייתכן שאין קול בעברית במכשיר – אפשר להוסיף אותו בהגדרות הטלפון (נגישות ← הקראה).'; render(true); };
  speechSynthesis.speak(u);
}

// ---------- ציור הדף ----------
let lastPhaseKey = '', errField = null, leaveConfirm = false;
function render(force) {
  const active = document.activeElement;
  const typing = active && ((active.tagName === 'INPUT' && active.type === 'text') || active.tagName === 'SELECT');
  if (!force && typing && (st && st.joined ? st.phase + st.roundNo : 'home') === lastPhaseKey) return;
  if (st && st.roundNo !== lastRound) { lastRound = st.roundNo; cardOpen = false; }
  const key = JSON.stringify(st) + err + status + cardOpen + role + leaveConfirm + sizeIdx;
  if (!force && key === lastKey) return;
  lastKey = key;

  // שמירת המיקוד כדי שמשתמשי מקלדת/קורא מסך לא יאבדו את מקומם (WCAG 2.4.3)
  const focusId = active && active.id && app.contains(active) ? active.id : null;
  const phaseKey = (st && st.joined ? st.phase + st.roundNo : 'home');
  const phaseChanged = phaseKey !== lastPhaseKey;

  let h = `<header class="top">
      <h1 tabindex="-1" id="mainTitle"><span aria-hidden="true">🕵️</span> מי <span class="hl">המתחזה</span>?</h1>
      <button class="tool" id="sizeBtn">גודל טקסט<span class="sr-only">: ${SIZES[sizeIdx].n}</span></button>
    </header>`;
  if (st && st.joined && st.round && st.round.inRound && st.phase !== 'lobby') h += stepper();
  if (err) h += `<div class="err" id="errBox"><span aria-hidden="true">⚠️</span> ${esc(err)}</div>`;
  if (status) h += `<div class="panel big status"><span class="spinner" aria-hidden="true"></span> ${esc(status)}</div>`;
  if (role === 'guest' && st && st.joined && !hostAlive) h += `<div class="panel big">📴 המנהל יצא לרגע מהמשחק… ממתינים שיחזור</div>`;

  if (!st || !st.joined) { if (!status) h += homeView(); }
  else if (st.phase === 'lobby') h += lobbyView();
  else if (st.round && !st.round.inRound) h += `<div class="panel big">🎬 סיבוב כבר התחיל!<p class="note">תצטרפו בסיבוב הבא</p></div>`;
  else if (st.phase === 'reveal') h += revealView();
  else if (st.phase === 'discuss') h += discussView();
  else if (st.phase === 'vote') h += voteView();
  else if (st.phase === 'results') h += resultsView();
  h += footer();

  app.innerHTML = h;
  hideEmojiFromScreenReaders(app);
  bind();

  if (focusId && document.getElementById(focusId)) document.getElementById(focusId).focus({ preventScroll: true });
  else if (phaseChanged && lastPhaseKey) { const t = document.getElementById('mainTitle'); if (t) t.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  lastPhaseKey = phaseKey;

  if (err) announce(err);
  else if (status) announce(status);
  else if (st && st.joined && phaseChanged) announce(PHASE_NAMES[st.phase] || '');
}

// אימוג׳י דקורטיבי בתוך טקסט מוסתר מקורא המסך, כדי שלא יקריא "פרצוף מחייך" וכו׳
const EMOJI_RE = /(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️)?)*)+/gu;
function hideEmojiFromScreenReaders(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const n = walker.currentNode;
    if (n.parentElement.closest('[role="img"],[aria-hidden="true"],option,title')) continue;
    EMOJI_RE.lastIndex = 0;
    if (EMOJI_RE.test(n.nodeValue)) nodes.push(n);
  }
  nodes.forEach(n => {
    const frag = document.createDocumentFragment();
    let last = 0; const s = n.nodeValue; EMOJI_RE.lastIndex = 0; let m;
    while ((m = EMOJI_RE.exec(s))) {
      if (m.index > last) frag.appendChild(document.createTextNode(s.slice(last, m.index)));
      const sp = document.createElement('span'); sp.setAttribute('aria-hidden', 'true'); sp.textContent = m[0]; frag.appendChild(sp);
      last = m.index + m[0].length;
    }
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)));
    n.parentNode.replaceChild(frag, n);
  });
}

// מחוון שלבים – המשתמש תמיד יודע איפה הוא נמצא (ISO 9241-110: שקיפות)
function stepper() {
  const steps = [['reveal', 'קלף', '🃏'], ['discuss', 'רמזים', '🗣️'], ['vote', 'הצבעה', '🗳️'], ['results', 'תוצאות', '🏆']];
  const cur = steps.findIndex(s => s[0] === st.phase);
  return `<nav aria-label="שלבי הסיבוב"><ol class="stepper">${steps.map(([k, n, e], i) =>
    `<li class="${i < cur ? 'done' : i === cur ? 'cur' : ''}" ${i === cur ? 'aria-current="step"' : ''}>
       <span class="dot" aria-hidden="true">${i < cur ? '✓' : e}</span><span>${n}</span></li>`).join('')}</ol></nav>`;
}

function field(id, label, opts) {
  const invalid = errField === id;
  return `<label for="${id}" class="lbl">${label}</label>
    <input id="${id}" type="text" ${opts} ${invalid ? 'aria-invalid="true" aria-describedby="errBox"' : ''}>`;
}

function homeView() {
  const saved = localStorage.getItem('imp_name') || '';
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  return `<p class="sub">משחק מסיבה לכל המשפחה – כל אחד בטלפון שלו · גילאי 5–12 · לפחות 3 שחקנים</p>
  <section class="panel" aria-labelledby="hName">
    <h2 id="hName"><span aria-hidden="true">1.</span> מה השם שלך?</h2>
    ${field('nameInput', 'השם שיופיע במשחק', `maxlength="16" autocomplete="nickname" value="${esc(saved)}"`)}
  </section>
  <section class="panel" aria-labelledby="hJoin">
    <h2 id="hJoin"><span aria-hidden="true">2.</span> 🔑 הצטרפות לחדר קיים</h2>
    ${field('codeInput', 'קוד החדר (4 ספרות)', `inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${esc(urlRoom)}"`)}
    <button id="joinBtn" class="btn">🚀 הצטרפות</button>
  </section>
  <section class="panel" aria-labelledby="hNew">
    <h2 id="hNew">👑 או: פתיחת חדר חדש</h2>
    <p class="note">מי שפותח את החדר הוא המנהל ומקבל קוד לשתף.</p>
    <button id="createBtn" class="btn green">✨ פתיחת חדר חדש</button>
  </section>
  ${rulesPanel()}`;
}

function playersList(canKick) {
  return `<ul class="players">${st.players.map(p => `
    <li>${avatar(p)}<span class="nm ${p.online ? '' : 'off'}">${esc(p.name)}${p.id === me ? ' (אני)' : ''}${p.online ? '' : ' <span class="tagoff">לא מחובר/ת</span>'}</span>
    ${p.score ? `<span class="score">⭐ ${p.score}<span class="sr-only"> נקודות</span></span>` : ''}
    ${p.host ? '<span class="tag">מנהל</span>' : ''}
    ${canKick && p.id !== me ? `<button class="x" id="kick-${p.id}" data-kick="${p.id}" aria-label="הוצאת ${esc(p.name)} מהמשחק">✕</button>` : ''}</li>`).join('')}</ul>`;
}

function qrSvg(text) {
  try { const q = qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); }
  catch (e) { return ''; }
}

function radios(name, legend, opts, val) {
  return `<fieldset class="seg-field"><legend>${legend}</legend><div class="seg">${opts.map(([v, t]) =>
    `<label class="seg-opt"><input type="radio" name="${name}" id="${name}-${v}" value="${v}" ${String(val) === String(v) ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div></fieldset>`;
}

function lobbyView() {
  const n = st.players.length, need = st.minPlayers - n;
  let h = `<p class="sub">חדר ההמתנה</p>
  <section class="panel center" aria-labelledby="hCode">
    <h2 id="hCode">קוד החדר</h2>
    <p class="code" aria-label="קוד החדר: ${esc(roomCode.split('').join(' '))}">${esc(roomCode)}</p>
    ${st.isHost ? `<div class="qr" role="img" aria-label="קוד QR להצטרפות לחדר">${qrSvg(joinLink())}</div>
      <p class="note">החברים סורקים את הקוד, או מקלידים את 4 הספרות באתר</p>
      <button class="btn ghost" id="shareBtn">📤 שיתוף קישור</button>` : ''}
  </section>
  <section class="panel" aria-labelledby="hPlayers"><h2 id="hPlayers">שחקנים (${n})</h2>${playersList(st.isHost)}</section>`;
  if (st.isHost) {
    const s = st.settings;
    h += `<section class="panel" aria-labelledby="hSet"><h2 id="hSet">⚙️ הגדרות</h2>
      <label for="catSel" class="lbl">נושא המילים</label>
      <select id="catSel">${st.categories.map(c => `<option value="${esc(c)}" ${c === s.category ? 'selected' : ''}>${c === 'הכול' ? '🎲' : st.catIcons[c]} ${esc(c)}</option>`).join('')}</select>
      ${radios('hint', 'רמז למתחזה (מה הנושא)', [[1, 'כן'], [0, 'לא']], s.hint ? 1 : 0)}
      ${radios('pics', 'ציור ליד המילה', [[1, 'כן'], [0, 'לא']], s.pictures !== false ? 1 : 0)}
      ${radios('imp', 'מספר מתחזים', [[1, '1'], [2, '2']], s.imposters)}
      ${s.imposters === 2 ? '<p class="note">2 מתחזים רק כשיש 6 שחקנים ומעלה</p>' : ''}
      <button id="startBtn" class="btn green" ${need > 0 ? 'aria-disabled="true"' : ''} aria-describedby="startNote">▶️ מתחילים!</button>
      <p class="note" id="startNote">${need > 0 ? `צריך עוד ${need} ${need === 1 ? 'שחקן' : 'שחקנים'} כדי להתחיל (לפחות ${st.minPlayers})` : 'כולם כאן? אפשר להתחיל!'}</p>
      ${st.players.some(p => p.score) ? '<button class="btn ghost" id="resetBtn">איפוס ניקוד</button>' : ''}
    </section>`;
  } else {
    h += `<div class="panel big">⏳ מחכים שהמנהל יתחיל…<p class="note">${need > 0 ? `צריך עוד ${need} ${need === 1 ? 'שחקן' : 'שחקנים'}` : 'כולם מוכנים!'}</p></div>`;
  }
  h += rulesPanel();
  if (leaveConfirm) {
    h += `<div class="panel confirm" role="group" aria-labelledby="hLeave"><h2 id="hLeave">${st.isHost ? 'לסגור את החדר לכולם?' : 'לצאת מהמשחק?'}</h2>
      <div class="row2"><button class="btn pink" id="leaveYes">כן, ${st.isHost ? 'לסגור' : 'לצאת'}</button><button class="btn ghost" id="leaveNo">לא, להישאר</button></div></div>`;
  } else h += `<button class="btn ghost" id="leaveBtn">${st.isHost ? 'סגירת החדר' : 'יציאה מהמשחק'}</button>`;
  return h;
}

function cardHtml(ctx) {
  const c = st.round.card;
  let inner;
  if (!cardOpen) {
    inner = `<div class="face front"><span class="q" aria-hidden="true">❓</span><p>הקלף מוסתר</p></div>`;
  } else if (c.imposter) {
    inner = `<div class="face back imp">
      <span class="pic" aria-hidden="true">🕵️</span>
      <p class="word">את/ה המתחזה!</p>
      ${c.hint ? `<p class="cat">רמז – הנושא: ${c.catIcon ? pic(c.catIcon, '') : ''} <b>${esc(c.hint)}</b></p>
        <button class="btn small light" id="speak-${ctx}" data-speak="${esc('הנושא הוא ' + c.hint)}">🔊 השמעת הנושא</button>`
        : '<p class="cat">אין רמז – תקשיבו טוב לאחרים!</p>'}
      <p>🤫 אל תגלו לאף אחד. נסו לנחש מה המילה.</p></div>`;
  } else {
    inner = `<div class="face back">
      <p class="lbl2">המילה הסודית:</p>
      ${c.emoji ? pic(c.emoji, 'ציור: ' + c.word, 'pic') : ''}
      <p class="word">${esc(c.word)}</p>
      <button class="btn small" id="speak-${ctx}" data-speak="${esc(c.word)}">🔊 השמעת המילה</button>
      <p class="cat">נושא: ${c.catIcon ? pic(c.catIcon, '') : ''} ${esc(c.category)}</p>
      <p>🤐 לא אומרים את המילה בקול!</p></div>`;
  }
  return `<section class="cardsec" aria-labelledby="hCard-${ctx}">
    <h2 class="sr-only" id="hCard-${ctx}">הקלף שלי</h2>
    <div class="card ${cardOpen ? 'open' : ''} ${flipNow ? 'anim' : ''}" id="cardBox-${ctx}" data-card="1">${inner}</div>
    <button class="btn ${cardOpen ? 'ghost' : 'blue'}" id="cardBtn-${ctx}" data-cardbtn="1" aria-expanded="${cardOpen}" aria-controls="cardBox-${ctx}">
      ${cardOpen ? '🙈 הסתרת הקלף' : '👁️ הצגת הקלף'}</button>
    <p class="note">${cardOpen ? '🎧 בהשמעה – קרבו את הטלפון לאוזן כדי שאחרים לא ישמעו' : '👀 ודאו שאף אחד לא מציץ'}</p>
  </section>`;
}

function progress(label, v, max) {
  return `<div class="progress" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="${max}" aria-valuenow="${v}" aria-valuetext="${v} מתוך ${max}"><div style="width:${100 * v / max}%"></div></div>
    <p class="note">${label}: ${v} מתוך ${max}</p>`;
}

function revealView() {
  const r = st.round;
  let h = `<p class="sub">סיבוב ${st.roundNo} · כל אחד מסתכל על הקלף שלו</p>${cardHtml('r')}
    ${progress('ראו את הקלף', r.seenCount, r.total)}`;
  h += !r.iSeen ? `<button id="seenBtn" class="btn green">✅ ראיתי, אני מוכן/ה</button>` : `<p class="note">מחכים לשאר השחקנים…</p>`;
  if (st.isHost) h += `<button class="btn ghost" id="skipBtn">להמשיך בלי לחכות לכולם</button>`;
  return h;
}

function discussView() {
  const r = st.round;
  return `<div class="starter">🎤 מתחיל/ה: <b>${esc(r.starter)}</b><br>ממשיכים בסיבוב לפי הסדר</div>
  <section class="panel" aria-labelledby="hTips"><h2 id="hTips">🗣️ זמן לרמזים!</h2>
    <ol class="tips">
      <li>כל אחד אומר <b>מילה אחת</b> שקשורה למילה הסודית.</li>
      <li>לא קל מדי – שהמתחזה לא יבין!</li>
      <li>לא קשה מדי – שלא יחשדו בך!</li>
      <li>אפשר לעשות 2–3 סיבובים של רמזים.</li>
    </ol></section>
  <details class="panel" id="peek"><summary>להציץ שוב בקלף שלי</summary>${cardHtml('d')}</details>
  ${guessPanel()}
  ${st.isHost ? '<button id="voteBtn" class="btn pink">🗳️ עוברים להצבעה</button>' : '<p class="note">המנהל יעביר להצבעה כשתהיו מוכנים</p>'}`;
}

let guessDraft = '', guessConfirm = false, flipNow = false;
function guessPanel() {
  if (!st.round.canGuess) return '';
  return `<section class="panel guess" aria-labelledby="hGuess"><h2 id="hGuess">🤔 גילית את המילה?</h2>
    <p class="note" id="guessHelp">אפשר לנחש <b>פעם אחת</b>: ניחוש נכון – ניצחת! ניחוש לא נכון – השחקנים מנצחים.</p>
    <label for="guessInput" class="lbl">הניחוש שלי</label>
    <input id="guessInput" type="text" maxlength="30" autocomplete="off" aria-describedby="guessHelp" value="${esc(guessDraft)}" ${errField === 'guessInput' ? 'aria-invalid="true"' : ''}>
    ${guessConfirm
      ? `<p class="confirm-q" id="gq">לשלוח את הניחוש "${esc(guessDraft)}"?</p>
         <div class="row2"><button id="guessGo" class="btn pink" aria-describedby="gq">✅ כן, לשלוח</button><button class="btn ghost" id="guessCancel">רגע, לא בטוח/ה</button></div>`
      : `<button id="guessBtn" class="btn">🎯 אני יודע/ת את המילה!</button>`}
  </section>`;
}

function voteView() {
  const r = st.round;
  let h = `<section class="panel" aria-labelledby="hVote"><h2 id="hVote">🗳️ מי ${r.impCount > 1 ? 'אחד המתחזים' : 'המתחזה'}?</h2>
    <p class="note">בוחרים שחקן אחד. אפשר לשנות עד שכולם מצביעים.</p>
    <div class="vote-list" role="group" aria-labelledby="hVote">${r.candidates.filter(c => c.id !== me).map(c =>
      `<button class="vote ${r.myVote === c.id ? 'sel' : ''}" id="vote-${c.id}" data-vote="${c.id}" aria-pressed="${r.myVote === c.id}">
        ${avatar(c)} <span class="nm">${esc(c.name)}</span> ${r.myVote === c.id ? '<span class="chk">✓ הקול שלי</span>' : ''}</button>`).join('')}</div>
    ${progress('הצביעו', r.votedCount, r.total)}</section>`;
  h += guessPanel();
  if (st.isHost) h += `<button class="btn ghost" id="endVoteBtn">לסיים הצבעה עכשיו</button>`;
  return h;
}

function resultsView() {
  const r = st.round, res = r.result;
  const win = (r.card && r.card.imposter) ? !res.caught : res.caught;
  const g = res.guess;
  const title = g ? (g.correct ? '😈 המתחזה ניחש את המילה!' : '🎉 המתחזה טעה בניחוש – השחקנים ניצחו!')
                  : (res.caught ? '🎉 תפסתם את המתחזה!' : '😈 המתחזה ניצח!');
  let h = `<h2 class="banner ${res.caught ? 'win' : 'lose'}">${title}</h2>
    <p class="panel big">${win ? '🏆 ניצחת בסיבוב הזה!' : '💪 בפעם הבאה!'}</p>
    <section class="panel reveal-word" aria-labelledby="hWord"><h3 id="hWord" class="lbl2">המילה הייתה</h3>
      ${st.settings.pictures !== false ? pic(r.emoji, 'ציור: ' + r.word, 'pic sm') : ''}
      <p class="word2">${esc(r.word)}</p><p>(${esc(r.category)})</p>
      <button class="btn small ghost inline" id="speak-res" data-speak="${esc(r.word)}">🔊 השמעה</button>
      <p class="impname">🕵️ ${r.imposterNames.length > 1 ? 'המתחזים היו' : 'המתחזה היה/תה'}: <b>${r.imposterNames.map(esc).join(' ו')}</b></p></section>
    ${g ? `<section class="panel big" aria-label="הניחוש של המתחזה">🎯 ${esc(g.name)} ניחש/ה: <b>"${esc(g.text)}"</b> – ${g.correct ? '✓ נכון' : '✗ לא נכון'}
        ${g.approved ? '<p class="note">המנהל אישר את הניחוש</p>' : ''}
        ${st.isHost && !g.correct ? '<button class="btn ghost" id="approveBtn">זה בעצם נכון (רק שגיאת כתיב) – לאשר</button>' : ''}</section>` : ''}
    ${g ? '' : `<section class="panel" aria-labelledby="hTally"><h3 id="hTally">תוצאות ההצבעה</h3><ul class="players tally">${res.tally.map(t =>
      `<li><span class="nm">${t.imposter ? '🕵️ ' : ''}${esc(t.name)}${t.imposter ? ' <span class="tag pinktag">מתחזה</span>' : ''}</span><span class="v">${t.votes} ${t.votes === 1 ? 'קול' : 'קולות'}</span></li>`).join('')}</ul>
      ${!res.caught && res.top.length > 1 ? '<p class="note">היה תיקו – אז המתחזה חמק!</p>' : ''}</section>`}
    <section class="panel" aria-labelledby="hScore"><h3 id="hScore">⭐ ניקוד</h3>${playersList(false)}<p class="note">השחקנים ניצחו = נקודה לכל אחד · המתחזה ניצח = 2 נקודות למתחזה</p></section>`;
  h += st.isHost ? `<button id="againBtn" class="btn green">🔄 סיבוב חדש</button><button class="btn ghost" id="lobbyBtn">חזרה לחדר ההמתנה</button>`
                 : `<p class="note">מחכים שהמנהל יתחיל סיבוב חדש…</p>`;
  return h;
}

function rulesPanel() {
  return `<details class="panel" id="rules"><summary>📖 איך משחקים?</summary>
  <ol class="tips">
    <li>כל השחקנים מקבלים את אותה מילה סודית (עם ציור והשמעה) – חוץ מהמתחזה!</li>
    <li>המתחזה לא יודע את המילה (אולי רק את הנושא).</li>
    <li>כל אחד בתורו אומר מילה אחת שקשורה למילה הסודית.</li>
    <li>בסוף כולם מצביעים: מי המתחזה?</li>
    <li>תפסתם אותו? ניצחתם! הוא חמק? המתחזה ניצח!</li>
    <li>🎯 המתחזה יכול בכל רגע לנחש את המילה (פעם אחת): ניחש נכון – הוא מנצח, טעה – השחקנים מנצחים.</li>
  </ol></details>`;
}

function footer() {
  return `<footer class="foot">
    <details id="a11y"><summary>♿ הצהרת נגישות</summary>
      <div class="a11y">
        <p>המשחק תוכנן לעמוד ב-WCAG 2.2 ברמה AA ובתקן הישראלי ת״י 5568:</p>
        <ul>
          <li>ניגודיות צבעים של 4.5:1 לפחות, ומידע לא מועבר רק באמצעות צבע.</li>
          <li>כפתורים גדולים (48 פיקסלים לפחות) ונוחים ללחיצה.</li>
          <li>תמיכה בקורא מסך: תוויות לכל שדה, הכרזה על שינויים ועל שגיאות.</li>
          <li>אפשר לשחק עם מקלדת בלבד, והמיקוד נראה בבירור.</li>
          <li>הגדלת טקסט בכפתור "גודל טקסט" למעלה, וזום של הדפדפן פתוח.</li>
          <li>ציור והשמעה לכל מילה – גם לילדים שעוד לא קוראים.</li>
          <li>כיבוד הגדרת "הפחתת תנועה" של המכשיר.</li>
        </ul>
        <p>המשחק לא אוסף מידע אישי, ואין בו פרסומות. מצאתם בעיית נגישות? ספרו לנו כדי שנתקן.</p>
      </div></details>
    <p>גרסה ${VERSION}</p></footer>`;
}

function leaveGame() {
  if (role === 'host') {
    S.order.forEach(pid => { if (pid !== me) pub('s/' + pid, { roomId: S.roomId, closed: true }); });
    pub('meta', '');
    localStorage.removeItem('imp_host_state');
  } else send('leave');
  leaveConfirm = false;
  setTimeout(() => { leaveLocal(); render(true); }, 300);
}

function bind() {
  const $ = id => document.getElementById(id);
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  const fail = (msg, fieldId) => { err = msg; errField = fieldId; render(true); const f = $(fieldId); if (f) f.focus(); };
  const ok = () => { err = ''; errField = null; };
  const getName = () => {
    const n = $('nameInput').value.trim();
    if (!n) { fail('צריך לכתוב שם. כתבו את השם שלכם בשדה "השם שיופיע במשחק".', 'nameInput'); return null; }
    localStorage.setItem('imp_name', n); return n;
  };
  on('sizeBtn', () => { sizeIdx = (sizeIdx + 1) % SIZES.length; localStorage.setItem('imp_size', sizeIdx); applySize(); render(true); announce('גודל טקסט: ' + SIZES[sizeIdx].n); });
  on('joinBtn', () => {
    const n = getName(); if (!n) return;
    const code = ($('codeInput').value || '').replace(/\D/g, '');
    if (code.length !== 4) { fail('קוד החדר הוא 4 ספרות. בקשו את הקוד ממי שפתח את החדר.', 'codeInput'); return; }
    ok(); joinRoom(n, code);
  });
  const ci = $('codeInput'); if (ci) ci.onkeydown = e => { if (e.key === 'Enter') $('joinBtn').click(); };
  on('createBtn', () => { const n = getName(); if (!n) return; ok(); createRoom(n); });
  on('shareBtn', async () => {
    const link = joinLink();
    try { if (navigator.share) await navigator.share({ title: 'מי המתחזה?', text: 'בואו לשחק! קוד חדר: ' + roomCode, url: link }); else { await navigator.clipboard.writeText(link); announce('הקישור הועתק'); err = ''; status = ''; render(true); } } catch (e) {}
  });
  on('startBtn', () => {
    if ($('startBtn').getAttribute('aria-disabled') === 'true') { fail(`צריך לפחות ${st.minPlayers} שחקנים כדי להתחיל. שתפו את הקוד עם עוד חברים.`, 'startBtn'); return; }
    ok(); send('start');
  });
  on('againBtn', () => send('again'));
  on('lobbyBtn', () => send('lobby'));
  on('resetBtn', () => send('resetScores'));
  on('leaveBtn', () => { leaveConfirm = true; render(true); const y = $('leaveNo'); if (y) y.focus(); });
  on('leaveNo', () => { leaveConfirm = false; render(true); const b = $('leaveBtn'); if (b) b.focus(); });
  on('leaveYes', leaveGame);
  on('seenBtn', () => { cardOpen = false; send('seen'); });
  on('skipBtn', () => send('discuss'));
  on('voteBtn', () => send('toVote'));
  on('endVoteBtn', () => send('endVote'));
  const gi = $('guessInput');
  if (gi) {
    gi.oninput = () => { guessDraft = gi.value; if (guessConfirm) { guessConfirm = false; render(true); $('guessInput').focus(); } };
    gi.onkeydown = e => { if (e.key === 'Enter' && $('guessBtn')) $('guessBtn').click(); };
  }
  on('guessBtn', () => {
    guessDraft = ($('guessInput').value || '').trim();
    if (!guessDraft) { fail('צריך לכתוב ניחוש לפני ששולחים.', 'guessInput'); return; }
    ok(); guessConfirm = true; render(true); $('guessGo').focus();
  });
  on('guessCancel', () => { guessConfirm = false; render(true); $('guessInput').focus(); });
  on('guessGo', () => { guessConfirm = false; send('guess', { text: guessDraft }); guessDraft = ''; });
  on('approveBtn', () => send('approveGuess'));
  const toggleCard = () => { cardOpen = !cardOpen; flipNow = cardOpen; render(true); flipNow = false; };
  document.querySelectorAll('[data-cardbtn]').forEach(b => b.onclick = toggleCard);
  document.querySelectorAll('[data-card]').forEach(c => c.onclick = (e) => { if (!e.target.closest('button')) toggleCard(); });
  document.querySelectorAll('[data-speak]').forEach(b => b.onclick = (e) => { e.stopPropagation(); speak(b.dataset.speak); });
  document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => send('kick', { id: b.dataset.kick }));
  document.querySelectorAll('[data-vote]').forEach(b => b.onclick = () => send('vote', { target: b.dataset.vote }));
  document.querySelectorAll('input[name=hint]').forEach(i => i.onchange = () => send('settings', { hint: i.value === '1' }));
  document.querySelectorAll('input[name=pics]').forEach(i => i.onchange = () => send('settings', { pictures: i.value === '1' }));
  document.querySelectorAll('input[name=imp]').forEach(i => i.onchange = () => send('settings', { imposters: +i.value }));
  const cs = $('catSel'); if (cs) cs.onchange = () => send('settings', { category: cs.value });
  document.querySelectorAll('details').forEach(d => {
    const k = d.id || d.querySelector('summary').textContent;
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
