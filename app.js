const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// تخزين المستخدمين النشطين
let users = {};      // socket.id -> { userId, role, lat, lng, available, networkId }
let networks = {};   // networkId -> { id, name, owner, members }

// دالة حساب المسافة (haversine)
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (v) => v * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function findNearbyLivreurs(client, maxDistance = 5, limit = 3) {
  return Object.values(users)
    .filter(u => u.role === 'livreur' && u.available === true && u.userId !== client.userId)
    .map(l => ({
      userId: l.userId,
      distance: getDistance(client.lat, client.lng, l.lat, l.lng),
      lat: l.lat,
      lng: l.lng
    }))
    .filter(l => l.distance <= maxDistance)
    .sort((a,b) => a.distance - b.distance)
    .slice(0, limit);
}

io.on('connection', (socket) => {
  console.log('Client connecté:', socket.id);

  socket.on('JOIN', (data) => {
    users[socket.id] = {
      socketId: socket.id,
      userId: data.userId,
      role: data.role,
      lat: data.lat || 0,
      lng: data.lng || 0,
      available: data.role === 'livreur',
      networkId: data.networkId || null
    };
    socket.emit('JOIN_ACK', { status: 'ok' });
    console.log(`User ${data.userId} joined as ${data.role}`);
  });

  socket.on('UPDATE_LOCATION', (loc) => {
    if (users[socket.id]) {
      users[socket.id].lat = loc.lat;
      users[socket.id].lng = loc.lng;
      // Diffuser à tous les clients (pour affichage des livreurs)
      io.emit('LOCATION_UPDATED', { userId: users[socket.id].userId, lat: loc.lat, lng: loc.lng });
    }
  });

  socket.on('REQUEST_LIVREURS', (clientData, callback) => {
    if (!users[socket.id]) return callback([]);
    const livreurs = findNearbyLivreurs(users[socket.id]);
    callback(livreurs);
  });

  socket.on('SEND_MESSAGE', ({ toUserId, message }) => {
    const targetSocket = Object.values(users).find(u => u.userId === toUserId);
    if (targetSocket) {
      io.to(targetSocket.socketId).emit('RECEIVE_MESSAGE', {
        from: users[socket.id].userId,
        message,
        time: Date.now()
      });
    }
  });

  socket.on('CREATE_NETWORK', ({ name, ownerId }) => {
    const netId = 'net_' + Date.now();
    networks[netId] = { id: netId, name, owner: ownerId, members: [ownerId] };
    if (users[socket.id]) users[socket.id].networkId = netId;
    socket.emit('NETWORK_CREATED', networks[netId]);
  });

  socket.on('JOIN_NETWORK', (networkId) => {
    if (networks[networkId] && users[socket.id]) {
      if (!networks[networkId].members.includes(users[socket.id].userId)) {
        networks[networkId].members.push(users[socket.id].userId);
      }
      users[socket.id].networkId = networkId;
      socket.emit('NETWORK_JOINED', networkId);
      socket.emit('GROUP_MESSAGE', { from: 'system', msg: `Vous avez rejoint ${networks[networkId].name}` });
    }
  });

  socket.on('SEND_GROUP_MESSAGE', ({ networkId, msg }) => {
    const network = networks[networkId];
    if (!network) return;
    network.members.forEach(memberId => {
      const memberSocket = Object.values(users).find(u => u.userId === memberId);
      if (memberSocket) {
        io.to(memberSocket.socketId).emit('GROUP_MESSAGE', {
          from: users[socket.id].userId,
          msg,
          networkId
        });
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('Client déconnecté:', socket.id);
    delete users[socket.id];
  });
});

app.use(express.static(path.join(__dirname)));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Serveur TSP WORLD PRO lancé sur http://localhost:${PORT}`);
});