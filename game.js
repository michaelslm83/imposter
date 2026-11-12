// מי המתחזה? – גרסת GitHub Pages
// הטלפון של המנהל מחזיק את המשחק, ושאר הטלפונים מתחברים אליו ישירות (PeerJS).

const MIN_PLAYERS = 3;
const PREFIX = 'mi-hamitchaze-il-';

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
const conns = new Map(); // conn -> playerId

function newState() {
  return {
    players: {}, order: [], hostId: me, phase: 'lobby',
    settings: { hint: true, imposters: 1, category: 'הכול' },
    round: null, used: [], scores: {}, roundNo: 0,
  };
}
const rint = (n) => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const isOnline = (id) => id === S.hostId || [...conns.values()].includes(id);
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

function finishVote() {
  const r = S.round, tally = {};
  Object.values(r.votes).forEach(t => { tally[t] = (tally[t] || 0) + 1; });
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter(k => tally[k] === max);
  const caught = max > 0 && top.length === 1 && r.imposters.includes(top[0]);
  r.result = { tally, top: max > 0 ? top : [], caught };
  r.playerIds.forEach(id => { S.scores[id] = S.scores[id] || 0; });
  if (caught) r.playerIds.filter(id => !r.imposters.includes(id)).forEach(id => S.scores[id]++);
  else r.imposters.forEach(id => S.scores[id] += 2);
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
    for (const [c, pid] of conns) if (pid === b.id) { try { c.send({ type: 'kicked' }); } catch (e) {} setTimeout(() => c.close(), 300); }
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
};

function view(pid) {
  const name = (id) => (S.players[id] ? S.players[id].name : '?');
  const out = {
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
          caught: r.result.caught, top: r.result.top.map(name),
          tally: r.playerIds.map(id => ({ name: name(id), votes: r.result.tally[id] || 0, imposter: r.imposters.includes(id) })).sort((a, b) => b.votes - a.votes),
        },
      });
    }
  }
  return out;
}

function broadcast() {
  try { localStorage.setItem('imp_host_state', JSON.stringify({ code: roomCode, S, t: Date.now() })); } catch (e) {}
  for (const [c, pid] of conns) if (pid && c.open) { try { c.send({ type: 'state', st: view(pid) }); } catch (e) {} }
  st = view(me); render(true);
}

function hostAction(pid, action, body, conn) {
  try {
    if (!actions[action]) throw 'פעולה לא קיימת';
    if (action !== 'join' && !S.players[pid]) throw 'צריך להצטרף קודם';
    actions[action](pid, body || {});
    if (conn && action === 'join') conns.set(conn, pid);
    broadcast();
  } catch (e) {
    const msg = typeof e === 'string' ? e : 'שגיאה';
    if (conn) { try { conn.send({ type: 'error', msg }); } catch (x) {} } else { err = msg; render(true); }
  }
}

// =====================================================================
//                              רשת
// =====================================================================
let peer = null, hostConn = null, roomCode = null, role = null; // role: 'host' | 'guest'
let st = null, err = '', status = '', cardOpen = false, lastKey = '', lastRound = -1;
const openDetails = new Set();

function makePeer(id) {
  return new Peer(id, { debug: 0 });
}

function createRoom(name, code, restored) {
  role = 'host';
  roomCode = code || String(1000 + rint(9000));
  status = 'יוצר חדר…'; render(true);
  peer = makePeer(PREFIX + roomCode);
  peer.on('open', () => {
    status = '';
    if (!restored) { S = newState(); actions.join(me, { name }); }
    S.hostId = me;
    sessionStorage.setItem('imp_session', JSON.stringify({ role: 'host', code: roomCode, name }));
    history.replaceState(null, '', location.pathname + '?room=' + roomCode);
    broadcast();
  });
  peer.on('connection', (c) => {
    c.on('data', (d) => { if (d && d.type === 'action') hostAction(d.id, d.action, d.body, c); });
    c.on('close', () => { conns.delete(c); broadcast(); });
    c.on('error', () => { conns.delete(c); broadcast(); });
    conns.set(c, null);
  });
  peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  peer.on('error', (e) => {
    if (e.type === 'unavailable-id') {
      peer.destroy();
      if (restored) { status = ''; err = 'החדר הקודם כבר לא זמין – נוצר חדר חדש'; createRoom(name, null, true); }
      else createRoom(name, null, false);
    } else if (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error') {
      err = 'בעיה בחיבור לאינטרנט'; render(true);
    }
  });
}

function joinRoom(name, code) {
  role = 'guest'; roomCode = code;
  status = 'מתחבר לחדר ' + code + '…'; err = ''; render(true);
  if (!peer || peer.destroyed) {
    peer = makePeer();
    peer.on('error', (e) => {
      if (e.type === 'peer-unavailable') { status = ''; err = 'לא נמצא חדר עם הקוד ' + roomCode + '. בדקו את הקוד.'; st = null; role = null; render(true); }
      else if (e.type === 'network' || e.type === 'server-error') { err = 'בעיה בחיבור לאינטרנט'; render(true); }
    });
    peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) {} });
  }
  const go = () => {
    hostConn = peer.connect(PREFIX + code, { reliable: true });
    hostConn.on('open', () => {
      status = '';
      sessionStorage.setItem('imp_session', JSON.stringify({ role: 'guest', code, name }));
      history.replaceState(null, '', location.pathname + '?room=' + code);
      send('join', { name });
    });
    hostConn.on('data', (d) => {
      if (d.type === 'state') { st = d.st; if (err && !err.startsWith('השם')) err = ''; render(false); }
      else if (d.type === 'error') {
        err = d.msg;
        if (!st || !st.joined) { st = null; role = null; sessionStorage.removeItem('imp_session'); hostConn.close(); }
        render(true);
      } else if (d.type === 'kicked') { sessionStorage.removeItem('imp_session'); role = null; st = null; err = 'הוצאת מהמשחק'; render(true); }
    });
    hostConn.on('close', () => {
      if (role !== 'guest') return;
      status = 'החיבור למנהל נותק… מנסה שוב'; render(true);
      setTimeout(() => { if (role === 'guest') joinRoom(name, code); }, 2500);
    });
  };
  if (peer.open) go(); else peer.once('open', go);
}

