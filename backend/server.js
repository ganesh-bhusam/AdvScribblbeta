/**
 * Skribbl Premium Backend — Express + Socket.io + JSON DB + JWT + Razorpay.
 *
 * All HTTP API routes are prefixed with /api (Kubernetes ingress requirement).
 * Socket.io is mounted at path /api/socket.io/ so it routes through the ingress.
 *
 * Production hardening applied:
 *  - [C5]  Whitelist-based CORS (reads ALLOWED_ORIGINS from .env)
 *  - [C6]  In-memory rate limiting on auth endpoints (10 req / 60s per IP)
 *  - [C7]  Draw command packet size cap (MAX_CMDS_PER_PACKET = 200)
 *  - [H4]  deletionTimeouts always initialized in GameEngine constructor
 *  - [H8]  Graceful SIGTERM / SIGINT shutdown with 1s DB flush window
 */
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const path       = require('path');
const cors       = require('cors');
const bodyParser = require('body-parser');
const { Server } = require('socket.io');
const jwt        = require('jsonwebtoken');

const { router: authRouter }    = require('./routes/auth');
const { router: paymentRouter } = require('./routes/payment');
const { q }                     = require('./db');
const { GameEngine }            = require('./gameEngine');
const { getLanguageList }       = require('./wordBanks');

const PORT       = Number(process.env.PORT) || 8001;
const JWT_SECRET = process.env.JWT_SECRET;

// [FIX C1] Fail fast if the secret is weak or missing
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error('[FATAL] JWT_SECRET is missing or too short. Set a strong secret in .env (min 32 chars).');
  process.exit(1);
}

// ===================== CORS =====================
// [FIX C5] Restrict CORS to explicitly whitelisted origins.
const rawOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map((s) => s.trim()).filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server calls (no Origin header) or whitelisted origins
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
app.use(bodyParser.json({ limit: '256kb' })); // tightened from 1mb
app.use(bodyParser.urlencoded({ extended: true }));

// ===================== RATE LIMITER =====================
// [FIX C6] Sliding-window rate limiter — no external dependency needed.
const rateLimitStore = new Map(); // ip -> [timestamps]

function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.socket.remoteAddress
      || 'unknown';
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

// Clean stale IP entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [ip, hits] of rateLimitStore) {
    if (!hits.some((t) => t > cutoff)) rateLimitStore.delete(ip);
  }
}, 5 * 60 * 1000);

// ===================== ROUTES =====================
// Auth routes get rate limiting: 10 requests per 60 seconds per IP
app.use('/api/auth',    rateLimit(10, 60_000), authRouter);
app.use('/api/payment', paymentRouter);

// Health + meta
app.get('/api/',         (req, res) => res.json({ ok: true, service: 'skribbl-premium' }));
app.get('/api/health',   (req, res) => res.json({ ok: true }));
app.get('/api/languages',(req, res) => res.json({ languages: getLanguageList() }));

// GET /api/admin/stats - application analytics (Phase 5)
app.get('/api/admin/stats', async (req, res) => {
  try {
    const totalUsersObj = await q.statsTotalUsers();
    const premiumUsersObj = await q.statsPremiumUsers();
    const totalRevenueObj = await q.statsTotalRevenue('captured');

    const totalUsers = totalUsersObj?.count || 0;
    const premiumUsers = premiumUsersObj?.count || 0;
    const totalRevenue = totalRevenueObj?.total || 0;
    
    // Live game stats
    const allRooms = Array.from(engine.rooms.values());
    const activeRooms = allRooms.length;
    const activePlayers = allRooms.reduce((acc, r) => acc + r.realPlayerCount(), 0);

    res.json({
      database: { totalUsers, premiumUsers, totalRevenue },
      live: { activeRooms, activePlayers }
    });
  } catch (err) {
    console.error('[stats]', err);
    res.status(500).json({ error: 'Failed to retrieve stats' });
  }
});

// POST /api/play — matchmaking entry point
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

// POST /api/private — create a private room and return invite id
app.post('/api/private', (req, res) => {
  const langId = parseInt(req.body.lang ?? '0', 10);
  const modeId = String(req.body.mode || 'all');
  const room = engine.createPrivate(langId, modeId);
  return res.json({ roomId: room.id });
});

// Static pages
app.get('/api/terms',   (req, res) => res.type('html').send(TERMS_HTML));
app.get('/api/credits', (req, res) => res.type('html').send(CREDITS_HTML));

// Serve the entire frontend directly from the backend
app.use(express.static(path.join(__dirname, '../frontend')));

// Fallback for single-page app deep links
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ===================== SERVER + SOCKET.IO =====================
const server = http.createServer(app);
const io = new Server(server, {
  path: '/api/socket.io/',
  cors: corsOptions,
  maxHttpBufferSize: 512 * 1024, // [FIX C7] tightened from 5MB → 512KB
});
const engine = new GameEngine(io);

