/**
 * AdvScribbl iteration-2 backend tests — moderation, votekick, rating, custom words, spam, close-guess.
 * Run: cd /app/backend && node tests/backend_test_v2.js
 * Reads REACT_APP_BACKEND_URL from /app/frontend/.env.
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
const record = (name, ok, info='') => { results.push({name, ok, info}); console.log(`${ok?'PASS':'FAIL'} - ${name}${info?' :: '+info:''}`); };
const rid = () => Math.random().toString(36).slice(2,10);
const sleep = (ms) => new Promise(r => setTimeout(r,ms));

async function http(method, p, body, token) {
  const headers = {'Content-Type':'application/json'};
  if (token) headers.Authorization = `Bearer ${token}`;
  const init = { method, headers };
  if (body !== undefined && body !== null) {
    if (body instanceof URLSearchParams) { init.body = body.toString(); headers['Content-Type']='application/x-www-form-urlencoded'; }
    else init.body = JSON.stringify(body);
  }
  const r = await fetch(BASE_URL+p, init);
  const txt = await r.text(); let data=null; try{data=JSON.parse(txt);}catch{data=txt;}
  return { status: r.status, data };
}

async function signup(prefix='TEST_') {
  const username = prefix + rid();
  const email = `${username}@x.dev`;
  const r = await http('POST','/api/auth/signup',{name:username,username,email,password:'secret123'});
  if (r.status !== 201) throw new Error('signup fail '+r.status+' '+JSON.stringify(r.data));
  return { username, token: r.data.token, userId: r.data.user.id };
}

function connect(token) {
  return io(BASE_URL, { path:'/api/socket.io/', transports:['websocket'], reconnection:false, timeout:6000, auth:{ token } });
}

// Login a single socket and resolve when first id:10 lobby arrives.
function loginSocket(token, loginPayload, dataHandler) {
  return new Promise((resolve,reject) => {
    const s = connect(token);
    let lobby = null;
    const allMessages = [];
    s.on('connect_error', e => { console.log('  ! connect_error', e.message); });
    s.on('connect', () => s.emit('login', loginPayload));
    s.on('data', (msg) => {
      allMessages.push(msg);
      if (msg.id === 10 && !lobby) { lobby = msg.data; resolve({socket:s, lobby, messages: allMessages}); }
      if (dataHandler) dataHandler(msg);
    });
    s.on('joinerr', (code) => { resolve({ socket:s, lobby:null, joinerr:code, messages: allMessages }); });
    setTimeout(() => { if (!lobby) resolve({socket:s, lobby:null, messages: allMessages}); }, 8000);
  });
}

function collect(socket, predicate, ms=2000) {
  return new Promise((resolve) => {
    const found = [];
    const h = (msg) => { if (predicate(msg)) found.push(msg); };
    socket.on('data', h);
    setTimeout(() => { socket.off('data', h); resolve(found); }, ms);
  });
}

(async () => {
  try {
    // ---------- Regression: payment config in LIVE TEST mode ----------
    const cfg = await http('GET','/api/payment/config');
    record('payment/config mock=false (LIVE TEST keys)',
      cfg.status === 200 && cfg.data?.mock === false && typeof cfg.data?.keyId === 'string' && cfg.data.keyId.startsWith('rzp_test_'),
      `cfg=${JSON.stringify(cfg.data)}`);

    const u0 = await signup('TEST_');
    const ord = await http('POST','/api/payment/order',{},u0.token);
    record('payment/order LIVE -> real order_id (starts order_)',
      ord.status === 200 && typeof ord.data?.orderId === 'string' && ord.data.orderId.startsWith('order_') && !ord.data.orderId.startsWith('order_mock_'),
      `orderId=${ord.data?.orderId} status=${ord.status} mock=${ord.data?.mock}`);

    // Verify with bad signature -> should fail
    const verBad = await http('POST','/api/payment/verify',
      { razorpay_order_id: ord.data?.orderId, razorpay_payment_id:'pay_FAKE', razorpay_signature:'deadbeef' }, u0.token);
    record('payment/verify with bogus signature rejected', verBad.status === 400 || verBad.data?.success === false,
      `status=${verBad.status} data=${JSON.stringify(verBad.data)}`);

    // ---------- Sign up 3 users: owner, victim, voter ----------
    const owner = await signup('TEST_O_');
    const victim = await signup('TEST_V_');
    const voter  = await signup('TEST_W_');

    // =====================================================================
    // PART 1 — Private room: owner kick + ban (id:3, id:4)
    // =====================================================================
    const oS = await loginSocket(owner.token, { lang:0, create:1, name:'Owner' });
    if (!oS.lobby) { record('owner private lobby init', false); process.exit(2); }
    record('owner private lobby init id=10 type=1', oS.lobby?.type === 1, `roomId=${oS.lobby.id}`);
    const roomId = oS.lobby.id;

    // Victim joins via joinId
    const vS = await loginSocket(victim.token, { lang:0, join: roomId, name:'Victim' });
    record('victim joined same private room', vS.lobby?.id === roomId, `lobby=${vS.lobby?.id}`);
    const victimPlayerId = vS.lobby?.me;

    // Capture id:2 broadcast on owner socket AND id:100 on victim socket
    let ownerSawRemove = null;
    let victimSawKick = null;
    let victimDisconnected = false;
    oS.socket.on('data', m => { if (m.id === 2) ownerSawRemove = m.data; });
    vS.socket.on('data', m => { if (m.id === 100) victimSawKick = m.data; });
    vS.socket.on('disconnect', () => { victimDisconnected = true; });

    // Owner emits kick (id:3)
    oS.socket.emit('data', { id:3, data: victimPlayerId });
    await sleep(800);
    record('owner kick -> id=2 broadcast with reason=1',
      ownerSawRemove && ownerSawRemove.id === victimPlayerId && ownerSawRemove.reason === 1,
      `broadcast=${JSON.stringify(ownerSawRemove)}`);
    record('victim received private id=100 value=1',
      victimSawKick === 1, `gotId100=${victimSawKick}`);
    record('victim socket disconnected after kick', victimDisconnected, `disconnected=${victimDisconnected}`);

    // Victim tries to rejoin -> joinerr code 3
    const vRejoin = await loginSocket(victim.token, { lang:0, join: roomId, name:'VictimAgain' });
    record('kicked user rejoin blocked (joinerr=3)',
      vRejoin.lobby == null && vRejoin.joinerr === 3, `joinerr=${vRejoin.joinerr}`);
    vRejoin.socket?.disconnect();

    // ---- BAN (id:4) ----
    const banee = await signup('TEST_B_');
    const bS = await loginSocket(banee.token, { lang:0, join: roomId, name:'Banee' });
    record('banee joined room', bS.lobby?.id === roomId);
    const baneePlayerId = bS.lobby?.me;

    let ownerSawBanRemove = null;
    let baneeSawBan = null;
    oS.socket.on('data', m => { if (m.id === 2 && m.data?.id === baneePlayerId) ownerSawBanRemove = m.data; });
    bS.socket.on('data', m => { if (m.id === 100) baneeSawBan = m.data; });
    oS.socket.emit('data', { id:4, data: baneePlayerId });
    await sleep(800);
    record('owner ban -> id=2 reason=2',
      ownerSawBanRemove && ownerSawBanRemove.reason === 2, `bcast=${JSON.stringify(ownerSawBanRemove)}`);
    record('banee received id=100 value=2', baneeSawBan === 2, `val=${baneeSawBan}`);
    const bRejoin = await loginSocket(banee.token, { lang:0, join: roomId, name:'BaneeAgain' });
    record('banned user rejoin blocked (joinerr=4)',
      bRejoin.lobby == null && bRejoin.joinerr === 4, `joinerr=${bRejoin.joinerr}`);
    bRejoin.socket?.disconnect();

    // ---- NON-OWNER trying id:3 / id:4 is ignored ----
    const stranger = await signup('TEST_S_');
    const sS = await loginSocket(stranger.token, { lang:0, join: roomId, name:'Stranger' });
    record('stranger joined', sS.lobby?.id === roomId);

    // Add a 2nd victim
    const target2 = await signup('TEST_T_');
    const t2S = await loginSocket(target2.token, { lang:0, join: roomId, name:'Target2' });
    const target2PlayerId = t2S.lobby?.me;
    let target2Removed = false;
    t2S.socket.on('disconnect', () => { target2Removed = true; });
    // Stranger (non-owner) tries to kick + ban target2
    sS.socket.emit('data', { id:3, data: target2PlayerId });
    sS.socket.emit('data', { id:4, data: target2PlayerId });
    await sleep(600);
    record('non-owner id:3/id:4 ignored (target2 still connected)',
      !target2Removed, `removed=${target2Removed}`);

    // Cleanup
    sS.socket.disconnect();
    t2S.socket.disconnect();
    oS.socket.disconnect();
    await sleep(400);

    // =====================================================================
    // PART 2 — Custom words + start (id:22) in private room
    // =====================================================================
    const cwOwner = await signup('TEST_CW_');
    const cwO = await loginSocket(cwOwner.token, { lang:0, create:1, name:'CWOwner' });
    record('cw owner lobby init', !!cwO.lobby, `room=${cwO.lobby?.id}`);
    const cwRoomId = cwO.lobby?.id;

    const cwOther = await signup('TEST_CW2_');
    const cwG = await loginSocket(cwOther.token, { lang:0, join: cwRoomId, name:'CWGuesser' });
    record('cw guesser joined', cwG.lobby?.id === cwRoomId);

    // capture id:12 settings broadcast (custom-only flag) + id:11 V state with drawer words
    let saw12_idx7 = null;
    let drawerWordsV = null;   // words on drawer's V payload
    let v11Count = 0;
    cwO.socket.on('data', m => {
      if (m.id === 12 && m.data?.id === 7) saw12_idx7 = m.data.val;
      if (m.id === 11 && m.data?.id === 3 && m.data?.data?.words) { drawerWordsV = m.data.data.words; v11Count++; }
    });
    cwG.socket.on('data', m => {
      if (m.id === 11 && m.data?.id === 3 && m.data?.data?.words) { drawerWordsV = m.data.data.words; }
    });

    const customCsv = 'pineapple,zebra,octopus,satellite,zeppelin';
    cwO.socket.emit('data', { id:22, data: { words: customCsv, useOnly: 1 } });

    // Wait for K -> F -> V (~7s)
    await sleep(7500);

    record('id=22 with custom words -> id:12 {id:7,val:1} broadcast',
      saw12_idx7 === 1, `val=${saw12_idx7}`);
    const wordsArr = drawerWordsV || [];
    const customSet = new Set(customCsv.split(','));
    const allFromCustom = wordsArr.length === 3 && wordsArr.every(w => customSet.has(String(w).toLowerCase()));
    record('drawer V state words exclusively from custom list (useOnly=1)',
      allFromCustom, `words=${JSON.stringify(wordsArr)}`);

    cwO.socket.disconnect();
    cwG.socket.disconnect();
    await sleep(400);

    // =====================================================================
    // PART 3 — Votekick (id:5) in PUBLIC room  +  private-room ignore
    // =====================================================================
    const pa = await signup('TEST_PA_');
    const pb = await signup('TEST_PB_');
    const pc = await signup('TEST_PC_');
    const pd = await signup('TEST_PD_');
    // Use lang=8 to get a fresh public room with no leftover bans
    const LANG = 8;
    const paS = await loginSocket(pa.token, { lang: LANG, name:'PA' });
    record('public room owner init', !!paS.lobby, `room=${paS.lobby?.id}`);
    const pubRoomId = paS.lobby?.id;
    const pbS = await loginSocket(pb.token, { lang: LANG, name:'PB' });
    const pcS = await loginSocket(pc.token, { lang: LANG, name:'PC' });
    const pdS = await loginSocket(pd.token, { lang: LANG, name:'PD' });
    const allSame = [pbS,pcS,pdS].every(x => x.lobby?.id === pubRoomId);
    record('4 users in same public room', allSame, `ids=${[paS,pbS,pcS,pdS].map(x=>x.lobby?.id).join(',')}`);

    const paPid = paS.lobby?.me;
    const pbPid = pbS.lobby?.me;
    const pcPid = pcS.lobby?.me;
    const pdPid = pdS.lobby?.me;

    // Self-votekick must be ignored — pb votes pb. No id:5 broadcast.
    let selfBroadcast = 0;
    const selfH = (m) => { if (m.id === 5) selfBroadcast++; };
    pbS.socket.on('data', selfH);
    pbS.socket.emit('data', { id:5, data: pbPid });
    await sleep(400);
    pbS.socket.off('data', selfH);
    record('self-votekick ignored (no id:5)', selfBroadcast === 0, `count=${selfBroadcast}`);

    // Votekick owner must be ignored — pb votes pa(owner).
    let ownerVKBroadcast = 0;
    const ownerH = (m) => { if (m.id === 5) ownerVKBroadcast++; };
    pbS.socket.on('data', ownerH);
    pbS.socket.emit('data', { id:5, data: paPid });
    await sleep(400);
    pbS.socket.off('data', ownerH);
    record('votekick owner ignored', ownerVKBroadcast === 0, `count=${ownerVKBroadcast}`);

    // Real votekick: pb, pc, pd vote pd? No - they vote pc (not owner, not self).
    // eligible = 3 (pa,pb,pd) so required = max(2, ceil(3/2))=2
    let vkBroadcasts = [];
    const vkH = (m) => { if (m.id === 5 && Array.isArray(m.data) && m.data[1] === pcPid) vkBroadcasts.push(m.data); };
    paS.socket.on('data', vkH);
    let pcRemovedBroadcast = null;
    paS.socket.on('data', m => { if (m.id === 2 && m.data?.id === pcPid) pcRemovedBroadcast = m.data; });
    pbS.socket.emit('data', { id:5, data: pcPid });
    await sleep(300);
    pdS.socket.emit('data', { id:5, data: pcPid });
    await sleep(800);
    paS.socket.off('data', vkH);

    record('votekick broadcasts id:5 with [voter,target,count,required]',
      vkBroadcasts.length >= 1 && vkBroadcasts[0].length === 4 && vkBroadcasts[0][3] >= 2,
      `bcasts=${JSON.stringify(vkBroadcasts)}`);
    record('votekick threshold reached -> target removed (id:2)',
      pcRemovedBroadcast?.id === pcPid, `bcast=${JSON.stringify(pcRemovedBroadcast)}`);

    // pc should now be unable to rejoin same public room (kickedUserIds)
    // pcS is also dropped. Try fresh socket with pc credentials joining lang.
    pcS.socket?.disconnect?.();
    await sleep(300);
    const pcRejoin = await loginSocket(pc.token, { lang: LANG, name:'PCagain' });
    const wasMatchedToDifferentRoom = pcRejoin.lobby && pcRejoin.lobby.id !== pubRoomId;
    record('votekicked user gets a NEW public room (not re-matched into old)',
      !!wasMatchedToDifferentRoom, `oldRoom=${pubRoomId} newRoom=${pcRejoin.lobby?.id}`);
    pcRejoin.socket?.disconnect();

    // Votekick must NOT work in private room
    const vkPrivOwner = await signup('TEST_VKP_');
    const vkPrivP2 = await signup('TEST_VKP2_');
    const vkpO = await loginSocket(vkPrivOwner.token, { lang:0, create:1, name:'VKPOwner' });
    const vkpRoom = vkpO.lobby?.id;
    const vkpG = await loginSocket(vkPrivP2.token, { lang:0, join: vkpRoom, name:'VKPGuest' });
    let privVkBroadcast = 0;
    vkpO.socket.on('data', m => { if (m.id === 5) privVkBroadcast++; });
    vkpG.socket.emit('data', { id:5, data: vkpO.lobby.me });
    await sleep(500);
    record('votekick ignored in private room', privVkBroadcast === 0, `count=${privVkBroadcast}`);
    vkpO.socket.disconnect(); vkpG.socket.disconnect();

    // Cleanup remaining public sockets
    paS.socket.disconnect(); pbS.socket.disconnect(); pdS.socket.disconnect();
    await sleep(400);

    // =====================================================================
    // PART 4 — Spam warning (id:32) — private room
    // =====================================================================
    const spOwner = await signup('TEST_SP_');
    const spOther = await signup('TEST_SP2_');
    const spO = await loginSocket(spOwner.token, { lang:0, create:1, name:'SPOwner' });
    const spG = await loginSocket(spOther.token, { lang:0, join: spO.lobby?.id, name:'SPGuest' });

    let spamWarning = null;
    let id30Count = 0;
    spG.socket.on('data', m => { if (m.id === 32) spamWarning = m.data; });
    spO.socket.on('data', m => { if (m.id === 30) id30Count++; });

    // Send 6 messages rapidly (in <3s) -> after 4 the 5th+6th should be dropped.
    for (let i=1; i<=6; i++) { spG.socket.emit('data', { id:30, data: `msg${i}` }); await sleep(40); }
    await sleep(800);
    record('spam: id:32 warning sent to spammer',
      spamWarning && spamWarning.msg && spamWarning.msg.toLowerCase().includes('too fast'),
      `warn=${JSON.stringify(spamWarning)}`);
    record('spam: only first 4 broadcasts as id:30 (5th+ dropped)',
      id30Count === 4, `gotId30=${id30Count}`);

    // After 3s silence reset: send 1 more, should broadcast
    await sleep(3200);
    id30Count = 0;
    spG.socket.emit('data', { id:30, data: 'after_silence' });
    await sleep(600);
    record('spam throttle resets after 3s', id30Count === 1, `gotId30=${id30Count}`);

    spO.socket.disconnect(); spG.socket.disconnect();
    await sleep(300);

    // =====================================================================
    // PART 5 — Rate broadcast (id:8) — needs a drawing state.  And close-guess (id:16).
    // =====================================================================
    const rOwner = await signup('TEST_R_');
    const rGuesser = await signup('TEST_RG_');
    const rO = await loginSocket(rOwner.token, { lang:0, create:1, name:'RDrawer' });
    const rG = await loginSocket(rGuesser.token, { lang:0, join: rO.lobby?.id, name:'RGuesser' });

    // Force owner to be drawer by setting custom words known to us, useOnly=1, then starting and selecting first word
    const knownWords = 'apple,banana,carrot';
    // Capture rating broadcasts received by everyone (rater is guesser; broadcast goes to ALL incl drawer)
    let rateBcastDrawer = null;
    let rateBcastGuesser = null;
    rO.socket.on('data', m => { if (m.id === 8) rateBcastDrawer = m.data; });
    rG.socket.on('data', m => { if (m.id === 8) rateBcastGuesser = m.data; });

    // Capture close-guess id:16 on guesser side
    let closeGuess1 = null, closeGuess2 = null;
    rG.socket.on('data', m => { if (m.id === 16) { if (!closeGuess1) closeGuess1 = m.data; else closeGuess2 = m.data; } });

    // We need to know the actual word once selected. Drawer V payload contains words; j state payload has actual word.
    let drawerActualWord = null;
    let drawerVwords = null;
    rO.socket.on('data', m => {
      if (m.id === 11 && m.data?.id === 3 && m.data?.data?.words) drawerVwords = m.data.data.words;
      if (m.id === 11 && m.data?.id === 4 && m.data?.data?.word && typeof m.data.data.word === 'string') drawerActualWord = m.data.data.word;
    });

    // Start with custom-words useOnly so drawerVwords ∈ knownWords
    rO.socket.emit('data', { id:22, data:{ words: knownWords, useOnly: 1 } });

    // Wait for V state on drawer (3s startup K + F + brief)
    const tStart = Date.now();
    while (!drawerVwords && Date.now()-tStart < 9000) await sleep(150);
    record('rate test: drawer V words received (custom-only)',
      Array.isArray(drawerVwords) && drawerVwords.length >= 1, `words=${JSON.stringify(drawerVwords)}`);

    // Drawer selects index 0 -> enters state j with that word
    if (drawerVwords) {
      rO.socket.emit('data', { id:18, data: 0 });
    }
    // Wait for j state
    const tJ = Date.now();
    while (!drawerActualWord && Date.now()-tJ < 4000) await sleep(150);
    record('drawing state j reached, drawer has actual word',
      typeof drawerActualWord === 'string' && drawerActualWord.length > 0, `word=${drawerActualWord}`);

    // ---- Rate (id:8) — guesser sends vote 1, drawer's own rate should be ignored ----
    if (drawerActualWord) {
      rG.socket.emit('data', { id:8, data: 1 });
      await sleep(400);
      record('rate: id:8 broadcast {id:rater,vote:1} to ALL incl drawer',
        rateBcastDrawer?.vote === 1 && rateBcastGuesser?.vote === 1, `drawerSaw=${JSON.stringify(rateBcastDrawer)} guesserSaw=${JSON.stringify(rateBcastGuesser)}`);

      // Reset and verify drawer's own rate is ignored
      rateBcastDrawer = null; rateBcastGuesser = null;
      rO.socket.emit('data', { id:8, data: 0 });
      await sleep(400);
      record('drawer own id:8 ignored (no broadcast)',
        rateBcastDrawer === null && rateBcastGuesser === null, `drawerSaw=${JSON.stringify(rateBcastDrawer)} guesserSaw=${JSON.stringify(rateBcastGuesser)}`);

      // ---- Close guess (id:16) ----
      // Distance-1 from word
      const w = drawerActualWord;
      const dist1 = w.length > 0 ? w.slice(0,-1) + (w[w.length-1] === 'x' ? 'y' : 'x') : 'xxxx';
      // Distance-2: change two characters
      const dist2 = w.length >= 2 ? (w[0] === 'q' ? 'z' : 'q') + (w[1] === 'q' ? 'z' : 'q') + w.slice(2) : 'qzqz';
      // Distance >=3: completely different word
      const dist3 = 'zzzzzzzzz';

      rG.socket.emit('data', { id:30, data: dist1 });
      await sleep(400);
      rG.socket.emit('data', { id:30, data: dist2 });
      await sleep(400);

      const cg1ok = closeGuess1 != null;
      const cg2ok = closeGuess2 != null;
      record('close-guess distance=1 triggers id:16',
        cg1ok, `cg1=${closeGuess1} word=${w} attempt=${dist1}`);
      record('close-guess distance=2 triggers id:16',
        cg2ok, `cg2=${closeGuess2} word=${w} attempt=${dist2}`);

      // distance>=3 — should NOT trigger id:16 (so cg2 still equal after this)
      const beforeCount = [closeGuess1, closeGuess2].filter(Boolean).length;
      rG.socket.emit('data', { id:30, data: dist3 });
      await sleep(400);
      const afterCount = [closeGuess1, closeGuess2].filter(Boolean).length;
      record('close-guess distance>=3 does NOT trigger id:16',
        afterCount === beforeCount, `before=${beforeCount} after=${afterCount}`);

      // ---- Correct guess (distance 0) -> id:15 ----
      let gotId15 = null;
      rG.socket.on('data', m => { if (m.id === 15) gotId15 = m.data; });
      // need NEW guesser since current one might still be allowed -- actually current one IS the guesser
      rG.socket.emit('data', { id:30, data: w });
      await sleep(500);
      record('correct guess broadcasts id:15',
        gotId15 && gotId15.word === w, `id15=${JSON.stringify(gotId15)}`);
    } else {
      record('skipping rate/close-guess tests because drawer never entered j', false, 'word missing');
    }

    rO.socket.disconnect(); rG.socket.disconnect();

    // ---------- summary ----------
    const passed = results.filter(r => r.ok).length;
    const total = results.length;
    console.log(`\nSummary v2: ${passed}/${total} passed`);
    const out = '/app/test_reports/pytest/backend_test_v2_results.json';
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ passed, total, results }, null, 2));
    process.exit(passed === total ? 0 : 1);
  } catch (e) {
    console.error('CRASH', e);
    process.exit(2);
  }
})();
