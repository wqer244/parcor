// ────────────────────────────────────────────────────────
// 3D Game Renderer — expo-gl + Three.js (no expo-three)
// ────────────────────────────────────────────────────────
import React, { useCallback, useRef } from 'react';
import { StyleSheet, Platform, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GLView } from 'expo-gl';
import * as THREE from 'three';
import {
  PLATFORMS, PhysState3D, WeaponType, WEAPON_DEFS, PVP_WEAPON_SPAWNS, WEAPON_RESPAWN_MS,
  PVP_PILLARS, PVP_WALL_SEGMENTS, TIER_COLORS,
} from '@/services/game3DPhysics';
import { Skin, getSkin, DEFAULT_SKIN_ID, CHARACTER_MODEL } from '@/constants/skins';
import { Asset } from 'expo-asset';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/examples/jsm/utils/SkeletonUtils.js';

// Three common camera perspectives:
//  'third'  — current default: behind & above the player (chase cam)
//  'first'  — first-person, from the player's eyes looking forward
//  'top'    — top-down bird's-eye view, straight above the player
export type CameraMode = 'third' | 'first' | 'top';

export interface RemotePlayer3D {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  skinId?: string;
  weapon?: WeaponType | null;
  name: string;
}

interface Props {
  physStateRef: React.MutableRefObject<PhysState3D>;
  playerSkin: Skin;
  remotePlayersRef: React.MutableRefObject<RemotePlayer3D[]>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
  // Free-look drag state (radians). yaw = horizontal turn, pitch = vertical
  // tilt. Updated by a Pan gesture in game.tsx; read every frame here —
  // exactly like physStateRef, so this doesn't need to be React state.
  orbitYawRef: React.MutableRefObject<number>;
  orbitPitchRef: React.MutableRefObject<number>;
  // PvP — weapon crate cooldown timestamps (weaponId -> last taken at,
  // 0/undefined = available) and the local player's currently held
  // weapon, read fresh every frame so crate visibility and the held prop
  // stay in sync without re-mounting the GL scene.
  weaponTakenAtRef: React.MutableRefObject<Record<string, number>>;
  currentWeaponRef: React.MutableRefObject<WeaponType | null>;
}

// ── Helpers ────────────────────────────────────────────────
function cssHex(css: string): number {
  return parseInt(css.replace('#', '0x'), 16);
}

// ── Character builder ──────────────────────────────────────
// Sleek futuristic runner — smooth capsules, NO Roblox blocks.
// Returns both the group (for the scene) and direct references to the
// moving parts (for animation) — grabbing children by array index was
// fragile and was actually the reason the walk animation looked broken.
interface CharacterRig {
  kind: 'procedural';
  group: THREE.Group;
  torso: THREE.Object3D;
  head: THREE.Object3D;
  lArm: THREE.Object3D;
  rArm: THREE.Object3D;
  lLeg: THREE.Object3D;
  rLeg: THREE.Object3D;
}

// The GLB-based rig (loaded from assets/models/character.glb). It has its
// own internal skeleton + animation clip, so unlike CharacterRig we don't
// puppeteer individual limbs — we just position/rotate the group and let
// the AnimationMixer drive the idle animation every frame.
interface ModelRig {
  kind: 'model';
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
}

type AnyRig = CharacterRig | ModelRig;

// ── GLB model loading ────────────────────────────────────
// Loaded once and cached; every character using the model skin gets its
// own SkeletonUtils.clone() (a real GLTFLoader re-parse per instance is
// unnecessary and slow). Textures were stripped at build time (see
// constants/skins.ts) so there's no image decoding to worry about on
// native — this is plain geometry + a skinned skeleton + flat colors.
interface LoadedModel { scene: THREE.Group; animations: THREE.AnimationClip[] }
let cachedModelPromise: Promise<LoadedModel> | null = null;

