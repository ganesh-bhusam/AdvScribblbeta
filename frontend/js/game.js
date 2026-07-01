/**
 * AdvScribbl — game client.
 * Implements the protocol from the architecture spec:
 *   - Socket.io with path /api/socket.io/
 *   - 'login' handshake + 'data' multiplexing with {id, data}
 *   - State machine: G(0) K(1) F(2) V(3) j(4) Z(5) X(6) J(7)
 *   - Drawing tools: pencil, bucket, line, rect, circle, eraser
 *   - 26 standard + 26 premium colors swapped via toggle
 */
(function () {
  window.ENV = window.ENV || {};
  window.ENV.API = 'http://localhost:8001';

  const STATE = { G: 0, K: 1, F: 2, V: 3, j: 4, Z: 5, X: 6, J: 7 };

  // 26 standard + 26 premium colors
  const STANDARD_COLORS = [
    '#FFFFFF','#C1C1C1','#EF130B','#FF7100','#FFE400','#00CC00',
    '#00B2FF','#231FD3','#A300BA','#D37CAA','#A0522D','#000000','#4C4C4C',
    '#740B07','#C23800','#E8A200','#005510','#00569E','#0E0865','#550069',
    '#A75574','#63300D','#111111','#222222','#333333','#444444',
  ];
  const PREMIUM_COLORS = [
    '#FFB3BA','#FFDFBA','#FFFFBA','#BAFFC9','#BAE1FF','#D0E1FF','#E1BAFF',
    '#FFB3E6','#FFC4E1','#F4F4F4','#E0E0E0','#FF6B6B','#FF9E9E',
    '#FFD700','#98FF98','#4ECDC4','#45B7D1','#1A535C','#5F27CD','#341F97',
    '#01A3A4','#B8E994','#FF9FF3','#FCA311','#FECA57','#54A0FF',
  ];
  const ALL_COLORS = [...STANDARD_COLORS, ...PREMIUM_COLORS];

  // 10 classic skribbl-style head colors (indices match data-color CSS)
  const HEAD_COLORS = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink', 'mint', 'gold'];

  // ============================ STATE ============================
  let socket = null;
  let me = null;
  let room = null;
  let players = [];
  let currentDrawerId = null;
  let currentState = STATE.G;
  let currentWord = null;
  let wordHints = [];
  let colorIndex = 11;
  let secondaryColorIndex = 0;
  let brushSize = 8;
  let tool = 'pencil';
  let drawingEnabled = false;
  let premiumColorsActive = false;
  let languages = [];
  let avatarIdx = 0;
  const mutedPlayerIds = new Set();
  // Drawing-rating aggregation (cleared on new drawer)
  let rateScores = new Map(); // raterPlayerId -> 0|1
  let myRate = null;          // 0|1|null for this drawing

  const canvas = document.getElementById('draw-canvas');
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.fillStyle = '#FBFCFD';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawCommands = [];

  // Hidden input element for native color wheel picker
  const wheelInput = document.createElement('input');
  wheelInput.type = 'color';
  wheelInput.style.position = 'absolute';
  wheelInput.style.opacity = '0';
  wheelInput.style.width = '0';
  wheelInput.style.height = '0';
  document.body.appendChild(wheelInput);

  // Custom premium color selection logic (Wheel & Random) using event delegation
  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.id === 'color-wheel') {
      ev.preventDefault();
      wheelInput.click();
    }
  });

  wheelInput.addEventListener('input', () => {
    const hex = wheelInput.value;
    setColor(hex);
  });

  document.addEventListener('click', (ev) => {
    const btn = ev.target && ev.target.closest('#action-random');
    if (btn) {
      ev.preventDefault();
      const hex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
      setColor(hex);
    }
  });

  // ============================ HELPERS ============================
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }
  function escapeHTML(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

  function toast(msg, kind = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = kind + ' show';
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.className = kind; }, 2800);
  }
  window.toast = toast;

  function colorFromIdx(idx) {
    if (typeof idx === 'string') return idx;
    if (idx < 0 || idx >= ALL_COLORS.length) return '#000000';
    return ALL_COLORS[idx];
  }

  function show(view) {
    $('home').style.display = view === 'home' ? '' : 'none';
    $('game').style.display = view === 'game' ? '' : 'none';
  }

  function playSound(name) {
    try {
      const a = new Audio('/audio/' + name + '.ogg');
      a.volume = 0.35;
      a.play().catch(() => {});
    } catch (_) { /* noop */ }
  }

  // ============================ LANGUAGES ============================
  async function loadLanguages() {
    try {
      const r = await fetch((window.ENV.API || '') + '/api/languages');
      const d = await r.json();
      languages = d.languages || [];
      const sel = $('login-language');
      sel.innerHTML = '';
      languages.forEach((l) => {
        const o = document.createElement('option');
        o.value = String(l.id); o.textContent = l.name;
        sel.appendChild(o);
      });
    } catch (e) { console.error('lang', e); }
  }

  // ============================ HOME ============================
  function updateHomeUI() {
    const user = window.Auth?.user();
    if (!user) return;
    $('welcome-text').innerHTML = `Hi <b>${escapeHTML(user.name)}</b>` + (user.has_premium ? ' <span class="prem-icon">★</span>' : '');
    if (!$('login-name').value) $('login-name').value = user.name;
    const btn = $('button-unlock-premium');
    if (user.has_premium) {
      btn.innerHTML = '<span class="prem-icon">★</span> Premium Unlocked';
      btn.disabled = true;
      btn.style.opacity = '0.75';
    } else {
      btn.innerHTML = '<span class="prem-icon">★</span> Unlock Premium';
      btn.disabled = false;
      btn.style.opacity = '';
    }
  }

  function setAvatar(idx) {
    avatarIdx = ((idx % HEAD_COLORS.length) + HEAD_COLORS.length) % HEAD_COLORS.length;
    const big = $('avatar-big-head');
    if (big) {
      big.setAttribute('data-color', HEAD_COLORS[avatarIdx]);
      big.animate(
        [
          { transform: 'scale(0.8) scaleX(1.1) rotate(-8deg)' }, 
          { transform: 'scale(1.05) scaleX(0.95) rotate(3deg)' },
          { transform: 'scale(1) scaleX(1) rotate(0)' }
        ],
        { duration: 350, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
      );
    }
  }
  function pickAvatar(dir) { setAvatar(avatarIdx + dir); }

  function avatarPayload() {
    return [avatarIdx, 0, 0, -1];
  }

  // ============================ SOCKET ============================
  let reconnectAttempts = 0;
  const MAX_RECONNECT = 5;

  function connectAndJoin(opts) {
    const token = window.Auth?.token();
    if (!token) return;
    if (socket) { try { socket.disconnect(); } catch (_) { /* noop */ } socket = null; }
    reconnectAttempts = 0;
    socket = io(window.ENV.API || undefined, {
      path: '/api/socket.io/',
      transports: ['websocket', 'polling'],
      auth: { token },
      reconnection: true,           // [FIX H2] Enable built-in reconnection
      reconnectionAttempts: MAX_RECONNECT,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
    });
    socket.on('connect', () => {
      reconnectAttempts = 0;
      socket.emit('login', {
        join: opts.join || 0,
        create: opts.create ? 1 : 0,
        name: $('login-name').value.trim() || (window.Auth.user()?.name || 'Player'),
        lang: String(opts.lang ?? $('login-language').value ?? '0'),
        code: '',
        avatar: avatarPayload(),
      });
    });
    socket.on('connect_error', (err) => { toast('Connection error: ' + err.message, 'error'); });
    socket.on('reconnect_attempt', (n) => { toast(`Reconnecting… (${n}/${MAX_RECONNECT})`, 'error'); });
    socket.on('reconnect_failed', () => { toast('Could not reconnect. Returning to home.', 'error'); show('home'); });
    socket.on('joinerr', (code) => {
      const map = { 1: 'Room not found', 2: 'Room is full', 3: 'Cooldown', 4: 'You are banned', 5: 'Joining too fast', 100: 'Already connected', 200: 'Too many users from your IP', 300: 'Kicked too many times' };
      toast(map[code] || 'Failed to join', 'error');
    });
    socket.on('reason', (code) => { toast(code === 1 ? 'You were kicked' : 'You were banned', 'error'); });
    socket.on('data', handlePacket);
    socket.on('disconnect', (reason) => {
      // [FIX H2] Only show disconnect toast / go home if not auto-reconnecting
      if (reason === 'io server disconnect' || reason === 'io client disconnect') {
        toast('Disconnected', 'error');
        show('home');
      }
    });
  }

  function send(id, data) {
    if (!socket || !socket.connected) return;
    socket.emit('data', { id, data });
  }

  // ============================ PACKET HANDLERS ============================
  function handlePacket(packet) {
    const { id, data } = packet;
    switch (id) {
      case 1: onPlayerJoined(data); break;
      case 2: onPlayerLeft(data); break;
      case 5: onVotekickUpdate(data); break;
      case 8: onRatingBroadcast(data); break;
      case 9: onAvatarSync(data); break;
      case 90: onNameSync(data); break;
      case 10: onLobbyInit(data); break;
      case 11: onStateTransition(data); break;
      case 12: onSettingsUpdate(data); break;
      case 13: onHintsUpdate(data); break;
      case 14: onTimerTick(data); break;
      case 15: onCorrectGuess(data); break;
      case 16: onCloseGuess(data); break;
      case 17: onOwnerChange(data); break;
      case 19: onDrawCommands(data); break;
      case 20: onClearCanvas(); break;
      case 21: onUndo(data); break;
      case 30: onChat(data); break;
      case 31: onWarning(data); break;
      case 32: onSpamWarning(data); break;
      case 100: onKickReason(data); break;
      default: break;
    }
  }

  function onLobbyInit(data) {
    room = data;
    me = data.me;
    players = data.users.slice();
    currentState = data.state.id;
    show('game');
    updatePlayersList();
    applyState(data.state);
    addChatSystem('Joined room ' + data.id);
    playSound('join');
    if (data.type === 1) {
      showRoomSettings(data.settings, data.owner === me);
    }
    const myPlayer = players.find(p => p.id === me);
    if (myPlayer && Array.isArray(myPlayer.avatar)) {
      avatarIdx = (myPlayer.avatar[0] != null ? myPlayer.avatar[0] : 0) % HEAD_COLORS.length;
    }
    updateLobbyAvatarUI();
  }
  function onPlayerJoined(p) {
    players.push(p);
    updatePlayersList();
    addChatSystem(p.name + ' joined', 'join');
    playSound('join');
  }
  function onPlayerLeft(d) {
    const idx = players.findIndex((p) => p.id === d.id);
    if (idx >= 0) {
      const p = players.splice(idx, 1)[0];
      addChatSystem(p.name + ' left', 'leave');
      updatePlayersList();
      playSound('leave');
    }
  }
  function onAvatarSync(d) {
    const p = players.find((x) => x.id === d.id);
    if (p) {
      p.avatar = d.avatar;
      updatePlayersList();
    }
  }
  function onNameSync(d) {
    const p = players.find((x) => x.id === d.id);
    if (p) {
      const oldName = p.name;
      p.name = d.name;
      addChatSystem(`${oldName} changed name to ${d.name}`);
      updatePlayersList();
    }
  }
  function onOwnerChange(newOwnerId) {
    players.forEach((p) => { if (p.flags) p.flags &= ~4; });
    const o = players.find((p) => p.id === newOwnerId);
    if (o) o.flags = (o.flags || 0) | 4;
    if (room) room.owner = newOwnerId;
    updatePlayersList();
  }
  function onStateTransition(s) {
    currentState = s.id;
    applyState(s);
  }
  function onSettingsUpdate(d) {
    if (!room) return;
    room.settings[d.id] = d.val;
    const sel = document.querySelector(`select[data-setting="${d.id}"]`);
    if (sel) sel.value = String(d.val);
  }
  function onTimerTick(t) {
    $('game-clock').querySelector('.text').textContent = t;
  }
  function onHintsUpdate(arr) {
    arr.forEach(([idx, ch]) => { wordHints[idx] = ch; });
    renderHintWord();
  }
  function onCorrectGuess(d) {
    const p = players.find((x) => x.id === d.id);
    addChat({ author: p?.name || '?', msg: 'guessed the word!', kind: 'guess-correct', system: true });
    if (p) { p.guessed = true; updatePlayersList(); }
    playSound('roundEndSuccess');
  }
  function onCloseGuess(name) {
    // [FIX L4] This is already sent only to the guesser by the server (id:16).
    // Display privately in chat — do NOT show the full word hint text to others.
    addChatSystem('Close! Keep guessing…', 'guess-close');
  }
  function onDrawCommands(cmds) {
    if (!Array.isArray(cmds)) return;
    cmds.forEach((c) => { drawCommands.push(c); renderCommand(c); });
  }
  function onClearCanvas() {
    drawCommands.length = 0;
    clearCanvasLocal();
    undoneCommands.length = 0;
    updateRedoButtonState();
  }
  function onUndo(newLen) {
    drawCommands.length = Math.max(0, Math.min(newLen, drawCommands.length));
    redrawAll();
    undoneCommands.length = 0;
    updateRedoButtonState();
  }
  function onChat(d) {
    if (mutedPlayerIds.has(d.id)) return;
    const p = players.find((x) => x.id === d.id);
    addChat({ author: p?.name || '?', msg: d.msg });
  }
  function onWarning(d) {
    const map = { 0: 'Need at least 2 players to start' };
    toast(map[d.id] || 'Warning', 'error');
  }
  function onVotekickUpdate(arr) {
    if (!Array.isArray(arr)) return;
    const [voterId, targetId, count, required] = arr;
    const voter = players.find((p) => p.id === voterId);
    const target = players.find((p) => p.id === targetId);
    if (!voter || !target) return;
    addChatSystem(`${voter.name} votekicked ${target.name} (${count}/${required})`, 'guess-close');
  }
  function onRatingBroadcast(d) {
    if (!d) return;
    // Aggregate ratings shown on the rate-count badge
    rateScores.set(d.id, d.vote);
    refreshRateCount();
  }
  function onSpamWarning() {
    toast('You are typing too fast, slow down', 'error');
  }
  function onKickReason(code) {
    if (code === 1) toast('You were kicked from the room', 'error');
    if (code === 2) toast('You were banned from the room', 'error');
  }

  // ============================ STATE APPLICATION ============================
  function applyState(s) {
    undoneCommands.length = 0;
    updateRedoButtonState();
    const overlay = $('canvas-overlay');
    const overlayContent = $('canvas-overlay-content');
    overlay.classList.remove('active');
    overlayContent.classList.remove('active');
    [...overlayContent.children].forEach((c) => c.classList.remove('active'));
    currentDrawerId = null;
    drawingEnabled = false;
    // Hide rate bar by default (re-enabled inside STATE.j only)
    const rb = $('rate-bar');
    if (rb) rb.classList.remove('show');

    if (s.id === STATE.G) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-text').classList.add('active');
      $('overlay-text').textContent = 'Waiting for more players… (need ≥ 2)';
      $('game-round').querySelector('.text').textContent = 'Lobby';
      $('game-word').querySelector('.word').textContent = '—';
    } else if (s.id === STATE.J) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-room').classList.add('active');
      $('game-round').querySelector('.text').textContent = 'Private Room';
      showRoomSettings(room.settings, room.owner === me);
    } else if (s.id === STATE.K) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-text').classList.add('active');
      $('overlay-text').textContent = 'Game starting in a few seconds…';
      playSound('roundStart');
    } else if (s.id === STATE.F) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-text').classList.add('active');
      $('overlay-text').textContent = 'Round ' + ((s.data ?? 0) + 1);
      $('game-round').querySelector('.text').textContent = 'Round ' + ((s.data ?? 0) + 1);
      players.forEach((p) => (p.guessed = false));
      updatePlayersList();
      clearCanvasLocal();
      drawCommands.length = 0;
    } else if (s.id === STATE.V) {
      currentDrawerId = s.data?.id;
      const isDrawer = currentDrawerId === me;
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      if (isDrawer && s.data?.words) {
        $('overlay-words').classList.add('active');
        $('overlay-text').classList.add('active');
        $('overlay-words').innerHTML = '';
        const isCombination = room && room.settings[6] === 2;
        if (isCombination) {
          $('overlay-text').textContent = 'Choose the first word';
          const half = s.data.words.length / 2;
          const firstHalf = s.data.words.slice(0, half);
          const secondHalf = s.data.words.slice(half);
          let firstChoiceIdx = null;
          firstHalf.forEach((w, i) => {
            const btn = el('button', 'word-card', w);
            btn.dataset.testid = 'word-choice-' + i;
            btn.addEventListener('click', () => {
              firstChoiceIdx = i;
              $('overlay-text').textContent = 'Choose the second word';
              $('overlay-words').innerHTML = '';
              secondHalf.forEach((w2, j) => {
                const btn2 = el('button', 'word-card', w2);
                btn2.dataset.testid = 'word-choice-second-' + j;
                btn2.addEventListener('click', () => {
                  send(18, [firstChoiceIdx, j]);
                  $('overlay-words').innerHTML = '';
                });
                $('overlay-words').appendChild(btn2);
              });
            });
            $('overlay-words').appendChild(btn);
          });
        } else {
          $('overlay-text').textContent = 'Choose a word to draw';
          s.data.words.forEach((w, i) => {
            const c = el('button', 'word-card', w);
            c.dataset.testid = 'word-choice-' + i;
            c.addEventListener('click', () => {
              send(18, i);
              $('overlay-words').innerHTML = '';
            });
            $('overlay-words').appendChild(c);
          });
        }
      } else {
        const drawer = players.find((p) => p.id === currentDrawerId);
        $('overlay-text').classList.add('active');
        $('overlay-text').textContent = (drawer?.name || 'Someone') + ' is choosing a word…';
      }
      $('game-word').querySelector('.word').textContent = '—';
      updatePlayersList();
    } else if (s.id === STATE.j) {
      currentDrawerId = s.data?.id;
      const isDrawer = currentDrawerId === me;
      drawingEnabled = isDrawer;
      canvas.style.cursor = isDrawer ? 'crosshair' : 'default';
      // Reset rating state for new drawing
      rateScores = new Map();
      myRate = null;
      refreshRateCount();
      // Show rate-bar only for non-drawers
      const rb = $('rate-bar');
      if (rb) rb.classList.toggle('show', !isDrawer);
      document.querySelectorAll('.rate-btn').forEach((b) => b.classList.remove('voted'));
      if (isDrawer) {
        currentWord = String(s.data?.word || '').toLowerCase();
        $('game-word').querySelector('.description').textContent = 'DRAW THIS';
        $('game-word').querySelector('.word').textContent = currentWord;
        wordHints = currentWord.split('').map((c) => (c === ' ' ? ' ' : null));
      } else {
        currentWord = null;
        const w = s.data?.word;
        const isHidden = room && room.settings[6] === 1;
        if (isHidden) {
          wordHints = [null, null, null];
          $('game-word').querySelector('.description').textContent = 'WORD HIDDEN';
        } else {
          const lengths = Array.isArray(w) ? w : [w];
          wordHints = [];
          lengths.forEach((len, idx) => {
            if (idx > 0) wordHints.push(' ');
            for (let i = 0; i < len; i++) wordHints.push(null);
          });
          $('game-word').querySelector('.description').textContent = 'GUESS THE WORD';
        }
        renderHintWord();
      }
      // [FIX L3] Show the full draw time on the clock immediately when drawing starts
      $('game-clock').querySelector('.text').textContent = String(room?.settings?.[2] ?? '--');
      if (Array.isArray(s.data?.drawCommands)) {
        s.data.drawCommands.forEach((c) => { drawCommands.push(c); renderCommand(c); });
      }
      updatePlayersList();
    } else if (s.id === STATE.Z) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-reveal').classList.add('active');
      $('reveal-word').textContent = s.data?.word || '???';
      const reasonMap = { 0: 'Everyone guessed!', 1: 'Time is up!', 2: 'Drawer left', 5: 'Drawer skipped' };
      $('reveal-reason').textContent = reasonMap[s.data?.reason] || '';
      const sc = s.data?.scores || [];
      for (let i = 0; i < sc.length; i += 3) {
        const pid = sc[i], score = sc[i + 1], delta = sc[i + 2];
        const p = players.find((x) => x.id === pid);
        if (p) { p.score = score; p.delta = delta; }
      }
      updatePlayersList();
    } else if (s.id === STATE.X) {
      overlay.classList.add('active');
      overlayContent.classList.add('active');
      $('overlay-result').classList.add('active');
      const ranks = s.data || [];
      const top = ranks[0];
      if (top) {
        const wn = players.find((p) => p.id === top[0]);
        $('winner-name').textContent = wn?.name || '???';
      }
      const list = $('ranks-list'); list.innerHTML = '';
      ranks.forEach((r) => {
        const p = players.find((x) => x.id === r[0]);
        if (!p) return;
        const row = el('div', 'rank-row');
        row.innerHTML = `<span><b>#${r[1] + 1}</b> ${escapeHTML(p.name)}</span><span>${p.score} pts</span>`;
        list.appendChild(row);
      });
    }
  }

  function renderHintWord() {
    if (!wordHints || !wordHints.length) {
      $('game-word').querySelector('.word').textContent = '—';
      return;
    }
    const isHidden = room && room.settings[6] === 1 && currentDrawerId !== me;
    const s = wordHints.map((c) => (c === null ? (isHidden ? '?' : '_') : c)).join(' ');
    $('game-word').querySelector('.word').textContent = s;
  }

  function showRoomSettings(settings, isOwner) {
    const grid = $('settings-grid');
    grid.innerHTML = '';
    const fields = [
      { idx: 0, label: 'Language', opts: languages.map((l) => [l.id, l.name]) },
      { idx: 1, label: 'Players', opts: Array.from({ length: 19 }, (_, i) => [i + 2, String(i + 2)]) },
      { idx: 2, label: 'Drawtime', opts: [15, 20, 30, 40, 50, 60, 80, 100, 120, 150, 180, 240].map((v) => [v, v + 's']) },
      { idx: 3, label: 'Rounds', opts: Array.from({ length: 9 }, (_, i) => [i + 2, String(i + 2)]) },
      { idx: 4, label: 'Word choices', opts: Array.from({ length: 5 }, (_, i) => [i + 1, String(i + 1)]) },
      { idx: 5, label: 'Hints', opts: Array.from({ length: 6 }, (_, i) => [i, String(i)]) },
      { idx: 6, label: 'Word mode', opts: [[0, 'Normal'], [1, 'Hidden'], [2, 'Combination']] },
    ];
    fields.forEach((f) => {
      const lbl = el('label', '', f.label);
      const sel = document.createElement('select');
      sel.dataset.setting = String(f.idx);
      sel.dataset.testid = 'setting-' + f.idx;
      sel.disabled = !isOwner;
      f.opts.forEach(([v, t]) => {
        const o = document.createElement('option');
        o.value = String(v); o.textContent = t;
        if (Number(v) === Number(settings[f.idx])) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => send(12, { id: f.idx, val: Number(sel.value) }));
      grid.appendChild(lbl);
      grid.appendChild(sel);
    });
    // Only owner sees Start button enabled
    const startBtn = $('button-start-game');
    if (startBtn) startBtn.disabled = !isOwner;
  }

  // ============================ PLAYERS LIST ============================
  // [FIX H7] Debounce DOM rebuild — coalesce rapid consecutive calls (avatar sync,
  // timer ticks, etc.) into a single repaint on the next animation frame.
  let _playersListRaf = null;
  function updatePlayersList() {
    if (_playersListRaf) return; // already queued
    _playersListRaf = requestAnimationFrame(() => {
      _playersListRaf = null;
      _buildPlayersList();
    });
  }
  function _buildPlayersList() {
    const wrap = $('players-list');
    wrap.innerHTML = '';
    const sorted = [...players].sort((a, b) => b.score - a.score);
    sorted.forEach((p, idx) => {
      const card = el('div', 'player-card');
      card.dataset.testid = 'player-' + p.id;
      card.dataset.playerId = String(p.id);
      if (p.id === me) card.classList.add('me');
      if (p.id === currentDrawerId) card.classList.add('drawer');
      if (p.guessed) card.classList.add('guessed');
      // Use mini colored head
      const av = el('div', 'char-head small');
      const c = HEAD_COLORS[(p.avatar && p.avatar[0] != null ? p.avatar[0] : 0) % HEAD_COLORS.length];
      av.setAttribute('data-color', c);
      const face = el('div', 'face');
      av.appendChild(face);
      const info = el('div', 'player-info');
      const nameRow = el('div', 'player-name');
      nameRow.textContent = p.name;
      if (p.flags & 4) {
        const crown = el('span', 'crown', '♛');
        nameRow.appendChild(crown);
      }
      if (mutedPlayerIds.has(p.id)) {
        const muteIcon = el('span', 'mute-icon', ' 🔇');
        nameRow.appendChild(muteIcon);
      }
      const sc = el('div', 'player-score', (p.score || 0) + ' pts' + (p.guessed ? ' • guessed ✓' : ''));
      info.appendChild(nameRow); info.appendChild(sc);
      const rank = el('div', 'player-rank', '#' + (idx + 1));
      card.appendChild(av); card.appendChild(info); card.appendChild(rank);
      // Click → context menu (votekick / kick / ban) for other players
      card.addEventListener('click', (ev) => {
        if (p.id === me) return;
        openPlayerMenu(p.id, ev);
      });
      wrap.appendChild(card);
    });
    $('player-count').textContent = players.length;
  }

  // --- Player context menu ---
  function openPlayerMenu(targetId, ev) {
    const menu = $('player-menu');
    if (!menu) return;
    const isOwner = room && room.owner === me;
    menu.classList.toggle('no-owner', !isOwner);
    menu.dataset.target = String(targetId);
    const muteBtn = menu.querySelector('[data-action="mute"]');
    if (muteBtn) {
      muteBtn.textContent = mutedPlayerIds.has(targetId) ? '🔊 Unmute' : '🔇 Mute';
    }
    // Position next to the clicked card
    const rect = ev.currentTarget.getBoundingClientRect();
    menu.style.left = Math.min(window.innerWidth - 200, rect.right + 6) + 'px';
    menu.style.top = (rect.top) + 'px';
    menu.classList.add('open');
  }
  function closePlayerMenu() {
    $('player-menu')?.classList.remove('open');
  }
  document.addEventListener('click', (ev) => {
    const menu = $('player-menu');
    if (!menu || !menu.classList.contains('open')) return;
    if (menu.contains(ev.target)) return;
    if (ev.target.closest('.player-card')) return;
    closePlayerMenu();
  });
  document.querySelectorAll('#player-menu .player-menu-item').forEach((b) => {
    b.addEventListener('click', () => {
      const targetId = Number($('player-menu').dataset.target);
      const action = b.dataset.action;
      if (!targetId) return;
      if (action === 'votekick') send(5, targetId);
      else if (action === 'kick') send(3, targetId);
      else if (action === 'ban')  send(4, targetId);
      else if (action === 'report') {
        send(6, { id: targetId, reasons: 1 }); // Default to toxic (reasons: 1)
        toast('Player reported', 'success');
      }
      else if (action === 'mute') {
        if (mutedPlayerIds.has(targetId)) {
          mutedPlayerIds.delete(targetId);
          toast('Player unmuted', 'success');
        } else {
          mutedPlayerIds.add(targetId);
          toast('Player muted', 'success');
        }
        send(7, targetId);
        updatePlayersList();
      }
      closePlayerMenu();
    });
  });

  // --- Drawing rating ---
  function refreshRateCount() {
    let up = 0, down = 0;
    for (const v of rateScores.values()) { if (v === 1) up++; else down++; }
    const txt = up + (down ? ' / -' + down : '');
    const node = $('rate-count'); if (node) node.textContent = txt;
  }
  document.querySelectorAll('.rate-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.dataset.vote);
      if (myRate === v) return; // already voted same way
      myRate = v;
      document.querySelectorAll('.rate-btn').forEach((x) => x.classList.toggle('voted', Number(x.dataset.vote) === v));
      send(8, v);
    });
  });

  // ============================ CHAT ============================
  function addChat({ author, msg, kind, system }) {
    const wrap = $('chat-content');
    const m = el('div', 'chat-msg' + (kind ? ' ' + kind : '') + (system ? ' system' : ''));
    if (system) m.innerHTML = '<i>' + escapeHTML(author) + ' ' + escapeHTML(msg) + '</i>';
    else m.innerHTML = '<span class="author">' + escapeHTML(author) + ':</span>' + escapeHTML(msg);
    wrap.appendChild(m);
    wrap.scrollTop = wrap.scrollHeight;
  }
  function addChatSystem(msg, kind) {
    const wrap = $('chat-content');
    const m = el('div', 'chat-msg system' + (kind ? ' ' + kind : ''));
    m.textContent = msg;
    wrap.appendChild(m); wrap.scrollTop = wrap.scrollHeight;
  }

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const inp = $('chat-input');
    const t = inp.value.trim();
    if (!t) return;
    send(30, t);
    inp.value = '';
  });

  // ============================ COLOR PALETTE ============================
  function buildPalette(usePremium) {
    const grid = $('color-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const colors = usePremium ? PREMIUM_COLORS : STANDARD_COLORS;
    const offset = usePremium ? 26 : 0;
    colors.forEach((c, i) => {
      const idx = offset + i;
      const sw = el('button', 'color-swatch');
      sw.type = 'button';
      sw.style.background = c;
      sw.dataset.color = String(idx);
      sw.dataset.testid = 'color-' + idx;
      sw.addEventListener('click', (ev) => { ev.preventDefault(); setColor(idx); });
      sw.addEventListener('contextmenu', (ev) => { ev.preventDefault(); setColor(idx, true); });
      grid.appendChild(sw);
    });
    refreshColorSelection();

    // Show/hide premium toolbar sections in sync with toggle state
    const customTools = $('premium-color-tools');
    if (customTools) customTools.style.display = usePremium ? 'flex' : 'none';

    const premiumShapes = $('premium-shapes');
    if (premiumShapes) premiumShapes.style.display = usePremium ? 'flex' : 'none';

    const redoBtn = $('action-redo');
    if (redoBtn) redoBtn.style.display = usePremium ? 'inline-flex' : 'none';

    const standardSize = $('size-picker');
    const premiumSize = $('premium-size-slider');
    if (standardSize) standardSize.style.display = usePremium ? 'none' : 'flex';
    if (premiumSize) {
      premiumSize.style.display = usePremium ? 'flex' : 'none';
      if (usePremium) applySizeSlider();
    }

    const rainbowBtn = $('tool-rainbow');
    if (rainbowBtn) {
      rainbowBtn.style.display = usePremium ? 'inline-flex' : 'none';
    }

    if (!usePremium && tool === 'rainbow') {
      tool = 'pencil';
      document.querySelectorAll('#tool-buttons .tool-btn').forEach((x) => x.classList.toggle('active', x.dataset.tool === 'pencil'));
    }
  }

  function setColor(idx, secondary = false) {
    if (secondary) secondaryColorIndex = idx;
    else colorIndex = idx;
    $('color-primary').style.background = colorFromIdx(colorIndex);
    $('color-secondary').style.background = colorFromIdx(secondaryColorIndex);
    
    // Update premium swatch background color
    const swatch = $('size-swatch');
    if (swatch) swatch.style.background = colorFromIdx(colorIndex);
    
    refreshColorSelection();
  }
  function refreshColorSelection() {
    document.querySelectorAll('.color-swatch').forEach((s) => {
      const colAttr = s.dataset.color;
      s.classList.toggle('selected', colAttr === String(colorIndex) || colAttr === colorIndex);
    });
  }

  const premiumSwitch = $('toggle-color-panel');
  premiumSwitch.addEventListener('click', () => {
    const user = window.Auth?.user();
    if (!user?.has_premium) {
      premiumSwitch.classList.remove('active');
      premiumSwitch.setAttribute('aria-pressed', 'false');
      window.Payment.open();
      return;
    }
    premiumColorsActive = !premiumColorsActive;
    premiumSwitch.classList.toggle('active', premiumColorsActive);
    premiumSwitch.setAttribute('aria-pressed', String(premiumColorsActive));
    buildPalette(premiumColorsActive);
    if (premiumColorsActive) setColor(26);
    else setColor(11);
  });

  // ============================ TOOLS / SIZES ============================
  document.querySelectorAll('#tool-buttons .tool-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#tool-buttons .tool-btn').forEach((x) => x.classList.remove('active'));
      document.querySelectorAll('.shape-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      tool = b.dataset.tool;
    });
  });
  document.querySelectorAll('#size-picker .size-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#size-picker .size-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      brushSize = Number(b.dataset.size);
    });
  });

  // Premium Brush Size Slider Implementation
  const SIZES = [3, 8, 16, 32];
  let sizeIdx = 1;
  function applySizeSlider() {
    brushSize = SIZES[sizeIdx];
    const fill = $('size-fill');
    const dot = $('size-dot');
    const swatch = $('size-swatch');
    if (fill) fill.style.width = (sizeIdx / (SIZES.length - 1)) * 100 + '%';
    if (dot) dot.style.left = (sizeIdx / (SIZES.length - 1)) * 100 + '%';
    if (swatch) {
      const swPx = 14 + sizeIdx * 10;
      swatch.style.width = swPx + 'px';
      swatch.style.height = swPx + 'px';
      swatch.style.background = colorFromIdx(colorIndex);
    }
  }

  document.addEventListener('click', (ev) => {
    if (ev.target && ev.target.id === 'size-minus') {
      ev.preventDefault();
      sizeIdx = Math.max(0, sizeIdx - 1);
      applySizeSlider();
    }
    if (ev.target && ev.target.id === 'size-plus') {
      ev.preventDefault();
      sizeIdx = Math.min(SIZES.length - 1, sizeIdx + 1);
      applySizeSlider();
    }
  });

  // Undo / Redo Actions
  $('action-undo').addEventListener('click', () => {
    if (!drawingEnabled) return;
    if (drawCommands.length === 0) return;
    const popped = drawCommands.pop();
    undoneCommands.push(popped);
    send(21, drawCommands.length);
    redrawAll();
    updateRedoButtonState();
  });

  const redoBtn = $('action-redo');
  if (redoBtn) {
    redoBtn.addEventListener('click', () => {
      if (!drawingEnabled) return;
      if (undoneCommands.length === 0) return;
      const cmd = undoneCommands.pop();
      drawCommands.push(cmd);
      send(19, [cmd]);
      renderCommand(cmd);
      updateRedoButtonState();
    });
  }

  function updateRedoButtonState() {
    const btn = $('action-redo');
    if (btn) {
      btn.disabled = undoneCommands.length === 0;
    }
  }
  $('action-clear').addEventListener('click', () => {
    if (!drawingEnabled) return;
    drawCommands.length = 0;
    send(20, null);
    clearCanvasLocal();
  });

  // ============================ DRAWING ============================
  let drawing = false;
  let strokeStart = null;
  let lastPoint = null;

  const SHAPE_MAP = {
    'line': 2,
    'rect': 3,
    'circle': 4,
    'curve': 5,
    'rrect': 6,
    'parallel': 7,
    'triangle': 8,
    'rtriangle': 9,
    'diamond': 10,
    'pentagon': 11,
    'hexagon': 12,
    'arrow-r': 13,
    'arrow-l': 14,
    'arrow-u': 15,
    'arrow-d': 16,
    'sparkle': 17,
    'star': 18,
    'burst': 19,
    'bubble': 20,
    'bubble2': 21,
    'cloud': 22,
    'heart': 23,
    'lightning': 24
  };

  let currentShapeType = 'line';
  const undoneCommands = [];

  function randomHexColor() {
    return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  }

  function canvasCoord(e) {
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (canvas.width / r.width);
    const y = (e.clientY - r.top) * (canvas.height / r.height);
    return { x: Math.round(x), y: Math.round(y) };
  }

  canvas.addEventListener('mousedown', (e) => {
    if (!drawingEnabled) return;
    const p = canvasCoord(e);
    drawing = true;
    strokeStart = p; lastPoint = p;
    undoneCommands.length = 0;
    updateRedoButtonState();

    if (tool === 'bucket') {
      const cmd = [1, colorIndex, brushSize, p.x, p.y, p.x, p.y];
      drawCommands.push(cmd); renderCommand(cmd); send(19, [cmd]);
      drawing = false;
    } else if (tool === 'pencil' || tool === 'eraser' || tool === 'rainbow') {
      const usedColor = tool === 'eraser' ? secondaryColorIndex : (tool === 'rainbow' ? randomHexColor() : colorIndex);
      const cmd = [0, usedColor, brushSize, p.x, p.y, p.x, p.y];
      drawCommands.push(cmd); renderCommand(cmd); send(19, [cmd]);
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!drawingEnabled) return;
    const p = canvasCoord(e);
    if (!drawing) return;
    if (tool === 'pencil' || tool === 'eraser' || tool === 'rainbow') {
      const usedColor = tool === 'eraser' ? secondaryColorIndex : (tool === 'rainbow' ? randomHexColor() : colorIndex);
      const cmd = [0, usedColor, brushSize, lastPoint.x, lastPoint.y, p.x, p.y];
      drawCommands.push(cmd); renderCommand(cmd); send(19, [cmd]);
      lastPoint = p;
    } else if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'shape') {
      redrawAll();
      drawShapePreview(strokeStart, p, tool === 'shape' ? currentShapeType : tool, colorIndex, brushSize);
    }
  });

  function endDraw(e) {
    if (!drawingEnabled || !drawing) return;
    const p = e && e.clientX !== undefined ? canvasCoord(e) : lastPoint;
    
    if (tool === 'line' || tool === 'rect' || tool === 'circle' || tool === 'shape') {
      const shapeType = tool === 'shape' ? currentShapeType : tool;
      const typeCode = SHAPE_MAP[shapeType] || 2;
      const cmd = [typeCode, colorIndex, brushSize, strokeStart.x, strokeStart.y, p.x, p.y];
      drawCommands.push(cmd); renderCommand(cmd); send(19, [cmd]);
    }
    drawing = false; strokeStart = null; lastPoint = null;
  }

  canvas.addEventListener('mouseup', endDraw);
  canvas.addEventListener('mouseleave', endDraw);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('touchstart', (e) => { if (!drawingEnabled) return; e.preventDefault(); const t = e.touches[0]; canvas.dispatchEvent(new MouseEvent('mousedown', { clientX: t.clientX, clientY: t.clientY })); }, { passive: false });
  canvas.addEventListener('touchmove',  (e) => { if (!drawingEnabled) return; e.preventDefault(); const t = e.touches[0]; canvas.dispatchEvent(new MouseEvent('mousemove', { clientX: t.clientX, clientY: t.clientY })); }, { passive: false });
  canvas.addEventListener('touchend', (e) => {
    if (!drawingEnabled) return;
    e.preventDefault();
    const t = e.changedTouches[0];
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: t.clientX, clientY: t.clientY }));
  }, { passive: false });

  function drawShapePath(type, x1, y1, x2, y2) {
    const w = x2 - x1;
    const h = y2 - y1;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;

    ctx.beginPath();
    
    if (type === 2 || type === 'line') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
    } else if (type === 3 || type === 'rect') {
      ctx.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(w), Math.abs(h));
    } else if (type === 4 || type === 'circle') {
      const rx = Math.abs(w) / 2;
      const ry = Math.abs(h) / 2;
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    } else if (type === 5 || type === 'curve') {
      ctx.moveTo(x1, y2);
      ctx.quadraticCurveTo(cx, y1, x2, y2);
    } else if (type === 6 || type === 'rrect') {
      const r = Math.min(Math.abs(w), Math.abs(h)) * 0.15;
      ctx.roundRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(w), Math.abs(h), r);
    } else if (type === 7 || type === 'parallel') {
      const offset = w * 0.2;
      ctx.moveTo(x1 + offset, y1);
      ctx.lineTo(x2, y1);
      ctx.lineTo(x2 - offset, y2);
      ctx.lineTo(x1, y2);
      ctx.closePath();
    } else if (type === 8 || type === 'triangle') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x1, y2);
      ctx.closePath();
    } else if (type === 9 || type === 'rtriangle') {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1, y2);
      ctx.lineTo(x2, y2);
      ctx.closePath();
    } else if (type === 10 || type === 'diamond') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(x2, cy);
      ctx.lineTo(cx, y2);
      ctx.lineTo(x1, cy);
      ctx.closePath();
    } else if (type === 11 || type === 'pentagon') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(x1 + w * 0.95, y1 + h * 0.38);
      ctx.lineTo(x1 + w * 0.78, y2);
      ctx.lineTo(x1 + w * 0.22, y2);
      ctx.lineTo(x1 + w * 0.05, y1 + h * 0.38);
      ctx.closePath();
    } else if (type === 12 || type === 'hexagon') {
      ctx.moveTo(x1 + w * 0.25, y1);
      ctx.lineTo(x1 + w * 0.75, y1);
      ctx.lineTo(x2, cy);
      ctx.lineTo(x1 + w * 0.75, y2);
      ctx.lineTo(x1 + w * 0.25, y2);
      ctx.lineTo(x1, cy);
      ctx.closePath();
    } else if (type === 13 || type === 'arrow-r') {
      ctx.moveTo(x1, cy);
      ctx.lineTo(x2, cy);
      ctx.moveTo(x2, cy);
      ctx.lineTo(x2 - w * 0.25, y1);
      ctx.moveTo(x2, cy);
      ctx.lineTo(x2 - w * 0.25, y2);
    } else if (type === 14 || type === 'arrow-l') {
      ctx.moveTo(x2, cy);
      ctx.lineTo(x1, cy);
      ctx.moveTo(x1, cy);
      ctx.lineTo(x1 + w * 0.25, y1);
      ctx.moveTo(x1, cy);
      ctx.lineTo(x1 + w * 0.25, y2);
    } else if (type === 15 || type === 'arrow-u') {
      ctx.moveTo(cx, y2);
      ctx.lineTo(cx, y1);
      ctx.moveTo(cx, y1);
      ctx.lineTo(x1, y1 + h * 0.25);
      ctx.moveTo(cx, y1);
      ctx.lineTo(x2, y1 + h * 0.25);
    } else if (type === 16 || type === 'arrow-d') {
      ctx.moveTo(cx, y1);
      ctx.lineTo(cx, y2);
      ctx.moveTo(cx, y2);
      ctx.lineTo(x1, y2 - h * 0.25);
      ctx.moveTo(cx, y2);
      ctx.lineTo(x2, y2 - h * 0.25);
    } else if (type === 17 || type === 'sparkle') {
      ctx.moveTo(cx, y1);
      ctx.quadraticCurveTo(cx, cy, x2, cy);
      ctx.quadraticCurveTo(cx, cy, cx, y2);
      ctx.quadraticCurveTo(cx, cy, x1, cy);
      ctx.quadraticCurveTo(cx, cy, cx, y1);
    } else if (type === 18 || type === 'star') {
      const R = Math.max(Math.abs(w), Math.abs(h)) / 2;
      const r = R * 0.4;
      for (let i = 0; i < 10; i++) {
        const angle = (i * Math.PI) / 5 - Math.PI / 2;
        const radius = i % 2 === 0 ? R : r;
        const sx = cx + radius * Math.cos(angle);
        const sy = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    } else if (type === 19 || type === 'burst') {
      const R = Math.max(Math.abs(w), Math.abs(h)) / 2;
      const r = R * 0.65;
      for (let i = 0; i < 16; i++) {
        const angle = (i * Math.PI) / 8;
        const radius = i % 2 === 0 ? R : r;
        const sx = cx + radius * Math.cos(angle);
        const sy = cy + radius * Math.sin(angle);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
    } else if (type === 20 || type === 'bubble') {
      ctx.moveTo(x1 + w * 0.1, y1);
      ctx.lineTo(x1 + w * 0.9, y1);
      ctx.quadraticCurveTo(x2, y1, x2, y1 + h * 0.4);
      ctx.quadraticCurveTo(x2, y1 + h * 0.8, x1 + w * 0.9, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.5, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.3, y2);
      ctx.lineTo(x1 + w * 0.4, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.1, y1 + h * 0.8);
      ctx.quadraticCurveTo(x1, y1 + h * 0.8, x1, y1 + h * 0.4);
      ctx.quadraticCurveTo(x1, y1, x1 + w * 0.1, y1);
    } else if (type === 21 || type === 'bubble2') {
      ctx.ellipse(cx, y1 + h * 0.45, Math.abs(w) * 0.45, Math.abs(h) * 0.35, 0, 0, Math.PI * 2);
      ctx.moveTo(x1 + w * 0.35, y1 + h * 0.8);
      ctx.lineTo(x1 + w * 0.2, y2);
      ctx.lineTo(x1 + w * 0.5, y1 + h * 0.77);
    } else if (type === 22 || type === 'cloud') {
      ctx.arc(cx - w * 0.2, cy, Math.abs(w) * 0.25, Math.PI, Math.PI * 1.8);
      ctx.arc(cx + w * 0.15, cy - h * 0.15, Math.abs(w) * 0.3, Math.PI * 1.3, Math.PI * 2.2);
      ctx.arc(cx + w * 0.25, cy + h * 0.05, Math.abs(w) * 0.2, Math.PI * 1.8, Math.PI * 0.3);
      ctx.lineTo(x1, cy + h * 0.25);
      ctx.closePath();
    } else if (type === 23 || type === 'heart') {
      ctx.moveTo(cx, y1 + h * 0.3);
      ctx.bezierCurveTo(x1, y1, x1, cy, cx, y2);
      ctx.bezierCurveTo(x2, cy, x2, y1, cx, y1 + h * 0.3);
    } else if (type === 24 || type === 'lightning') {
      ctx.moveTo(cx + w * 0.1, y1);
      ctx.lineTo(x1, cy + h * 0.1);
      ctx.lineTo(cx + w * 0.1, cy + h * 0.1);
      ctx.lineTo(cx - w * 0.1, y2);
      ctx.lineTo(x2, cy - h * 0.1);
      ctx.lineTo(cx - w * 0.1, cy - h * 0.1);
      ctx.closePath();
    }
  }

  function renderCommand(c) {
    const [type, colIdx, size, x1, y1, x2, y2] = c;
    const color = colorFromIdx(colIdx);
    ctx.lineWidth = size;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    if (type === 0) {
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      if (x1 === x2 && y1 === y2) { ctx.beginPath(); ctx.arc(x1, y1, size / 2, 0, Math.PI * 2); ctx.fill(); }
    } else if (type === 1) {
      floodFill(x1, y1, color);
    } else {
      drawShapePath(type, x1, y1, x2, y2);
      ctx.stroke();
    }
  }

  function drawShapePreview(p1, p2, t, colIdx, size) {
    const color = colorFromIdx(colIdx);
    ctx.lineWidth = size; ctx.strokeStyle = color;
    drawShapePath(t, p1.x, p1.y, p2.x, p2.y);
    ctx.stroke();
  }

  function clearCanvasLocal() {
    ctx.save(); ctx.fillStyle = '#FBFCFD'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore();
  }
  function redrawAll() {
    clearCanvasLocal();
    drawCommands.forEach(renderCommand);
  }

  function floodFill(x, y, color) {
    const w = canvas.width, h = canvas.height;
    const img = ctx.getImageData(0, 0, w, h);
    const data = img.data;
    const idx = (x, y) => (y * w + x) * 4;
    const target = idx(x | 0, y | 0);
    const tr = data[target], tg = data[target + 1], tb = data[target + 2];
    const fill = hexToRgb(color);
    if (fill.r === tr && fill.g === tg && fill.b === tb) return;
    const stack = [[x | 0, y | 0]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
      const i = idx(cx, cy);
      if (data[i] !== tr || data[i + 1] !== tg || data[i + 2] !== tb) continue;
      data[i] = fill.r; data[i + 1] = fill.g; data[i + 2] = fill.b; data[i + 3] = 255;
      stack.push([cx + 1, cy]); stack.push([cx - 1, cy]); stack.push([cx, cy + 1]); stack.push([cx, cy - 1]);
    }
    ctx.putImageData(img, 0, 0);
  }
  function hexToRgb(h) {
    const x = h.replace('#', '');
    return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16) };
  }

  // ============================ HOME ACTIONS ============================
  document.querySelectorAll('[data-avatar-dir]').forEach((b) => b.addEventListener('click', () => pickAvatar(Number(b.dataset.avatarDir))));

  // Lobby avatar customization
  $('lobby-avatar-prev').addEventListener('click', (ev) => {
    ev.preventDefault();
    avatarIdx = ((avatarIdx - 1) % HEAD_COLORS.length + HEAD_COLORS.length) % HEAD_COLORS.length;
    updateLobbyAvatarUI();
    send(9, avatarPayload());
    // Also sync the home screen avatar preview to match
    setAvatar(avatarIdx);
  });
  $('lobby-avatar-next').addEventListener('click', (ev) => {
    ev.preventDefault();
    avatarIdx = (avatarIdx + 1) % HEAD_COLORS.length;
    updateLobbyAvatarUI();
    send(9, avatarPayload());
    setAvatar(avatarIdx);
  });

  function updateLobbyAvatarUI() {
    const head = $('lobby-avatar-head');
    if (head) {
      head.setAttribute('data-color', HEAD_COLORS[avatarIdx]);
    }
  }

  $('button-login-play').addEventListener('click', () => {
    const name = $('login-name').value.trim();
    if (!name) { toast('Enter a name first', 'error'); return; }
    connectAndJoin({ create: 0, lang: $('login-language').value });
  });
  $('button-login-create').addEventListener('click', () => {
    const name = $('login-name').value.trim();
    if (!name) { toast('Enter a name first', 'error'); return; }
    connectAndJoin({ create: 1, lang: $('login-language').value });
  });
  function extractRoomId(str) {
    if (!str) return '';
    str = str.trim();
    if (str.includes('room=')) {
      try {
        const u = new URL(str.startsWith('http') ? str : 'http://dummy/' + str);
        return u.searchParams.get('room') || str;
      } catch (_) {
        const match = str.match(/room=([a-zA-Z0-9_-]+)/);
        if (match) return match[1];
      }
    }
    return str;
  }

  $('button-login-join').addEventListener('click', () => {
    const raw = $('login-room').value;
    const code = extractRoomId(raw);
    if (!code) { toast('Enter an invite code', 'error'); return; }
    const name = $('login-name').value.trim();
    if (!name) { toast('Enter a name first', 'error'); return; }
    connectAndJoin({ join: code });
  });

  // Game bar actions
  $('leave-game-btn').addEventListener('click', () => {
    if (socket) { try { socket.disconnect(); } catch (_) { /* noop */ } socket = null; }
    show('home');
  });
  $('button-start-game').addEventListener('click', () => {
    const cw = $('custom-words-input');
    const co = $('custom-words-only');
    const words = (cw?.value || '').trim();
    const useOnly = !!(co && co.checked);
    if (words) {
      send(22, { words, useOnly: useOnly ? 1 : 0 });
    } else {
      send(22, '');
    }
  });
  $('button-invite').addEventListener('click', () => {
    if (!room) return;
    const link = window.location.origin + '/?room=' + room.id;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(link).then(
        () => toast('Invite link copied!', 'success'),
        () => toast('Link: ' + link, 'success')
      );
    } else {
      toast('Link: ' + link, 'success');
    }
  });

  $('logout-btn').addEventListener('click', () => window.Auth.logout());

  // ============================ SHAPES GRID GENERATION ============================
  const SHAPES = [
    { id:'line',      svg:'<line x1="4" y1="20" x2="20" y2="4"/>' },
    { id:'curve',     svg:'<path d="M4 16 Q9 4 12 12 T20 8"/>' },
    { id:'circle',    svg:'<circle cx="12" cy="12" r="8"/>' },
    { id:'rect',      svg:'<rect x="4" y="6" width="16" height="12"/>' },
    { id:'rrect',     svg:'<rect x="4" y="6" width="16" height="12" rx="4"/>' },
    { id:'parallel',  svg:'<path d="M7 20 L11 4 L21 4 L17 20 Z"/>' },
    { id:'triangle',  svg:'<path d="M12 4 L20 20 L4 20 Z"/>' },
    { id:'rtriangle', svg:'<path d="M5 4 L5 20 L20 20 Z"/>' },
    { id:'diamond',   svg:'<path d="M12 3 L21 12 L12 21 L3 12 Z"/>' },
    { id:'pentagon',  svg:'<path d="M12 3 L21 10 L18 20 L6 20 L3 10 Z"/>' },
    { id:'hexagon',   svg:'<path d="M7 4 L17 4 L21 12 L17 20 L7 20 L3 12 Z"/>' },
    { id:'arrow-r',   svg:'<path d="M4 12 H18 M13 6 L19 12 L13 18"/>' },
    { id:'arrow-l',   svg:'<path d="M20 12 H6 M11 6 L5 12 L11 18"/>' },
    { id:'arrow-u',   svg:'<path d="M12 20 V6 M6 11 L12 5 L18 11"/>' },
    { id:'arrow-d',   svg:'<path d="M12 4 V18 M6 13 L12 19 L18 13"/>' },
    { id:'sparkle',   svg:'<path d="M12 2 L14 10 L22 12 L14 14 L12 22 L10 14 L2 12 L10 10 Z"/>' },
    { id:'star',      svg:'<path d="M12 2 L14.6 9 L22 9.5 L16.2 14.2 L18 21.5 L12 17.5 L6 21.5 L7.8 14.2 L2 9.5 L9.4 9 Z"/>' },
    { id:'burst',     svg:'<path d="M12 2 L14 8 L20 6 L16 11 L22 12 L16 13 L20 18 L14 16 L12 22 L10 16 L4 18 L8 13 L2 12 L8 11 L4 6 L10 8 Z"/>' },
    { id:'bubble',    svg:'<path d="M4 5 H20 V16 H10 L6 20 V16 H4 Z"/>' },
    { id:'bubble2',   svg:'<ellipse cx="12" cy="11" rx="9" ry="7"/><path d="M8 17 L5 21 L11 18"/>' },
    { id:'cloud',     svg:'<path d="M7 17a4 4 0 0 1 0-8 5 5 0 0 1 9.6-1.5A4.5 4.5 0 0 1 17 17Z"/>' },
    { id:'heart',     svg:'<path d="M12 20 C4 14 2 9 6 6 C9 4 12 6 12 9 C12 6 15 4 18 6 C22 9 20 14 12 20 Z"/>' },
    { id:'lightning', svg:'<path d="M13 2 L4 14 H11 L9 22 L20 9 H13 Z"/>' }
  ];

  function buildShapesGrid() {
    const grid = $('shape-buttons');
    if (!grid) return;
    grid.innerHTML = '';
    SHAPES.forEach(s => {
      const b = el('button', 'shape-btn');
      b.type = 'button';
      b.dataset.shape = s.id;
      b.title = s.id;
      b.innerHTML = `<svg viewBox="0 0 24 24" style="stroke: currentColor; fill: none; stroke-width: 1.8; width: 60%; height: 60%;">${s.svg}</svg>`;
      b.addEventListener('click', (ev) => {
        ev.preventDefault();
        document.querySelectorAll('.shape-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('#tool-buttons .tool-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        tool = 'shape';
        currentShapeType = s.id;
      });
      grid.appendChild(b);
    });
  }

  // ============================ BOOTSTRAP ============================
  document.addEventListener('auth:ready', async () => {
    updateHomeUI();
    await loadLanguages();
    buildShapesGrid();
    buildPalette(false);
    setColor(11); setColor(0, true);
    setAvatar(Math.floor(Math.random() * HEAD_COLORS.length));
    const qs = new URLSearchParams(window.location.search);
    const r = extractRoomId(qs.get('room'));
    if (r) {
      connectAndJoin({ join: r });
    }
  });
  document.addEventListener('premium:unlocked', updateHomeUI);
})();
