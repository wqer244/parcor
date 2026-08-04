// ────────────────────────────────────────────────────────
// Sound effects — weapon fire, melee swings, hit impacts,
// target-lock, and weapon pickups.
// ────────────────────────────────────────────────────────
// Uses expo-audio's createAudioPlayer, which builds a ready-to-play
// player synchronously (no async loading dance needed before first use).
//
// Every play() call spawns a BRAND-NEW player for that one shot, instead
// of reusing/seeking a pooled player. That might look wasteful at first
// glance, but it's deliberate: a freshly created player already sits at
// position 0, so there's nothing to seek before playing it — no race,
// no chance of play() firing before a previous seek landed, no "sounds
// sometimes fire late / sometimes not at all / need a couple of presses
// before they catch up", which is exactly what seeking a shared player
// caused (seekTo() is async in expo-audio; calling it right before
// play() without awaiting it races the two calls against each other).
// These clips are tiny (well under half a second, a few KB each) and
// ATTACK_COOLDOWN_MS already caps fire rate to 2/sec per weapon, so the
// overhead of a new player per shot is negligible — correctness and
// audible-on-time beat marginal memory savings here.
//
// This module has no game-loop dependency and no React state — it's a
// plain side-effect module, safe to call from anywhere (game.tsx,
// usePvP.ts, or the low-level per-frame renderer loop in
// GameRenderer3D.tsx) without re-render cost.
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
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

// Each clip's real length (see the synthesis script that generated
// them) + a small buffer, in ms — used only to know when it's safe to
// release the one-shot player's native resources after it finishes.
const CLIP_MS: Record<SfxKey, number> = {
  blaster: 300,
  railgun: 500,
  bow: 400,
  staff: 450,
  melee: 500,
  hit: 400,
  lock: 350,
  pickup: 500,
};

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

  // Touch every source once up front so the underlying asset files are
  // already resolved/cached by the time the first shot is fired — the
  // very first createAudioPlayer() call for a given source can be a
  // touch slower than subsequent ones while Metro/the native layer
  // resolves the bundled asset. This player is discarded immediately;
  // it's purely a warm-up, not something that gets played.
  (Object.keys(SOURCES) as SfxKey[]).forEach((key) => {
    try {
      const warm = createAudioPlayer(SOURCES[key]);
      warm.remove?.();
    } catch {
      // Non-fatal — worst case the very first real shot pays the
      // resolve cost instead of it happening here.
    }
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
  try {
    const player = createAudioPlayer(SOURCES[key]);
    player.volume = Math.max(0, Math.min(1, volume));
    player.play();
    // Release the native player once the clip has definitely finished —
    // it was a one-shot, there's nothing left to reuse it for.
    setTimeout(() => {
      try {
        player.remove?.();
      } catch {
        // Already gone / backend cleaned it up itself — fine either way.
      }
    }, CLIP_MS[key]);
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
