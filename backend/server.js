/**
 * AdvScribbl Backend — Express + Socket.io + PostgreSQL
 * No-auth mode: players join by username directly (like skribbl.io)
 * Premium features are free for all users — no payment required.
 */
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');

const { q }                     = require('./db');
const { GameEngine }            = require('./gameEngine');
const { getLanguageList }       = require('./wordBanks');

const PORT = Number(process.env.PORT) || 8001;

// ===================== CORS =====================
const rawOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:8001')
  .split(',').map((s) => s.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || rawOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin "${origin}" not allowed`));
    }
  },
  credentials: true,
};

const app = express();
app.use(cors(corsOptions));
app.use(bodyParser.json({ limit: '256kb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// ===================== RATE LIMITER =====================
const rateLimitStore = new Map();

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let hits = rateLimitStore.get(ip) || [];
    hits = hits.filter((t) => now - t < windowMs);
    hits.push(now);
    rateLimitStore.set(ip, hits);
    if (hits.length > maxRequests) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    next();
  };
}

setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [ip, hits] of rateLimitStore) {
    if (!hits.some((t) => t > cutoff)) rateLimitStore.delete(ip);
  }
}, 5 * 60 * 1000);

// ===================== ROUTES =====================
// Health + meta
app.get('/api/',          (req, res) => res.json({ ok: true, service: 'advscribbl' }));
app.get('/api/health',    (req, res) => res.json({ ok: true }));
app.get('/api/languages', (req, res) => res.json({ languages: getLanguageList() }));

// Admin stats
app.get('/api/admin/stats', async (req, res) => {
  const secret = req.query.secret || req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const allRooms      = Array.from(engine.rooms.values());
    const activeRooms   = allRooms.length;
    const activePlayers = allRooms.reduce((acc, r) => acc + r.realPlayerCount(), 0);
    res.json({
      live: { activeRooms, activePlayers }
    });
  } catch (err) {
    console.error('[stats]', err);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// POST /api/play — matchmaking
app.post('/api/play', (req, res) => {
  const langId = parseInt(req.body.lang ?? '0', 10);
  const modeId = String(req.body.mode || 'all');
  const roomId = req.body.id;
  let room;
  if (roomId) {
    room = engine.getRoom(String(roomId));
    if (!room) return res.status(404).json({ error: 'Room not found' });
  } else {
    room = engine.publicRoomForLang(langId, null, modeId) || engine.createPublic(langId, modeId);
  }
  return res.json({ roomId: room.id, type: room.type });
});

// POST /api/private — create a private room
app.post('/api/private', (req, res) => {
  const langId = parseInt(req.body.lang ?? '0', 10);
  const modeId = String(req.body.mode || 'all');
  const room = engine.createPrivate(langId, modeId);
  return res.json({ roomId: room.id });
});

// Static pages
app.get('/api/terms',   (req, res) => res.type('html').send(TERMS_HTML));
app.get('/api/credits', (req, res) => res.type('html').send(CREDITS_HTML));

// Serve the frontend
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ===================== SERVER + SOCKET.IO =====================
const server = http.createServer(app);
const io = new Server(server, {
  path: '/api/socket.io/',
  cors: corsOptions,
  maxHttpBufferSize: 512 * 1024,
});
const engine = new GameEngine(io);

// ===================== SOCKET MIDDLEWARE =====================
// No JWT — anyone can connect. All users get premium features for free.
io.use((socket, next) => {
  const rawName = (socket.handshake.auth?.name || '').trim().slice(0, 21);
  if (!rawName) return next(new Error('NAME_REQUIRED'));
  socket.playerName = rawName;
  socket.hasPremium = true; // All users get premium features for free
  next();
});

const MAX_CMDS_PER_PACKET = 200;

// ===================== SOCKET EVENTS =====================
io.on('connection', (socket) => {
  socket.roomId   = null;
  socket.playerId = null;

  socket.on('login', (payload = {}) => {
    try {
      const langId     = parseInt(payload.lang ?? '0', 10);
      const modeId     = String(payload.mode || 'all');
      const joinId     = payload.join;
      const create     = payload.create === 1;
      const playerName = String(payload.name || socket.playerName || 'Player').slice(0, 21);
      const avatar     = Array.isArray(payload.avatar) ? payload.avatar.slice(0, 4) : [0, 0, 0, -1];
      const ip         = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;

      // Reconnect grace period
      if (joinId && engine.disconnectTimers) {
        const targetRoom = engine.getRoom(String(joinId));
        if (targetRoom) {
          const existingPlayer = targetRoom.players.find(p =>
            engine.disconnectTimers.has(p.id) && (p.ip === ip && p.name === playerName)
          );
          if (existingPlayer) {
            clearTimeout(engine.disconnectTimers.get(existingPlayer.id));
            engine.disconnectTimers.delete(existingPlayer.id);
            existingPlayer.socketId = socket.id;
            socket.roomId   = targetRoom.id;
            socket.playerId = existingPlayer.id;
            socket.join(targetRoom.id);
            socket.emit('data', { id: 10, data: targetRoom.toLobbyInit(existingPlayer.id) });
            return;
          }
        }
      }

      // Global name uniqueness check
      let nameTaken = false;
      let stolenPlayer = null;
      let stolenRoom = null;
      for (const r of engine.rooms.values()) {
        const p = r.players.find((p) => !p.bot && p.name.toLowerCase() === playerName.toLowerCase());
        if (p) {
          if (p.ip === ip) {
            stolenPlayer = p;
            stolenRoom = r;
          } else {
            nameTaken = true;
          }
          break;
        }
      }
      if (stolenPlayer) {
        // Only allow session reclaiming if the socket is actually disconnected
        if (engine.disconnectTimers && engine.disconnectTimers.has(stolenPlayer.id)) {
          clearTimeout(engine.disconnectTimers.get(stolenPlayer.id));
          engine.disconnectTimers.delete(stolenPlayer.id);
          stolenRoom.removePlayer(stolenPlayer.id, 0);
        } else {
          return socket.emit('joinerr', 6);
        }
      } else if (nameTaken) {
        return socket.emit('joinerr', 6);
      }

      let room;
      if (create) {
        room = engine.createPrivate(langId, modeId);
      } else if (joinId && joinId !== 0 && joinId !== '0') {
        room = engine.getRoom(String(joinId));
        if (!room)                              return socket.emit('joinerr', 1);
        if (room.bannedIPs.has(ip))             return socket.emit('joinerr', 4);
        if (room.kickedIPs.has(ip))             return socket.emit('joinerr', 3);
        if (room.players.length >= room.settings[1]) {
          const botIdx = room.players.findIndex(p => p.bot);
          if (botIdx !== -1) {
            room.removePlayer(room.players[botIdx].id, 0);
          } else {
            return socket.emit('joinerr', 2);
          }
        }
        if (engine.deletionTimeouts.has(room.id)) {
          clearTimeout(engine.deletionTimeouts.get(room.id));
          engine.deletionTimeouts.delete(room.id);
        }
      } else {
        room = engine.publicRoomForLang(langId, ip, modeId) || engine.createPublic(langId, modeId);
      }

      const player = {
        name:       playerName,
        avatar,
        socketId:   socket.id,
        userId:     null,
        hasPremium: socket.hasPremium,
        bot:        false,
        ip,
      };
      room.addPlayer(player);
      socket.roomId   = room.id;
      socket.playerId = player.id;
      socket.join(room.id);
      socket.emit('data', { id: 10, data: room.toLobbyInit(player.id) });
      room.broadcast(1, room.publicPlayer(player), socket.id);
      if (room.type === 0) room.maybeStartPublic();
    } catch (err) {
      console.error('[login]', err);
      socket.emit('joinerr', 1);
    }
  });

  socket.on('data', (msg = {}) => {
    const room = engine.getRoom(socket.roomId);
    if (!room) return;
    const playerId = socket.playerId;
    const { id, data } = msg;
    switch (id) {
      case 3:  if (typeof data === 'number') room.ownerKick(playerId, data); break;
      case 4:  if (typeof data === 'number') room.ownerBan(playerId, data); break;
      case 5:  if (typeof data === 'number') room.votekick(playerId, data); break;
      case 6:
        if (data && typeof data.id === 'number' && typeof data.reasons === 'number')
          room.reportPlayer(playerId, data.id, data.reasons);
        break;
      case 7:  if (typeof data === 'number') console.log(`[mute] Player ${playerId} muted ${data}`); break;
      case 8:  if (data === 0 || data === 1) room.rateDrawing(playerId, data); break;
      case 9:  if (Array.isArray(data)) room.updatePlayerAvatar(playerId, data); break;
      case 12:
        if (data && typeof data.id === 'number' && data.val !== undefined)
          room.updateSetting(playerId, data.id, data.val);
        break;
      case 18: if (typeof data === 'number' || Array.isArray(data)) room.selectWord(playerId, data); break;
      case 19:
        if (Array.isArray(data) && data.length <= MAX_CMDS_PER_PACKET) {
          if (!socket.drawTs) socket.drawTs = [];
          const now = Date.now();
          socket.drawTs = socket.drawTs.filter(t => now - t < 1000);
          socket.drawTs.push(now);
          if (socket.drawTs.length > 25) break;
          room.receiveDrawCommands(playerId, data);
        }
        break;
      case 20: 
        if (!socket.drawTs) socket.drawTs = [];
        {
          const now = Date.now();
          socket.drawTs = socket.drawTs.filter(t => now - t < 1000);
          socket.drawTs.push(now);
          if (socket.drawTs.length > 25) break;
        }
        room.clearCanvas(playerId); 
        break;
      case 21: 
        if (typeof data === 'number') {
          if (!socket.drawTs) socket.drawTs = [];
          const now = Date.now();
          socket.drawTs = socket.drawTs.filter(t => now - t < 1000);
          socket.drawTs.push(now);
          if (socket.drawTs.length > 25) break;
          room.undoCanvas(playerId, data); 
        }
        break;
      case 22:
        if (room.type === 1 && playerId === room.ownerId) {
          if (data && (typeof data === 'string' || typeof data === 'object'))
            room.setCustomWords(playerId, data);
          room.startPrivate();
        }
        break;
      case 30: if (typeof data === 'string') room.receiveChat(playerId, data); break;
      case 33: if (typeof data === 'string') room.receiveEmoji(playerId, data); break;
      default: break;
    }
  });

  socket.on('disconnect', () => {
    const room = engine.getRoom(socket.roomId);
    if (!room) return;
    const playerId = socket.playerId;
    const roomId   = socket.roomId;
    const tId = setTimeout(() => {
      engine.disconnectTimers.delete(playerId);
      const currentRoom = engine.getRoom(roomId);
      if (!currentRoom) return;
      currentRoom.removePlayer(playerId, 0);
      if (currentRoom.realPlayerCount() === 0) {
        if (engine.deletionTimeouts.has(currentRoom.id)) {
          clearTimeout(engine.deletionTimeouts.get(currentRoom.id));
        }
        const t = setTimeout(() => {
          if (currentRoom.realPlayerCount() === 0) {
            console.log(`[cleanup] Room ${currentRoom.id} deleted`);
            engine.removeRoom(currentRoom.id);
          }
          engine.deletionTimeouts.delete(currentRoom.id);
        }, 60_000);
        engine.deletionTimeouts.set(currentRoom.id, t);
      }
    }, 10_000);
    engine.disconnectTimers.set(playerId, tId);
  });
});

// ===================== START =====================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[skribbl] backend listening on :${PORT}`);
  console.log(`[skribbl] allowed origins: ${rawOrigins.join(', ')}`);
});

