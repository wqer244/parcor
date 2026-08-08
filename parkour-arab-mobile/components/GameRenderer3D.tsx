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
  PVP_PILLARS, PVP_WALL_SEGMENTS, PVP_BANNERS, TIER_COLORS,
  HAZARDS, getPlatformPosition, getHazardPosition, isPlatformSolid, Platform3D, Hazard3D,
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
  // Date.now() of this player's most recent attack — a change in this
  // value (not its absolute value) is what triggers the swing/fire
  // animation on their rig. See PlayerContext's notifyAttack.
  attackedAt?: number;
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
  // Local player's most recent attack attempt (timestamp + the weapon it
  // was made with) — drives the swing/fire animation on the local rig,
  // same mechanism used for remote rigs via RemotePlayer3D.attackedAt.
  localAttackRef: React.MutableRefObject<{ at: number; weapon: WeaponType | null }>;
  // Date.now() of the last hit the local player took — drives a brief
  // red hit-flash on their own model.
  localDamageAtRef: React.MutableRefObject<number>;
  // True while the local player is holding the "aim" button — drives the
  // camera FOV zoom (in every camera mode) that backs the aim/target-lock
  // system in game.tsx.
  isAimingRef?: React.MutableRefObject<boolean>;
  // id of the remote player currently locked as the aim target (or null)
  // — drives the floating lock-on reticle drawn above their head.
  aimTargetIdRef?: React.MutableRefObject<string | null>;
  // Fired every time ANY player (local or remote) triggers a weapon
  // attack, so game.tsx can play the matching sound effect — with a
  // distance for remote shots so game.tsx can attenuate the volume for
  // far-away gunfire instead of every shot on the map blasting at full
  // volume. Kept as a ref (not a prop callback that changes) so calling
  // it every frame-ish never triggers a React re-render.
  onFireRef?: React.MutableRefObject<((weapon: WeaponType, isLocal: boolean, distance: number) => void) | null>;
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
  // Exposed so the animate loop can briefly tint it red on taking damage
  // without needing a separate overlay mesh per character.
  suitMat: THREE.MeshStandardMaterial;
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

  return { kind: 'procedural', group, torso: torsoPivot, head: headPivot, lArm, rArm, lLeg, rLeg, suitMat };
}

// ── Shared material cache ────────────────────────────────────
// Keyed by every property that actually affects the look, so visually
// identical requests always reuse the same Material instance instead of
// compiling/allocating a new one. Course platforms only use ~12 distinct
// colors across 34+ pieces, so this alone cuts dozens of duplicate
// materials down to a dozen shared ones — and stays flat as more
// platforms/levels are added later instead of growing with content.
const standardMatCache = new Map<string, THREE.MeshStandardMaterial>();
function getStandardMat(opts: {
  color: number; emissive?: number; emissiveIntensity?: number; metalness?: number; roughness?: number;
}): THREE.MeshStandardMaterial {
  const key = `${opts.color}|${opts.emissive ?? 0}|${opts.emissiveIntensity ?? 0}|${opts.metalness ?? 1}|${opts.roughness ?? 1}`;
  let mat = standardMatCache.get(key);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: opts.color,
      emissive: opts.emissive ?? 0x000000,
      emissiveIntensity: opts.emissiveIntensity ?? 0,
      metalness: opts.metalness ?? 1,
      roughness: opts.roughness ?? 1,
    });
    standardMatCache.set(key, mat);
  }
  return mat;
}

// ── Platform meshes ────────────────────────────────────────
// Built per-chunk now (see the ChunkManager below) instead of once for
// the whole course — a level this long can't afford to build every
// platform's meshes (plus Map 4's shard/ring pairs) at startup, so this
// function is called once per chunk, only for the platforms that chunk
// actually contains, and everything it creates is returned in `objects`
// so the chunk can be fully torn down again when the player moves away.
//
// `dynamicPlatforms` covers Map 4's moving/blinking obstacles
// (m4-move*/m4-blink* in PLATFORMS): every visual piece built for a
// given platform (box, glow strip, and — for crystal-themed ones — the
// floating shard + hover ring) is recorded with its fixed offset from
// that platform's anchor point, so the animate() loop can reposition
// (and, for blinkers, show/hide) the whole set each frame just by
// re-evaluating the platform's live position/solidity.
interface DynamicPlatformPart { obj: THREE.Object3D; offsetX: number; offsetY: number; offsetZ: number }
interface DynamicPlatform { platform: Platform3D; parts: DynamicPlatformPart[] }
interface PlatformMeshResult {
  crystalSpinners: THREE.Object3D[];
  dynamicPlatforms: DynamicPlatform[];
  objects: THREE.Object3D[]; // every top-level object added to the scene — dispose these on unload
}

