/**
 * GameEngine: room management, state machine, drawer rotation, scoring, bots.
 * Implements the Skribbl.io protocol from the architecture spec.
 *
 * State enum:  G=0 K=1 F=2 V=3 j=4 Z=5 X=6 J=7
 * Settings:    [LANG, SLOTS, DRAWTIME, ROUNDS, WORDCOUNT, HINTCOUNT, WORDMODE, CUSTOMWORDSONLY]
 */
const { getLanguageList, getWords } = require('./wordBanks');

const STATE = { G: 0, K: 1, F: 2, V: 3, j: 4, Z: 5, X: 6, J: 7 };
const DEFAULT_SETTINGS = [0, 8, 80, 3, 3, 2, 0, 0]; // lang, slots, drawtime, rounds, wordcount, hints, mode, customwordsonly

const BOT_NAMES = ['Picasso', 'Vincent', 'Frida', 'Banksy', 'Doodle', 'Sketchy', 'Crayon', 'Brushy'];

/* ---------- Room ---------- */
class Room {
  constructor(io, opts) {
    this.io = io;
    this.id = opts.id;
    this.type = opts.type; // 0=public, 1=private
    this.modeId = opts.modeId || 'all'; // 'all' or 'movies'
    this.settings = opts.settings || [...DEFAULT_SETTINGS];
    this.players = []; // {id, name, avatar, score, guessed, flags, bot, socketId, userId, hasPremium}
    this.ownerId = null;
    this.round = 0;
    this.state = { id: this.type === 1 ? STATE.J : STATE.G, time: 0, data: null };
    this.drawCommands = [];
    this.currentWord = null;
    this.currentDrawerId = null;
    this.drawerQueue = [];
    this.timer = null;
    this.startCountdownTimer = null;
    this.tickTimer = null;
    this.hintInterval = null;
    this.revealedHints = [];
    this.nextPlayerId = 1;
    this.startTime = 0;
    this.roundEndReason = 1;
    this.guessedCount = 0;
    this.lastActivity = Date.now();
    // Moderation
    this.kickedUserIds = new Set();   // userIds the room kicked (cannot rejoin)
    this.bannedUserIds = new Set();   // userIds the room banned (cannot rejoin)
    this.votekicks = new Map();       // targetPlayerId -> Set<voterPlayerIds>
    // Drawing rating (thumbs up/down per drawing)
    this.ratings = new Map();         // raterPlayerId -> 0|1 for current drawing
    // Custom words mode (settings[7] = useOnly; this.customWords = array)
    this.customWords = [];
    this.pastWords = new Set();
    // Per-player chat spam tracker
    this.chatTs = new Map();          // playerId -> array of timestamps
  }

  /* ---- broadcasting helpers ---- */
  broadcast(id, data, exceptSocketId = null) {
    for (const p of this.players) {
      if (p.bot) continue;
      if (exceptSocketId && p.socketId === exceptSocketId) continue;
      const sock = this.io.sockets.sockets.get(p.socketId);
      if (sock) sock.emit('data', { id, data });
    }
  }
  sendTo(playerId, id, data) {
    const p = this.players.find((x) => x.id === playerId);
    if (!p || p.bot) return;
    const sock = this.io.sockets.sockets.get(p.socketId);
    if (sock) sock.emit('data', { id, data });
  }