function loadCharacterModel(): Promise<LoadedModel> {
  if (!cachedModelPromise) {
    cachedModelPromise = (async () => {
      const asset = Asset.fromModule(CHARACTER_MODEL);
      await asset.downloadAsync();
      const uri = asset.localUri ?? asset.uri;
      const res = await fetch(uri);
      const buffer = await res.arrayBuffer();
      const loader = new GLTFLoader();
      return new Promise<LoadedModel>((resolve, reject) => {
        loader.parse(
          buffer,
          '',
          (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
          (err) => reject(err),
        );
      });
    })();
  }
  return cachedModelPromise;
}

function createModelRig(base: LoadedModel): ModelRig {
  const clone = SkeletonUtils.clone(base.scene) as THREE.Group;
  const mixer = new THREE.AnimationMixer(clone);
  if (base.animations[0]) {
    mixer.clipAction(base.animations[0]).play();
  }
  return { kind: 'model', group: clone, mixer };
}

function createCharacter(skin: Skin): CharacterRig {
  const group = new THREE.Group();
  const accentHex = cssHex(skin.accent);

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.8,
    metalness: 0.95,
    roughness: 0.05,
  });
  const suitMat = new THREE.MeshStandardMaterial({
    color: cssHex(skin.suit),
    metalness: 0.7,
    roughness: 0.35,
  });
  const pantsMat = new THREE.MeshStandardMaterial({
    color: cssHex(skin.pants),
    metalness: 0.6,
    roughness: 0.4,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: cssHex(skin.skin),
    roughness: 0.75,
    metalness: 0.0,
  });
  const hairMat = new THREE.MeshStandardMaterial({
    color: cssHex(skin.hair),
    roughness: 0.55,
    metalness: 0.0,
  });

  // Head — a small pivot group so it can nod/bob independently of the body
  const headPivot = new THREE.Group();
  headPivot.position.y = 1.66;
  group.add(headPivot);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 20, 16), skinMat);
  headPivot.add(head);

  // Hair — a slightly-larger offset sphere cap sitting on the crown, cheap
  // but reads clearly as a hairstyle silhouette at gameplay distance.
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.235, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
    hairMat,
  );
  hair.position.set(0, 0.05, 0.01);
  headPivot.add(hair);

  // Visor (glowing front half)
  const visorGeo = new THREE.SphereGeometry(0.15, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const visor = new THREE.Mesh(visorGeo, accentMat);
  visor.position.set(0, 0, -0.09);
  visor.rotation.x = 0.1;
  headPivot.add(visor);

  // Helmet ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 10, 20), accentMat);
  ring.rotation.x = Math.PI / 2;
  headPivot.add(ring);

  // Torso — pivot at the hips so lean/bob reads naturally
  const torsoPivot = new THREE.Group();
  torsoPivot.position.y = 0.85;
  group.add(torsoPivot);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.52, 6, 12), suitMat);
  torso.position.y = 0.25;
  torsoPivot.add(torso);

  // Chest stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.2), accentMat);
  stripe.position.set(0, 0.25, -0.18);
  torsoPivot.add(stripe);

  // Arms — pivoted at the shoulder so they swing naturally, not from the middle
  const armGeo = new THREE.CapsuleGeometry(0.065, 0.42, 6, 10);

  const lArm = new THREE.Group();
  lArm.position.set(-0.29, 0.44, 0);
  const lArmMesh = new THREE.Mesh(armGeo, suitMat);
  lArmMesh.position.y = -0.21;
  lArm.add(lArmMesh);
  torsoPivot.add(lArm);

  const rArm = new THREE.Group();
  rArm.position.set(0.29, 0.44, 0);
  const rArmMesh = new THREE.Mesh(armGeo, suitMat);
  rArmMesh.position.y = -0.21;
  rArm.add(rArmMesh);
  torsoPivot.add(rArm);

  // Legs — pivoted at the hip, shoe is nested inside so it swings with the leg
  const legGeo = new THREE.CapsuleGeometry(0.08, 0.5, 6, 10);
  const shoeGeo = new THREE.BoxGeometry(0.18, 0.09, 0.28);

  const lLeg = new THREE.Group();
  lLeg.position.set(-0.11, 0.65, 0);
  const lLegMesh = new THREE.Mesh(legGeo, pantsMat);
  lLegMesh.position.y = -0.25;
  lLeg.add(lLegMesh);
  const lShoe = new THREE.Mesh(shoeGeo, accentMat);
  lShoe.position.set(0, -0.6, -0.03);
  lLeg.add(lShoe);
  group.add(lLeg);

  const rLeg = new THREE.Group();
  rLeg.position.set(0.11, 0.65, 0);
  const rLegMesh = new THREE.Mesh(legGeo, pantsMat);
  rLegMesh.position.y = -0.25;
  rLeg.add(rLegMesh);
  const rShoe = new THREE.Mesh(shoeGeo, accentMat);
  rShoe.position.set(0, -0.6, -0.03);
  rLeg.add(rShoe);
  group.add(rLeg);

  return { kind: 'procedural', group, torso: torsoPivot, head: headPivot, lArm, rArm, lLeg, rLeg };
}

