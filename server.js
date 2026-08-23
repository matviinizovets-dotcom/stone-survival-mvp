/*
  Multiplayer chat server — Express + Socket.io

  Start locally:
    npm init -y
    npm install express socket.io
    node server.js

  Then open http://localhost:3000 in two browser tabs to test chat.
*/

const path = require('path');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rootDir = path.join(__dirname);

app.use(express.static(rootDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
});

io.on('connection', (socket) => {
    console.log(`Player connected: ${socket.id}`);

    socket.on('chatMessage', (text) => {
        const message = String(text || '').trim().slice(0, 500);
        if (!message) return;

        io.emit('chatMessage', {
            id: socket.id.slice(0, 6),
            text: message,
            time: Date.now()
        });
    });

    socket.on('disconnect', () => {
        console.log(`Player disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Chat server running at http://localhost:${PORT}`);
});