// ===================== GRACEFUL SHUTDOWN =====================
function shutdown(signal) {
  console.log(`\n[skribbl] Received ${signal} — shutting down gracefully...`);
  server.close(() => {
    setTimeout(() => { process.exit(0); }, 1000);
  });
  setTimeout(() => { process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

/* ---------- static HTML pages ---------- */
const SUPPORT = process.env.SUPPORT_EMAIL || 'support@advscribbl.app';

const TERMS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Terms of Service - AdvScribbl</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<style>body{font-family:'Outfit',system-ui,sans-serif;background:#0D0D12;color:#fff;max-width:1000px;margin:40px auto;padding:0 24px;line-height:1.7}h2{color:#6366F1;margin-top:32px}a{color:#FFD700}</style></head>
<body>
<div class="info-page-container">
  <div class="glass-panel" style="padding:40px;">
    <a href="/" class="btn btn-play-blue" style="display:inline-block;margin-bottom:20px;">← Back to Home</a>
    <h1 style="color:var(--accent-gold);">Terms of Service</h1>
    <p>By using AdvScribbl you agree to these terms. The Service is provided "as is".</p>
    <h2>1. Acceptable Use</h2><p>No hate speech, harassment, or illegal content. Violators will be banned.</p>
    <h2>2. Fair Use</h2><p>No hate speech, harassment, or illegal content. Violators will be banned.</p>
    <h2>3. Support</h2><p>For help, email <a href="mailto:${SUPPORT}">${SUPPORT}</a>.</p>
    <h2>4. Liability</h2><p>We are not liable for user-generated content or service interruptions.</p>
  </div>
</div>
</body></html>`;

const CREDITS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Credits - AdvScribbl</title>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<style>body{font-family:'Outfit',system-ui,sans-serif;background:#0D0D12;color:#fff;max-width:1000px;margin:40px auto;padding:0 24px;line-height:1.7}h2{color:#6366F1;margin-top:32px}a{color:#FFD700}</style></head>
<body>
<div class="info-page-container">
  <div class="glass-panel" style="padding:40px;">
    <a href="/" class="btn btn-play-blue" style="display:inline-block;margin-bottom:20px;">← Back to Home</a>
    <h1 style="color:var(--accent-gold);">Credits</h1>
    <p>AdvScribbl is a modernized drawing & guessing game inspired by skribbl.io.</p>
    <h2>Open Source</h2><ul><li>Socket.io — real-time multiplayer</li><li>Express — HTTP server</li><li>PostgreSQL — database</li><li>nodemailer — email alerts</li></ul>
    <h2>Sound</h2><ul><li>UI sound effects sourced from original game assets.</li></ul>
  </div>
</div>
</body></html>`;
