/**
 * Historically grounded Stone Age gathering mechanics.
 * Resource tags mirror semantic selectors: .branch-ground, .tree, .pebble-ground, etc.
 */

export const TAG = {
    BRANCH_GROUND: 'branch-ground',
    TREE: 'tree',
    PEBBLE_GROUND: 'pebble-ground',
    ROCK_DEPOSIT: 'rock-deposit',
    CAMPFIRE: 'campfire',
    RESOURCE_CHUNK: 'resource-chunk',
};

export const RECIPES = {
    stoneAxe: { sticks: 2, flint: 2, label: 'Stone Axe (2 sticks, 2 flint)' },
    stoneHammer: { stone: 3, sticks: 1, label: 'Stone Hammer (3 stone, 1 stick)' },
    campfire: { wood: 5, stone: 3, label: 'Campfire (5 wood, 3 stone)' },
};

export function createPlayerState() {
    return {
        inventory: {
            wood: 0,
            stone: 0,
            sticks: 0,
            flint: 0,
        },
        tools: {
            stoneAxe: 0,
            stoneHammer: 0,
        },
        campfires: 0,
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function lerpColor(hex, targetHex, t) {
    const r1 = (hex >> 16) & 255;
    const g1 = (hex >> 8) & 255;
    const b1 = hex & 255;
    const r2 = (targetHex >> 16) & 255;
    const g2 = (targetHex >> 8) & 255;
    const b2 = targetHex & 255;
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return (r << 16) | (g << 8) | b;
}

export class StoneAgeGathering {
    constructor({
        scene,
        camera,
        raycaster,
        getTerrainHeight,
        onInventoryChange,
        onStatusChange,
        onProgressChange,
        onShake,
    }) {
        this.scene = scene;
        this.camera = camera;
        this.raycaster = raycaster;
        this.getTerrainHeight = getTerrainHeight;
        this.onInventoryChange = onInventoryChange || (() => {});
        this.onStatusChange = onStatusChange || (() => {});
        this.onProgressChange = onProgressChange || (() => {});
        this.onShake = onShake || (() => {});

        this.player = createPlayerState();
        this.interactables = [];
        this.chunks = [];
        this.campfires = [];
        this.trees = [];
        this.rockDeposits = [];

        this.isUsing = false;
        this.activeTarget = null;
        this.swingTimer = 0;
        this.interactRange = 9;
        this.pickupRange = 2.2;

        this.damageRates = {
            axeOnTree: 14,
            axeWithoutTool: 0.4,
            hammerOnCrackedRock: 18,
            hammerOnSolidRock: 0.5,
            fireOnTree: 6,
            fireHeatRock: 1 / 6,
        };
    }

    registerInteractable(object, resource) {
        object.userData.resource = resource;
        object.userData.root = resource.root;
        this.interactables.push(object);

        if (resource.tag === TAG.TREE) this.trees.push(resource);
        if (resource.tag === TAG.ROCK_DEPOSIT) this.rockDeposits.push(resource);
        if (resource.tag === TAG.CAMPFIRE) this.campfires.push(resource);
    }

    unregisterResource(resource) {
        this.interactables = this.interactables.filter((obj) => {
            let current = obj;
            while (current) {
                if (current === resource.root) return false;
                current = current.parent;
            }
            return true;
        });
        this.trees = this.trees.filter((r) => r !== resource);
        this.rockDeposits = this.rockDeposits.filter((r) => r !== resource);
        this.campfires = this.campfires.filter((r) => r !== resource);
    }

    getAimedTarget() {
        this.raycaster.setFromCamera({ x: 0, y: 0 }, this.camera);
        const hits = this.raycaster.intersectObjects(this.interactables, false);
        if (!hits.length) return null;

        const hit = hits[0];
        if (hit.distance > this.interactRange) return null;

        const resource = hit.object.userData.resource;
        if (!resource) return null;

        return { hit, resource, object: hit.object };
    }

    hasRecipeItems(recipe) {
        return Object.entries(recipe).every(([key, amount]) => {
            if (key === 'label') return true;
            if (this.player.tools[key] != null) return this.player.tools[key] >= amount;
            return (this.player.inventory[key] || 0) >= amount;
        });
    }

    spendRecipeItems(recipe) {
        Object.entries(recipe).forEach(([key, amount]) => {
            if (key === 'label') return;
            if (this.player.tools[key] != null) {
                this.player.tools[key] -= amount;
            } else {
                this.player.inventory[key] -= amount;
            }
        });
        this.onInventoryChange(this.player);
    }

    craftStoneAxe() {
        const recipe = RECIPES.stoneAxe;
        if (!this.hasRecipeItems(recipe)) {
            this.onStatusChange('Need 2 sticks and 2 flint for a stone axe.');
            return false;
        }
        this.spendRecipeItems(recipe);
        this.player.tools.stoneAxe += 1;
        this.onStatusChange('Hafted a stone axe onto a stick.');
        this.onInventoryChange(this.player);
        return true;
    }

    craftStoneHammer() {
        const recipe = RECIPES.stoneHammer;
        if (!this.hasRecipeItems(recipe)) {
            this.onStatusChange('Need 3 stone and 1 stick for a stone hammer.');
            return false;
        }
        this.spendRecipeItems(recipe);
        this.player.tools.stoneHammer += 1;
        this.onStatusChange('Knapped a heavy stone hammer.');
        this.onInventoryChange(this.player);
        return true;
    }

    craftCampfire(spawnPos) {
        const recipe = RECIPES.campfire;
        if (!this.hasRecipeItems(recipe)) {
            this.onStatusChange('Need 5 wood and 3 stone for a campfire.');
            return null;
        }
        this.spendRecipeItems(recipe);
        this.player.campfires += 1;

        const fireGroup = this.createCampfireMesh();
        fireGroup.position.copy(spawnPos);
        this.scene.add(fireGroup);

        const resource = {
            tag: TAG.CAMPFIRE,
            root: fireGroup,
            hp: 9999,
            maxHp: 9999,
            state: 'burning',
            heatRadius: 4,
        };
        fireGroup.userData.resource = resource;

        fireGroup.traverse((child) => {
            if (child.isMesh) this.registerInteractable(child, resource);
        });

        this.onStatusChange('Campfire lit — use fire-setting on trees and rock faces.');
        this.onInventoryChange(this.player);
        return resource;
    }

    createCampfireMesh() {
        const fireGroup = new THREE.Group();
        const logGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.5, 6);
        logGeo.rotateX(Math.PI / 2);
        const logMat = new THREE.MeshStandardMaterial({ color: 0x3e2723 });

        for (let i = 0; i < 3; i++) {
            const log = new THREE.Mesh(logGeo, logMat);
            log.rotation.y = (i * Math.PI) / 3;
            log.position.y = 0.1;
            log.castShadow = true;
            fireGroup.add(log);
        }

        const fireGeo = new THREE.SphereGeometry(0.4, 8, 8);
        const fireMat = new THREE.MeshBasicMaterial({ color: 0xff5722 });
        const fire = new THREE.Mesh(fireGeo, fireMat);
        fire.position.y = 0.35;
        fireGroup.add(fire);

        return fireGroup;
    }

    beginUse() {
        this.isUsing = true;
        this.swingTimer = 0;
        this.tryInstantInteract();
    }

    endUse() {
        this.isUsing = false;
        this.activeTarget = null;
        this.onProgressChange(0, '');
    }

    tryInstantInteract() {
        const target = this.getAimedTarget();
        if (!target) return false;

        const { resource } = target;

        if (resource.tag === TAG.BRANCH_GROUND) {
            this.collectBranch(resource);
            return true;
        }

        if (resource.tag === TAG.PEBBLE_GROUND) {
            this.collectPebble(resource);
            return true;
        }

        if (resource.tag === TAG.RESOURCE_CHUNK) {
            this.collectChunk(resource);
            return true;
        }

        return false;
    }

    collectBranch(resource) {
        this.player.inventory.sticks += 1;
        this.player.inventory.wood += 1;
        this.removeResource(resource);
        this.onStatusChange('Collected fallen sticks from the forest floor.');
        this.onInventoryChange(this.player);
    }

    collectPebble(resource) {
        const givesFlint = Math.random() > 0.35;
        if (givesFlint) {
            this.player.inventory.flint += 1;
            this.onStatusChange('Found a sharp flint pebble.');
        } else {
            this.player.inventory.stone += 1;
            this.onStatusChange('Picked up a loose stone.');
        }
        this.removeResource(resource);
        this.onInventoryChange(this.player);
    }

    collectChunk(resource) {
        if (resource.loot === 'wood') {
            this.player.inventory.wood += resource.amount || 1;
        } else {
            this.player.inventory.stone += resource.amount || 1;
        }
        this.removeResource(resource);
        this.onInventoryChange(this.player);
    }

    quenchRock() {
        const target = this.getAimedTarget();
        if (!target || target.resource.tag !== TAG.ROCK_DEPOSIT) {
            this.onStatusChange('Aim at a heated rock face to quench it.');
            return false;
        }

        const resource = target.resource;
        if (resource.state !== 'heated') {
            this.onStatusChange('Rock must be heated by fire before quenching.');
            return false;
        }

        resource.state = 'cracked';
        resource.stateProgress = 1;
        this.applyRockVisual(resource, 1);
        this.onShake(0.08);
        this.onStatusChange('Thermal shock — the rock cracked. Use a stone hammer.');
        return true;
    }

    update(delta) {
        this.updateFireSetting(delta);
        this.updateContinuousUse(delta);
        this.updateChunks(delta);
        this.autoPickupNearbyChunks();
    }

    updateFireSetting(delta) {
        for (const tree of this.trees) {
            if (tree.hp <= 0) continue;

            const nearbyFire = this.getNearestCampfire(tree.root.position, tree.fireRadius || 5);
            if (!nearbyFire) continue;

            tree.charProgress = (tree.charProgress || 0) + delta * this.damageRates.fireOnTree;
            const charRatio = clamp(tree.charProgress / tree.maxHp, 0, 1);
            this.applyTreeCharring(tree, charRatio);

            if (tree.charProgress >= tree.maxHp) {
                this.collapseTree(tree, 'fire');
            }
        }

        for (const rock of this.rockDeposits) {
            if (rock.state === 'cracked' || rock.state === 'broken') continue;

            const nearbyFire = this.getNearestCampfire(rock.root.position, rock.heatRadius || 3.5);
            if (!nearbyFire) continue;

            rock.heatProgress = (rock.heatProgress || 0) + delta * this.damageRates.fireHeatRock;
            const heatRatio = clamp(rock.heatProgress, 0, 1);
            this.applyRockVisual(rock, heatRatio);

            if (rock.heatProgress >= 1 && rock.state !== 'heated') {
                rock.state = 'heated';
                this.onStatusChange('Rock face is glowing hot — quench with water (Q).');
            }
        }
    }

    updateContinuousUse(delta) {
        if (!this.isUsing) return;

        const target = this.getAimedTarget();
        if (!target) {
            this.onProgressChange(0, 'Nothing in reach');
            return;
        }

        this.activeTarget = target.resource;
        this.swingTimer += delta;

        if (this.swingTimer >= 0.45) {
            this.swingTimer = 0;
            this.applyToolHit(target.resource);
        }

        const progress = target.resource.hp / target.resource.maxHp;
        this.onProgressChange(progress, this.describeTarget(target.resource));
    }

    applyToolHit(resource) {
        let damage = 0;
        let message = '';

        if (resource.tag === TAG.TREE) {
            if (this.player.tools.stoneAxe > 0) {
                damage = this.damageRates.axeOnTree;
                message = 'Chopping with stone axe...';
            } else {
                damage = this.damageRates.axeWithoutTool;
                message = 'Hands barely scratch the trunk — craft a stone axe.';
            }
            this.onShake(this.player.tools.stoneAxe > 0 ? 0.035 : 0.01);
            this.applyTreeCharring(resource, 1 - resource.hp / resource.maxHp);
        } else if (resource.tag === TAG.ROCK_DEPOSIT) {
            if (resource.state === 'cracked' && this.player.tools.stoneHammer > 0) {
                damage = this.damageRates.hammerOnCrackedRock;
                message = 'Hammering cracked stone...';
                this.onShake(0.05);
            } else if (resource.state === 'cracked') {
                damage = this.damageRates.hammerOnSolidRock;
                message = 'Rock is cracked — craft a stone hammer.';
            } else if (resource.state === 'heated') {
                message = 'Heat then quench (Q) before hammering.';
            } else {
                message = 'Build a fire against the rock to heat it.';
            }
        } else {
            return;
        }

        if (damage <= 0) {
            this.onStatusChange(message);
            return;
        }

        resource.hp = Math.max(0, resource.hp - damage);
        this.onStatusChange(message);

        if (resource.hp <= 0) {
            if (resource.tag === TAG.TREE) {
                this.collapseTree(resource, 'axe');
            } else if (resource.tag === TAG.ROCK_DEPOSIT) {
                this.shatterRock(resource);
            }
        }
    }

    collapseTree(resource, cause) {
        const pos = resource.root.position.clone();
        const chunkCount = cause === 'fire' ? 4 : 6;

        this.spawnChunks(pos, 'wood', chunkCount);
        this.removeResource(resource);
        this.onShake(0.12);
        this.onStatusChange(cause === 'fire'
            ? 'Fire-setting toppled the charred tree.'
            : 'The tree falls — gather the scattered wood.');
    }

    shatterRock(resource) {
        const pos = resource.root.position.clone();
        this.spawnChunks(pos, 'stone', 5);
        resource.state = 'broken';
        this.removeResource(resource);
        this.onShake(0.1);
        this.onStatusChange('Rock face collapses into knappable chunks.');
    }

    spawnChunks(origin, lootType, count) {
        for (let i = 0; i < count; i++) {
            const size = 0.25 + Math.random() * 0.2;
            const geometry = new THREE.BoxGeometry(size, size * 0.6, size);
            const color = lootType === 'wood' ? 0x5c4033 : 0x7a7a7a;
            const material = new THREE.MeshStandardMaterial({ color, flatShading: true });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;

            const angle = Math.random() * Math.PI * 2;
            const speed = 2 + Math.random() * 3;
            const x = origin.x + Math.cos(angle) * 0.5;
            const z = origin.z + Math.sin(angle) * 0.5;
            const y = this.getTerrainHeight(x, z) + 0.4;

            mesh.position.set(x, y, z);

            const resource = {
                tag: TAG.RESOURCE_CHUNK,
                root: mesh,
                hp: 1,
                maxHp: 1,
                loot: lootType,
                amount: 1,
                velocity: new THREE.Vector3(
                    Math.cos(angle) * speed,
                    3 + Math.random() * 2,
                    Math.sin(angle) * speed
                ),
                spin: new THREE.Vector3(
                    Math.random() * 4,
                    Math.random() * 4,
                    Math.random() * 4
                ),
            };

            this.scene.add(mesh);
            this.registerInteractable(mesh, resource);
            this.chunks.push(resource);
        }
    }

    updateChunks(delta) {
        for (const chunk of this.chunks) {
            if (!chunk.velocity) continue;

            chunk.velocity.y -= 18 * delta;
            chunk.root.position.addScaledVector(chunk.velocity, delta);
            chunk.root.rotation.x += chunk.spin.x * delta;
            chunk.root.rotation.y += chunk.spin.y * delta;

            const groundY = this.getTerrainHeight(chunk.root.position.x, chunk.root.position.z) + 0.15;
            if (chunk.root.position.y <= groundY) {
                chunk.root.position.y = groundY;
                chunk.velocity.multiplyScalar(0.35);
                chunk.velocity.y = 0;
                if (chunk.velocity.length() < 0.2) {
                    chunk.velocity.set(0, 0, 0);
                    chunk.spin.multiplyScalar(0.5);
                }
            }
        }
    }

    autoPickupNearbyChunks() {
        const playerPos = this.camera.position;
        for (const chunk of [...this.chunks]) {
            if (chunk.tag !== TAG.RESOURCE_CHUNK) continue;
            const dist = chunk.root.position.distanceTo(playerPos);
            if (dist < 1.1) {
                this.collectChunk(chunk);
            }
        }
    }

    getNearestCampfire(position, radius) {
        let nearest = null;
        let bestDist = radius;
        for (const fire of this.campfires) {
            const dist = fire.root.position.distanceTo(position);
            if (dist <= bestDist) {
                bestDist = dist;
                nearest = fire;
            }
        }
        return nearest;
    }

    applyTreeCharring(resource, ratio) {
        resource.root.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            if (child.geometry.type === 'ConeGeometry') return;
            const base = child.userData.baseColor ?? 0x5c4033;
            child.userData.baseColor = base;
            child.material.color.setHex(lerpColor(base, 0x1a1008, ratio));
        });
    }

    applyRockVisual(resource, ratio) {
        resource.root.traverse((child) => {
            if (!child.isMesh || !child.material) return;
            const base = child.userData.baseColor ?? 0x6a6a6a;
            child.userData.baseColor = base;

            if (resource.state === 'cracked') {
                child.material.color.setHex(lerpColor(base, 0x3a3a3a, 0.85));
                child.scale.set(1.02, 0.96, 1.02);
            } else if (resource.state === 'heated' || ratio > 0.5) {
                child.material.color.setHex(lerpColor(base, 0xc45c1a, clamp(ratio, 0.3, 1)));
            } else {
                child.material.color.setHex(lerpColor(base, 0x9a4010, ratio));
            }
        });
    }

    removeResource(resource) {
        this.scene.remove(resource.root);
        this.unregisterResource(resource);
        this.chunks = this.chunks.filter((c) => c !== resource);
    }

    describeTarget(resource) {
        switch (resource.tag) {
            case TAG.BRANCH_GROUND: return 'Fallen branch';
            case TAG.PEBBLE_GROUND: return 'Surface pebble';
            case TAG.TREE: return this.player.tools.stoneAxe > 0 ? 'Living tree' : 'Tree (needs axe)';
            case TAG.ROCK_DEPOSIT:
                if (resource.state === 'cracked') return 'Cracked rock face';
                if (resource.state === 'heated') return 'Heated rock — quench (Q)';
                return 'Rock deposit — heat with fire';
            case TAG.RESOURCE_CHUNK: return `${resource.loot} chunk`;
            default: return resource.tag;
        }
    }

    // --- World builders (called from main.js) ---

    createBranch(x, y, z) {
        const group = new THREE.Group();
        const geometry = new THREE.CylinderGeometry(0.08, 0.1, 1.6, 5);
        geometry.rotateZ(Math.PI / 2);
        const material = new THREE.MeshStandardMaterial({ color: 0x6b4423, flatShading: true });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.y = Math.random() * Math.PI;
        mesh.position.y = 0.08;
        mesh.castShadow = true;
        group.add(mesh);
        group.position.set(x, y, z);

        const resource = {
            tag: TAG.BRANCH_GROUND,
            root: group,
            hp: 1,
            maxHp: 1,
        };

        this.scene.add(group);
        this.registerInteractable(mesh, resource);
        return resource;
    }

    createPebble(x, y, z) {
        const geometry = new THREE.DodecahedronGeometry(0.18 + Math.random() * 0.12, 0);
        const material = new THREE.MeshStandardMaterial({
            color: Math.random() > 0.4 ? 0x4a4a50 : 0x8b7355,
            flatShading: true,
            roughness: 0.95,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y + 0.1, z);
        mesh.castShadow = true;
        this.scene.add(mesh);

        const resource = {
            tag: TAG.PEBBLE_GROUND,
            root: mesh,
            hp: 1,
            maxHp: 1,
        };
        this.registerInteractable(mesh, resource);
        return resource;
    }

    createTree(x, y, z) {
        const treeGroup = new THREE.Group();
        const trunkHeight = 3 + Math.random() * 2;

        const trunkGeometry = new THREE.BoxGeometry(1, trunkHeight, 1);
        const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5c4033 });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
        trunk.position.y = trunkHeight / 2;
        trunk.castShadow = true;
        trunk.receiveShadow = true;
        treeGroup.add(trunk);

        const leavesGeometry = new THREE.ConeGeometry(2.5, 4, 6);
        const leavesMaterial = new THREE.MeshStandardMaterial({ color: 0x2e4d1e, flatShading: true });
        const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
        leaves.position.y = trunkHeight + 1.5;
        leaves.castShadow = true;
        treeGroup.add(leaves);

        treeGroup.position.set(x, y, z);
        this.scene.add(treeGroup);

        const resource = {
            tag: TAG.TREE,
            root: treeGroup,
            hp: 100,
            maxHp: 100,
            charProgress: 0,
            fireRadius: 5,
        };

        treeGroup.traverse((child) => {
            if (child.isMesh) this.registerInteractable(child, resource);
        });

        return resource;
    }

    createRockDeposit(x, y, z) {
        const geometry = new THREE.DodecahedronGeometry(1.4 + Math.random() * 0.8, 1);
        const material = new THREE.MeshStandardMaterial({ color: 0x6a6a6a, roughness: 0.85, flatShading: true });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(x, y + 0.8, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const resource = {
            tag: TAG.ROCK_DEPOSIT,
            root: mesh,
            hp: 80,
            maxHp: 80,
            state: 'solid',
            heatProgress: 0,
            heatRadius: 3.5,
        };

        this.registerInteractable(mesh, resource);
        return resource;
    }
}