function send(action, body = {}) {
  if (role === 'host') hostAction(me, action, body, null);
  else if (hostConn && hostConn.open) hostConn.send({ type: 'action', id: me, action, body });
  else { err = 'אין חיבור למנהל'; render(true); }
}

// =====================================================================
//                              תצוגה
// =====================================================================
const COLORS = ['#ffd23f','#3ddc97','#4cc9f0','#ff9f1c','#c77dff','#ff5d8f','#90e0ef','#b5e48c','#f4a261','#e9c46a','#a0c4ff','#ffadad'];
const app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const color = (id) => { const i = st.players.findIndex(p => p.id === id); return COLORS[(i < 0 ? 0 : i) % COLORS.length]; };
const avatar = (p) => `<span class="av" style="background:${color(p.id)}">${esc(p.name[0] || '?')}</span>`;
const joinLink = () => location.origin + location.pathname + '?room=' + roomCode;

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
    <div class="note" style="margin:0">מי שפותח את החדר הוא המנהל. הטלפון שלו צריך להישאר פתוח על המשחק.</div>
    <button id="createBtn" class="green">✨ פתיחת חדר חדש</button>
  </div>
  ${rulesPanel()}`;
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
  ${st.isHost ? '<button id="voteBtn" class="pink">🗳️ עוברים להצבעה</button>' : '<div class="note">המנהל יעביר להצבעה כשתהיו מוכנים</div>'}`;
}

function voteView() {
  const r = st.round;
  let h = `<div class="panel"><h2>🗳️ מי ${r.impCount > 1 ? 'אחד המתחזים' : 'המתחזה'}?</h2>
    <div class="vote-list">${r.candidates.filter(c => c.id !== me).map(c =>
      `<button data-vote="${c.id}" class="${r.myVote === c.id ? 'sel' : ''}">${avatar(c)} ${esc(c.name)} ${r.myVote === c.id ? ' ✔' : ''}</button>`).join('')}</div>
    <div class="progress"><div style="width:${100 * r.votedCount / r.total}%"></div></div>
    <div class="note">${r.votedCount} מתוך ${r.total} הצביעו${r.myVote ? ' · אפשר לשנות עד שכולם מצביעים' : ''}</div></div>`;
  if (st.isHost) h += `<button class="ghost" id="endVoteBtn">לסיים הצבעה עכשיו</button>`;
  return h;
}

function resultsView() {
  const r = st.round, res = r.result;
  const win = (r.card && r.card.imposter) ? !res.caught : res.caught;
  let h = `<div class="banner ${res.caught ? 'win' : 'lose'}">${res.caught ? '🎉 תפסתם את המתחזה!' : '😈 המתחזה ניצח!'}</div>
    <div class="panel big">${win ? '🏆 ניצחת בסיבוב הזה!' : '💪 בפעם הבאה!'}</div>
    <div class="panel reveal-word">המילה הייתה <b>${esc(r.word)}</b>(${esc(r.category)})
      <p>🕵️ ${r.imposterNames.length > 1 ? 'המתחזים היו' : 'המתחזה היה/תה'}: <b style="font-size:1.5rem;display:inline;color:var(--pink)">${r.imposterNames.map(esc).join(' ו')}</b></p></div>
    <div class="panel"><h2>תוצאות ההצבעה</h2><ul class="players tally">${res.tally.map(t =>
      `<li><span class="nm">${t.imposter ? '🕵️ ' : ''}${esc(t.name)}</span><span class="v">${t.votes} קולות</span></li>`).join('')}</ul>
      ${!res.caught && res.top.length > 1 ? '<div class="note">היה תיקו – אז המתחזה חמק!</div>' : ''}</div>
    <div class="panel"><h2>⭐ ניקוד</h2>${playersList(false)}<div class="note">תפסתם את המתחזה = נקודה לכל השאר · המתחזה חמק = 2 נקודות למתחזה</div></div>`;
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
  </ol></details>`;
}

function leaveGame() {
  if (role === 'host') {
    if (!confirmLeave()) return;
    for (const c of conns.keys()) { try { c.send({ type: 'kicked' }); } catch (e) {} }
    localStorage.removeItem('imp_host_state');
  } else send('leave');
  sessionStorage.removeItem('imp_session');
  role = null; st = null; S = null;
  setTimeout(() => { if (peer) peer.destroy(); peer = null; hostConn = null; history.replaceState(null, '', location.pathname); render(true); }, 300);
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
  if (typeof Peer === 'undefined') { err = 'לא הצלחתי לטעון את רכיב החיבור – בדקו חיבור לאינטרנט ורעננו'; render(true); return; }
  let sess = null;
  try { sess = JSON.parse(sessionStorage.getItem('imp_session')); } catch (e) {}
  if (sess && sess.role === 'host') {
    let saved = null; try { saved = JSON.parse(localStorage.getItem('imp_host_state')); } catch (e) {}
    if (saved && saved.code === sess.code && Date.now() - saved.t < 6 * 3600e3) { S = saved.S; createRoom(sess.name, sess.code, true); return; }
  }
  if (sess && sess.role === 'guest') { joinRoom(sess.name, sess.code); return; }
  render(true);
})();
