const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Роздаємо статичні файли (html, css, js) з кореня проєкту
app.use(express.static(__dirname));

// Послухати підключення гравців
io.on('connection', (socket) => {
    console.log(`🌍 Хтось залетів у світ! ID: ${socket.id}`);

    // Ловимо текстове повідомлення і розсилаємо всім у світі
    socket.on('chat message', (data) => {
        io.emit('chat message', data);
    });

    // Перенаправлення сигналів для майбутнього голосового чату (WebRTC)
    socket.on('voice-signal', (data) => {
        socket.broadcast.emit('voice-signal', data);
    });

    socket.on('disconnect', () => {
        console.log(`💨 Гравець вийшов зі світу: ${socket.id}`);
    });
});

// Render виділяє свій порт автоматично, а локально запуститься на 3000
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`🚀 Сервер гри успішно запущено на порті: ${PORT}`);
});