function buildPlatformMeshes(scene: THREE.Scene, platforms: Platform3D[]): PlatformMeshResult {
  // Arena "armor panel" trim (bevel + 4 corner beacons per arena platform)
  // — one InstancedMesh per chunk for the bevels and one per beacon
  // color, so a chunk with several arena platforms still costs only a
  // couple of draw calls, and the whole thing disposes cleanly as a unit
  // when that chunk unloads.
  const bevelDummy = new THREE.Object3D();
  const bevelTransforms: { x: number; y: number; z: number; sx: number; sz: number }[] = [];
  const beaconDummy = new THREE.Object3D();
  const beaconTransforms: { x: number; y: number; z: number; color: number }[] = [];

  // Map 4 "Crystal Sanctuary" decor — a floating shard hovering above
  // each platform plus a thin hover-ring beneath it, so the zone reads
  // as hand-crafted floating islands rather than the same glowing cubes
  // used everywhere else. Both are pushed into crystalSpinners so the
  // animate() loop can give them a slow, ambient rotation.
  const crystalSpinners: THREE.Object3D[] = [];
  // Obstacle platforms (move and/or blink) — see DynamicPlatform above.
  const dynamicPlatforms: DynamicPlatform[] = [];
  const objects: THREE.Object3D[] = [];
  const add = (obj: THREE.Object3D) => { scene.add(obj); objects.push(obj); };

  for (const p of platforms) {
    // Accumulates every visual piece built for THIS platform, in case it
    // turns out to be a moving/blinking one (checked at the bottom of
    // the loop body, once shard/hoverRing have also had a chance to add
    // themselves in).
    const dynParts: DynamicPlatformPart[] = [];

    const mat = getStandardMat({
      color: cssHex(p.color),
      emissive: cssHex(p.glowColor),
      emissiveIntensity: p.type === 'finish' ? 0.55 : 0.18,
      metalness: 0.85,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(p.width, p.height, p.depth), mat);
    mesh.position.set(p.x, p.y - p.height / 2, p.z);
    add(mesh);
    dynParts.push({ obj: mesh, offsetX: 0, offsetY: -p.height / 2, offsetZ: 0 });

    // Top glow strip
    const stripMat = getStandardMat({
      color: cssHex(p.glowColor),
      emissive: cssHex(p.glowColor),
      emissiveIntensity: p.type === 'finish' ? 2.2 : 1.4,
    });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.06, 0.035, p.depth + 0.06), stripMat);
    strip.position.set(p.x, p.y + 0.01, p.z);
    add(strip);
    dynParts.push({ obj: strip, offsetX: 0, offsetY: 0.01, offsetZ: 0 });

    // Finish pillars
    if (p.type === 'finish') {
      const pillarGeo = new THREE.CylinderGeometry(0.07, 0.07, 3, 8);
      const pillarMat = getStandardMat({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.0 });
      for (const px of [-2.3, 2.3]) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(p.x + px, p.y + 1.5, p.z);
        add(pillar);
      }

      // Map 4's finish gets a grander "victory portal" treatment: a big
      // slowly-spinning ring standing on end behind the pillars, plus a
      // crown of four small shards orbiting just above it — this is the
      // course's actual ending now, so it earns a bigger flourish than
      // the two mid-course gates.
      if (p.theme === 'crystal') {
        const portalMat = getStandardMat({ color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 1.8 });
        const portal = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.09, 12, 40), portalMat);
        portal.position.set(p.x, p.y + 3.1, p.z - 0.4);
        add(portal);
        crystalSpinners.push(portal);

        const crownGeo = new THREE.OctahedronGeometry(0.22, 0);
        const crownMat = getStandardMat({ color: 0xc23bff, emissive: 0xc23bff, emissiveIntensity: 1.6 });
        for (let i = 0; i < 4; i++) {
          const angle = (i / 4) * Math.PI * 2;
          const shard = new THREE.Mesh(crownGeo, crownMat);
          shard.userData.orbitRadius = 2.6;
          shard.userData.orbitAngle = angle;
          shard.userData.orbitCenter = { x: p.x, y: p.y + 3.1, z: p.z - 0.4 };
          shard.position.set(p.x + Math.cos(angle) * 2.6, p.y + 3.1, p.z - 0.4 + Math.sin(angle) * 2.6);
          add(shard);
          crystalSpinners.push(shard);
        }
      }
    }

    // Map 4 "Crystal Sanctuary" platforms: a small floating shard above
    // (an anchor point the eye reads as "this island is magical", not
    // just lit) and a thin hover-ring beneath (sells the "floating"
    // illusion the way a drop-shadow can't at this scale). Both are
    // cosmetic only — collision still uses the plain box above, so this
    // never risks a mismatch between what you see and where you can
    // stand.
    if (p.theme === 'crystal' && p.type !== 'finish') {
      const shardSize = Math.max(0.16, Math.min(p.width, p.depth) * 0.28);
      const shardGeo = new THREE.OctahedronGeometry(shardSize, 0);
      const shardMat = getStandardMat({
        color: cssHex(p.glowColor), emissive: cssHex(p.glowColor),
        emissiveIntensity: 1.5, metalness: 0.2, roughness: 0.1,
      });
      const shard = new THREE.Mesh(shardGeo, shardMat);
      shard.position.set(p.x, p.y + 0.75 + shardSize, p.z);
      add(shard);
      crystalSpinners.push(shard);
      dynParts.push({ obj: shard, offsetX: 0, offsetY: 0.75 + shardSize, offsetZ: 0 });

      const hoverRadius = Math.max(p.width, p.depth) * 0.46;
      const ringGeo = new THREE.TorusGeometry(hoverRadius, 0.03, 6, 24);
      const ringMat = getStandardMat({ color: cssHex(p.glowColor), emissive: cssHex(p.glowColor), emissiveIntensity: 1.1 });
      const hoverRing = new THREE.Mesh(ringGeo, ringMat);
      hoverRing.rotation.x = Math.PI / 2;
      hoverRing.position.set(p.x, p.y - p.height - 0.3, p.z);
      add(hoverRing);
      crystalSpinners.push(hoverRing);
      dynParts.push({ obj: hoverRing, offsetX: 0, offsetY: -p.height - 0.3, offsetZ: 0 });
    }

    // Register as a dynamic obstacle if it moves and/or blinks — done
    // last so every visual piece above (box, strip, shard, ring) is
    // already in dynParts.
    if (p.move || p.blink) {
      dynamicPlatforms.push({ platform: p, parts: dynParts });
    }

    // Arena structures (decks, hub, cover, steps) get armor-panel trim —
    // a recessed dark bevel + four corner rivets/beacons — instead of a
    // plain glowing cube, so the PvP zone reads as built hardware rather
    // than parkour geometry re-used as a battlefield. Transforms only are
    // collected here; the actual meshes are built once, in bulk, below.
    if (p.arena) {
      bevelTransforms.push({
        x: p.x, y: p.y - 0.01, z: p.z,
        sx: Math.max(p.width - 0.3, 0.2), sz: Math.max(p.depth - 0.3, 0.2),
      });
      const cornerInsetX = Math.max(p.width / 2 - 0.28, 0.1);
      const cornerInsetZ = Math.max(p.depth / 2 - 0.28, 0.1);
      const beaconColor = cssHex(p.glowColor);
      for (const cx of [-cornerInsetX, cornerInsetX]) {
        for (const cz of [-cornerInsetZ, cornerInsetZ]) {
          beaconTransforms.push({ x: p.x + cx, y: p.y + 0.11, z: p.z + cz, color: beaconColor });
        }
      }
    }
  }

  // One draw call for every bevel panel in this chunk. Each panel is a
  // unit box scaled per-instance to that platform's footprint.
  if (bevelTransforms.length) {
    const bevelMat = getStandardMat({ color: 0x0a0a10, metalness: 0.9, roughness: 0.3 });
    const bevelMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.05, 1), bevelMat, bevelTransforms.length);
    bevelTransforms.forEach((t, i) => {
      bevelDummy.position.set(t.x, t.y, t.z);
      bevelDummy.scale.set(t.sx, 1, t.sz);
      bevelDummy.updateMatrix();
      bevelMesh.setMatrixAt(i, bevelDummy.matrix);
    });
    bevelMesh.instanceMatrix.needsUpdate = true;
    add(bevelMesh);
  }

  // One draw call per unique beacon color present in this chunk.
  // (Using InstancedMesh's per-instance vertex color instead was
  // tempting, but three.js's standard shader only multiplies instance
  // color into the diffuse channel, not emissive — it would silently
  // wash every beacon out to the same white glow. Grouping by real
  // material color is both simpler and correct.)
  if (beaconTransforms.length) {
    const beaconGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8);
    const groups = new Map<number, { x: number; y: number; z: number }[]>();
    for (const t of beaconTransforms) {
      const arr = groups.get(t.color) ?? [];
      arr.push({ x: t.x, y: t.y, z: t.z });
      groups.set(t.color, arr);
    }
    for (const [color, positions] of groups) {
      const beaconMat = getStandardMat({ color, emissive: color, emissiveIntensity: 2.5 });
      const beaconMesh = new THREE.InstancedMesh(beaconGeo, beaconMat, positions.length);
      positions.forEach((t, i) => {
        beaconDummy.position.set(t.x, t.y, t.z);
        beaconDummy.updateMatrix();
        beaconMesh.setMatrixAt(i, beaconDummy.matrix);
      });
      beaconMesh.instanceMatrix.needsUpdate = true;
      add(beaconMesh);
    }
  }

  return { crystalSpinners, dynamicPlatforms, objects };
}

// ── Hazard meshes ──────────────────────────────────────────
// Map 4's spike hazards (HAZARDS in game3DPhysics.ts): a small cluster
// of thorn-like cones around a glowing core, danger-red so it reads as
// "don't touch" at a glance rather than blending in with the amethyst/
// gold crystal platforms. Also built per-chunk (see ChunkManager) —
// `objects` holds the top-level Group per hazard for disposal. Returned
// as one Group per hazard, positioned every frame in the animate() loop
// (getHazardPosition handles the ones that patrol via `move`; static
// ones just sit at rest).
interface HazardVisual { hazard: Hazard3D; group: THREE.Group }

function buildHazardMeshes(scene: THREE.Scene, hazards: Hazard3D[]): { hazardVisuals: HazardVisual[]; objects: THREE.Object3D[] } {
  const hazardVisuals: HazardVisual[] = [];
  const objects: THREE.Object3D[] = [];
  const coreMat = getStandardMat({ color: 0xff2a4a, emissive: 0xff2a4a, emissiveIntensity: 2.2, metalness: 0.3, roughness: 0.15 });
  const spikeMat = getStandardMat({ color: 0x8a0018, emissive: 0xff2a4a, emissiveIntensity: 1.4, metalness: 0.4, roughness: 0.2 });

  for (const h of hazards) {
    const group = new THREE.Group();
    group.position.set(h.x, h.y, h.z);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(h.radius * 0.5, 0), coreMat);
    group.add(core);

    const spikeGeo = new THREE.ConeGeometry(h.radius * 0.28, h.radius * 1.4, 6);
    const spikeCount = 5;
    for (let i = 0; i < spikeCount; i++) {
      const angle = (i / spikeCount) * Math.PI * 2;
      const spike = new THREE.Mesh(spikeGeo, spikeMat);
      spike.position.set(Math.cos(angle) * h.radius * 0.55, Math.sin(angle * 1.7) * h.radius * 0.3, Math.sin(angle) * h.radius * 0.55);
      spike.lookAt(group.position.clone().add(new THREE.Vector3(Math.cos(angle), Math.sin(angle * 1.7), Math.sin(angle)).multiplyScalar(2)));
      spike.rotation.x += Math.PI / 2;
      group.add(spike);
    }

    // No dynamic PointLight here on purpose: every extra light in a
    // three.js scene adds a shading term for EVERY MeshStandardMaterial
    // fragment rendered anywhere, not just objects near that light — 5
    // of them stacked on top of the game's existing key/fill/back lights
    // would tax the whole scene's frame time the moment this chunk
    // loads, not just the hazard's immediate surroundings. The emissive
    // core + spike materials already glow brightly enough on their own
    // to read as "danger" from a distance without paying that cost.

    scene.add(group);
    objects.push(group);
    hazardVisuals.push({ hazard: h, group });
  }

  return { hazardVisuals, objects };
}

