const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// maxHttpBufferSize збільшено, щоб голосові чанки (бінарні аудіо-блоби) не відхилялись
const io = new Server(server, {
  maxHttpBufferSize: 1e7 // 10 MB
});

// Роздаємо статичні файли (html, css, js) з кореня проєкту
app.use(express.static(__dirname));

// socket.id -> короткий ID гравця (напр. "X7QK2")
const players = new Map();

function makeShortId() {
  return Math.random().toString(36).substring(2, 7).toUpperCase();
}

io.on('connection', (socket) => {
  const shortId = makeShortId();
  players.set(socket.id, shortId);

  console.log(`🌍 Хтось залетів у світ! ID: ${shortId} (${socket.id}) — усього: ${players.size}`);

  // Кажемо новому гравцю, хто він, і повідомляємо всіх інших про нового гравця
  socket.emit('init', { id: shortId, playerCount: players.size });
  socket.broadcast.emit('player-joined', { id: shortId, playerCount: players.size });

  // ---- Текстовий чат ----
  socket.on('chat-message', (text) => {
    if (typeof text !== 'string') return;
    const trimmed = text.trim().slice(0, 500); // базове обмеження довжини
    if (!trimmed) return;
    io.emit('chat-message', { id: shortId, text: trimmed, time: Date.now() });
  });

  // ---- Голосовий чат (push-to-talk) ----
  socket.on('voice-start', () => {
    socket.broadcast.emit('voice-start', { id: shortId });
  });

  socket.on('voice-chunk', (chunk) => {
    // chunk приходить як ArrayBuffer/Buffer від MediaRecorder клієнта.
    // Пересилаємо як є усім іншим — без збереження, без обробки, без API ключів.
    socket.broadcast.emit('voice-chunk', { id: shortId, chunk });
  });

  socket.on('voice-end', () => {
    socket.broadcast.emit('voice-end', { id: shortId });
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    console.log(`💨 Гравець вийшов зі світу: ${shortId} — усього: ${players.size}`);
    io.emit('player-left', { id: shortId, playerCount: players.size });
  });
});

// Render виділяє свій порт автоматично, а локально запуститься на 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(`🚀 Сервер гри успішно запущено на порті: ${PORT}`);
});