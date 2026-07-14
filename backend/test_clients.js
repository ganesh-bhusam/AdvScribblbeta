const io = require('socket.io-client');
const SERVER_URL = 'http://localhost:8001';
const SOCKET_OPTS = { path: '/api/socket.io/' };
const p1 = io(SERVER_URL, SOCKET_OPTS);
const p2 = io(SERVER_URL, SOCKET_OPTS);
let p1Id = null, p2Id = null, roomId = null;
p1.on('connect', () => { p1.emit('login', { name: 'Player1', create: 1 }); });
p1.on('data', (packet) => {
  if (packet.id === 10) { p1Id = packet.data.me; roomId = packet.data.id; p2.emit('login', { name: 'Player2', join: roomId }); }
  if (packet.id === 11) { console.log('[P1] State Transition', packet.data.id, packet.data.data); }
});
p2.on('data', (packet) => {
  if (packet.id === 10) { p2Id = packet.data.me; setTimeout(() => { p1.emit('data', { id: 16 }); }, 1000); }
  if (packet.id === 11) { console.log('[P2] State Transition', packet.data.id, packet.data.data); }
});