// ── Level streaming (chunked loading) ───────────────────────
// Building every platform/hazard mesh for the whole course at once (the
// old behavior) got noticeably worse as Map 4 grew — more draw calls,
// more objects animated every frame (crystal spinners, movers,
// blinkers), all sitting in the scene graph even while the player is
// nowhere near most of them. Real long-running games solve this with
// level streaming: only the geometry near the player is actually
// loaded, and it's loaded/unloaded as they move — never the whole level
// at once. This does the same thing here, bucketed by Z-distance along
// the course.
const CHUNK_SIZE = 45; // world units of Z per chunk — a handful of platforms each
// A little before the arena walkway (z:16) so approaching it doesn't
// cause a visible pop-in right at the gate; still well above the course
// spawn (z:0), so Maps 1-4 never trigger it.
const ARENA_LOAD_Z = 8;
// "Ahead" = toward the finish (decreasing Z); "behind" = toward the
// start/arena (increasing Z). Bumped BEHIND up to 2 (from 1) so walking
// backward doesn't out-run the loaded window either — see the backward-
// walking question this was written to answer.
const CHUNK_LOAD_AHEAD = 2; // chunks to keep loaded toward the finish
const CHUNK_LOAD_BEHIND = 2; // chunks to keep loaded back toward the start

function chunkIndexForZ(z: number): number {
  return Math.floor(z / CHUNK_SIZE);
}

// Computed once at module load (not per-frame) — grouping ~100
// platforms/hazards by chunk is cheap and never needs to happen again
// since PLATFORMS/HAZARDS are static data.
function groupByChunk<T extends { z: number }>(items: T[]): Map<number, T[]> {
  const map = new Map<number, T[]>();
  for (const item of items) {
    const idx = chunkIndexForZ(item.z);
    const arr = map.get(idx) ?? [];
    arr.push(item);
    map.set(idx, arr);
  }
  return map;
}
// The PvP arena (z:16..~90, see PVP_ARENA_BOUNDS) is a separate branch
// off the course, not something you pass through while running Maps
// 1-4 — but naive Z-based chunking would still sweep its platforms in
// alongside Map 1/2's chunks, since the arena's z-range starts right
// next to the course's own z:0 spawn. Pulled out of the normal chunk
// grouping entirely; handled by its own load-once trigger below
// (ChunkManager.loadArena) instead.
const COURSE_PLATFORMS = PLATFORMS.filter(p => !p.arena);
const ARENA_PLATFORMS = PLATFORMS.filter(p => p.arena);
const PLATFORMS_BY_CHUNK = groupByChunk(COURSE_PLATFORMS);
const HAZARDS_BY_CHUNK = groupByChunk(HAZARDS);

// Recursively frees GPU geometry buffers for an object and its children.
// Materials are NOT disposed here — they come from the shared
// `standardMatCache` above and stay alive for other chunks (and any
// chunk that gets reloaded later) to keep reusing.
function disposeObjectGeometry(obj: THREE.Object3D) {
  obj.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
}

interface LoadedChunk {
  crystalSpinners: THREE.Object3D[];
  dynamicPlatforms: DynamicPlatform[];
  hazardVisuals: HazardVisual[];
  objects: THREE.Object3D[]; // everything to remove + dispose on unload
}

// Extra chunks of slack kept loaded beyond the "need" window before
// something actually gets unloaded (see ensureAround). Without this, a
// player standing right on a chunk boundary — which can genuinely
// happen, e.g. a moving platform (m4-move3) straddles one — would flip
// `current` back and forth every time it wobbles across the line, and
// each flip would tear down and immediately rebuild the same meshes.
// That thrashing (not the streaming itself) is what causes a hard
// freeze; this buffer means a single-chunk wobble across one boundary
// never crosses into unload territory.
const CHUNK_KEEP_BUFFER = 1;

// Owns which chunks currently have meshes in the scene, and keeps that
// set in sync with the player's position. `ensureAround(z)` is meant to
// be called every frame with the player's current Z — it's cheap
// (a couple of integer comparisons) when nothing needs to change, and
// only does real work (building/tearing down meshes) right when the
// player crosses a chunk boundary AND lands outside the keep buffer.
class ChunkManager {
  private scene: THREE.Scene;
  private loaded = new Map<number, LoadedChunk>();
  private lastChunk: number | null = null;
  private arenaLoaded = false;
  private arenaDynamic: { crystalSpinners: THREE.Object3D[]; dynamicPlatforms: DynamicPlatform[] } = {
    crystalSpinners: [], dynamicPlatforms: [],
  };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  // The PvP arena is loaded once, the first time the player actually
  // walks toward it (past ARENA_LOAD_Z, a little before the walkway at
  // z:16 so there's no pop-in right at the gate) — never eagerly at
  // scene mount. It's never unloaded again afterward: unlike the course
  // chunks, it's a single bounded, out-of-the-way zone, so the only
  // goal here is avoiding paying for it while the player is nowhere
  // near it (i.e. the whole time they're playing Maps 1-4).
  private loadArena() {
    if (this.arenaLoaded) return;
    this.arenaLoaded = true;
    try {
      const platResult = buildPlatformMeshes(this.scene, ARENA_PLATFORMS);
      this.arenaDynamic.crystalSpinners.push(...platResult.crystalSpinners);
      this.arenaDynamic.dynamicPlatforms.push(...platResult.dynamicPlatforms);
      buildArenaDecor(this.scene);
    } catch (err) {
      console.error('[ChunkManager] failed to load arena:', err);
    }
  }

  private loadChunk(idx: number) {
    if (this.loaded.has(idx)) return;
    try {
      const platforms = PLATFORMS_BY_CHUNK.get(idx) ?? [];
      const hazards = HAZARDS_BY_CHUNK.get(idx) ?? [];
      const platResult = buildPlatformMeshes(this.scene, platforms);
      const hazResult = buildHazardMeshes(this.scene, hazards);
      this.loaded.set(idx, {
        crystalSpinners: platResult.crystalSpinners,
        dynamicPlatforms: platResult.dynamicPlatforms,
        hazardVisuals: hazResult.hazardVisuals,
        objects: [...platResult.objects, ...hazResult.objects],
      });
    } catch (err) {
      // A build failure here must never take the whole render loop down
      // with it — an uncaught throw inside animate() silently stops
      // requestAnimationFrame from ever rescheduling, which looks
      // exactly like a full freeze. Log and skip this chunk instead;
      // the player just won't see that piece of the level rather than
      // losing the whole game.
      console.error(`[ChunkManager] failed to load chunk ${idx}:`, err);
    }
  }

  private unloadChunk(idx: number) {
    const chunk = this.loaded.get(idx);
    if (!chunk) return;
    try {
      for (const obj of chunk.objects) {
        this.scene.remove(obj);
        disposeObjectGeometry(obj);
      }
    } catch (err) {
      console.error(`[ChunkManager] failed to unload chunk ${idx}:`, err);
    }
    this.loaded.delete(idx);
  }

  // Call every frame with the player's current world Z. No-ops unless
  // the player has moved into a new chunk since the last call.
  //
  // The course runs along -Z (start at 0, finish at -534), so a LOWER
  // chunk index is further along toward the finish ("ahead") and a
  // HIGHER index is back toward the start/arena ("behind"). This must
  // stay the way it's written below — CHUNK_LOAD_AHEAD subtracts from
  // `current`, CHUNK_LOAD_BEHIND adds to it — an earlier version of
  // this file had that backwards, which starved the buffer in the
  // direction the player is actually normally travelling.
  ensureAround(z: number) {
    // Checked every call (not gated behind the chunk-change early return
    // below) since the arena threshold sits well inside a single chunk —
    // the player can cross z:8 without their chunk index ever changing.
    if (!this.arenaLoaded && z > ARENA_LOAD_Z) this.loadArena();

    const current = chunkIndexForZ(z);
    if (current === this.lastChunk) return;
    this.lastChunk = current;

    const need = new Set<number>();
    for (let i = current - CHUNK_LOAD_AHEAD; i <= current + CHUNK_LOAD_BEHIND; i++) need.add(i);
    for (const idx of need) this.loadChunk(idx);

    // Hysteresis: only unload chunks that fall outside the need window
    // by MORE than the keep buffer, so a player oscillating across a
    // single boundary (see CHUNK_KEEP_BUFFER above) never triggers a
    // load/unload/load/unload cycle.
    const keepMin = current - CHUNK_LOAD_AHEAD - CHUNK_KEEP_BUFFER;
    const keepMax = current + CHUNK_LOAD_BEHIND + CHUNK_KEEP_BUFFER;
    for (const idx of Array.from(this.loaded.keys())) {
      if (idx < keepMin || idx > keepMax) this.unloadChunk(idx);
    }
  }