// ── Platform meshes ────────────────────────────────────────
function buildPlatformMeshes(scene: THREE.Scene) {
  for (const p of PLATFORMS) {
    const geo = new THREE.BoxGeometry(p.width, p.height, p.depth);
    const mat = new THREE.MeshStandardMaterial({
      color: cssHex(p.color),
      emissive: cssHex(p.glowColor),
      emissiveIntensity: p.type === 'finish' ? 0.55 : 0.18,
      metalness: 0.85,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, p.y - p.height / 2, p.z);
    scene.add(mesh);

    // Top glow strip
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(p.width + 0.06, 0.035, p.depth + 0.06),
      new THREE.MeshStandardMaterial({
        color: cssHex(p.glowColor),
        emissive: cssHex(p.glowColor),
        emissiveIntensity: p.type === 'finish' ? 2.2 : 1.4,
      }),
    );
    strip.position.set(p.x, p.y + 0.01, p.z);
    scene.add(strip);

    // Finish pillars
    if (p.type === 'finish') {
      const pillarGeo = new THREE.CylinderGeometry(0.07, 0.07, 3, 8);
      const pillarMat = new THREE.MeshStandardMaterial({
        color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.0,
      });
      for (const px of [-2.3, 2.3]) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(p.x + px, p.y + 1.5, p.z);
        scene.add(pillar);
      }
    }

    // Arena structures (decks, hub, cover, steps) get armor-panel trim —
    // a recessed dark bevel + four corner rivets/beacons — instead of a
    // plain glowing cube, so the PvP zone reads as built hardware rather
    // than parkour geometry re-used as a battlefield.
    if (p.arena) {
      const bevelMat = new THREE.MeshStandardMaterial({
        color: 0x0a0a10, metalness: 0.9, roughness: 0.3,
      });
      const bevel = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(p.width - 0.3, 0.2), 0.05, Math.max(p.depth - 0.3, 0.2)),
        bevelMat,
      );
      bevel.position.set(p.x, p.y - 0.01, p.z);
      scene.add(bevel);

      const beaconGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8);
      const beaconMat = new THREE.MeshStandardMaterial({
        color: cssHex(p.glowColor), emissive: cssHex(p.glowColor), emissiveIntensity: 2.5,
      });
      const cornerInsetX = Math.max(p.width / 2 - 0.28, 0.1);
      const cornerInsetZ = Math.max(p.depth / 2 - 0.28, 0.1);
      for (const cx of [-cornerInsetX, cornerInsetX]) {
        for (const cz of [-cornerInsetZ, cornerInsetZ]) {
          const beacon = new THREE.Mesh(beaconGeo, beaconMat);
          beacon.position.set(p.x + cx, p.y + 0.11, p.z + cz);
          scene.add(beacon);
        }
      }
    }
  }
}

// ── Arena decor — pillars, perimeter walls, entrance gate, floor grid ──
// Pure set-dressing (no collision). This is what turns the PvP zone from
// "a lit rectangle with boxes on it" into a coliseum silhouette players
// can recognize the shape of from across the map.
function buildArenaDecor(scene: THREE.Scene) {
  const pillarMat = new THREE.MeshStandardMaterial({
    color: 0x151022, metalness: 0.85, roughness: 0.3,
  });
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.8,
  });

  for (const pil of PVP_PILLARS) {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(pil.radius, pil.radius * 1.25, pil.height, 10),
      pillarMat,
    );
    shaft.position.set(pil.x, pil.height / 2, pil.z);
    scene.add(shaft);

    // Glowing crown + ring bands so the towers read from a distance
    const crown = new THREE.Mesh(new THREE.SphereGeometry(pil.radius * 1.4, 12, 10), beaconMat);
    crown.position.set(pil.x, pil.height + pil.radius * 0.6, pil.z);
    scene.add(crown);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.2,
    });
    for (const t of [0.32, 0.68]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(pil.radius * 1.15, 0.035, 8, 20),
        ringMat,
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.set(pil.x, pil.height * t, pil.z);
      scene.add(ring);
    }

    const beaconLight = new THREE.PointLight(0xff3333, 0.9, 14);
    beaconLight.position.set(pil.x, pil.height + 0.5, pil.z);
    scene.add(beaconLight);
  }

  // Perimeter energy walls — dark metal base with a bright top trim line
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0x1a0f14, metalness: 0.8, roughness: 0.4,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.6,
  });
  for (const w of PVP_WALL_SEGMENTS) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(w.width, w.height, w.depth), wallMat);
    wall.position.set(w.x, w.height / 2, w.z);
    scene.add(wall);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w.width + 0.04, 0.06, w.depth + 0.04),
      trimMat,
    );
    trim.position.set(w.x, w.height + 0.03, w.z);
    scene.add(trim);
  }

  // Entrance gate — a glowing arch bridging the two gate pillars, marking
  // the transition from the parkour walkway into the arena proper.
  const archMat = new THREE.MeshStandardMaterial({
    color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 1.6,
  });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.09, 8, 24, Math.PI), archMat);
  arch.position.set(0, 6.2, 25.2);
  arch.rotation.z = Math.PI;
  scene.add(arch);

  // Central hub — a vertical light column marking the legendary weapon
  // objective, visible from every corner of the arena.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffb020, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 40, 16, 1, true), beamMat);
  beam.position.set(0, 22, 43);
  scene.add(beam);

  // Hi-tech floor grid across the arena — thin emissive lines instead of
  // a flat unbroken slab, so the ground itself reads as engineered.
  const gridMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.16 });
  for (let gx = -12; gx <= 12; gx += 3) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 34), gridMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(gx, 0.015, 43);
    scene.add(line);
  }
  for (let gz = 27; gz <= 59; gz += 4) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(24, 0.03), gridMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(0, 0.015, gz);
    scene.add(line);
  }
}

