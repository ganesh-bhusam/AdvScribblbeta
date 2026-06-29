/**
 * Skribbl Premium — Backend E2E tests (HTTP + Socket.io).
 * Run: node backend/tests/backend_test.js
 * Uses REACT_APP_BACKEND_URL from /app/frontend/.env (read manually).
 */
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

// --- Load REACT_APP_BACKEND_URL from frontend .env or fallback ---
let BASE_URL = 'http://localhost:8001';
try {
  const possiblePaths = [
    '/app/frontend/.env',
    path.join(__dirname, '../../frontend/.env'),
    path.join(__dirname, '../frontend/.env')
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      const envText = fs.readFileSync(p, 'utf8');
      const match = envText.match(/REACT_APP_BACKEND_URL=(.+)/);
      if (match && match[1]) {
        BASE_URL = match[1].trim();
        break;
      }
    }
  }
} catch (e) {}
console.log('BASE_URL:', BASE_URL);

const results = [];
function record(name, ok, info = '') {
  results.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} - ${name}${info ? ' :: ' + info : ''}`);
}
async function http(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    if (body instanceof URLSearchParams) { init.body = body.toString(); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    else init.body = JSON.stringify(body);
  }
  const r = await fetch(BASE_URL + p, init);
  let data = null;
  const txt = await r.text();
  try { data = JSON.parse(txt); } catch { data = txt; }
  return { status: r.status, data };
}

function rid() { return Math.random().toString(36).slice(2, 10); }

(async () => {
  // -- AUTH FLOW --
  // unique signup
  const username = 'TEST_' + rid();
  const email = `test_${rid()}@x.dev`;
  let signup = await http('POST', '/api/auth/signup', { name: 'TEST User', username, email, password: 'secret123' });
  record('signup 201 + token', signup.status === 201 && !!signup.data?.token && signup.data?.user?.has_premium === false, `status=${signup.status}`);
  const token = signup.data?.token;
  const userId = signup.data?.user?.id;

  // duplicate username
  const dupU = await http('POST', '/api/auth/signup', { name: 'X', username, email: `x_${rid()}@x.dev`, password: 'secret123' });
  record('signup duplicate username -> 409', dupU.status === 409, `status=${dupU.status}`);
  // duplicate email
  const dupE = await http('POST', '/api/auth/signup', { name: 'X', username: 'TEST_' + rid(), email, password: 'secret123' });
  record('signup duplicate email -> 409', dupE.status === 409, `status=${dupE.status}`);
  // short password
  const shortP = await http('POST', '/api/auth/signup', { name: 'X', username: 'TEST_' + rid(), email: `s_${rid()}@x.dev`, password: '123' });
  record('signup short password -> 400', shortP.status === 400, `status=${shortP.status}`);
  // invalid email
  const badE = await http('POST', '/api/auth/signup', { name: 'X', username: 'TEST_' + rid(), email: 'notanemail', password: 'secret123' });
  record('signup invalid email -> 400', badE.status === 400, `status=${badE.status}`);

  // login correct
  const lg = await http('POST', '/api/auth/login', { username, password: 'secret123' });
  record('login correct -> 200 + token', lg.status === 200 && !!lg.data?.token, `status=${lg.status}`);
  // login wrong pw
  const lgw = await http('POST', '/api/auth/login', { username, password: 'wrongpass' });
  record('login wrong pw -> 401', lgw.status === 401, `status=${lgw.status}`);

  // /me with token
  const me1 = await http('GET', '/api/auth/me', null, token);
  record('/me with token -> 200', me1.status === 200 && me1.data?.user?.username === username, `status=${me1.status}`);
  // /me without token
  const me0 = await http('GET', '/api/auth/me');
  record('/me without token -> 401', me0.status === 401, `status=${me0.status}`);

  // -- LANGUAGES --
  const langs = await http('GET', '/api/languages');
  const list = langs.data?.languages || [];
  const names = list.map(l => l.name);
  const need = ['English','Hinglish','Tamiglish','Teluglish','Benglish','Marathiglish','Gujaratinglish','Kannadaglish','Malayalaglish'];
  const allPresent = need.every(n => names.includes(n));
  record('languages: 9 langs incl required', list.length === 9 && allPresent, `count=${list.length} names=${names.join(',')}`);

  // -- /api/play --
  const playRes = await http('POST', '/api/play', new URLSearchParams({ lang: '0' }));
  record('POST /api/play lang=0 -> roomId + type=0', playRes.status === 200 && !!playRes.data?.roomId && playRes.data?.type === 0, `status=${playRes.status} body=${JSON.stringify(playRes.data)}`);

  // -- /api/private --
  const privRes = await http('POST', '/api/private', new URLSearchParams({ lang: '0' }));
  record('POST /api/private -> roomId', privRes.status === 200 && !!privRes.data?.roomId, `status=${privRes.status}`);

  // -- /api/payment/config --
  const pcfg = await http('GET', '/api/payment/config');
  const cfg = pcfg.data || {};
  record('payment/config returns expected fields', pcfg.status === 200 && cfg.mock === true && cfg.amount === 2500 && cfg.currency === 'INR' && !!cfg.keyId && !!cfg.productName, `cfg=${JSON.stringify(cfg)}`);

  // -- /api/payment/order (auth) --
  const ord = await http('POST', '/api/payment/order', {}, token);
  const orderId = ord.data?.orderId;
  record('payment/order MOCK -> orderId starts order_mock_', ord.status === 200 && typeof orderId === 'string' && orderId.startsWith('order_mock_'), `orderId=${orderId}`);

  // -- /api/payment/verify (auth) --
  const ver = await http('POST', '/api/payment/verify', { razorpay_order_id: orderId }, token);
  record('payment/verify MOCK -> success', ver.status === 200 && ver.data?.success === true, `data=${JSON.stringify(ver.data)}`);

  // verify premium granted via /me
  const me2 = await http('GET', '/api/auth/me', null, token);
  const adUntilOk = !!me2.data?.user?.ad_free_until;
  let months = 0;
  if (adUntilOk) {
    const t = new Date(me2.data.user.ad_free_until).getTime();
    months = (t - Date.now()) / (30 * 24 * 3600 * 1000);
  }
  record('/me shows has_premium=true after verify', me2.data?.user?.has_premium === true && adUntilOk && months > 5 && months < 7, `premium=${me2.data?.user?.has_premium} adFreeMonths=${months.toFixed(2)}`);

  // -- /api/terms /api/credits --
  const terms = await http('GET', '/api/terms');
  record('/api/terms returns HTML', terms.status === 200 && typeof terms.data === 'string' && terms.data.includes('Terms of Service'), `status=${terms.status}`);
  const credits = await http('GET', '/api/credits');
  record('/api/credits returns HTML', credits.status === 200 && typeof credits.data === 'string' && credits.data.includes('Credits'), `status=${credits.status}`);

  // -- SOCKET.IO TESTS --
  // 1. Without token => rejected
  await new Promise((resolve) => {
    const s = io(BASE_URL, { path: '/api/socket.io/', transports: ['websocket'], reconnection: false, timeout: 5000 });
    s.on('connect', () => { record('socket no-token rejected', false, 'connected without token'); s.disconnect(); resolve(); });
    s.on('connect_error', (err) => { record('socket no-token rejected', String(err.message).includes('AUTH_REQUIRED'), `err=${err.message}`); resolve(); });
    setTimeout(() => { record('socket no-token rejected (timeout)', false, 'no event'); s.disconnect(); resolve(); }, 6000);
  });

  // helper to connect + login
  function connect(tkn) {
    return io(BASE_URL, { path: '/api/socket.io/', transports: ['websocket'], reconnection: false, timeout: 5000, auth: { token: tkn } });
  }

  // 2. Connect with valid token + login (public room), capture id=10
  const owner = await new Promise((resolve) => {
    const s = connect(token);
    let lobby = null;
    s.on('connect_error', (e) => { console.log('connect_err', e.message); });
    s.on('connect', () => s.emit('login', { lang: 0, name: 'Owner', avatar: [0,0,0,-1] }));
    s.on('data', (msg) => {
      if (msg.id === 10 && !lobby) { lobby = msg.data; record('socket login -> data id=10 lobby init', !!lobby?.id && Array.isArray(lobby?.users), `roomId=${lobby?.id} owner=${lobby?.owner}`); resolve({ socket: s, lobby }); }
    });
    setTimeout(() => { record('socket login id=10 (timeout)', false, 'no lobby received'); resolve({ socket: s, lobby: null }); }, 7000);
  });

  // Owner flags & 4
  if (owner.lobby) {
    const me = owner.lobby.users.find(u => u.id === owner.lobby.me);
    record('owner flags include & 4', !!me && (me.flags & 4) === 4, `flags=${me?.flags}`);
  }

  // 3. Second user joins SAME public lang -> same room, others get id=1 broadcast
  // Create a second user
  const u2name = 'TEST_' + rid();
  const su2 = await http('POST', '/api/auth/signup', { name: 'U2', username: u2name, email: `${u2name}@x.dev`, password: 'secret123' });
  const tk2 = su2.data?.token;
  const joined = await new Promise((resolve) => {
    const s2 = connect(tk2);
    let gotLobby = false;
    let ownerSawJoin = false;
    owner.socket.on('data', (msg) => { if (msg.id === 1) ownerSawJoin = true; });
    s2.on('connect', () => s2.emit('login', { lang: 0, name: 'Player2', avatar: [1,1,1,-1] }));
    s2.on('data', (msg) => {
      if (msg.id === 10 && !gotLobby) {
        gotLobby = true;
        const sameRoom = msg.data?.id === owner.lobby?.id;
        record('two users same public lang -> same room', sameRoom, `roomA=${owner.lobby?.id} roomB=${msg.data?.id}`);
        setTimeout(() => {
          record('owner received id=1 player-joined broadcast', ownerSawJoin, `sawJoin=${ownerSawJoin}`);
          s2.disconnect();
          resolve();
        }, 500);
      }
    });
    setTimeout(() => { if (!gotLobby) { record('second user join lobby (timeout)', false); s2.disconnect(); resolve(); } }, 7000);
  });

  // 4. Disconnect owner public socket (cleanup)
  owner.socket?.disconnect();
  await new Promise(r => setTimeout(r, 300));

  // 5. PRIVATE ROOM: create + bot spawn + start game
  const priv = await new Promise((resolve) => {
    const s = connect(token);
    let lobby = null;
    s.on('connect', () => s.emit('login', { lang: 0, create: 1, name: 'PrivOwner' }));
    s.on('data', (msg) => {
      if (msg.id === 10 && !lobby) {
        lobby = msg.data;
        record('private room created via login{create:1} type=1', lobby?.type === 1, `type=${lobby?.type}`);
        resolve({ socket: s, lobby });
      }
    });
    setTimeout(() => { if (!lobby) { record('private room created (timeout)', false); resolve({ socket: s, lobby: null }); } }, 6000);
  });

  // Spawn bot (custom packet 50)
  await new Promise((resolve) => {
    let sawBot = false;
    const onMsg = (msg) => {
      if (msg.id === 1 && msg.data?.name && /\#\d+/.test(msg.data.name)) {
        sawBot = true;
        record('bot spawn via {id:50} -> id=1 player joined with bot-like name', true, `botName=${msg.data.name}`);
        priv.socket.off('data', onMsg);
        resolve();
      }
    };
    priv.socket.on('data', onMsg);
    priv.socket.emit('data', { id: 50 });
    setTimeout(() => { if (!sawBot) { record('bot spawn via {id:50}', false, 'no id=1 broadcast'); priv.socket.off('data', onMsg); resolve(); } }, 4000);
  });

  // Start game with bot (need 2 players: owner + bot)
  await new Promise((resolve) => {
    let sawK = false, sawF = false, sawV = false, drawerWords = null, nonDrawerNoWords = null;
    const onMsg = (msg) => {
      if (msg.id === 11) {
        if (msg.data?.id === 1) sawK = true;     // K state
        if (msg.data?.id === 2) sawF = true;     // F state
        if (msg.data?.id === 3) {                 // V state
          sawV = true;
          // If this socket is the drawer, payload will contain words
          if (msg.data?.data?.words) drawerWords = msg.data.data.words;
          else nonDrawerNoWords = !msg.data?.data?.words;
        }
      }
    };
    priv.socket.on('data', onMsg);
    priv.socket.emit('data', { id: 22 }); // start
    setTimeout(() => {
      // Owner here is the drawer since only 2 players & bots get random pick. The owner socket should have received drawer V state because state V either drawer or guesser. If owner is drawer, drawerWords set. If bot is drawer, owner gets non-drawer V (no words).
      const transitions = sawK && sawF && sawV;
      record('start game -> state K -> F -> V transitions', transitions, `K=${sawK} F=${sawF} V=${sawV}`);
      record('V state delivers words to drawer OR non-drawer (one of both)', drawerWords?.length === 3 || nonDrawerNoWords === true, `drawerWords=${drawerWords?.length} nonDrawerNoWords=${nonDrawerNoWords}`);
      priv.socket.off('data', onMsg);
      priv.socket.disconnect();
      resolve();
    }, 6500);
  });

  // Final summary
  const passed = results.filter(r => r.ok).length;
  const total = results.length;
  console.log(`\nSummary: ${passed}/${total} passed`);

  // Write JSON
  const outPath = '/app/test_reports/pytest/backend_test_results.json';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ passed, total, results }, null, 2));
  process.exit(passed === total ? 0 : 1);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