  // Iterators for the animate() loop — combine every currently-loaded
  // chunk's dynamic content instead of one fixed array for the whole
  // course.
  *allCrystalSpinners(): IterableIterator<THREE.Object3D> {
    for (const chunk of this.loaded.values()) yield* chunk.crystalSpinners;
    yield* this.arenaDynamic.crystalSpinners;
  }
  *allDynamicPlatforms(): IterableIterator<DynamicPlatform> {
    for (const chunk of this.loaded.values()) yield* chunk.dynamicPlatforms;
    yield* this.arenaDynamic.dynamicPlatforms;
  }
  *allHazardVisuals(): IterableIterator<HazardVisual> {
    for (const chunk of this.loaded.values()) yield* chunk.hazardVisuals;
  }
}

// ── Arena decor — pillars, perimeter walls, entrance gate, floor grid ──
// Pure set-dressing (no collision). This is what turns the PvP zone from
// "a lit rectangle with boxes on it" into a coliseum silhouette players
// can recognize the shape of from across the map.
function buildArenaDecor(scene: THREE.Scene) {
  const pillarMat = getStandardMat({ color: 0x151022, metalness: 0.85, roughness: 0.3 });
  const beaconMat = getStandardMat({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.8 });
  const ringMat = getStandardMat({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.2 });

  // Pillar ring-bands (2 per pillar) all share one unit-radius geometry,
  // scaled per instance to that pillar's actual radius — one draw call
  // for every ring band on every pillar, present or future.
  const ringDummy = new THREE.Object3D();
  const ringMesh = new THREE.InstancedMesh(
    new THREE.TorusGeometry(1, 0.035, 8, 20), ringMat, PVP_PILLARS.length * 2,
  );
  let ringIdx = 0;

  for (const pil of PVP_PILLARS) {
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(pil.radius, pil.radius * 1.25, pil.height, 10),
      pillarMat,
    );
    shaft.position.set(pil.x, pil.height / 2, pil.z);
    scene.add(shaft);

    // Glowing crown so the towers read from a distance. No PointLight
    // here on purpose — six extra real-time lights would mean every
    // PBR-shaded object in the whole scene has to factor six more lights
    // into its per-pixel lighting every frame, which is real GPU cost on
    // a mobile GPU. Emissive-only "fake glow" reads almost identically
    // and costs nothing extra, which is how real games fake this too.
    const crown = new THREE.Mesh(new THREE.SphereGeometry(pil.radius * 1.4, 12, 10), beaconMat);
    crown.position.set(pil.x, pil.height + pil.radius * 0.6, pil.z);
    scene.add(crown);

    for (const t of [0.32, 0.68]) {
      ringDummy.position.set(pil.x, pil.height * t, pil.z);
      ringDummy.rotation.set(Math.PI / 2, 0, 0);
      ringDummy.scale.setScalar(pil.radius * 1.15);
      ringDummy.updateMatrix();
      ringMesh.setMatrixAt(ringIdx++, ringDummy.matrix);
    }
  }
  ringMesh.instanceMatrix.needsUpdate = true;
  scene.add(ringMesh);

  // Perimeter energy walls — dark metal base with a bright top trim line
  const wallMat = getStandardMat({ color: 0x1a0f14, metalness: 0.8, roughness: 0.4 });
  const trimMat = getStandardMat({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 1.6 });
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
  const archMat = getStandardMat({ color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 1.6 });
  const arch = new THREE.Mesh(new THREE.TorusGeometry(4.4, 0.09, 8, 24, Math.PI), archMat);
  arch.position.set(0, 6.2, 25.2);
  arch.rotation.z = Math.PI;
  scene.add(arch);

  // Central hub — a vertical light column marking the legendary weapon
  // objective, visible from every corner of the (much bigger) arena.
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffb020, transparent: true, opacity: 0.18, side: THREE.DoubleSide,
  });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 40, 16, 1, true), beamMat);
  beam.position.set(0, 22, 57);
  scene.add(beam);

  // Concentric floor rings around the hub — a cheap way to make the
  // ground read as "designed arena floor with a spotlight zone" instead
  // of a flat colored rectangle.
  const floorRingMat = new THREE.MeshBasicMaterial({
    color: 0xffb020, transparent: true, opacity: 0.22, side: THREE.DoubleSide,
  });
  for (const r of [5.2, 7.2, 9.4]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.08, 40), floorRingMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(0, 0.02, 57);
    scene.add(ring);
  }

  // Energy-shield dome — a huge, faintly tinted hemisphere over the whole
  // arena. This single mesh does an outsized amount of work for how
  // cheap it is: instead of the arena just trailing off into the
  // starfield, it now reads as an enclosed coliseum with a sci-fi shield
  // roof, viewed from the inside (BackSide) so it doesn't occlude
  // anything and never needs to be lit.
  const domeMat = new THREE.MeshBasicMaterial({
    color: 0x6a2a55, transparent: true, opacity: 0.07, side: THREE.BackSide, depthWrite: false,
  });
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(52, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2),
    domeMat,
  );
  dome.position.set(0, 0, 57);
  scene.add(dome);
  // A bright seam ring where the dome meets the walls reads as its "base"
  const domeSeam = new THREE.Mesh(new THREE.TorusGeometry(52, 0.12, 6, 48), archMat);
  domeSeam.rotation.x = Math.PI / 2;
  domeSeam.position.set(0, 0.05, 57);
  scene.add(domeSeam);

  // Thin glowing light pillars strung along both perimeter walls —
  // breaks up the flat wall slabs from the outside and from a distance
  // reads like stadium floodlight masts. Batched into one InstancedMesh.
  const lightPillarMat = getStandardMat({ color: 0xff3333, emissive: 0xff3333, emissiveIntensity: 2.0 });
  const pillarSpots: { x: number; z: number }[] = [];
  for (let z = 30; z <= 84; z += 9) {
    pillarSpots.push({ x: -20.9, z });
    pillarSpots.push({ x: 20.9, z });
  }
  const lightPillarMesh = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.06, 0.06, 4.4, 6), lightPillarMat, pillarSpots.length,
  );
  const lpDummy = new THREE.Object3D();
  pillarSpots.forEach((s, i) => {
    lpDummy.position.set(s.x, 2.2, s.z);
    lpDummy.updateMatrix();
    lightPillarMesh.setMatrixAt(i, lpDummy.matrix);
  });
  lightPillarMesh.instanceMatrix.needsUpdate = true;
  scene.add(lightPillarMesh);

  // Hanging team-color banners at the gate and every corner tower — flat
  // planes, one draw call each, but a big visual read from a distance
  // (this is what stops corner decks from all looking identical).
  for (const b of PVP_BANNERS) {
    const bannerMat = new THREE.MeshBasicMaterial({
      color: cssHex(b.color), transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 3.2), bannerMat);
    banner.position.set(b.x, b.height, b.z);
    banner.rotation.y = b.x < 0 ? 0.15 : -0.15; // slight angle so it doesn't read as a flat 2D cutout head-on
    scene.add(banner);
    const trimStripe = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.1),
      new THREE.MeshBasicMaterial({ color: cssHex(b.color), transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    trimStripe.position.set(b.x, b.height - 1.65, b.z + (b.x < 0 ? 0.02 : -0.02));
    trimStripe.rotation.y = banner.rotation.y;
    scene.add(trimStripe);
  }

  // Hi-tech floor grid — every line (vertical + horizontal) batched into
  // one InstancedMesh instead of ~20+ separate plane meshes.
  const gridMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.16 });
  const gridLines: { x: number; z: number; sx: number; sz: number }[] = [];
  for (let gx = -20; gx <= 20; gx += 4) gridLines.push({ x: gx, z: 57, sx: 0.03, sz: 62 });
  for (let gz = 27; gz <= 87; gz += 5) gridLines.push({ x: 0, z: gz, sx: 40, sz: 0.03 });
  const gridMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), gridMat, gridLines.length);
  const gridDummy = new THREE.Object3D();
  gridLines.forEach((g, i) => {
    gridDummy.position.set(g.x, 0.015, g.z);
    gridDummy.rotation.set(-Math.PI / 2, 0, 0);
    gridDummy.scale.set(g.sx, g.sz, 1);
    gridDummy.updateMatrix();
    gridMesh.setMatrixAt(i, gridDummy.matrix);
  });
  gridMesh.instanceMatrix.needsUpdate = true;
  scene.add(gridMesh);
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
// Materials are cached per weapon type and reused by every instance of
// that weapon (every pedestal + every player currently holding it). This
// matters for scaling: without it, a busy arena with many players holding
// weapons would keep allocating brand-new Material/shader-uniform objects
// forever. One shared material per type/role means the object count stays
// flat no matter how many players or pickups exist at once.
const DARK_PROP_MAT = new THREE.MeshStandardMaterial({ color: 0x1c1c22, metalness: 0.5, roughness: 0.6 });
const weaponMatCache = new Map<WeaponType, { primary: THREE.MeshStandardMaterial; accent: THREE.MeshStandardMaterial }>();
function getWeaponMaterials(type: WeaponType) {
  let entry = weaponMatCache.get(type);
  if (!entry) {
    const def = WEAPON_DEFS[type];
    const accentHex = cssHex(TIER_COLORS[def.tier]);
    entry = {
      primary: new THREE.MeshStandardMaterial({ color: cssHex(def.color), metalness: 0.85, roughness: 0.25 }),
      accent: new THREE.MeshStandardMaterial({
        color: accentHex, emissive: accentHex, emissiveIntensity: 1.5, metalness: 0.5, roughness: 0.2,
      }),
    };
    weaponMatCache.set(type, entry);
  }
  return entry;
}

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
  const { primary: primaryMat, accent: accentMat } = getWeaponMaterials(type);
  const darkMat = DARK_PROP_MAT;
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
      // Muzzle marker — an invisible pivot right at the barrel tip. Every
      // ranged weapon gets one of these; it's what fireRangedEffect uses
      // to spawn the tracer/flash from the actual gun, not the hand.
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.47, -0.47);
      group.add(muzzle);
      group.userData.muzzle = muzzle;
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
      // Arrow release point, just past the string.
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.42, -0.5);
      group.add(muzzle);
      group.userData.muzzle = muzzle;
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
      // Bolts channel out through the orb at the top of the staff.
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.92, 0);
      group.add(muzzle);
      group.userData.muzzle = muzzle;
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
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.47, -0.78);
      group.add(muzzle);
      group.userData.muzzle = muzzle;
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
function NativeRenderer({
  physStateRef, playerSkin, remotePlayersRef, cameraModeRef, orbitYawRef, orbitPitchRef,
  weaponTakenAtRef, currentWeaponRef, localAttackRef, localDamageAtRef,
  isAimingRef, aimTargetIdRef, onFireRef,
}: Props) {
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

      const DEFAULT_FOV = 62;
      const AIM_FOV = 34; // narrower FOV = "zoomed in" while aiming, in every camera mode
      const camera = new THREE.PerspectiveCamera(DEFAULT_FOV, W / H, 0.1, 400);
      // The first-person view-model (added further below) is parented to
      // the camera itself. Three.js's render() only traverses the scene
      // graph passed as its first argument, so the camera has to be part
      // of that graph for a camera-child object to ever be visited/drawn
      // — otherwise the viewmodel would silently never render.
      scene.add(camera);

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

      // ── One-time shader/geometry warm-up ─────────────────────────
      // WebGL only compiles the GPU shader program for a given
      // material+geometry combo the FIRST time it's actually rendered —
      // and that compile happens synchronously on the render thread, so
      // it shows up as a real stutter/freeze the instant a brand-new
      // visual (a new InstancedMesh, a new emissive combo, the gate
      // portal effect, a hazard spike, etc.) first appears on screen.
      // Because the chunk streamer (below) builds each chunk's meshes
      // lazily as the player reaches it, almost every DISTINCT combo
      // used anywhere in the whole 4-map course debuts within the very
      // first couple of chunks — Map 1 alone introduces the box
      // platform, the glow strip, the InstancedMesh bevels/beacons, and
      // the gate torus/portal/crown effects. That's exactly why lag was
      // heaviest in Map 1, lighter in Map 2 (most combos already
      // compiled), and gone by Map 3/4 (everything already warm).
      //
      // Fix: build one copy of EVERY platform/hazard from ALL 4 maps
      // right here, force-compile every resulting shader program in one
      // batch via renderer.compile(), then immediately tear the temporary
      // meshes back down — all before the first frame is ever rendered,
      // so none of this is visible. Materials survive (they're cached in
      // standardMatCache, keyed by their visual properties, and get
      // reused for free by the real chunks streamed in afterward);
      // only the throwaway geometries are disposed.
      try {
        const warmPlatforms = buildPlatformMeshes(scene, COURSE_PLATFORMS);
        const warmHazards = buildHazardMeshes(scene, HAZARDS);
        renderer.compile(scene, camera);
        for (const obj of warmPlatforms.objects) { scene.remove(obj); disposeObjectGeometry(obj); }
        for (const obj of warmHazards.objects) { scene.remove(obj); disposeObjectGeometry(obj); }
      } catch (err) {
        // Never let a warm-up failure block the actual game from
        // loading — worst case without it is the original lazy-compile
        // stutter, not a broken scene.
        console.error('[GameRenderer3D] shader warm-up failed:', err);
      }

      // World — platforms/hazards are streamed in by chunk (see
      // ChunkManager above) rather than built all at once; only the
      // chunks around the player's starting position load here, and
      // ensureAround() keeps that window moving with them every frame
      // down in animate(). The PvP arena (buildArenaDecor + its
      // platforms) is intentionally NOT built here — it used to load
      // unconditionally at mount, which meant it sat in the scene the
      // entire time the player was on Maps 1/2 near spawn, right next
      // to it spatially. ChunkManager now defers it until the player
      // actually approaches (see ARENA_LOAD_Z / loadArena above).
      const chunkManager = new ChunkManager(scene);
      chunkManager.ensureAround(physStateRef.current.z);
      buildStarfield(scene);

      // Map 4 "Crystal Sanctuary" atmosphere — as the player approaches
      // and enters the zone (around map3-gate, z ≈ -338), the fog and
      // clear color drift from the course's usual near-black toward a
      // violet tint, so the new area announces itself with lighting
      // instead of only new geometry. Reused Color objects (no per-frame
      // allocation) per this file's existing "never allocate in the hot
      // path" convention — see muzzleScratch etc. below.
      const FOG_DEFAULT = new THREE.Color(0x06060f);
      const FOG_CRYSTAL = new THREE.Color(0x170a28);
      const fogScratch = new THREE.Color();
      const MAP4_TINT_START_Z = -300; // begins drifting well before map3-gate (-337.93)
      const MAP4_TINT_END_Z = -345;   // fully tinted by m4-start

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

      // ── Attack visual effects ────────────────────────────────────
      // Ranged weapons get a brief tracer beam + muzzle flash on every
      // shot. Both are drawn from small fixed-size pools built once here
      // and reused by every attack, local or remote — same "never
      // allocate in the hot path" reasoning as everywhere else in this
      // file, since a busy arena could mean many shots per second.
      const ATTACK_ANIM_MS = 380; // melee swing length; ranged recoil decays faster within this same window
      const TRACER_LIFE_MS = 150;
      const FLASH_LIFE_MS = 90;
      const EFFECT_POOL_SIZE = 10;

      const tracerGeo = new THREE.BoxGeometry(0.045, 0.045, 1);
      tracerGeo.translate(0, 0, -0.5); // origin at the back end, extends toward local -Z (the rig's forward)
      interface EffectSlot { mesh: THREE.Mesh; active: boolean; start: number }
      const tracerPool: EffectSlot[] = [];
      for (let i = 0; i < EFFECT_POOL_SIZE; i++) {
        const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
        mesh.visible = false;
        scene.add(mesh);
        tracerPool.push({ mesh, active: false, start: 0 });
      }
      let tracerCursor = 0;

      const flashGeo = new THREE.SphereGeometry(0.13, 8, 6);
      const flashPool: EffectSlot[] = [];
      for (let i = 0; i < EFFECT_POOL_SIZE; i++) {
        const mesh = new THREE.Mesh(flashGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
        mesh.visible = false;
        scene.add(mesh);
        flashPool.push({ mesh, active: false, start: 0 });
      }
      let flashCursor = 0;
      const muzzleScratch = new THREE.Vector3(); // reused every shot — see fireRangedEffect

      // Fires a tracer + muzzle flash from the weapon's own muzzle point
      // (see the `muzzle` Object3D added per ranged weapon in
      // buildWeaponMesh above) — NOT the shoulder/hand — in the exact
      // direction the rig is currently facing (rig.group's own -Z axis —
      // getWorldPosition/quaternion do the correct math regardless of
      // parent transforms, so no manual trig needed here). Falls back to
      // the gun hand only if a weapon mesh/muzzle genuinely isn't
      // available yet (e.g. the very first frame after equipping).
      function fireRangedEffect(rig: CharacterRig, heldMesh: THREE.Object3D | null, colorHex: number, range: number) {
        const muzzle = (heldMesh?.userData?.muzzle as THREE.Object3D | undefined) ?? null;
        if (muzzle) muzzle.getWorldPosition(muzzleScratch);
        else rig.rArm.getWorldPosition(muzzleScratch);

        const t = tracerPool[tracerCursor];
        tracerCursor = (tracerCursor + 1) % EFFECT_POOL_SIZE;
        t.mesh.position.copy(muzzleScratch);
        t.mesh.quaternion.copy(rig.group.quaternion);
        t.mesh.scale.z = Math.min(range, 16);
        t.active = true;
        t.start = Date.now();
        t.mesh.visible = true;
        (t.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
        (t.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85;

        const f = flashPool[flashCursor];
        flashCursor = (flashCursor + 1) % EFFECT_POOL_SIZE;
        f.mesh.position.copy(muzzleScratch);
        f.mesh.scale.setScalar(1);
        f.active = true;
        f.start = Date.now();
        f.mesh.visible = true;
        (f.mesh.material as THREE.MeshBasicMaterial).color.setHex(colorHex);
        (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1;
      }

      // Called once, the instant a new attack timestamp is seen (local or
      // remote) — fires the one-off ranged effect if applicable. The
      // per-frame pose (swing/recoil) is applied separately every frame
      // for the animation's duration, see applyAttackPose below.
      function triggerAttackEffect(rig: AnyRig, heldMesh: THREE.Object3D | null, weaponType: WeaponType | null | undefined, isLocal: boolean) {
        if (weaponType && onFireRef?.current) {
          const dist = isLocal ? 0 : rig.group.position.distanceTo(camera.position);
          onFireRef.current(weaponType, isLocal, dist);
        }
        if (rig.kind !== 'procedural') return; // model rig has no puppeteerable gun hand — known limitation
        const def = weaponType ? WEAPON_DEFS[weaponType] : null;
        if (def?.ranged) fireRangedEffect(rig, heldMesh, cssHex(def.color), def.range);
      }

      // Drives the arm/torso pose for the attack animation every frame it
      // is active. Melee: a windup → strike → recover swing arc. Ranged:
      // a sharp recoil kick that decays fast, since the "shot" itself is
      // the tracer/flash above, not the pose.
      function applyAttackPose(rig: CharacterRig, weaponType: WeaponType | null | undefined, elapsedMs: number) {
        const t = Math.min(1, elapsedMs / ATTACK_ANIM_MS);
        const def = weaponType ? WEAPON_DEFS[weaponType] : null;
        if (def?.ranged) {
          const kick = Math.max(0, 1 - t * 5);
          rig.rArm.rotation.x = 0.2 - kick * 0.4;
          rig.rArm.rotation.z = -0.08;
        } else {
          let rot: number;
          if (t < 0.25) rot = -0.3 * (t / 0.25);
          else if (t < 0.55) rot = -0.3 + ((t - 0.25) / 0.3) * 2.3;
          else rot = 2.0 * (1 - (t - 0.55) / 0.45);
          rig.rArm.rotation.x = rot;
          rig.rArm.rotation.z = Math.sin(t * Math.PI) * -0.3;
          rig.torso.rotation.y = Math.sin(t * Math.PI) * 0.15;
        }
      }

      // Brief red tint on a rig's suit material when it takes damage — the
      // simplest possible "you got hit" readback with no extra geometry.
      // Local-player only: knowing when a *remote* player got hit would
      // need broadcasting that event to everyone (today only the target
      // itself learns about a hit, via listenForHits) — a reasonable next
      // step, but out of scope here.
      function applyHitFlash(rig: AnyRig, damageAt: number, nowMs: number) {
        if (rig.kind !== 'procedural') return;
        const elapsed = nowMs - damageAt;
        if (damageAt > 0 && elapsed < 260) {
          const k = 1 - elapsed / 260;
          rig.suitMat.emissive.setRGB(k, 0, 0);
          rig.suitMat.emissiveIntensity = k * 1.6;
        } else {
          rig.suitMat.emissive.setRGB(0, 0, 0);
          rig.suitMat.emissiveIntensity = 0;
        }
      }

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
      const HELD_WEAPON_SCALE = 0.55;
      const POP_IN_MS = 220;
      interface HeldWeaponState { type: WeaponType | null; mesh: THREE.Object3D | null; attachedAt: number }
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
          // rather than floating loot. Starts at zero scale — see
          // updateWeaponPop below, which grows it with a little bounce
          // the moment it's equipped, instead of just appearing.
          const mesh = buildWeaponMesh(type);
          mesh.scale.setScalar(0.001);
          mesh.position.set(0.02, -0.36, -0.06);
          mesh.rotation.x = -Math.PI / 2 + 0.35;
          mesh.rotation.z = 0.1;
          rig.rArm.add(mesh);
          held.mesh = mesh;
          held.attachedAt = Date.now();
        }
      }
      // Small bounce-in scale so picking up/switching a weapon reads as an
      // event instead of the model just popping into existence.
      function updateWeaponPop(held: HeldWeaponState) {
        if (!held.mesh) return;
        const elapsed = Date.now() - held.attachedAt;
        if (elapsed >= POP_IN_MS) {
          held.mesh.scale.setScalar(HELD_WEAPON_SCALE);
          return;
        }
        const t = elapsed / POP_IN_MS;
        const eased = 1 - Math.pow(1 - t, 3);
        const overshoot = 1 + Math.sin(t * Math.PI) * 0.18;
        held.mesh.scale.setScalar(HELD_WEAPON_SCALE * eased * overshoot);
      }
      const playerHeldWeapon: HeldWeaponState = { type: null, mesh: null, attachedAt: 0 };

      // ── First-person view-model ──────────────────────────────────
      // A small hand+weapon rig parented straight to the camera (not the
      // world), so it always renders in the same spot on screen no
      // matter where the player is — the standard "gun in the corner of
      // the screen" every FPS/battle-royale game uses. The camera never
      // needs to be added to `scene` for this to work: three's renderer
      // updates a parent-less camera's matrixWorld every frame on its
      // own, which cascades down to vmGroup automatically.
      const vmArmMat = new THREE.MeshStandardMaterial({
        color: cssHex(playerSkin.skin), roughness: 0.7, metalness: 0.0,
      });
      const vmSleeveMat = new THREE.MeshStandardMaterial({
        color: cssHex(playerSkin.suit), metalness: 0.6, roughness: 0.4,
      });
      const vmGroup = new THREE.Group();
      vmGroup.position.set(0.28, -0.28, -0.55);
      camera.add(vmGroup);

      const vmSleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.3, 6, 10), vmSleeveMat);
      vmSleeve.rotation.z = Math.PI / 2.4;
      vmSleeve.position.set(0.08, -0.02, 0.32);
      vmGroup.add(vmSleeve);
      const vmHand = new THREE.Mesh(new THREE.SphereGeometry(0.075, 12, 10), vmArmMat);
      vmHand.position.set(-0.02, -0.06, 0.12);
      vmGroup.add(vmHand);

      const vmWeaponAnchor = new THREE.Group();
      vmGroup.add(vmWeaponAnchor);
      let vmWeaponType: WeaponType | null = null;
      let vmWeaponMesh: THREE.Object3D | null = null;
      let vmAttachedAt = 0;
      const VM_SCALE = 0.85;

      // Swaps the visible view-model weapon whenever the equipped weapon
      // type changes — mirrors updateHeldWeapon's world-space logic but
      // targets the camera-parented anchor instead of a rig's arm.
      function updateViewModelWeapon(type: WeaponType | null) {
        if (type === vmWeaponType) return;
        vmWeaponType = type;
        if (vmWeaponMesh) { vmWeaponAnchor.remove(vmWeaponMesh); vmWeaponMesh = null; }
        if (type) {
          const mesh = buildWeaponMesh(type);
          mesh.scale.setScalar(0.001);
          mesh.rotation.x = -Math.PI / 2 + 0.4;
          mesh.position.set(0, -0.08, 0.05);
          vmWeaponAnchor.add(mesh);
          vmWeaponMesh = mesh;
          vmAttachedAt = Date.now();
        }
      }
      // Same little bounce-in pop as the world-space held weapon, so
      // switching weapons in first-person reads as an event too.
      function updateViewModelPop() {
        if (!vmWeaponMesh) return;
        const elapsed = Date.now() - vmAttachedAt;
        if (elapsed >= POP_IN_MS) { vmWeaponMesh.scale.setScalar(VM_SCALE); return; }
        const t = elapsed / POP_IN_MS;
        const eased = 1 - Math.pow(1 - t, 3);
        const overshoot = 1 + Math.sin(t * Math.PI) * 0.18;
        vmWeaponMesh.scale.setScalar(VM_SCALE * eased * overshoot);
      }

      // ── Aim / target-lock reticle ────────────────────────────────
      // A small billboarded ring + downward chevron that hovers above
      // whichever remote player is currently locked by the aim system in
      // game.tsx (aimTargetIdRef) — the in-world half of the "select a
      // player and shoot them" targeting UI (the name/health readout is
      // drawn as a 2D HUD element in game.tsx, above the crosshair).
      const lockRingMat = new THREE.MeshBasicMaterial({ color: 0xff3333, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
      const lockRing = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.28, 24), lockRingMat);
      lockRing.visible = false;
      scene.add(lockRing);
      const lockChevronMat = new THREE.MeshBasicMaterial({ color: 0xff5555, transparent: true, opacity: 0.95 });
      const lockChevron = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.1, 4), lockChevronMat);
      lockChevron.visible = false;
      scene.add(lockChevron);
      // Reused every frame for the reticle's billboard spin — mutating
      // .rotation.z directly after a .quaternion.copy() would silently
      // get overwritten by Euler/quaternion resync, so the spin has to
      // be applied as a proper quaternion multiply instead.
      const LOCK_SPIN_AXIS = new THREE.Vector3(0, 0, 1);
      const lockSpinQ = new THREE.Quaternion();

      interface PoolEntry {
        rig: AnyRig; shadow: THREE.Mesh; legPhase: number; lastX: number; lastZ: number;
        skinId: string; loading: boolean; heldWeapon: HeldWeaponState;
        // Last attackedAt value we've already reacted to, so we only play
        // the swing/fire animation once per genuine new attack. Seeded
        // from the player's current value when first spotted (see the
        // remote loop below) so we don't fire off a stale animation for
        // an attack that happened before we started tracking them.
        lastAttackAt: number;
      }
      const remotePool = new Map<string, PoolEntry>();
      // Reused every frame via .clear() below — same reasoning as the
      // camera vectors above, just for the remote-player presence check.
      const seenRemotes = new Set<string>();

      // Camera
      const camPos = new THREE.Vector3(0, 6, 10);
      const camLook = new THREE.Vector3(0, 1.2, -4);
      // Reused every frame via .set() below instead of `new THREE.Vector3(...)`
      // — allocating fresh vectors 2x per frame (2 per animate() call, 60
      // times a second) is exactly the kind of thing that triggers GC
      // pauses and shows up as stutter on mobile JS engines. Big game
      // engines never allocate inside the render loop for this reason.
      const targetPos = new THREE.Vector3();
      const targetLook = new THREE.Vector3();
      let legPhase = 0;
      let idlePhase = 0;
      let lastLocalAttackAt = 0;

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
            entry.heldWeapon = { type: null, mesh: null, attachedAt: 0 }; // old prop was on the removed rig
            scene.add(entry.rig.group);
          })
          .catch(() => { entry.loading = false; });
      }

      const animate = () => {
        rafRef.current = requestAnimationFrame(animate);
        const s = physStateRef.current;
        const delta = clock.getDelta();
        const now = Date.now();

        // First-person hides the local player model (camera sits at its head)
        const mode = cameraModeRef.current;
        playerRig.group.visible = mode !== 'first';
        playerShadow.visible = mode !== 'first';

        // Crystal Sanctuary atmosphere — lerp fog/clear color by how far
        // into Map 4's approach the player currently is.
        const tintT = THREE.MathUtils.clamp(
          (MAP4_TINT_START_Z - s.z) / (MAP4_TINT_START_Z - MAP4_TINT_END_Z), 0, 1,
        );
        fogScratch.copy(FOG_DEFAULT).lerp(FOG_CRYSTAL, tintT);
        (scene.fog as THREE.FogExp2).color.copy(fogScratch);
        renderer.setClearColor(fogScratch);

        // Level streaming — keep only the chunks near the player loaded.
        // Cheap to call every frame: it's a no-op unless `s.z` has
        // crossed into a new chunk since the last check (see
        // ChunkManager.ensureAround).
        chunkManager.ensureAround(s.z);

        // Map 4 crystal decor — slow ambient spin on every shard/ring,
        // plus the finish portal's orbiting crown shards. Only iterates
        // objects from currently-loaded chunks.
        for (const obj of chunkManager.allCrystalSpinners()) {
          obj.rotation.y += 0.012;
          obj.rotation.x += 0.006;
          const orbit = obj.userData.orbitCenter as { x: number; y: number; z: number } | undefined;
          if (orbit) {
            obj.userData.orbitAngle += 0.01;
            const a = obj.userData.orbitAngle as number;
            obj.position.set(
              orbit.x + Math.cos(a) * obj.userData.orbitRadius,
              orbit.y + Math.sin(now / 700) * 0.15,
              orbit.z + Math.sin(a) * obj.userData.orbitRadius,
            );
          }
        }

        // Map 4 obstacles — moving/blinking platforms and spike hazards.
        // Uses the same `now/1000` time basis as stepPhysics3D's default
        // `t` (both read Date.now()), so what's rendered here always
        // matches what the physics step just collided against. Only
        // currently-loaded chunks' obstacles are iterated.
        const obstacleT = now / 1000;
        for (const dp of chunkManager.allDynamicPlatforms()) {
          const pos = getPlatformPosition(dp.platform, obstacleT);
          const solid = isPlatformSolid(dp.platform, obstacleT);
          for (const part of dp.parts) {
            part.obj.position.set(pos.x + part.offsetX, pos.y + part.offsetY, pos.z + part.offsetZ);
            part.obj.visible = solid;
          }
        }
        for (const hv of chunkManager.allHazardVisuals()) {
          const pos = getHazardPosition(hv.hazard, obstacleT);
          hv.group.position.set(pos.x, pos.y, pos.z);
          hv.group.rotation.y += 0.05;
        }

        const moving = Math.abs(s.vx) > 0.01 || Math.abs(s.vz) > 0.01;
        if (moving) legPhase += 0.18; else idlePhase += 0.045;
        animateRig(playerRig, s.x, s.y, s.z, s.facingAngle, s.vy, s.onGround, moving, legPhase, idlePhase, playerShadow);
        if (playerRig.kind === 'model') playerRig.mixer.update(delta);
        updateHeldWeapon(playerRig, playerHeldWeapon, currentWeaponRef.current);
        updateWeaponPop(playerHeldWeapon);

        // Local player attack — a new timestamp means a fresh attack
        // attempt, so fire the one-off ranged effect (if any); the pose
        // itself is (re)applied every frame for the rest of the window,
        // layered on top of animateRig's walk-cycle arm swing above.
        const localAtk = localAttackRef.current;
        if (localAtk.at !== lastLocalAttackAt) {
          lastLocalAttackAt = localAtk.at;
          triggerAttackEffect(playerRig, playerHeldWeapon.mesh, localAtk.weapon, true);
        }
        if (playerRig.kind === 'procedural' && lastLocalAttackAt > 0 && now - lastLocalAttackAt < ATTACK_ANIM_MS) {
          applyAttackPose(playerRig, localAtk.weapon, now - lastLocalAttackAt);
        }
        applyHitFlash(playerRig, localDamageAtRef.current, now);

        // PvP weapon crates — hidden while on cooldown, otherwise a slow
        // spin + bob so they read as "live" pickups.
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

        // Fade/deactivate any active tracer or muzzle-flash effects
        for (const slot of tracerPool) {
          if (!slot.active) continue;
          const elapsed = now - slot.start;
          if (elapsed > TRACER_LIFE_MS) { slot.active = false; slot.mesh.visible = false; continue; }
          (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - elapsed / TRACER_LIFE_MS);
        }
        for (const slot of flashPool) {
          if (!slot.active) continue;
          const elapsed = now - slot.start;
          if (elapsed > FLASH_LIFE_MS) { slot.active = false; slot.mesh.visible = false; continue; }
          const ft = elapsed / FLASH_LIFE_MS;
          (slot.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - ft;
          slot.mesh.scale.setScalar(1 + ft * 0.8);
        }

        const remotes = remotePlayersRef.current;
        seenRemotes.clear();
        for (const rp of remotes) {
          seenRemotes.add(rp.id);
          const rpSkinId = rp.skinId ?? DEFAULT_SKIN_ID;
          const rpSkin = getSkin(rpSkinId);
          let entry = remotePool.get(rp.id);
          if (!entry) {
            entry = {
              rig: createCharacter(rpSkin), shadow: makeShadow(), legPhase: 0, lastX: rp.x, lastZ: rp.z,
              skinId: rpSkinId, loading: false, heldWeapon: { type: null, mesh: null, attachedAt: 0 },
              lastAttackAt: rp.attackedAt ?? 0,
            };
            scene.add(entry.rig.group);
            remotePool.set(rp.id, entry);
            if (rpSkin.isModel) upgradeToModelWhenReady(entry);
          } else if (entry.skinId !== rpSkinId) {
            // Remote player changed skin — swap the rig in place.
            scene.remove(entry.rig.group);
            entry.rig = createCharacter(rpSkin);
            entry.skinId = rpSkinId;
            entry.heldWeapon = { type: null, mesh: null, attachedAt: 0 }; // old prop was on the removed rig
            scene.add(entry.rig.group);
            if (rpSkin.isModel) upgradeToModelWhenReady(entry);
          }
          updateHeldWeapon(entry.rig, entry.heldWeapon, rp.weapon);
          updateWeaponPop(entry.heldWeapon);

          // Same new-timestamp-means-new-attack check as the local player,
          // just sourced from the synced attackedAt field instead of a ref.
          // (The pose itself is applied further below, after animateRig —
          // otherwise animateRig's walk-cycle arm swing would immediately
          // overwrite it.)
          const rpAttackedAt = rp.attackedAt ?? 0;
          if (rpAttackedAt !== entry.lastAttackAt) {
            entry.lastAttackAt = rpAttackedAt;
            triggerAttackEffect(entry.rig, entry.heldWeapon.mesh, rp.weapon, false);
          }
          // Infer movement + facing from frame-to-frame position deltas,
          // since remote players only send us a position, not full physics.
          const ddx = rp.x - entry.lastX;
          const ddz = rp.z - entry.lastZ;
          const dist = Math.sqrt(ddx * ddx + ddz * ddz);
          const rMoving = dist > 0.003;
          if (rMoving) entry.legPhase += 0.18;
          const rFacing = rMoving ? Math.atan2(ddx, ddz) : entry.rig.group.rotation.y;
          animateRig(entry.rig, rp.x, rp.y, rp.z, rFacing, 0, true, rMoving, entry.legPhase, 0, entry.shadow);
          if (entry.rig.kind === 'procedural' && entry.lastAttackAt > 0 && now - entry.lastAttackAt < ATTACK_ANIM_MS) {
            applyAttackPose(entry.rig, rp.weapon, now - entry.lastAttackAt);
          }
          if (entry.rig.kind === 'model') entry.rig.mixer.update(delta);
          entry.rig.group.visible = true;
          entry.shadow.visible = true;
          entry.lastX = rp.x;
          entry.lastZ = rp.z;
        }
        for (const [id, entry] of remotePool) {
          if (!seenRemotes.has(id)) { entry.rig.group.visible = false; entry.shadow.visible = false; }
        }

        // Aim lock-on reticle — shown above the currently-locked target's
        // head (if any, and if they're still on screen this frame),
        // billboarded to always face the camera.
        const lockedId = aimTargetIdRef?.current ?? null;
        const lockedEntry = lockedId ? remotePool.get(lockedId) : undefined;
        if (lockedEntry && lockedEntry.rig.group.visible) {
          const headPos = lockedEntry.rig.group.position;
          lockRing.position.set(headPos.x, headPos.y + 2.05, headPos.z);
          lockRing.quaternion.copy(camera.quaternion);
          lockRing.quaternion.multiply(lockSpinQ.setFromAxisAngle(LOCK_SPIN_AXIS, now / 400)); // slow spin reads as "actively tracking"
          lockRing.visible = true;
          lockChevron.position.set(headPos.x, headPos.y + 2.32, headPos.z);
          lockChevron.quaternion.copy(camera.quaternion);
          lockChevron.quaternion.multiply(lockSpinQ.setFromAxisAngle(LOCK_SPIN_AXIS, Math.PI)); // point down at the ring
          lockChevron.visible = true;
        } else {
          lockRing.visible = false;
          lockChevron.visible = false;
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

        let lerpSpeed = 0.07;

        if (mode === 'first') {
          // Eyes-level; look direction comes straight from the drag (yaw =
          // turn left/right, pitch = look up/down), not from facingAngle —
          // so you can look around freely while walking in any direction.
          //
          // IMPORTANT: this must use the exact same "yaw=0 → -Z" forward
          // convention as the third-person camera below (and as the
          // joystick's world-space rotation in game.tsx) — otherwise
          // pushing the stick "forward" walks the player straight away
          // from where the first-person camera is actually looking, i.e.
          // backward on screen. Third-person's forward is -(sinYaw,cosYaw)
          // (camera sits at +(sinYaw,cosYaw) behind the player, looking
          // back at them) so first-person's look vector uses the same
          // negated form here.
          //
          // Pitch: orbitPitchRef is shared with the third-person camera,
          // where it means "how high/overhead", defaulting to ~0.447 rad
          // and clamped to [0.08, 1.35] — never zero, never negative. For
          // an eye-level look direction that has to mean something
          // different: 0 = dead ahead, positive = look down, negative =
          // look up. `fpPitch` re-centers the shared value around its own
          // default so first-person starts perfectly level, and dragging
          // down/up tilts the view down/up from there.
          const fpPitch = orbitPitchRef.current - 0.447;
          const cosFP = Math.cos(fpPitch);
          const lookDx = -sinYaw * cosFP;
          const lookDy = -Math.sin(fpPitch);
          const lookDz = -cosYaw * cosFP;
          targetPos.set(s.x, s.y + 1.6, s.z);
          targetLook.set(s.x + lookDx * 5, s.y + 1.6 + lookDy * 5, s.z + lookDz * 5);
          lerpSpeed = 0.45; // snappy — first-person look shouldn't lag behind the finger
        } else if (mode === 'top') {
          // Straight overhead, small Z nudge avoids a degenerate lookAt.
          // Yaw still rotates the compass direction of the view; pitch is
          // ignored here (staying perfectly overhead reads best).
          targetPos.set(s.x + sinYaw * 0.01, s.y + 20, s.z + cosYaw * 0.01);
          targetLook.set(s.x, s.y, s.z);
        } else {
          // 'third' — orbiting chase camera: distance is fixed, yaw/pitch
          // (from the drag gesture) rotate it around the player. Defaults
          // (yaw 0, pitch ~0.447 rad) reproduce the original fixed
          // behind-and-above view exactly. Pitch is kept positive by the
          // clamp in game.tsx, so the camera can never dip below the player.
          const ORBIT_DIST = 11.1;
          targetPos.set(
            s.x + sinYaw * cosPitch * ORBIT_DIST,
            s.y + 1 + sinPitch * ORBIT_DIST,
            s.z + cosYaw * cosPitch * ORBIT_DIST,
          );
          targetLook.set(s.x, s.y + 1, s.z);
        }

        camPos.lerp(targetPos, lerpSpeed);
        camLook.lerp(targetLook, lerpSpeed);
        camera.position.copy(camPos);
        camera.lookAt(camLook);

        // Aim zoom — smoothly narrows the FOV while the aim button is
        // held, in any camera mode, for the "professional" sniper-style
        // zoom the aim/target-lock system in game.tsx drives.
        const aiming = isAimingRef?.current ?? false;
        const targetFov = aiming ? AIM_FOV : DEFAULT_FOV;
        if (Math.abs(camera.fov - targetFov) > 0.05) {
          camera.fov += (targetFov - camera.fov) * 0.18;
          camera.updateProjectionMatrix();
        }

        // First-person weapon view-model — a hand+gun rig parented to the
        // camera so it always sits in the same spot on screen, exactly
        // like a real shooter's viewmodel, instead of the player's body
        // (and weapon) simply being invisible in first-person.
        vmGroup.visible = mode === 'first';
        if (mode === 'first') {
          updateViewModelWeapon(currentWeaponRef.current);
          const idleT = now / 900;
          const walkT = now / 130;
          const swayX = moving ? Math.sin(walkT) * 0.014 : Math.sin(idleT) * 0.004;
          const swayY = moving ? Math.abs(Math.cos(walkT)) * 0.012 : Math.sin(idleT * 1.3) * 0.003;
          const aimLerp = aiming ? 0.5 : 0;
          vmGroup.position.x = (0.28 + swayX) * (1 - aimLerp) + 0.02 * aimLerp;
          vmGroup.position.y = (-0.28 + swayY) * (1 - aimLerp) + -0.2 * aimLerp;
          vmGroup.position.z = -0.55 + aimLerp * 0.12;

          // Recoil kick — synced to the exact same attack timestamp that
          // drives the world-space tracer/pose above, so the on-screen
          // gun visibly kicks the instant it fires.
          let recoil = 0;
          if (lastLocalAttackAt > 0) {
            const el = now - lastLocalAttackAt;
            const KICK_MS = 150;
            if (el < KICK_MS) recoil = 1 - el / KICK_MS;
          }
          vmWeaponAnchor.position.z = recoil * 0.14;
          vmGroup.rotation.x = -recoil * 0.16;

          updateViewModelPop();
        }

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