// ── Starfield ──────────────────────────────────────────────
function buildStarfield(scene: THREE.Scene) {
  const n = 700;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 250;
    pos[i * 3 + 1] = Math.random() * 90 + 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 350;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x99aaff, size: 0.2 })));
}

// ── Weapon models ───────────────────────────────────────────
// Builds a recognizable silhouette per weapon type out of primitives —
// blade+guard+grip for the sword, bow limbs as a torus arc, a proper
// rifle-like body+barrel for the blaster/railgun, etc — instead of the
// single glowing box every weapon used to share. The weapon's own color
// (WEAPON_DEFS) is the main material; the rarity tier color (TIER_COLORS)
// accents the glowing parts, so higher-tier weapons visibly "glow richer"
// on both the pedestal and in-hand. Origin sits at the grip/base, with
// the model extending upward along +Y — convenient for both pedestal
// floating (used as-is) and held-in-hand (rotated forward, see
// updateHeldWeapon below).
function buildWeaponMesh(type: WeaponType): THREE.Group {
  const def = WEAPON_DEFS[type];
  const primaryMat = new THREE.MeshStandardMaterial({ color: cssHex(def.color), metalness: 0.85, roughness: 0.25 });
  const accentHex = cssHex(TIER_COLORS[def.tier]);
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex, emissive: accentHex, emissiveIntensity: 1.5, metalness: 0.5, roughness: 0.2,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.5, roughness: 0.6 });
  const group = new THREE.Group();

  switch (type) {
    case 'sword': {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.02), primaryMat);
      blade.position.y = 0.5;
      group.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 4), primaryMat);
      tip.position.y = 0.82;
      tip.rotation.y = Math.PI / 4;
      group.add(tip);
      const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.05), accentMat);
      guard.position.y = 0.24;
      group.add(guard);
      const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8), darkMat);
      grip.position.y = 0.12;
      group.add(grip);
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.04, 10, 8), accentMat);
      pommel.position.y = 0.01;
      group.add(pommel);
      break;
    }
    case 'hammer': {
      const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.55, 8), darkMat);
      handle.position.y = 0.3;
      group.add(handle);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.2), primaryMat);
      head.position.y = 0.62;
      group.add(head);
      for (const side of [-1, 1]) {
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.03, 12), accentMat);
        cap.rotation.z = Math.PI / 2;
        cap.position.set(side * 0.16, 0.62, 0);
        group.add(cap);
      }
      break;
    }
    case 'blaster': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.14, 0.3), primaryMat);
      body.position.y = 0.45;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.32, 10), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.47, -0.28);
      group.add(barrel);
      const tipRing = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.014, 8, 14), accentMat);
      tipRing.position.set(0, 0.47, -0.44);
      group.add(tipRing);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.09), darkMat);
      grip.position.set(0, 0.24, 0.08);
      grip.rotation.x = -0.25;
      group.add(grip);
      break;
    }
    case 'bow': {
      const limb = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.028, 8, 20, Math.PI * 0.92), primaryMat);
      limb.rotation.z = Math.PI / 2;
      limb.rotation.y = Math.PI / 2;
      limb.position.y = 0.42;
      group.add(limb);
      const bowstring = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.78, 6), darkMat);
      bowstring.position.y = 0.42;
      group.add(bowstring);
      const gripWrap = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 10), accentMat);
      gripWrap.position.y = 0.42;
      group.add(gripWrap);
      break;
    }
    case 'staff': {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.8, 8), darkMat);
      rod.position.y = 0.42;
      group.add(rod);
      const orb = new THREE.Mesh(new THREE.SphereGeometry(0.095, 16, 12), accentMat);
      orb.position.y = 0.87;
      group.add(orb);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.016, 8, 16), primaryMat);
      ring.position.y = 0.87;
      ring.rotation.x = Math.PI / 3;
      group.add(ring);
      break;
    }
    case 'railgun': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.17, 0.58), primaryMat);
      body.position.y = 0.45;
      group.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.5, 12), darkMat);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0.47, -0.5);
      group.add(barrel);
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 12), accentMat);
      core.position.set(0, 0.47, -0.1);
      group.add(core);
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.14, 0.1), accentMat);
        fin.position.set(side * 0.08, 0.47, -0.72);
        group.add(fin);
      }
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.22), darkMat);
      stock.position.set(0, 0.4, 0.36);
      group.add(stock);
      break;
    }
  }

  return group;
}

