import { StoneAgeGathering } from './script.js';

let scene, camera, renderer;
let moveForward = false, moveBackward = false, moveLeft = false, moveRight = false, canJump = false;
let velocity = new THREE.Vector3();
let prevTime = performance.now();

let raycaster;
let gathering;
let isGameRunning = true;

let socket = null;
let myPlayerId = null;
let remotePlayers = {};
let lastNetworkUpdate = 0;
const NETWORK_INTERVAL = 50;
const EYE_HEIGHT = 1.8;
const MOUSE_SENSITIVITY = 0.002;
const TOUCH_LOOK_SENSITIVITY = 0.003;
let isPointerLocked = false;
let touchLookId = null;
let lastLookX = 0;
let lastLookY = 0;
let shakeOffset = new THREE.Vector3();
let shakeDecay = 0;

init();
animate();

function init() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.01);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    document.body.appendChild(renderer.domElement);

    raycaster = new THREE.Raycaster();

    gathering = new StoneAgeGathering({
        scene,
        camera,
        raycaster,
        getTerrainHeight,
        onInventoryChange: updateInventoryUI,
        onStatusChange: setStatusMessage,
        onProgressChange: updateProgressUI,
        onShake: (amount) => { shakeDecay = Math.max(shakeDecay, amount); },
    });

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xfffaed, 0.9);
    sunLight.position.set(200, 300, 100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 800;
    sunLight.shadow.camera.left = -300;
    sunLight.shadow.camera.right = 300;
    sunLight.shadow.camera.top = 300;
    sunLight.shadow.camera.bottom = -300;
    scene.add(sunLight);

    buildWorld();
    setupInputListeners();
    connectMultiplayer();
    updateInventoryUI(gathering.player);
    setStatusMessage('Forage fallen branches and pebbles first. Craft tools before felling trees.');
}

function buildWorld() {
    const worldSize = 600;
    const floorGeometry = new THREE.PlaneGeometry(worldSize, worldSize, 128, 128);
    floorGeometry.rotateX(-Math.PI / 2);

    const pos = floorGeometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i);
        const vz = pos.getZ(i);
        const distFromCenter = Math.sqrt(vx * vx + vz * vz);
        if (distFromCenter > 20) {
            const y = getTerrainHeight(vx, vz);
            pos.setY(i, y);
        }
    }
    floorGeometry.computeVertexNormals();

    const floorMaterial = new THREE.MeshStandardMaterial({
        color: 0x3b5323,
        roughness: 0.9,
        flatShading: true,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.receiveShadow = true;
    scene.add(floor);

    for (let i = 0; i < 220; i++) {
        const x = (Math.random() - 0.5) * (worldSize - 60);
        const z = (Math.random() - 0.5) * (worldSize - 60);

        if (Math.abs(x) <= 15 && Math.abs(z) <= 15) continue;

        const y = getTerrainHeight(x, z);
        gathering.createTree(x, y, z);

        if (Math.random() > 0.45) {
            const bx = x + (Math.random() - 0.5) * 4;
            const bz = z + (Math.random() - 0.5) * 4;
            gathering.createBranch(bx, getTerrainHeight(bx, bz), bz);
        }
    }

    for (let i = 0; i < 120; i++) {
        const x = (Math.random() - 0.5) * (worldSize - 40);
        const z = (Math.random() - 0.5) * (worldSize - 40);
        if (Math.abs(x) <= 10 && Math.abs(z) <= 10) continue;
        gathering.createPebble(x, getTerrainHeight(x, z), z);
    }

    for (let i = 0; i < 45; i++) {
        const x = (Math.random() - 0.5) * (worldSize - 40);
        const z = (Math.random() - 0.5) * (worldSize - 40);
        if (Math.abs(x) <= 12 && Math.abs(z) <= 12) continue;
        gathering.createRockDeposit(x, getTerrainHeight(x, z), z);
    }
}

function updateInventoryUI(player) {
    document.getElementById('wood-count').innerText = player.inventory.wood;
    document.getElementById('stone-count').innerText = player.inventory.stone;
    document.getElementById('sticks-count').innerText = player.inventory.sticks;
    document.getElementById('flint-count').innerText = player.inventory.flint;
    document.getElementById('axe-status').innerText = player.tools.stoneAxe > 0 ? `Ready (${player.tools.stoneAxe})` : 'Not crafted';
    document.getElementById('hammer-status').innerText = player.tools.stoneHammer > 0 ? `Ready (${player.tools.stoneHammer})` : 'Not crafted';
    document.getElementById('campfire-status').innerText = player.campfires > 0 ? `Placed (${player.campfires})` : 'Not crafted';
}

function setStatusMessage(text) {
    document.getElementById('status-message').innerText = text;
}

function updateProgressUI(ratio, label) {
    const bar = document.getElementById('action-progress');
    const labelEl = document.getElementById('action-label');
    if (ratio <= 0) {
        bar.style.width = '0%';
        labelEl.innerText = label || '';
        return;
    }
    bar.style.width = `${Math.round(ratio * 100)}%`;
    labelEl.innerText = label || '';
}

function craftCampfire() {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    const spawnPos = camera.position.clone().add(dir.multiplyScalar(3));
    spawnPos.y = getTerrainHeight(spawnPos.x, spawnPos.z);
    gathering.craftCampfire(spawnPos);
}

function colorFromId(id) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = id.charCodeAt(i) + ((hash << 5) - hash);
    }
    return hash & 0xffffff;
}