  /* ---- player ---- */
  addPlayer(player) {
    player.id = this.nextPlayerId++;
    player.score = 0;
    player.guessed = false;
    player.flags = 0;
    if (!this.ownerId) {
      this.ownerId = player.id;
      player.flags |= 4;
    }
    this.players.push(player);
    this.lastActivity = Date.now();
    return player;
  }
  removePlayer(playerId, reason = 0) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const left = this.players.splice(idx, 1)[0];
    this.broadcast(2, { id: playerId, reason });
    // Clean up votekick state involving this player
    this.votekicks.delete(playerId);
    for (const [tid, set] of this.votekicks) { set.delete(playerId); if (set.size === 0) this.votekicks.delete(tid); }
    this.ratings.delete(playerId);
    this.chatTs.delete(playerId);
    if (this.ownerId === playerId) {
      const next = this.players.find((p) => !p.bot);
      if (next) {
        this.ownerId = next.id;
        next.flags |= 4;
        this.broadcast(17, next.id);
      }
    }
    // [FIX 1] Also abort if drawer leaves during word-selection phase (STATE.V)
    // Without this, the game would ghost-start with no drawer and freeze guessers.
    if (this.currentDrawerId === playerId && this.state.id === STATE.V) {
      clearTimeout(this.timer);
      this.roundEndReason = 2;
      // Skip to next drawer — or end round if queue empty
      if (this.drawerQueue.length > 0) {
        this.nextDrawer();
      } else if (this.round < this.settings[3]) {
        this.startRound();
      } else {
        this.gameOver();
      }
    } else if (this.currentDrawerId === playerId && this.state.id === STATE.j) {
      this.roundEndReason = 2;
      this.endDrawingPhase();
    }
    // Clean up any bot-only or empty room (prevents memory leak)
    const count = this.realPlayerCount();
    if (count === 0) {
      this.removeAllBots();
      this.cleanup();
      // Force room back to Lobby so it's clean if someone joins during the 60s grace period
      this.round = 0;
      this.currentWord = null;
      this.currentDrawerId = null;
      this.drawCommands = [];
      this.drawerQueue = [];
      this.revealedHints = [];
      this.players.forEach((p) => (p.score = 0));
      this.changeState(this.type === 1 ? STATE.J : STATE.G, 0, null);
    } else if (this.players.length < 2 && this.state.id !== STATE.G && this.state.id !== STATE.J) {
      // Abort the game if only 1 player remains (including bots) and we aren't in the lobby
      if (this.state.id === STATE.K) {
        // Just cancel the start countdown
        clearTimeout(this.startCountdownTimer);
        this.changeState(this.type === 1 ? STATE.J : STATE.G, 0, null);
      } else if (this.state.id !== STATE.X) {
        // End the active game properly
        this.gameOver();
      }
    }
  }
  realPlayerCount() {
    return this.players.filter((p) => !p.bot).length;
  }

  toLobbyInit(meId) {
    return {
      me: meId,
      type: this.type,
      id: this.id,
      settings: this.settings,
      users: this.players.map((p) => this.publicPlayer(p)),
      round: this.round,
      owner: this.ownerId,
      state: this.state,
      drawCommands: this.drawCommands,
    };
  }
  publicPlayer(p) {
    const hasDrawn = this.round > 0 && Array.isArray(this.drawerQueue) && !this.drawerQueue.includes(p.id) && p.id !== this.currentDrawerId;
    return {
      id: p.id,
      flags: p.flags,
      name: p.name,
      avatar: p.avatar,
      score: p.score,
      guessed: p.guessed,
      hasPremium: !!p.hasPremium,
      drawn: hasDrawn
    };
  }

  /* ---- state transitions ---- */
  changeState(stateId, time = 0, data = null) {
    this.state = { id: stateId, time, data };
    this.broadcast(11, { id: stateId, time, data });

    clearInterval(this.tickTimer);
    if (time > 0) {
      let remaining = time;
      this.tickTimer = setInterval(() => {
        remaining -= 1;
        if (remaining < 0) {
          clearInterval(this.tickTimer);
          return;
        }
        this.broadcast(14, remaining);
      }, 1000);
    }
  }

  maybeStartPublic() {
    if (this.type !== 0) return;
    if (this.state.id !== STATE.G) return;
    const playable = this.players.length; // including bots
    if (playable < 2) return;
    // brief countdown
    this.changeState(STATE.K, 3, null);
    clearTimeout(this.startCountdownTimer);
    this.startCountdownTimer = setTimeout(() => this.startGame(), 3000);
  }
  startPrivate() {
    if (this.type !== 1) return;
    if (this.players.length < 2) {
      // notify "need at least 2 players"
      this.broadcast(31, { id: 0 });
      return;
    }
    this.changeState(STATE.K, 3, null);
    clearTimeout(this.startCountdownTimer);
    this.startCountdownTimer = setTimeout(() => this.startGame(), 3000);
  }

  startGame() {
    this.round = 0;
    this.players.forEach((p) => (p.score = 0));
    this.startRound();
  }

  startRound() {
    this.round += 1;
    if (this.round > this.settings[3]) return this.gameOver();
    // Build drawer queue for this round (all real+bot players, randomized)
    this.drawerQueue = [...this.players].sort(() => Math.random() - 0.5).map((p) => p.id);
    this.currentDrawerId = null;
    this.currentWord = null;
    this.changeState(STATE.F, 3, this.round - 1); // round index (0-based)
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.nextDrawer(), 3000);
  }

  nextDrawer() {
    if (this.drawerQueue.length === 0) {
      // Round finished, move on
      if (this.round >= this.settings[3]) return this.gameOver();
      return this.startRound();
    }
    const drawerId = this.drawerQueue.shift();
    const drawer = this.players.find((p) => p.id === drawerId);
    if (!drawer) return this.nextDrawer();
    this.currentDrawerId = drawer.id;
    this.players.forEach((p) => (p.guessed = false));
    this.guessedCount = 0;
    this.drawCommands = [];
    this.revealedHints = [];
    this.ratings.clear();
    this.broadcast(20, null); // clear canvas

    const count = Math.max(1, this.settings[4]);
    const choicesCount = this.settings[6] === 2 ? count * 2 : count;
    const choices = this.getWordChoices(choicesCount);
    this.pendingChoices = choices;

    // Word selection state
    this.changeState(STATE.V, 15, { id: drawer.id });
    // Drawer-only payload with the actual words
    this.sendTo(drawer.id, 11, { id: STATE.V, time: 15, data: { id: drawer.id, words: choices } });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.onWordTimeout(), 15000);

    // If drawer is a bot, auto-pick after a short delay
    if (drawer.bot) {
      setTimeout(() => {
        if (this.currentDrawerId === drawer.id && this.state.id === STATE.V) {
          this.selectWord(drawer.id, Math.floor(Math.random() * choices.length));
        }
      }, 1500);
    }
  }

  onWordTimeout() {
    // Drawer didn't pick — auto-pick first word
    if (this.state.id === STATE.V) {
      if (this.settings[6] === 2) {
        this.selectWord(this.currentDrawerId, [0, 0]);
      } else {
        this.selectWord(this.currentDrawerId, 0);
      }
    }
  }

  selectWord(playerId, choiceIdx) {
    if (playerId !== this.currentDrawerId) return;
    if (this.state.id !== STATE.V) return;
    let word;
    if (Array.isArray(choiceIdx) && this.settings[6] === 2) {
      const half = this.pendingChoices.length / 2;
      const w1 = this.pendingChoices[choiceIdx[0]];
      const w2 = this.pendingChoices[choiceIdx[1] + half];
      if (w1 && w2) {
        word = `${w1} ${w2}`;
      }
    } else if (typeof choiceIdx === 'number') {
      word = this.pendingChoices[choiceIdx];
    }
    if (!word) word = this.pendingChoices[0];
    this.currentWord = word.toLowerCase();
    this.pastWords.add(this.currentWord);
    clearTimeout(this.timer);

    const drawtime = this.settings[2];
    this.startTime = Date.now();
    
    // Reset emoji counts for all players at the start of a new drawing phase
    this.players.forEach(p => p.emojiCount = 0);

    this.changeState(STATE.j, drawtime, {
      id: this.currentDrawerId,
      word: this.currentWord.split(' ').map((w) => w.length),
      drawCommands: [],
    });
    // Drawer gets the actual word
    this.sendTo(this.currentDrawerId, 11, {
      id: STATE.j,
      time: drawtime,
      data: { id: this.currentDrawerId, word: this.currentWord, drawCommands: [] },
    });


    // Hint schedule
    this.scheduleHints(drawtime);

    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.roundEndReason = 1;
      this.endDrawingPhase();
    }, drawtime * 1000);

    // AFK Kick Timer for drawer
    const drawer = this.players.find((p) => p.id === this.currentDrawerId);
    if (drawer && !drawer.bot) {
      // [FIX 2] Reset the hasDrawn flag each new round so the check is fresh
      drawer.hasDrawn = false;
      clearTimeout(this.afkTimer);
      this.afkTimer = setTimeout(() => {
        if (this.state.id === STATE.j && this.currentDrawerId === drawer.id) {
          // [FIX 2] Only kick if they genuinely never drew anything this round
          if (!drawer.hasDrawn) {
            this.broadcast(30, { id: 0, msg: `${drawer.name} was kicked for not drawing.` });
            this.sendTo(drawer.id, 100, 1);
            this.removePlayer(drawer.id, 1);
            this.kickPlayerSocket(drawer);
          }
        }
      }, 35000); // 35 seconds
    }

    // If drawer is a bot, generate some doodles
    if (drawer && drawer.bot) {
      this.botDoodle();
    }
  }

  scheduleHints(drawtime) {
    clearInterval(this.hintInterval);
    if (this.settings[6] === 1) return; // Disable hints in Hidden mode
    const hintCount = Math.min(this.settings[5], Math.floor(this.currentWord.replace(/\s/g, '').length / 2));
    if (hintCount <= 0) return;
    const interval = Math.floor((drawtime * 1000) / (hintCount + 1));
    let revealed = 0;
    this.hintInterval = setInterval(() => {
      const word = this.currentWord;
      if (revealed >= hintCount || !word) {
        clearInterval(this.hintInterval);
        return;
      }
      const candidates = [];
      for (let i = 0; i < word.length; i++) {
        if (word[i] === ' ') continue;
        if (this.revealedHints.includes(i)) continue;
        candidates.push(i);
      }
      if (candidates.length === 0) {
        clearInterval(this.hintInterval);
        return;
      }
      const idx = candidates[Math.floor(Math.random() * candidates.length)];
      this.revealedHints.push(idx);
      // Broadcast to non-drawer guessers
      const payload = [[idx, this.currentWord[idx]]];
      for (const p of this.players) {
        if (p.bot) continue;
        if (p.id === this.currentDrawerId) continue;
        if (p.guessed) continue;
        const sock = this.io.sockets.sockets.get(p.socketId);
        if (sock) sock.emit('data', { id: 13, data: payload });
      }
      revealed++;
    }, interval);
  }

  endDrawingPhase() {
    clearTimeout(this.afkTimer);
    clearTimeout(this.timer);
    clearInterval(this.tickTimer);
    clearInterval(this.hintInterval);
    // Reveal scores
    const scoresFlat = [];
    for (const p of this.players) {
      scoresFlat.push(p.id, p.score, p.deltaScore || 0, p.guessTime || 0);
    }
    this.changeState(STATE.Z, 5, {
      word: this.currentWord,
      reason: this.roundEndReason,
      scores: scoresFlat,
    });
    this.players.forEach((p) => {
      p.deltaScore = 0;
      p.guessTime = 0;
    });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // next drawer in queue, or next round, or game over
      if (this.drawerQueue.length > 0) {
        this.nextDrawer();
      } else if (this.round < this.settings[3]) {
        this.startRound();
      } else {
        this.gameOver();
      }
    }, 5000);
  }

  gameOver() {
    clearTimeout(this.timer);
    clearTimeout(this.startCountdownTimer);
    try {
      const ranked = [...this.players].sort((a, b) => b.score - a.score);
      const data = ranked.map((p, idx) => [p.id, idx, idx === 0 ? 'Winner' : `Rank ${idx + 1}`]);
      this.changeState(STATE.X, 10, data);
    } catch (e) {
      console.error('Error in gameOver state transition:', e);
    }
    
    this.timer = setTimeout(() => {
      try {
        // Reset to lobby
        this.round = 0;
        this.currentWord = null;
        this.currentDrawerId = null;
        this.drawCommands = [];
        this.drawerQueue = [];
        this.revealedHints = [];
        this.players.forEach((p) => (p.score = 0));
        this.changeState(this.type === 1 ? STATE.J : STATE.G, 0, null);
        if (this.type === 0) this.maybeStartPublic();
      } catch (e) {
        console.error('Error in gameOver timeout:', e);
      }
    }, 10000);
  }

  /* ---- drawing ---- */
  receiveDrawCommands(playerId, cmds) {
    if (playerId !== this.currentDrawerId) return;
    if (this.state.id !== STATE.j) return;
    if (!Array.isArray(cmds)) return;
    
    // Hard cap on drawCommands array size to prevent memory bloat
    if (this.drawCommands.length + cmds.length > 50000) return;
    
    // [FIX 2] Mark drawer as active so AFK timer never falsely kicks an active drawer
    const drawerRef = this.players.find((p) => p.id === playerId);
    if (drawerRef) drawerRef.hasDrawn = true;
    
    for (const c of cmds) this.drawCommands.push(c);
    // broadcast to non-drawers only
    for (const p of this.players) {
      if (p.bot) continue;
      if (p.id === this.currentDrawerId) continue;
      const sock = this.io.sockets.sockets.get(p.socketId);
      if (sock) sock.emit('data', { id: 19, data: cmds });
    }
  }
  clearCanvas(playerId) {
    if (playerId !== this.currentDrawerId) return;
    // [FIX 2] Canvas clear also counts as drawing activity
    const drawerRef = this.players.find((p) => p.id === playerId);
    if (drawerRef) drawerRef.hasDrawn = true;
    this.drawCommands = [];
    this.broadcast(20, null);
  }
  undoCanvas(playerId, newLen) {
    if (playerId !== this.currentDrawerId) return;
    if (typeof newLen !== 'number') return;
    if (newLen < 0 || newLen > this.drawCommands.length) return;
    // [FIX 2] Undo also counts as drawing activity
    const drawerRef = this.players.find((p) => p.id === playerId);
    if (drawerRef) drawerRef.hasDrawn = true;
    this.drawCommands.length = newLen;
    this.broadcast(21, newLen);
  }

  receiveEmoji(playerId, emojiStr) {
    const p = this.players.find((x) => x.id === playerId);
    if (!p) return;
    
    // Server-side check for max 5 emojis per drawing round
    p.emojiCount = p.emojiCount || 0;
    if (p.emojiCount >= 15) return;
    
    p.emojiCount++;
    this.broadcast(33, { id: playerId, emoji: emojiStr }, p.socketId);
  }

  /* ---- chat & guessing ---- */
  receiveChat(playerId, msg) {
    msg = String(msg || '').trim();
    if (!msg) return;
    if (msg.length > 100) msg = msg.slice(0, 100);
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;

    // ---- Spam detection (packet id:32 / "Oa") ----
    // Keep a sliding window of recent chat timestamps; if > 4 messages in 3 s,
    // warn the player privately and drop the message. If warned 3 times, kick them.
    const now = Date.now();
    let ts = this.chatTs.get(playerId) || [];
    ts = ts.filter((t) => now - t < 3000);
    ts.push(now);
    this.chatTs.set(playerId, ts);
    if (ts.length > 4) {
      player.spamWarnCount = (player.spamWarnCount || 0) + 1;
      if (player.spamWarnCount >= 3) {
        this.removePlayer(playerId, 1); // Reason 1 is typically used for Kick
        return;
      }
      this.sendTo(playerId, 32, { id: 0, msg: 'You are typing too fast' });
      return;
    }

    // Drawer cannot chat during drawing, EXCEPT in the last 10 seconds (Clue feature)
    if (this.state.id === STATE.j && playerId === this.currentDrawerId) {
      const remaining = Math.max(0, this.settings[2] - (Date.now() - this.startTime) / 1000);
      if (remaining <= 10) {
        // Anti-cheat: kick drawer if they type the exact word in the hint
        if (this.currentWord) {
          const normalizedMsg = msg.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
          const normalizedWord = this.currentWord.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
          if ((' ' + normalizedMsg + ' ').includes(' ' + normalizedWord + ' ')) {
            this.broadcast(30, { id: 0, msg: `🚫 ${player.name} was kicked for typing the word in a hint!` });
            this.removePlayer(playerId, 1);
            return;
          }
        }
        // Send as a system message to distinguish it as a clue
        this.broadcast(30, { id: 0, msg: `💡 Clue from ${player.name}: ${msg}` });
      }
      return;
    }

    if (this.state.id === STATE.j && this.currentWord) {
      // Normalize guess by replacing symbols with space and trimming extra spaces
      const guess = msg.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
      if (guess === this.currentWord) {
        if (player.guessed) return;
        player.guessed = true;
        this.guessedCount++;
        player.guessTime = Math.round((Date.now() - this.startTime) / 1000);
        // score: drawer gets points + guesser gets time-based points
        const remaining = Math.max(0, this.settings[2] - player.guessTime);
        const guesserPoints = Math.round(50 + (remaining / this.settings[2]) * 250);
        const drawerPoints = Math.round(20 + (remaining / this.settings[2]) * 100);
        player.score += guesserPoints;
        player.deltaScore = (player.deltaScore || 0) + guesserPoints;
        const drawer = this.players.find((x) => x.id === this.currentDrawerId);
        if (drawer) {
          drawer.score += drawerPoints;
          drawer.deltaScore = (drawer.deltaScore || 0) + drawerPoints;
        }
        // broadcast correct guess (no message content shown to non-guessers)
        this.broadcast(15, { id: playerId, word: this.currentWord });
        // Check end condition
        const eligibleGuessers = this.players.filter((p) => p.id !== this.currentDrawerId);
        const allGuessed = eligibleGuessers.every((p) => p.guessed || p.bot);
        if (allGuessed) {
          this.roundEndReason = 0;
          this.endDrawingPhase();
        }
        return;
      }
      // Close guess — Levenshtein distance 1 OR 2 (per spec §6.2 id:16 "$a")
      const dist = levenshtein(guess, this.currentWord);
      if (dist === 1 || dist === 2) {
        this.sendTo(playerId, 16, player.name);
      }
    }

    // If guesser already guessed, only other guessed players (+drawer) see msg.
    if (player.guessed) {
      for (const p of this.players) {
        if (p.bot) continue;
        if (p.guessed || p.id === this.currentDrawerId) {
          const sock = this.io.sockets.sockets.get(p.socketId);
          if (sock) sock.emit('data', { id: 30, data: { id: playerId, msg } });
        }
      }
    } else {
      // Normal chat — everyone sees
      this.broadcast(30, { id: playerId, msg });
    }
  }

  /* ---- moderation (id:3 kick, id:4 ban, id:5 votekick) ---- */
  ownerKick(actorId, targetId) {
    if (actorId !== this.ownerId) return;
    const target = this.players.find((p) => p.id === targetId);
    if (!target || target.id === this.ownerId) return;
    if (target.userId) this.kickedUserIds.add(target.userId);
    this.sendTo(target.id, 100, 1);
    // Remove FIRST so id:2 broadcast carries the correct reason; disconnect AFTER
    this.removePlayer(target.id, 1);
    this.kickPlayerSocket(target);
  }
  ownerBan(actorId, targetId) {
    if (actorId !== this.ownerId) return;
    const target = this.players.find((p) => p.id === targetId);
    if (!target || target.id === this.ownerId) return;
    if (target.userId) this.bannedUserIds.add(target.userId);
    this.sendTo(target.id, 100, 2);
    this.removePlayer(target.id, 2);
    this.kickPlayerSocket(target);
  }
  kickPlayerSocket(p) {
    if (!p || p.bot || !p.socketId) return;
    const sock = this.io.sockets.sockets.get(p.socketId);
    if (sock) {
      try { sock.emit('reason', 1); sock.disconnect(true); } catch (_) { /* noop */ }
    }
  }
  reportPlayer(reporterId, targetId, reasons) {
    const target = this.players.find((p) => p.id === targetId);
    if (!target) return;
    console.log(`[report] Player ${reporterId} reported Player ${targetId} for reasons mask ${reasons}`);
    if (!this.reports) this.reports = new Map();
    let set = this.reports.get(targetId);
    if (!set) {
      set = new Set();
      this.reports.set(targetId, set);
    }
    set.add(reporterId);
  }
  updatePlayerAvatar(playerId, avatarArray) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    // Validate payload to prevent malicious injections
    if (!Array.isArray(avatarArray)) return;
    const cleanAvatar = avatarArray.slice(0, 4).map(v => typeof v === 'number' ? v : 0);
    player.avatar = cleanAvatar;
    this.broadcast(9, { id: playerId, avatar: cleanAvatar });
  }
  votekick(voterId, targetId) {
    if (voterId === targetId) return;
    if (this.type !== 0) return; // votekick only in public rooms
    const target = this.players.find((p) => p.id === targetId);
    const voter = this.players.find((p) => p.id === voterId);
    if (!target || !voter) return;
    if (target.id === this.ownerId) return;
    let set = this.votekicks.get(targetId);
    if (!set) { set = new Set(); this.votekicks.set(targetId, set); }
    set.add(voterId);
    const eligible = this.players.filter((p) => !p.bot && p.id !== targetId).length;
    const required = Math.max(2, Math.ceil(eligible / 2));
    const count = set.size;
    this.broadcast(5, [voterId, targetId, count, required]);
    if (count >= required) {
      this.votekicks.delete(targetId);
      if (target.userId) this.kickedUserIds.add(target.userId);
      // Remove FIRST so id:2 broadcast carries reason=1, then disconnect
      this.removePlayer(target.id, 1);
      this.kickPlayerSocket(target);
    }
  }

  /* ---- drawing rating (id:8 / "Sa") ---- */
  rateDrawing(raterId, vote) {
    if (this.state.id !== STATE.j) return;
    if (raterId === this.currentDrawerId) return;
    const v = vote === 1 ? 1 : 0;
    this.ratings.set(raterId, v);
    this.broadcast(8, { id: raterId, vote: v });
  }

  /* ---- custom words helper (id:22) ---- */
  setCustomWords(actorId, payload) {
    if (actorId !== this.ownerId) return;
    if (!payload) return;
    let words = [];
    let useOnly = false;
    if (typeof payload === 'string') {
      words = payload.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (typeof payload === 'object') {
      if (typeof payload.words === 'string') {
        words = payload.words.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      } else if (Array.isArray(payload.words)) {
        words = payload.words.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
      }
      useOnly = !!payload.useOnly;
    }
    // Limit + sanitize + deduplicate
    words = [...new Set(words.filter((w) => w.length >= 2 && w.length <= 30))].slice(0, 200);
    this.customWords = words;
    this.settings[7] = useOnly ? 1 : 0;
    this.broadcast(12, { id: 7, val: this.settings[7] });
  }
  getWordChoices(count) {
    const useOnly = !!this.settings[7];
    
    // Prevent repeats from customWords
    let availableCustom = this.customWords.filter(w => !this.pastWords.has(w));
    
    // If we need custom words but don't have enough fresh ones, reset history
    if (useOnly && this.customWords.length >= count && availableCustom.length < count) {
      this.pastWords.clear();
      availableCustom = this.customWords;
    } else if (!useOnly && this.customWords.length > 0 && availableCustom.length === 0) {
      this.pastWords.clear();
      availableCustom = this.customWords;
    }

    if (useOnly && availableCustom.length >= count) {
      // pick `count` unique custom words
      const picks = new Set();
      const pool = [...availableCustom];
      while (picks.size < count && pool.length) {
        const i = Math.floor(Math.random() * pool.length);
        picks.add(pool.splice(i, 1)[0]);
      }
      return Array.from(picks);
    }
    // Mix: half custom (if any), half language bank
    const base = getWords(this.settings[0], count, this.modeId, this.pastWords);
    if (availableCustom.length === 0) return base;
    const custom = [...availableCustom].sort(() => Math.random() - 0.5).slice(0, Math.ceil(count / 2));
    const merged = [...new Set([...custom, ...base])].sort(() => Math.random() - 0.5).slice(0, count);
    return merged.length ? merged : base;
  }

  /* ---- bots ---- */
  spawnBot() {
    if (this.players.length >= this.settings[1]) return false;
    const name = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)] + '#' + Math.floor(Math.random() * 99);
    const bot = {
      id: 0,
      name,
      avatar: [
        Math.floor(Math.random() * 10),
        Math.floor(Math.random() * 10),
        Math.floor(Math.random() * 10),
        -1,
      ],
      bot: true,
      socketId: null,
      userId: null,
      hasPremium: false,
    };
    this.addPlayer(bot);
    this.broadcast(1, this.publicPlayer(bot));
    return true;
  }
  removeAllBots() {
    const bots = this.players.filter((p) => p.bot);
    for (const b of bots) this.removePlayer(b.id);
  }
  botDoodle() {
    // Generates a few random strokes so the canvas isn't blank
    let strokes = 0;
    const maxStrokes = 20;
    const draw = () => {
      if (strokes >= maxStrokes) return;
      if (this.state.id !== STATE.j) return;
      const cmds = [];
      const color = Math.floor(Math.random() * 26);
      const size = 1 + Math.floor(Math.random() * 4);
      const x1 = Math.random() * 800,
        y1 = Math.random() * 600,
        x2 = x1 + (Math.random() - 0.5) * 200,
        y2 = y1 + (Math.random() - 0.5) * 200;
      cmds.push([0, color, size, x1 | 0, y1 | 0, x2 | 0, y2 | 0]);
      this.drawCommands.push(...cmds);
      this.broadcast(19, cmds);
      strokes++;
      setTimeout(draw, 1000 + Math.random() * 1500);
    };
    setTimeout(draw, 800);
  }

  /* ---- lobby ops ---- */
  updateSetting(playerId, settingIdx, value) {
    if (playerId !== this.ownerId) return;
    if (settingIdx < 0 || settingIdx > 7) return;
    
    // Bounds validation to prevent crashes
    if (typeof value !== 'number') return;
    if (settingIdx === 1) value = Math.max(2, Math.min(20, value)); // slots
    if (settingIdx === 2) value = Math.max(10, Math.min(300, value)); // drawtime
    if (settingIdx === 3) value = Math.max(1, Math.min(10, value)); // rounds
    if (settingIdx === 4) value = Math.max(1, Math.min(10, value)); // wordcount
    if (settingIdx === 5) value = Math.max(0, Math.min(10, value)); // hints
    
    this.settings[settingIdx] = value;
    this.broadcast(12, { id: settingIdx, val: value });
  }

  cleanup() {
    clearTimeout(this.afkTimer);
    clearTimeout(this.timer);
    clearTimeout(this.startCountdownTimer);
    clearInterval(this.tickTimer);
    clearInterval(this.hintInterval);
  }
}