// ── Renderer factory — works on both web and native ─────────
function makeRenderer(gl: WebGLRenderingContext, w: number, h: number): THREE.WebGLRenderer {
  if (Platform.OS === 'web') {
    // Web: get the canvas from the gl context
    const canvas = (gl as WebGL2RenderingContext & { canvas: HTMLCanvasElement }).canvas;
    return new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
  }
  // Native (Expo GL): build a minimal fake canvas
  const fakeCanvas = {
    width: w, height: h,
    style: {} as CSSStyleDeclaration,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
    clientWidth: w, clientHeight: h,
    getContext: () => gl,
  } as unknown as HTMLCanvasElement;

  return new THREE.WebGLRenderer({
    canvas: fakeCanvas,
    context: gl,
    antialias: false,
  });
}

// ── Web placeholder (WebGL blocked in iframe preview) ───────
function WebPlaceholder() {
  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={['#06060f', '#0a0a20', '#08081a']}
        style={StyleSheet.absoluteFill}
      />
      {/* Fake 3D grid lines */}
      {Array.from({ length: 10 }).map((_, i) => (
        <View key={`h${i}`} style={{
          position: 'absolute', left: 0, right: 0,
          top: `${10 + i * 9}%` as `${number}%`,
          height: 1, backgroundColor: `rgba(0,255,204,${0.04 + i * 0.005})`,
        }} />
      ))}
      {Array.from({ length: 8 }).map((_, i) => (
        <View key={`v${i}`} style={{
          position: 'absolute', top: 0, bottom: 0,
          left: `${5 + i * 13}%` as `${number}%`,
          width: 1, backgroundColor: `rgba(0,170,255,${0.03 + i * 0.003})`,
        }} />
      ))}
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <Text style={{ fontSize: 40 }}>🎮</Text>
        <Text style={{ color: '#00ffcc', fontSize: 18, fontWeight: '800' }}>باركور العرب 3D</Text>
        <Text style={{ color: 'rgba(0,255,204,0.55)', fontSize: 12, textAlign: 'center' }}>
          افتح التطبيق على Expo Go لتجربة اللعبة ثلاثية الأبعاد
        </Text>
      </View>
    </View>
  );
}

