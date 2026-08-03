// ────────────────────────────────────────────────────────
// Sound effects — weapon fire, melee swings, hit impacts,
// target-lock, and weapon pickups.
// ────────────────────────────────────────────────────────
// Uses expo-audio's createAudioPlayer, which builds a ready-to-play
// player synchronously (no async loading dance needed before first use).
//
// ────────────────────────────────────────────────────────
// Sound effects — weapon fire, melee swings, hit impacts,
// target-lock, and weapon pickups.
// ────────────────────────────────────────────────────────
// Uses expo-audio's createAudioPlayer, which builds a ready-to-play
// player synchronously (no async loading dance needed before first use).
//
// Every sound gets a small ROUND-ROBIN POOL of players (not just one)
// for the same reason the renderer keeps pools of tracers/flashes: a
// railgun or blaster can fire faster than one clip's playback length,
// and reusing a single player would either cut the previous shot off
// or silently drop the new one. Cycling through 3-4 players per sound
// means overlapping shots each get their own voice, just like a real
// game's audio engine.
//
// This module has no game-loop dependency and no React state — it's a
// plain side-effect module, safe to call from anywhere (game.tsx,
// usePvP.ts, or the low-level per-frame renderer loop in
// GameRenderer3D.tsx) without re-render cost.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import type { WeaponType } from './game3DPhysics';

type SfxKey = 'blaster' | 'railgun' | 'bow' | 'staff' | 'melee' | 'hit' | 'lock' | 'pickup';

// Metro needs static, literal require() calls to bundle these — no
// dynamic path building.
const SOURCES: Record<SfxKey, number> = {
  blaster: require('../assets/sounds/sfx_blaster.wav'),
  railgun: require('../assets/sounds/sfx_railgun.wav'),
  bow: require('../assets/sounds/sfx_bow.wav'),
  staff: require('../assets/sounds/sfx_staff.wav'),
  melee: require('../assets/sounds/sfx_melee.wav'),
  hit: require('../assets/sounds/sfx_hit.wav'),
  lock: require('../assets/sounds/sfx_lock.wav'),
  pickup: require('../assets/sounds/sfx_pickup.wav'),
};

const POOL_SIZE = 4;
const pools = new Map<SfxKey, AudioPlayer[]>();
const cursors = new Map<SfxKey, number>();
let ready = false;

// Call once, early (game.tsx does this on mount). Safe to call more
// than once — later calls are no-ops.
export function initSfx() {
  if (ready) return;
  ready = true;

  // ── Audio session config ─────────────────────────────────────────
  // Explicitly claims the loudspeaker route and "mix with others" so
  // these sound effects: (a) never inherit the earpiece/"phone call"
  // routing that a VoIP engine like the Agora voice chat can otherwise
  // put the whole device's audio session into, and (b) play ALONGSIDE
  // the voice chat instead of interrupting/ducking it or getting
  // interrupted by it — the two audio sources should be independent and
  // both audible, not fighting over the same channel.
  setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false,
    interruptionMode: 'mixWithOthers',
    interruptionModeAndroid: 'duckOthers',
    shouldRouteThroughEarpiece: false,
  }).catch((err) => {
    console.warn('[sfx] failed to set audio mode (SFX will still try to play):', err);
  });

  (Object.keys(SOURCES) as SfxKey[]).forEach((key) => {
    const pool: AudioPlayer[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const p = createAudioPlayer(SOURCES[key]);
      p.volume = 1;
      pool.push(p);
    }
    pools.set(key, pool);
    cursors.set(key, 0);
  });
}

// Distance-based volume falloff for sounds coming from other players
// (0 = full volume close by, 1 = essentially inaudible far away).
function distanceVolume(distance?: number) {
  if (distance === undefined) return 1;
  const HEAR_RANGE = 45; // world units — beyond this, silent
  const v = 1 - distance / HEAR_RANGE;
  return Math.max(0, Math.min(1, v));
}

function play(key: SfxKey, volume = 1) {
  if (!ready) initSfx();
  const pool = pools.get(key);
  if (!pool || pool.length === 0) return;
  const i = cursors.get(key) ?? 0;
  cursors.set(key, (i + 1) % pool.length);
  const player = pool[i];
  try {
    player.volume = Math.max(0, Math.min(1, volume));
    player.seekTo(0);
    player.play();
  } catch {
    // Audio backend hiccup (e.g. focus loss) — never let a sound glitch
    // interrupt gameplay.
  }
}

const WEAPON_SFX_KEY: Record<WeaponType, SfxKey> = {
  sword: 'melee',
  hammer: 'melee',
  blaster: 'blaster',
  bow: 'bow',
  staff: 'staff',
  railgun: 'railgun',
};

// Plays the correct shot/swing sound for whichever weapon just attacked.
// `distance` is only passed for OTHER players' attacks (positional
// falloff) — omit it for the local player's own weapon, which should
// always play at full volume.
export function playWeaponFire(weapon: WeaponType, distance?: number) {
  play(WEAPON_SFX_KEY[weapon], distanceVolume(distance));
}

export function playHitImpact() {
  play('hit', 1);
}

export function playTargetLock() {
  play('lock', 0.8);
}

export function playPickup() {
  play('pickup', 0.9);
}