function setMultiplayerStatus(text, connected) {
    document.getElementById('mp-status').innerText = text;
    const panel = document.getElementById('multiplayer');
    panel.classList.toggle('connected', connected);
    panel.classList.toggle('disconnected', !connected);
}

function createRemotePlayer(id) {
    const group = new THREE.Group();
    const color = colorFromId(id);

    const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 1.2, 0.5),
        new THREE.MeshStandardMaterial({ color })
    );
    body.position.y = 0.6;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.5),
        new THREE.MeshStandardMaterial({ color: 0xffdbac })
    );
    head.position.y = 1.45;
    head.castShadow = true;
    group.add(head);

    scene.add(group);
    remotePlayers[id] = {
        group,
        targetPosition: new THREE.Vector3(),
        targetRotationY: 0,
    };
}

function updateRemotePlayer(id, position, rotation) {
    if (!remotePlayers[id]) createRemotePlayer(id);
    const remote = remotePlayers[id];
    remote.targetPosition.set(position.x, position.y - EYE_HEIGHT, position.z);
    remote.targetRotationY = rotation.y;
}

function removeRemotePlayer(id) {
    const remote = remotePlayers[id];
    if (!remote) return;
    scene.remove(remote.group);
    delete remotePlayers[id];
    updatePlayerCountLabel();
}

function updatePlayerCountLabel() {
    const count = Object.keys(remotePlayers).length + (myPlayerId ? 1 : 0);
    setMultiplayerStatus(`${count} player${count === 1 ? '' : 's'} online`, true);
}

function handleServerMessage(msg) {
    switch (msg.type) {
        case 'welcome':
            myPlayerId = msg.id;
            msg.players.forEach((player) => updateRemotePlayer(player.id, player.position, player.rotation));
            updatePlayerCountLabel();
            break;
        case 'playerJoined':
            if (msg.id !== myPlayerId) {
                updateRemotePlayer(msg.id, msg.position, msg.rotation);
                updatePlayerCountLabel();
            }
            break;
        case 'playerUpdate':
            if (msg.id !== myPlayerId) {
                updateRemotePlayer(msg.id, msg.position, msg.rotation);
            }
            break;
        case 'playerLeft':
            removeRemotePlayer(msg.id);
            break;
    }
}

