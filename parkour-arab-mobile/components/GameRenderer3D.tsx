// ────────────────────────────────────────────────────────
// 3D Game Renderer — expo-gl + Three.js (no expo-three)
// ────────────────────────────────────────────────────────
import React, { useCallback, useRef } from 'react';
import { StyleSheet, Platform, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { GLView } from 'expo-gl';
import * as THREE from 'three';
import { PLATFORMS, PhysState3D } from '@/services/game3DPhysics';

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
  name: string;
}

interface Props {
  physStateRef: React.MutableRefObject<PhysState3D>;
  playerColor: string;
  remotePlayersRef: React.MutableRefObject<RemotePlayer3D[]>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
}

// ── Helpers ────────────────────────────────────────────────
function cssHex(css: string): number {
  return parseInt(css.replace('#', '0x'), 16);
}

// ── Character builder ──────────────────────────────────────
// Sleek futuristic runner — smooth capsules, NO Roblox blocks
function createCharacter(colorCss: string): THREE.Group {
  const group = new THREE.Group();
  const accentHex = cssHex(colorCss);

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentHex,
    emissive: accentHex,
    emissiveIntensity: 0.8,
    metalness: 0.95,
    roughness: 0.05,
  });
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0x0b0b1f,
    metalness: 0.7,
    roughness: 0.35,
  });
  const skinMat = new THREE.MeshStandardMaterial({
    color: 0xd8956a,
    roughness: 0.75,
    metalness: 0.0,
  });

  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.23, 16, 12), skinMat);
  head.position.y = 1.66;
  group.add(head);

  // Visor (glowing front half)
  const visorGeo = new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const visor = new THREE.Mesh(visorGeo, accentMat);
  visor.position.set(0, 1.66, -0.09);
  visor.rotation.x = 0.1;
  group.add(visor);

  // Helmet ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.035, 8, 16), accentMat);
  ring.position.y = 1.66;
  ring.rotation.x = Math.PI / 2;
  group.add(ring);

  // Torso
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.52, 4, 8), suitMat);
  torso.position.y = 1.1;
  group.add(torso);

  // Chest stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.45, 0.2), accentMat);
  stripe.position.set(0, 1.1, -0.18);
  group.add(stripe);

  // Arms
  const armGeo = new THREE.CapsuleGeometry(0.065, 0.42, 4, 6);
  const lArm = new THREE.Mesh(armGeo, suitMat);
  lArm.position.set(-0.29, 1.08, 0);
  lArm.rotation.z = 0.22;
  group.add(lArm);

  const rArm = lArm.clone();
  rArm.position.set(0.29, 1.08, 0);
  rArm.rotation.z = -0.22;
  group.add(rArm);

  // Legs
  const legGeo = new THREE.CapsuleGeometry(0.08, 0.5, 4, 6);
  const lLeg = new THREE.Mesh(legGeo, suitMat);
  lLeg.position.set(-0.11, 0.4, 0);
  group.add(lLeg);

  const rLeg = new THREE.Mesh(legGeo, suitMat);
  rLeg.position.set(0.11, 0.4, 0);
  group.add(rLeg);

  // Glowing shoes
  const shoeGeo = new THREE.BoxGeometry(0.18, 0.09, 0.28);
  const lShoe = new THREE.Mesh(shoeGeo, accentMat);
  lShoe.position.set(-0.11, 0.05, -0.03);
  group.add(lShoe);

  const rShoe = new THREE.Mesh(shoeGeo, accentMat);
  rShoe.position.set(0.11, 0.05, -0.03);
  group.add(rShoe);

  return group;
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
function NativeRenderer({ physStateRef, playerColor, remotePlayersRef, cameraModeRef }: Props) {
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

      // Lights
      scene.add(new THREE.AmbientLight(0x223366, 0.9));
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
      buildStarfield(scene);

      // Ground plane
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 320),
        new THREE.MeshStandardMaterial({ color: 0x03030c, emissive: 0x040410, emissiveIntensity: 0.3, metalness: 0.4, roughness: 0.95 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(0, -0.65, -70);
      scene.add(ground);

      // Characters
      const playerMesh = createCharacter(playerColor);
      scene.add(playerMesh);
      const remotePool = new Map<string, THREE.Group>();

      // Camera
      const camPos = new THREE.Vector3(0, 6, 10);
      const camLook = new THREE.Vector3(0, 1.2, -4);
      let legPhase = 0;

      const animate = () => {
        rafRef.current = requestAnimationFrame(animate);
        const s = physStateRef.current;

        playerMesh.position.set(s.x, s.y, s.z);
        playerMesh.rotation.y = s.facingAngle;

        // First-person hides the local player model (camera sits at its head)
        const mode = cameraModeRef.current;
        playerMesh.visible = mode !== 'first';

        const moving = Math.abs(s.vx) > 0.01 || Math.abs(s.vz) > 0.01;
        if (moving) legPhase += 0.18;
        const swing = moving ? Math.sin(legPhase) * 0.28 : 0;
        const ch = playerMesh.children;
        if (ch[8]) ch[8].rotation.x = swing;
        if (ch[9]) ch[9].rotation.x = -swing;

        const remotes = remotePlayersRef.current;
        const seen = new Set<string>();
        for (const rp of remotes) {
          seen.add(rp.id);
          if (!remotePool.has(rp.id)) {
            const m = createCharacter(rp.color);
            scene.add(m);
            remotePool.set(rp.id, m);
          }
          const m = remotePool.get(rp.id)!;
          m.position.set(rp.x, rp.y, rp.z);
          m.visible = true;
        }
        for (const [id, m] of remotePool) {
          if (!seen.has(id)) m.visible = false;
        }

        // Forward direction implied by facingAngle (matches the formula
        // used in game3DPhysics.ts: facingAngle = atan2(nx, nz))
        const fdx = Math.sin(s.facingAngle);
        const fdz = Math.cos(s.facingAngle);

        let targetPos: THREE.Vector3;
        let targetLook: THREE.Vector3;
        let lerpSpeed = 0.07;

        if (mode === 'first') {
          // Eyes-level, looking in the direction the player is facing
          targetPos = new THREE.Vector3(s.x, s.y + 1.6, s.z);
          targetLook = new THREE.Vector3(s.x + fdx * 5, s.y + 1.6, s.z + fdz * 5);
          lerpSpeed = 0.35; // snappier — first person shouldn't feel laggy
        } else if (mode === 'top') {
          // Straight overhead, small Z nudge avoids a degenerate lookAt
          targetPos = new THREE.Vector3(s.x, s.y + 20, s.z + 0.01);
          targetLook = new THREE.Vector3(s.x, s.y, s.z);
        } else {
          // 'third' — default chase camera, behind & above the player
          targetPos = new THREE.Vector3(s.x, s.y + 5.8, s.z + 10);
          targetLook = new THREE.Vector3(s.x, s.y + 1, s.z - 5);
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