/* ---------- Engine ---------- */
class GameEngine {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
    this.deletionTimeouts = new Map(); // [FIX H4] Always initialized — never undefined
    this.disconnectTimers = new Map(); // Always initialized — prevents crash on first login before any disconnect
  }
  publicRoomForLang(langId, userId, modeId = 'all') {
    for (const room of this.rooms.values()) {
      if (room.type !== 0) continue;
      if (room.settings[0] !== langId) continue;
      if (room.modeId !== modeId) continue;
      if (room.players.length >= room.settings[1]) continue;
      if (userId != null && (room.bannedUserIds.has(userId) || room.kickedUserIds.has(userId))) continue;
      return room;
    }
    return null;
  }
  createPublic(langId, modeId = 'all') {
    const id = 'pub_' + randomId();
    const room = new Room(this.io, { id, type: 0, modeId, settings: [langId, 8, 80, 3, 3, 2, 0, 0] });
    this.rooms.set(id, room);
    return room;
  }
  createPrivate(langId = 0, modeId = 'all') {
    const id = randomId();
    const room = new Room(this.io, { id, type: 1, modeId, settings: [langId, 8, 80, 3, 3, 2, 0, 0] });
    this.rooms.set(id, room);
    return room;
  }
  getRoom(id) {
    return this.rooms.get(id);
  }
  removeRoom(id) {
    const r = this.rooms.get(id);
    if (r) {
      r.cleanup();
      this.rooms.delete(id);
    }
  }
}

// [FIX M7] Use crypto.randomBytes for much larger collision space (281 trillion combos)
const { randomBytes } = require('crypto');
function randomId() {
  return randomBytes(8).toString('hex'); // 16 hex chars
}

/* ---- helpers ---- */
function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length,
    n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}

module.exports = { GameEngine, Room, STATE };