// ── Native 3D renderer (hooks always called) ────────────────
function NativeRenderer({ physStateRef, playerSkin, remotePlayersRef, cameraModeRef, orbitYawRef, orbitPitchRef, weaponTakenAtRef, currentWeaponRef }: Props) {
  const rafRef = useRef<number>(0);

  const onContextCreate = useCallback(
    async (gl: WebGLRenderingContext) => {
      const W = (gl as unknown as { drawingBufferWidth: number }).drawingBufferWidth || 800;
      const H = (gl as unknown as { drawingBufferHeight: number }).drawingBufferHeight || 450;

      const renderer = makeRenderer(gl, W, H);
      renderer.setSize(W, H, false);
      renderer.setClearColor(0x06060f);
      renderer.setPixelRatio(1);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x06060f, 0.016);

      const camera = new THREE.PerspectiveCamera(62, W / H, 0.1, 400);

      // Lights — hemisphere gives a soft sky/ground colour gradient instead
      // of a flat ambient wash, which reads much less "empty" on screen.
      scene.add(new THREE.HemisphereLight(0x4466cc, 0x0a0a18, 1.0));
      const sun = new THREE.DirectionalLight(0x88aaff, 1.5);
      sun.position.set(8, 22, 12);
      scene.add(sun);
      const fill = new THREE.PointLight(0x00ffcc, 1.2, 35);
      fill.position.set(0, 12, -60);
      scene.add(fill);
      const back = new THREE.PointLight(0xff00aa, 0.6, 50);
      back.position.set(0, 18, -100);
      scene.add(back);

      // World
      buildPlatformMeshes(scene);
      buildArenaDecor(scene);
      buildStarfield(scene);

      // Ground plane
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 320),
        new THREE.MeshStandardMaterial({ color: 0x03030c, emissive: 0x040410, emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.95 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, -0.65, -70);
      scene.add(ground);

      // Soft contact-shadow blob — a cheap fake shadow that follows each
      // character's feet, so they don't look like they're floating.
      const shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 });
      function makeShadow(): THREE.Mesh {
        const m = new THREE.Mesh(new THREE.CircleGeometry(0.32, 16), shadowMat);
        m.rotation.x = -Math.PI / 2;
        scene.add(m);
        return m;
      }

      // ── PvP weapon pedestals ────────────────────────────
      // A real weapon model (see buildWeaponMesh) hovers and slowly spins
      // above a lit pedestal, with a soft vertical beam and a ground ring
      // — the loot-drop look of a real shooter, colored by rarity tier
      // (TIER_COLORS) so a legendary pickup is visibly more dramatic than
      // a common one from across the arena. Hidden while on cooldown
      // (checked every frame against weaponTakenAtRef, no rebuild needed).
      const crates = PVP_WEAPON_SPAWNS.map((spawn) => {
        const def = WEAPON_DEFS[spawn.type];
        const tierHex = cssHex(TIER_COLORS[def.tier]);

        const weaponModel = buildWeaponMesh(spawn.type);
        weaponModel.position.set(spawn.x, spawn.y + 0.55, spawn.z);
        weaponModel.rotation.x = Math.PI / 10; // tilt so the silhouette reads while spinning
        scene.add(weaponModel);

        // Pedestal base — small dark plinth the weapon floats above
        const base = new THREE.Mesh(
          new THREE.CylinderGeometry(0.42, 0.5, 0.14, 16),
          new THREE.MeshStandardMaterial({ color: 0x14141c, metalness: 0.8, roughness: 0.3 }),
        );
        base.position.set(spawn.x, spawn.y + 0.07, spawn.z);
        scene.add(base);

        // Soft vertical beam + ground ring, tinted by rarity
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 3.2, 12, 1, true),
          new THREE.MeshBasicMaterial({ color: tierHex, transparent: true, opacity: 0.16, side: THREE.DoubleSide }),
        );
        beam.position.set(spawn.x, spawn.y + 1.7, spawn.z);
        scene.add(beam);

        const ring = new THREE.Mesh(
          new THREE.RingGeometry(0.42, 0.54, 24),
          new THREE.MeshBasicMaterial({ color: tierHex, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
        );
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(spawn.x, spawn.y + 0.015, spawn.z);
        scene.add(ring);

        return { id: spawn.id, mesh: weaponModel, ring, base, beam, baseY: spawn.y + 0.55 };
      });

      // Characters
      let playerRig: AnyRig = createCharacter(playerSkin);
      scene.add(playerRig.group);
      const playerShadow = makeShadow();

      if (playerSkin.isModel) {
        loadCharacterModel()
          .then((base) => {
            scene.remove(playerRig.group);
            playerRig = createModelRig(base);
            scene.add(playerRig.group);
          })
          .catch(() => {
            // Load failed (e.g. offline) — keep the procedural fallback
            // rig already on screen, colored to match this skin.
          });
      }

      // Held-weapon prop — a small glowing shape parented to a rig's
      // right arm (procedural rig only; the GLB model skin has no
      // matching hand bone we can safely attach to, so it goes
      // unarmed-looking there for both local and remote players — a
      // known limitation). Shared by the local player and every remote
      // pool entry so everyone's held weapon renders for everyone.
      interface HeldWeaponState { type: WeaponType | null; mesh: THREE.Object3D | null }
      function updateHeldWeapon(rig: AnyRig, held: HeldWeaponState, desired: WeaponType | null | undefined) {
        const type = desired ?? null;
        if (type === held.type) return;
        held.type = type;
        if (held.mesh) {
          held.mesh.parent?.remove(held.mesh);
          held.mesh = null;
        }
        if (type && rig.kind === 'procedural') {
          // Same weapon model used on the pedestal, scaled down and
          // rotated forward-and-down so it reads as gripped in the hand
          // rather than floating loot.
          const mesh = buildWeaponMesh(type);
          mesh.scale.setScalar(0.55);
          mesh.position.set(0.02, -0.36, -0.06);
          mesh.rotation.x = -Math.PI / 2 + 0.35;
          mesh.rotation.z = 0.1;
          rig.rArm.add(mesh);
          held.mesh = mesh;
        }
      }
      const playerHeldWeapon: HeldWeaponState = { type: null, mesh: null };

      interface PoolEntry {
        rig: AnyRig; shadow: THREE.Mesh; legPhase: number; lastX: number; lastZ: number;
        skinId: string; loading: boolean; heldWeapon: HeldWeaponState;
      }
      const remotePool = new Map<string, PoolEntry>();

      // Camera
      const camPos = new THREE.Vector3(0, 6, 10);
      const camLook = new THREE.Vector3(0, 1.2, -4);
      let legPhase = 0;
      let idlePhase = 0;

      // Animates one character rig in place: leg/arm swing while moving,
      // a gentle idle breathing bob while still, and jump squash & stretch.
      function animateRig(
        rig: AnyRig,
        x: number, y: number, z: number, facing: number,
        vy: number, onGround: boolean, moving: boolean,
        phase: number, idle: number,
        shadow: THREE.Mesh,
      ) {
        rig.group.rotation.y = facing;
        rig.group.position.set(x, y, z);
        shadow.position.set(x, y + 0.015, z);
        const shadowScale = onGround ? 1 : Math.max(0.35, 1 - Math.abs(vy) * 1.2);
        shadow.scale.set(shadowScale, shadowScale, shadowScale);

        if (rig.kind === 'model') {
          // The GLB's own AnimationMixer drives its idle clip (updated
          // once per frame in the main loop below) — no limb puppeteering
          // needed here, just world position/rotation and a jump
          // squash & stretch to match the procedural rig's feel.
          const stretch = onGround ? 0 : Math.max(-0.16, Math.min(0.16, vy * 0.5));
          rig.group.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
          return;
        }

        const swing = moving ? Math.sin(phase) * 0.55 : 0;
        rig.lLeg.rotation.x = swing;
        rig.rLeg.rotation.x = -swing;
        rig.rArm.rotation.x = swing * 0.6;
        rig.lArm.rotation.x = -swing * 0.6;

        // Idle breathing bob (only when standing still on the ground)
        const bob = !moving && onGround ? Math.sin(idle) * 0.025 : 0;
        rig.torso.position.y = 0.85 + bob;
        rig.head.position.y = 1.66 + bob * 1.4;

        // Jump squash & stretch — stretch tall going up, squash on landing
        const stretch = onGround ? 0 : Math.max(-0.16, Math.min(0.16, vy * 0.5));
        rig.group.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);

        // Slight forward lean while running
        rig.torso.rotation.x = moving && onGround ? 0.12 : 0;
      }

      const clock = new THREE.Clock();

      // Swaps a pool entry's procedural fallback rig for the loaded GLB
      // model once it's ready. Shared by the "new remote" and "remote
      // switched skin" paths below so the loading logic only lives once.
      function upgradeToModelWhenReady(entry: PoolEntry) {
        if (entry.loading) return;
        entry.loading = true;
        loadCharacterModel()
          .then((base) => {
            entry.loading = false;
            scene.remove(entry.rig.group);
            entry.rig = createModelRig(base);
            entry.heldWeapon = { type: null, mesh: null }; // old prop was on the removed rig
            scene.add(entry.rig.group);
          })
          .catch(() => { entry.loading = false; });
      }

      const animate = () => {
        rafRef.current = requestAnimationFrame(animate);
        const s = physStateRef.current;
        const delta = clock.getDelta();

        // First-person hides the local player model (camera sits at its head)
        const mode = cameraModeRef.current;
        playerRig.group.visible = mode !== 'first';
        playerShadow.visible = mode !== 'first';

        const moving = Math.abs(s.vx) > 0.01 || Math.abs(s.vz) > 0.01;
        if (moving) legPhase += 0.18; else idlePhase += 0.045;
        animateRig(playerRig, s.x, s.y, s.z, s.facingAngle, s.vy, s.onGround, moving, legPhase, idlePhase, playerShadow);
        if (playerRig.kind === 'model') playerRig.mixer.update(delta);
        updateHeldWeapon(playerRig, playerHeldWeapon, currentWeaponRef.current);

        // PvP weapon crates — hidden while on cooldown, otherwise a slow
        // spin + bob so they read as "live" pickups.
        const now = Date.now();
        for (const crate of crates) {
          const takenAt = weaponTakenAtRef.current[crate.id] ?? 0;
          const available = now - takenAt > WEAPON_RESPAWN_MS;
          crate.mesh.visible = available;
          crate.ring.visible = available;
          crate.base.visible = available;
          crate.beam.visible = available;
          if (available) {
            crate.mesh.rotation.y += 0.03;
            crate.mesh.position.y = crate.baseY + Math.sin(now / 500) * 0.08;
          }
        }

        const remotes = remotePlayersRef.current;
        const seen = new Set<string>();
        for (const rp of remotes) {
          seen.add(rp.id);
          const rpSkinId = rp.skinId ?? DEFAULT_SKIN_ID;
          const rpSkin = getSkin(rpSkinId);
          let entry = remotePool.get(rp.id);
          if (!entry) {
            entry = { rig: createCharacter(rpSkin), shadow: makeShadow(), legPhase: 0, lastX: rp.x, lastZ: rp.z, skinId: rpSkinId, loading: false, heldWeapon: { type: null, mesh: null } };
            scene.add(entry.rig.group);
            remotePool.set(rp.id, entry);
            if (rpSkin.isModel) upgradeToModelWhenReady(entry);
          } else if (entry.skinId !== rpSkinId) {
            // Remote player changed skin — swap the rig in place.
            scene.remove(entry.rig.group);
            entry.rig = createCharacter(rpSkin);
            entry.skinId = rpSkinId;
            entry.heldWeapon = { type: null, mesh: null }; // old prop was on the removed rig
            scene.add(entry.rig.group);
            if (rpSkin.isModel) upgradeToModelWhenReady(entry);
          }
          updateHeldWeapon(entry.rig, entry.heldWeapon, rp.weapon);
          // Infer movement + facing from frame-to-frame position deltas,
          // since remote players only send us a position, not full physics.
          const ddx = rp.x - entry.lastX;
          const ddz = rp.z - entry.lastZ;
          const dist = Math.sqrt(ddx * ddx + ddz * ddz);
          const rMoving = dist > 0.003;
          if (rMoving) entry.legPhase += 0.18;
          const rFacing = rMoving ? Math.atan2(ddx, ddz) : entry.rig.group.rotation.y;
          animateRig(entry.rig, rp.x, rp.y, rp.z, rFacing, 0, true, rMoving, entry.legPhase, 0, entry.shadow);
          if (entry.rig.kind === 'model') entry.rig.mixer.update(delta);
          entry.rig.group.visible = true;
          entry.shadow.visible = true;
          entry.lastX = rp.x;
          entry.lastZ = rp.z;
        }
        for (const [id, entry] of remotePool) {
          if (!seen.has(id)) { entry.rig.group.visible = false; entry.shadow.visible = false; }
        }

        // Free-look drag state — yaw turns left/right, pitch tilts up/down.
        // This is set by a finger-drag gesture in game.tsx (see the
        // full-screen GestureDetector there) and is independent of which
        // way the player is walking, exactly like Roblox/Minecraft's
        // drag-to-look camera.
        const yaw = orbitYawRef.current;
        const pitch = orbitPitchRef.current;
        const cosYaw = Math.cos(yaw);
        const sinYaw = Math.sin(yaw);
        const cosPitch = Math.cos(pitch);
        const sinPitch = Math.sin(pitch);

        let targetPos: THREE.Vector3;
        let targetLook: THREE.Vector3;
        let lerpSpeed = 0.07;

        if (mode === 'first') {
          // Eyes-level; look direction comes straight from the drag (yaw =
          // turn left/right, pitch = look up/down), not from facingAngle —
          // so you can look around freely while walking in any direction.
          const lookDx = sinYaw * cosPitch;
          const lookDy = sinPitch;
          const lookDz = cosYaw * cosPitch;
          targetPos = new THREE.Vector3(s.x, s.y + 1.6, s.z);
          targetLook = new THREE.Vector3(s.x + lookDx * 5, s.y + 1.6 + lookDy * 5, s.z + lookDz * 5);
          lerpSpeed = 0.45; // snappy — first-person look shouldn't lag behind the finger
        } else if (mode === 'top') {
          // Straight overhead, small Z nudge avoids a degenerate lookAt.
          // Yaw still rotates the compass direction of the view; pitch is
          // ignored here (staying perfectly overhead reads best).
          targetPos = new THREE.Vector3(s.x + sinYaw * 0.01, s.y + 20, s.z + cosYaw * 0.01);
          targetLook = new THREE.Vector3(s.x, s.y, s.z);
        } else {
          // 'third' — orbiting chase camera: distance is fixed, yaw/pitch
          // (from the drag gesture) rotate it around the player. Defaults
          // (yaw 0, pitch ~0.447 rad) reproduce the original fixed
          // behind-and-above view exactly. Pitch is kept positive by the
          // clamp in game.tsx, so the camera can never dip below the player.
          const ORBIT_DIST = 11.1;
          targetPos = new THREE.Vector3(
            s.x + sinYaw * cosPitch * ORBIT_DIST,
            s.y + 1 + sinPitch * ORBIT_DIST,
            s.z + cosYaw * cosPitch * ORBIT_DIST,
          );
          targetLook = new THREE.Vector3(s.x, s.y + 1, s.z);
        }

        camPos.lerp(targetPos, lerpSpeed);
        camLook.lerp(targetLook, lerpSpeed);
        camera.position.copy(camPos);
        camera.lookAt(camLook);

        renderer.render(scene, camera);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gl as any).endFrameEXP?.();
      };

      animate();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <GLView
      style={StyleSheet.absoluteFill}
      onContextCreate={onContextCreate as (gl: unknown) => void}
    />
  );
}

// ── Public export — platform-aware ─────────────────────────
export function GameRenderer3D(props: Props) {
  // Web preview (sandboxed iframe) doesn't support WebGL — show placeholder
  if (Platform.OS === 'web') return <WebPlaceholder />;
  return <NativeRenderer {...props} />;
}
