const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname)));

const players = new Map();

function broadcast(exceptId, data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN && client.playerId !== exceptId) {
            client.send(message);
        }
    });
}

wss.on('connection', (ws) => {
    const id = `player-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    ws.playerId = id;

    const playerState = {
        id,
        position: {
            x: (Math.random() - 0.5) * 8,
            y: 5,
            z: (Math.random() - 0.5) * 8
        },
        rotation: { x: 0, y: 0, z: 0 }
    };

    players.set(id, playerState);

    const existingPlayers = [];
    players.forEach((player) => {
        if (player.id !== id) {
            existingPlayers.push(player);
        }
    });

    ws.send(JSON.stringify({
        type: 'welcome',
        id,
        players: existingPlayers
    }));

    broadcast(id, {
        type: 'playerJoined',
        ...playerState
    });

    console.log(`Player joined: ${id} (${players.size} online)`);

    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }

        if (msg.type !== 'update' || !msg.position || !msg.rotation) {
            return;
        }

        const player = players.get(id);
        if (!player) {
            return;
        }

        player.position = msg.position;
        player.rotation = msg.rotation;

        broadcast(id, {
            type: 'playerUpdate',
            id,
            position: msg.position,
            rotation: msg.rotation
        });
    });

    ws.on('close', () => {
        players.delete(id);
        broadcast(null, { type: 'playerLeft', id });
        console.log(`Player left: ${id} (${players.size} online)`);
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Stone Age Survival server running on port ${PORT}`);
});