function connectMultiplayer() {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}`;

    socket = new WebSocket(wsUrl);
    socket.onopen = () => setMultiplayerStatus('Connected', true);
    socket.onmessage = (event) => handleServerMessage(JSON.parse(event.data));
    socket.onclose = () => {
        myPlayerId = null;
        Object.keys(remotePlayers).forEach(removeRemotePlayer);
        setMultiplayerStatus('Disconnected — run npm start', false);
    };
    socket.onerror = () => setMultiplayerStatus('Server offline — run npm start', false);
}

function sendPlayerUpdate() {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: 'update',
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
    }));
}

function getTerrainHeight(x, z) {
    return Math.sin(x * 0.02) * Math.cos(z * 0.02) * 6 + Math.sin(x * 0.005) * 15;
}

function isUiTarget(element) {
    return element && (element.closest('#mobile-controls') || element.closest('#ui'));
}

function applyLook(deltaX, deltaY, sensitivity) {
    camera.rotation.y -= deltaX * sensitivity;
    camera.rotation.x -= deltaY * sensitivity;
    camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
}

function setupInputListeners() {
    window.addEventListener('keydown', (e) => {
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) {
            e.preventDefault();
        }

        switch (e.code) {
            case 'KeyW': moveForward = true; break;
            case 'KeyA': moveLeft = true; break;
            case 'KeyS': moveBackward = true; break;
            case 'KeyD': moveRight = true; break;
            case 'Space':
                if (canJump) { velocity.y += 10; canJump = false; }
                break;
            case 'KeyE': craftCampfire(); break;
            case 'KeyF': gathering.tryInstantInteract(); break;
            case 'KeyQ': gathering.quenchRock(); break;
            case 'Digit1': gathering.craftStoneAxe(); break;
            case 'Digit2': gathering.craftStoneHammer(); break;
        }
    });

    window.addEventListener('keyup', (e) => {
        switch (e.code) {
            case 'KeyW': moveForward = false; break;
            case 'KeyA': moveLeft = false; break;
            case 'KeyS': moveBackward = false; break;
            case 'KeyD': moveRight = false; break;
        }
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    const bindButton = (id, onDown, onUp) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); });
        el.addEventListener('touchend', (e) => { e.preventDefault(); if (onUp) onUp(); });
        el.addEventListener('mousedown', (e) => { e.preventDefault(); onDown(); });
        el.addEventListener('mouseup', (e) => { e.preventDefault(); if (onUp) onUp(); });
        el.addEventListener('mouseleave', () => { if (onUp) onUp(); });
    };

    bindButton('btn-up', () => { moveForward = true; }, () => { moveForward = false; });
    bindButton('btn-down', () => { moveBackward = true; }, () => { moveBackward = false; });
    bindButton('btn-left', () => { moveLeft = true; }, () => { moveLeft = false; });
    bindButton('btn-right', () => { moveRight = true; }, () => { moveRight = false; });
    bindButton('btn-jump', () => { if (canJump) { velocity.y += 10; canJump = false; } });
    bindButton('btn-gather', () => gathering.beginUse(), () => gathering.endUse());
    bindButton('btn-craft', () => craftCampfire());
    bindButton('btn-quench', () => gathering.quenchRock());

    renderer.domElement.addEventListener('mousedown', (e) => {
        if (isUiTarget(e.target)) return;
        if (e.button === 0) gathering.beginUse();
    });
    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) gathering.endUse();
    });

    renderer.domElement.addEventListener('click', () => {
        if (!document.pointerLockElement) {
            renderer.domElement.requestPointerLock();
        }
    });

    document.addEventListener('pointerlockchange', () => {
        isPointerLocked = document.pointerLockElement === renderer.domElement;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isPointerLocked) return;
        applyLook(e.movementX, e.movementY, MOUSE_SENSITIVITY);
    });

    window.addEventListener('touchstart', (e) => {
        if (isUiTarget(e.target)) return;
        if (e.touches.length !== 1) return;
        touchLookId = e.touches[0].identifier;
        lastLookX = e.touches[0].clientX;
        lastLookY = e.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchmove', (e) => {
        if (isUiTarget(e.target)) return;
        const touch = Array.from(e.touches).find((t) => t.identifier === touchLookId);
        if (!touch) return;
        e.preventDefault();
        applyLook(touch.clientX - lastLookX, touch.clientY - lastLookY, TOUCH_LOOK_SENSITIVITY);
        lastLookX = touch.clientX;
        lastLookY = touch.clientY;
    }, { passive: false });

    window.addEventListener('touchend', () => {
        touchLookId = null;
    });
}

function animate() {
    requestAnimationFrame(animate);
    if (!isGameRunning) return;

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    velocity.y -= 9.8 * 4.0 * delta;

    const moveDir = new THREE.Vector3();
    camera.getWorldDirection(moveDir);
    moveDir.y = 0;
    moveDir.normalize();

    const sideDir = new THREE.Vector3(-moveDir.z, 0, moveDir.x);
    const actualMove = new THREE.Vector3();
    if (moveForward) actualMove.add(moveDir);
    if (moveBackward) actualMove.sub(moveDir);
    if (moveRight) actualMove.add(sideDir);
    if (moveLeft) actualMove.sub(sideDir);
    if (actualMove.lengthSq() > 0) actualMove.normalize();

    camera.position.addScaledVector(actualMove, 10.0 * delta);
    camera.position.y += velocity.y * delta;

    const groundHeight = getTerrainHeight(camera.position.x, camera.position.z);
    if (camera.position.y < groundHeight + EYE_HEIGHT) {
        velocity.y = 0;
        camera.position.y = groundHeight + EYE_HEIGHT;
        canJump = true;
    }

    gathering.update(delta);

    Object.values(remotePlayers).forEach((remote) => {
        remote.group.position.lerp(remote.targetPosition, 0.35);
        remote.group.rotation.y = remote.targetRotationY;
    });

    if (time - lastNetworkUpdate >= NETWORK_INTERVAL) {
        lastNetworkUpdate = time;
        sendPlayerUpdate();
    }

    const savedCameraPosition = camera.position.clone();
    if (shakeDecay > 0) {
        shakeOffset.set(
            (Math.random() - 0.5) * shakeDecay,
            (Math.random() - 0.5) * shakeDecay,
            (Math.random() - 0.5) * shakeDecay * 0.5
        );
        camera.position.add(shakeOffset);
        shakeDecay *= 0.85;
        if (shakeDecay < 0.002) shakeDecay = 0;
    }

    renderer.render(scene, camera);
    camera.position.copy(savedCameraPosition);

    prevTime = time;
}