// ===================== SOCKET AUTH MIDDLEWARE =====================
io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('AUTH_REQUIRED'));
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await q.findUserById(payload.uid);
    if (!user) return next(new Error('USER_NOT_FOUND'));
    socket.userId   = user.id;
    socket.username = user.username;
    socket.hasPremium = !!user.has_premium;
    socket.realName = user.name;
    next();
  } catch (err) {
    next(new Error('INVALID_TOKEN'));
  }
});

// [FIX C7] Max draw commands allowed in a single socket packet
const MAX_CMDS_PER_PACKET = 200;

// ===================== SOCKET EVENTS =====================
io.on('connection', (socket) => {
  socket.roomId  = null;
  socket.playerId = null;

  socket.on('login', (payload = {}) => {
    try {
      const langId     = parseInt(payload.lang ?? '0', 10);
      const modeId     = String(payload.mode || 'all');
      const joinId     = payload.join;
      const create     = payload.create === 1;
      const playerName = String(payload.name || socket.realName || 'Player').slice(0, 21);
      const avatar     = Array.isArray(payload.avatar) ? payload.avatar.slice(0, 4) : [0, 0, 0, -1];
      const ip         = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;

      // [FIX H5] 10-second grace period reconnection
      if (joinId && engine.disconnectTimers) {
        const targetRoom = engine.getRoom(String(joinId));
        if (targetRoom) {
          const existingPlayer = targetRoom.players.find(p => 
            engine.disconnectTimers.has(p.id) &&
            ((socket.userId && p.userId === socket.userId) || (p.ip === ip && p.name === playerName))
          );

          if (existingPlayer) {
            clearTimeout(engine.disconnectTimers.get(existingPlayer.id));
            engine.disconnectTimers.delete(existingPlayer.id);

            existingPlayer.socketId = socket.id;
            socket.roomId = targetRoom.id;
            socket.playerId = existingPlayer.id;
            socket.join(targetRoom.id);

            socket.emit('data', { id: 10, data: targetRoom.toLobbyInit(existingPlayer.id) });
            return;
          }
        }
      }

      let room;
      if (create) {
        room = engine.createPrivate(langId, modeId);
      } else if (joinId && joinId !== 0 && joinId !== '0') {
        room = engine.getRoom(String(joinId));
        if (!room)                               return socket.emit('joinerr', 1);
        if (room.players.length >= room.settings[1]) return socket.emit('joinerr', 2);
        if (room.bannedUserIds.has(socket.userId))   return socket.emit('joinerr', 4);
        if (room.kickedUserIds.has(socket.userId))   return socket.emit('joinerr', 3);
        // Cancel active cleanup timeout — player rejoined before grace period expired
        if (engine.deletionTimeouts.has(room.id)) {
          clearTimeout(engine.deletionTimeouts.get(room.id));
          engine.deletionTimeouts.delete(room.id);
          console.log(`[cleanup] Cancelled cleanup for Room ${room.id} (player joined)`);
        }
      } else {
        room = engine.publicRoomForLang(langId, socket.userId, modeId) || engine.createPublic(langId, modeId);
      }

      const player = {
        name: playerName,
        avatar,
        socketId:   socket.id,
        userId:     socket.userId,
        hasPremium: socket.hasPremium,
        bot:        false,
        ip:         ip,
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
      case 19: // [FIX C7] Enforce per-packet command count cap
        if (Array.isArray(data) && data.length <= MAX_CMDS_PER_PACKET) {
          // Packet frequency limiter
          if (!socket.drawTs) socket.drawTs = [];
          const now = Date.now();
          socket.drawTs = socket.drawTs.filter(t => now - t < 1000);
          socket.drawTs.push(now);
          if (socket.drawTs.length > 25) break; // Drop excess traffic
          
          room.receiveDrawCommands(playerId, data);
        }
        break;
      case 20: room.clearCanvas(playerId); break;
      case 21: if (typeof data === 'number') room.undoCanvas(playerId, data); break;
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
    const roomId = socket.roomId;
    
    // 10-second grace period
    if (!engine.disconnectTimers) engine.disconnectTimers = new Map();
    const tId = setTimeout(() => {
      engine.disconnectTimers.delete(playerId);
      const currentRoom = engine.getRoom(roomId);
      if (!currentRoom) return;
      currentRoom.removePlayer(playerId, 0);
      
      // Tear down room after 60s grace period if no real players remain
      if (currentRoom.realPlayerCount() === 0) {
        if (engine.deletionTimeouts.has(currentRoom.id)) {
          clearTimeout(engine.deletionTimeouts.get(currentRoom.id));
        }
        const t = setTimeout(() => {
          if (currentRoom.realPlayerCount() === 0) {
            console.log(`[cleanup] Room ${currentRoom.id} deleted (0 players after grace period)`);
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
// [FIX H8] Give in-flight JSON writes 1 second to flush before exit.
function shutdown(signal) {
  console.log(`\n[skribbl] Received ${signal} — shutting down gracefully...`);
  server.close(() => {
    console.log('[skribbl] HTTP server closed. Waiting for DB flush...');
    setTimeout(() => { console.log('[skribbl] Exiting.'); process.exit(0); }, 1000);
  });
  // Force-kill after 10s if something hangs
  setTimeout(() => { console.error('[skribbl] Forced exit.'); process.exit(1); }, 10_000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

/* ---------- static HTML pages ---------- */
const SUPPORT = process.env.SUPPORT_EMAIL || 'support@advscribbl.app';

const TERMS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Terms of Service - AdvScribbl</title>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Outfit:wght@400;600;800;900&family=Patrick+Hand&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<style>body{font-family:'Outfit',system-ui,sans-serif;background:#0D0D12;color:#fff;max-width:1000px;margin:40px auto;padding:0 24px;line-height:1.7}h2{color:#6366F1;margin-top:32px;margin-bottom:12px;font-size:1.5rem}a{color:#FFD700}</style></head>
<body>
<div class="info-page-container">
  <div class="glass-panel" style="background: transparent; border-color: rgba(255, 255, 255, 0.2); width: 100%; display: flex; flex-direction: row; gap: 40px; padding: 40px; text-align: left; flex-wrap: wrap;">
    <div style="flex: 1; min-width: 200px;">
      <a href="/" class="btn btn-play-blue back-btn" style="display:inline-block; margin-bottom: 20px;">← Back to Home</a>
      <h1 style="text-align: left; margin: 0; line-height: 1.2; color: var(--accent-gold); font-size: 2.5rem; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">Terms of<br>Service</h1>
    </div>
    <div class="info-page-content" style="flex: 2; min-width: 300px; padding: 0;">
      <p style="margin-top:0;">By using AdvScribbl (the "Service") you agree to these terms. The Service is a multiplayer drawing &amp; guessing game provided "as is". You are responsible for the content you draw and the messages you send.</p>
      <h2 style="margin-top:0;">1. Acceptable Use</h2><p>No hate speech, harassment, illegal content, or attempts to disrupt the Service. Repeat violators will be banned.</p>
      <h2>2. Premium Purchases</h2><p>The ₹25 Premium upgrade grants lifetime access to the premium color palette and removes ads for 6 months. Purchases are processed by Razorpay and are non-refundable except where required by law.</p>
      <h2>3. Account Recovery</h2><p>If you forget your password, email <a href="mailto:${SUPPORT}">${SUPPORT}</a> from your registered address along with your Razorpay receipt (if Premium). We verify and reset manually.</p>
      <h2>4. Liability</h2><p>The Service is offered without warranty. We are not liable for user-generated content or service interruptions.</p>
    </div>
  </div>
</div>
</body></html>`;

const CREDITS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Credits - AdvScribbl</title>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Outfit:wght@400;600;800;900&family=Patrick+Hand&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/style.css">
<style>body{font-family:'Outfit',system-ui,sans-serif;background:#0D0D12;color:#fff;max-width:1000px;margin:40px auto;padding:0 24px;line-height:1.7}h2{color:#6366F1;margin-top:32px;margin-bottom:12px;font-size:1.5rem}a{color:#FFD700}ul{padding-left:20px;margin-top:0}</style></head>
<body>
<div class="info-page-container">
  <div class="glass-panel" style="background: transparent; border-color: rgba(255, 255, 255, 0.2); width: 100%; display: flex; flex-direction: row; gap: 40px; padding: 40px; text-align: left; flex-wrap: wrap;">
    <div style="flex: 1; min-width: 200px;">
      <a href="/" class="btn btn-play-blue back-btn" style="display:inline-block; margin-bottom: 20px;">← Back to Home</a>
      <h1 style="text-align: left; margin: 0; line-height: 1.2; color: var(--accent-gold); font-size: 2.5rem; text-shadow: 0 2px 4px rgba(0,0,0,0.5);">Credits</h1>
    </div>
    <div class="info-page-content" style="flex: 2; min-width: 300px; padding: 0;">
      <p style="margin-top:0;">AdvScribbl is a modernized clone of skribbl.io, designed and built with love.</p>
      <h2 style="margin-top:0;">Original Inspiration</h2><ul><li>skribbl.io by Mel - for the original gameplay and visual language</li></ul>
      <h2>Open Source</h2><ul><li>Socket.io - real-time multiplayer transport</li><li>Express - HTTP server</li><li>JSON flat-file DB - lightweight persistence</li><li>bcryptjs, jsonwebtoken - authentication</li><li>Razorpay - payments</li></ul>
      <h2>Sound</h2><ul><li>UI sound effects sourced from the original game assets.</li></ul>
    </div>
  </div>
</div>
</body></html>`;
