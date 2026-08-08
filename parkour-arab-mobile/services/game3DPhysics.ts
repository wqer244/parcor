// ────────────────────────────────────────────────────────
// 3D Parkour Physics & World Data
// ────────────────────────────────────────────────────────

// ── Tuning notes ─────────────────────────────────────────
// These three constants were rebalanced together. The old values
// (GRAVITY 0.022 / JUMP_VELOCITY 0.32 / MOVE_SPEED 0.13) produced a
// jump arc that could only cover ~3.8 units of forward distance, while
// the very first gap (start → p1) required 7.25 units — meaning it was
// physically IMPOSSIBLE to reach the first platform no matter how the
// player pressed the buttons. That's the "can't pass the first block"
// bug. The values below give ~6.4-7.5 units of reach per jump, with a
// safety margin over every platform gap in the course (see PLATFORMS
// below, which was also nudged closer for the first jump specifically).
export const GRAVITY = 0.016;
export const JUMP_VELOCITY = 0.40;
export const MOVE_SPEED = 0.17;
export const MAX_FALL_SPEED = 0.55;
export const PLAYER_RADIUS = 0.3;
export const PLAYER_HEIGHT = 1.8;
export const DEATH_Y = -6;

export const PLAYER_COLORS = [
  '#00ffcc', '#00aaff', '#ff00aa', '#ffaa00',
  '#aa00ff', '#ff3333', '#33ff33', '#ff6600',
];

// ── PvP Arena ──────────────────────────────────────────────
// The arena sits behind the spawn point, opposite the parkour course
// (which runs along -Z) — walk backward from start to reach it.
export type WeaponType = 'sword' | 'hammer' | 'blaster' | 'bow' | 'staff' | 'railgun';

// Rarity tier — purely cosmetic (pedestal glow, beam brightness, ring
// color) but reads exactly like a AAA looter-shooter: common items are
// quiet, legendaries announce themselves from across the arena.
export type WeaponTier = 'common' | 'rare' | 'epic' | 'legendary';

export const TIER_COLORS: Record<WeaponTier, string> = {
  common: '#9aa5b1',
  rare: '#3aa0ff',
  epic: '#b23aff',
  legendary: '#ffb020',
};

export interface WeaponDef {
  name: string;
  damage: number;
  range: number;   // attack reach, in world units
  color: string;    // primary material color for the held/pedestal model
  ranged: boolean;   // true = can hit from a distance; false = melee-only
  tier: WeaponTier;
}

// Stats + tier balanced so higher-risk pickups (corner sniper decks, the
// central hub) reward the player who fights for map control.
export const WEAPON_DEFS: Record<WeaponType, WeaponDef> = {
  sword:   { name: 'سيف الصاعقة',   damage: 18, range: 1.9,  color: '#d8dde6', ranged: false, tier: 'common' },
  hammer:  { name: 'مطرقة الحرب',    damage: 30, range: 1.7,  color: '#8a5a2e', ranged: false, tier: 'rare' },
  blaster: { name: 'مسدس بلازما',    damage: 14, range: 15,   color: '#00c8ff', ranged: true,  tier: 'rare' },
  bow:     { name: 'قوس الظل',       damage: 17, range: 17,   color: '#39ff6a', ranged: true,  tier: 'epic' },
  staff:   { name: 'عصا الأركان',    damage: 21, range: 13,   color: '#c23bff', ranged: true,  tier: 'epic' },
  railgun: { name: 'مدفع الطاقة',    damage: 38, range: 22,   color: '#ffcc33', ranged: true,  tier: 'legendary' },
};

export interface WeaponSpawn {
  id: string;
  type: WeaponType;
  x: number;
  y: number; // pedestal top surface — the renderer floats the model above this
  z: number;
}

// Spread across three tiers of the arena: two common/rare pickups on the
// open ground (contested early, low risk), four on the corner sniper
// decks (reward climbing for high ground), and one legendary railgun on
// the central hub platform (the map's main fight-for-it objective).
export const PVP_WEAPON_SPAWNS: WeaponSpawn[] = [
  { id: 'w1', type: 'sword',   x: 0,   y: 0.5, z: 40 },
  { id: 'w2', type: 'blaster', x: 0,   y: 0.5, z: 74 },
  { id: 'w3', type: 'bow',     x: -16, y: 3.1, z: 30 },
  { id: 'w4', type: 'hammer',  x: 16,  y: 3.1, z: 30 },
  { id: 'w5', type: 'staff',   x: 16,  y: 3.1, z: 84 },
  { id: 'w6', type: 'sword',   x: -16, y: 3.1, z: 84 },
  { id: 'w7', type: 'railgun', x: 0,   y: 2.5, z: 57 },
];

export const WEAPON_RESPAWN_MS = 15000;
export const WEAPON_PICKUP_RADIUS = 1.4;
export const MELEE_DAMAGE = 10;
export const MELEE_RANGE = 1.6;
export const ATTACK_ARC = Math.PI / 2.2; // ~82° cone in front of the attacker
export const PVP_MAX_HEALTH = 100;
export const ATTACK_COOLDOWN_MS = 500;

// Arena floor bounds (a subregion of the 'pvp-ground' platform below) —
// used to detect entering/leaving the PvP zone (health bar, weapon pickups,
// and combat are only active inside these bounds).
//
// NOTE: this used to be a cramped 24x34 box — noticeably too small once
// weapons with 15-22 unit range (blaster/bow/staff/railgun) are in play,
// since a fight in one corner could hitscan clear across to the opposite
// wall with room to spare. It's now 40x62 (roughly 2x the floor area),
// with the whole layout below (hub, corner decks, cover) redesigned to
// actually fill that space instead of leaving it empty.
export const PVP_ARENA_BOUNDS = { minX: -20, maxX: 20, minZ: 26, maxZ: 88 };
export function isInPvPArena(x: number, z: number): boolean {
  return (
    x >= PVP_ARENA_BOUNDS.minX && x <= PVP_ARENA_BOUNDS.maxX &&
    z >= PVP_ARENA_BOUNDS.minZ && z <= PVP_ARENA_BOUNDS.maxZ
  );
}
// Where a player respawns after their health hits 0 in the arena.
export const PVP_SPAWN = { x: 0, y: 0.5, z: 34 };

export interface Platform3D {
  id: string;
  x: number;       // center X
  y: number;       // TOP surface Y
  z: number;       // center Z
  width: number;   // X size
  height: number;  // thickness
  depth: number;   // Z size
  color: string;
  glowColor: string;
  type: 'ground' | 'platform' | 'finish';
  // Marks PvP-arena structures (decks, hub, cover) so the renderer can
  // dress them with armor-panel trim / corner beacons instead of the
  // plain glowing blocks used for the parkour course.
  arena?: boolean;
  // Marks Map 4's "Crystal Sanctuary" pieces so the renderer can dress
  // them with a floating shard + hover-ring (see buildPlatformMeshes in
  // GameRenderer3D.tsx) instead of the plain block+strip used by Maps
  // 1-3 — this is what makes Map 4 read as a different place rather
  // than "the same cubes, but smaller."
  theme?: 'crystal';
  // ── Real obstacles (not just smaller islands) ─────────────────────
  // `move`: the platform physically travels back and forth along one
  // axis, following a sine wave — position(t) = base ± range at `speed`
  // radians/sec, optionally phase-shifted so neighbouring movers don't
  // sync up. A player standing on a moving platform is carried with it
  // (see the `standingPlatformId` carry logic in stepPhysics3D below),
  // so timing the jump onto AND off of it is the actual obstacle.
  move?: { axis: 'x' | 'y' | 'z'; range: number; speed: number; phase?: number };
  // `blink`: the platform periodically stops being solid — visible the
  // whole time (so you can read the timing), but only collidable for
  // `onRatio` of every `period` seconds. Landing on it mid-vanish just
  // means you fall through, exactly like missing a jump.
  blink?: { period: number; onRatio: number; phase?: number };
}

// Shared by Platform3D.move and Hazard3D.move — a simple sine-wave
// oscillation around a fixed anchor point.
export interface MoveDef { axis: 'x' | 'y' | 'z'; range: number; speed: number; phase?: number }

// Evaluates a moving anchor's world position at time `t` (seconds). For
// anchors with no `move` def this is just the static point — cheap
// enough to call unconditionally for every platform/hazard every frame.
export function applyMove(
  anchor: { x: number; y: number; z: number },
  move: MoveDef | undefined,
  t: number,
): { x: number; y: number; z: number } {
  if (!move) return anchor;
  const offset = Math.sin(t * move.speed + (move.phase ?? 0)) * move.range;
  return {
    x: anchor.x + (move.axis === 'x' ? offset : 0),
    y: anchor.y + (move.axis === 'y' ? offset : 0),
    z: anchor.z + (move.axis === 'z' ? offset : 0),
  };
}

// A platform's live world position at time `t` — static platforms just
// return their fixed x/y/z.
export function getPlatformPosition(p: Platform3D, t: number): { x: number; y: number; z: number } {
  return applyMove(p, p.move, t);
}

// Whether a blinking platform is currently solid. Non-blinking platforms
// are always solid.
export function isPlatformSolid(p: Platform3D, t: number): boolean {
  if (!p.blink) return true;
  const cyclePos = (((t * 1) + (p.blink.phase ?? 0)) % p.blink.period + p.blink.period) % p.blink.period;
  return cyclePos < p.blink.period * p.blink.onRatio;
}

// ── Map 4 hazards — floating crystal spikes ─────────────────────────
// Unlike platforms, these are never safe to touch: brushing one respawns
// the player at their current checkpoint exactly like falling off the
// course. Most hazards patrol the gap between platforms (via `move`),
// so avoiding them is a real timing/positioning obstacle, not just a
// bigger jump.
export interface Hazard3D {
  id: string;
  x: number; y: number; z: number; // center, at rest
  radius: number; // rough collision radius (sphere-ish, cheap to test)
  move?: MoveDef;
}

export function getHazardPosition(h: Hazard3D, t: number): { x: number; y: number; z: number } {
  return applyMove(h, h.move, t);
}

export interface PhysState3D {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  facingAngle: number;
  finished: boolean;
  // Index into CHECKPOINTS (below) of the furthest checkpoint gate the
  // player has already reached — where they respawn if they fall, so
  // dying in Map 2 sends you back to the start of Map 2, not all the way
  // back to Map 1. Monotonically increases (never decreases, even if the
  // player walks backward past an already-cleared gate).
  checkpointIndex: number;
  // Which platform (by id) the player is currently standing on, and the
  // physics-time `t` (seconds) of the step that set it — together these
  // let stepPhysics3D "carry" the player along with a moving platform
  // (m4-move* in PLATFORMS) by comparing that platform's position at the
  // previous step's t vs the current one. Both optional/undefined for
  // players not standing on anything, or for callers that never pass a
  // custom `t` into stepPhysics3D — everything degrades gracefully to
  // the old static-platform behavior in that case.
  standingPlatformId?: string;
  platformT?: number;
}

export interface Input3D {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
  // Optional analog move vector in WORLD space (x, z), already rotated to
  // match the camera's current facing by the caller (see game.tsx, which
  // rotates the virtual joystick's screen-space push by orbitYawRef every
  // tick). Magnitude 0..1 — a light push moves slower, a full push moves
  // at MOVE_SPEED. When present (above a small deadzone) this takes
  // priority over the legacy boolean D-pad fields below, giving free
  // 360° movement instead of 8 fixed directions.
  moveX?: number;
  moveZ?: number;
}

// ── World Map ──────────────────────────────────────────────
// Course runs along -Z. player.y = feet Y. platform.y = top surface Y.

export const PLATFORMS: Platform3D[] = [
  // Start area
  { id:'start',  x:0,    y:0,    z:0,    width:8,   height:0.5, depth:14,  color:'#0d2040', glowColor:'#2255aa', type:'ground' },

  // Section 1: First hops
  // NOTE: p1 (and everything after it) was moved 2.75 units closer to the
  // start platform. It used to sit at z:-16, leaving a 7.25-unit gap that
  // was larger than every other jump in the course and larger than the
  // player could ever physically cross — that was the "stuck on the first
  // block" bug.
  { id:'p1',  x:0,    y:1.2,  z:-13.25, width:3.5, height:0.4, depth:3.5, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'p2',  x:1.8,  y:2.2,  z:-20.25, width:3,   height:0.4, depth:3,   color:'#0d2a40', glowColor:'#00aaff', type:'platform' },
  { id:'p3',  x:-1.5, y:1.6,  z:-27.25, width:3,   height:0.4, depth:3,   color:'#0d4040', glowColor:'#00ffcc', type:'platform' },

  // Section 2: Rising climb
  { id:'p4',  x:0.5,  y:3.5,  z:-35.25, width:2.5, height:0.4, depth:2.5, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'p5',  x:-1.2, y:5.0,  z:-42.25, width:2.2, height:0.4, depth:2.2, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },
  { id:'p6',  x:1.5,  y:6.5,  z:-48.25, width:2.2, height:0.4, depth:2.2, color:'#400030', glowColor:'#ff00aa', type:'platform' },
  { id:'p7',  x:0,    y:7.8,  z:-54.25, width:3.5, height:0.4, depth:3.5, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },

  // Section 3: Zig-zag
  { id:'p8',  x:-2.5, y:6.5,  z:-60.25, width:2.2, height:0.4, depth:2.2, color:'#0d2a40', glowColor:'#00aaff', type:'platform' },
  { id:'p9',  x:2.5,  y:5.8,  z:-66.25, width:2.2, height:0.4, depth:2.2, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'p10', x:-2,   y:7.0,  z:-72.25, width:2.2, height:0.4, depth:2.2, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'p11', x:0,    y:8.5,  z:-77.25, width:2.5, height:0.4, depth:2.5, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },

  // Section 4: Narrow
  { id:'p12', x:1.5,  y:9.0,  z:-84.25, width:1.8, height:0.4, depth:1.8, color:'#400030', glowColor:'#ff00aa', type:'platform' },
  { id:'p13', x:-1.5, y:9.5,  z:-90.25, width:1.8, height:0.4, depth:1.8, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'p14', x:0.5,  y:10.2, z:-96.25, width:1.8, height:0.4, depth:1.8, color:'#0d2a40', glowColor:'#00aaff', type:'platform' },

  // Section 5: Final approach
  { id:'p15', x:0,    y:11.0, z:-103.25, width:2.5, height:0.4, depth:2.5, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'p16', x:0,    y:12.0, z:-110.25, width:2.2, height:0.4, depth:2.2, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },

  // Map 1 → Map 2 gate. Used to be the finish line — it isn't anymore
  // (see CHECKPOINTS below and the 3-map redesign notes above the
  // Section comments). Kept the same gold "milestone" look so reaching
  // it still visually reads as an accomplishment, just `type:'platform'`
  // now instead of `'finish'`, so walking onto it no longer ends the
  // run — it just carries you straight into Map 2's own platforms,
  // which start immediately past it with no gap to fall through.
  { id:'map1-gate', x:0, y:13.0, z:-119.25, width:6, height:0.6, depth:6,
    color:'#5a4000', glowColor:'#ffd700', type:'platform' },

  // ══════════════════════════════════════════════════════════════
  // MAP 2 — smaller platforms than Map 1 at similar jump distances,
  // so every gap is a genuinely tighter landing, not a longer jump
  // (longer jumps risk becoming physically impossible; smaller targets
  // stay within the same proven-reachable envelope while still raising
  // difficulty). Checkpoint 1 (CHECKPOINTS[1] below) is the start pad.
  // ══════════════════════════════════════════════════════════════
  { id:'m2-start', x:0, y:13.0, z:-126, width:6, height:0.5, depth:6,
    color:'#0d1830', glowColor:'#3366cc', type:'ground' },

  { id:'m2-p1',  x:1.8,   y:14.3, z:-132.5, width:1.8, height:0.4, depth:1.8, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'m2-p2',  x:-1.89, y:15.3, z:-139.5, width:1.7, height:0.4, depth:1.7, color:'#0d2a40', glowColor:'#00aaff', type:'platform' },
  { id:'m2-p3',  x:1.8,   y:14.6, z:-146,   width:1.8, height:0.4, depth:1.8, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'m2-p4',  x:-1.6,  y:16.2, z:-152.65,width:1.6, height:0.4, depth:1.6, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },
  { id:'m2-p5',  x:0.89,  y:17.6, z:-159.65,width:1.5, height:0.4, depth:1.5, color:'#400030', glowColor:'#ff00aa', type:'platform' },
  { id:'m2-p6',  x:-1.8,  y:18.9, z:-166.15,width:1.5, height:0.4, depth:1.5, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'m2-p7',  x:0,     y:19.8, z:-173.15,width:2.0, height:0.4, depth:2.0, color:'#0d2a40', glowColor:'#00aaff', type:'platform' }, // breather
  { id:'m2-p8',  x:-1.8,  y:19.0, z:-179.15,width:1.6, height:0.4, depth:1.6, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'m2-p9',  x:1.7,   y:20.1, z:-185.65,width:1.5, height:0.4, depth:1.5, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },
  { id:'m2-p10', x:-1.22, y:21.4, z:-192.65,width:1.4, height:0.4, depth:1.4, color:'#400030', glowColor:'#ff00aa', type:'platform' },
  { id:'m2-p11', x:1.4,   y:20.8, z:-199.15,width:1.5, height:0.4, depth:1.5, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'m2-p12', x:-1.5,  y:22.3, z:-205.86,width:1.4, height:0.4, depth:1.4, color:'#0d2a40', glowColor:'#00aaff', type:'platform' },
  { id:'m2-p13', x:1.6,   y:23.4, z:-212.86,width:1.4, height:0.4, depth:1.4, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'m2-p14', x:-1.4,  y:24.4, z:-219.81,width:1.6, height:0.4, depth:1.6, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },

  // Map 2 → Map 3 gate.
  { id:'map2-gate', x:0, y:24.4, z:-226.81, width:6, height:0.6, depth:6,
    color:'#5a4000', glowColor:'#ffd700', type:'platform' },

  // ══════════════════════════════════════════════════════════════
  // MAP 3 — the hardest tier: smallest platforms, longest gaps (still
  // within the same physically-validated jump envelope as Map 1/2, just
  // pushed toward its upper end more consistently), and bigger height
  // swings. Checkpoint 2 (CHECKPOINTS[2] below) is the start pad. The
  // final pad is the ONLY real finish line in the whole course now.
  // ══════════════════════════════════════════════════════════════
  { id:'m3-start', x:0, y:24.4, z:-233.81, width:6, height:0.5, depth:6,
    color:'#0d1830', glowColor:'#3366cc', type:'ground' },

  { id:'m3-p1',  x:0.89,  y:25.8, z:-240.81, width:1.5, height:0.4, depth:1.5, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'m3-p2',  x:-2.0,  y:27.1, z:-247.62, width:1.4, height:0.4, depth:1.4, color:'#0d2a40', glowColor:'#00aaff', type:'platform' },
  { id:'m3-p3',  x:1.9,   y:26.1, z:-254.62, width:1.4, height:0.4, depth:1.4, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'m3-p4',  x:-1.7,  y:27.8, z:-261.22, width:1.3, height:0.4, depth:1.3, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },
  { id:'m3-p5',  x:0.89,  y:29.2, z:-268.22, width:1.3, height:0.4, depth:1.3, color:'#400030', glowColor:'#ff00aa', type:'platform' },
  { id:'m3-p6',  x:-1.9,  y:30.4, z:-274.72, width:1.2, height:0.4, depth:1.2, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'m3-p7',  x:0,     y:31.2, z:-281.77, width:1.8, height:0.4, depth:1.8, color:'#0d2a40', glowColor:'#00aaff', type:'platform' }, // breather
  { id:'m3-p8',  x:-1.9,  y:30.3, z:-288.27, width:1.3, height:0.4, depth:1.3, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'m3-p9',  x:1.22,  y:31.6, z:-295.27, width:1.2, height:0.4, depth:1.2, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },
  { id:'m3-p10', x:-1.6,  y:33.0, z:-302.03, width:1.2, height:0.4, depth:1.2, color:'#400030', glowColor:'#ff00aa', type:'platform' },
  { id:'m3-p11', x:1.5,   y:32.2, z:-308.53, width:1.3, height:0.4, depth:1.3, color:'#0d4040', glowColor:'#00ffcc', type:'platform' },
  { id:'m3-p12', x:-1.5,  y:33.8, z:-315.18, width:1.2, height:0.4, depth:1.2, color:'#0d2a40', glowColor:'#00aaff', type:'platform' },
  { id:'m3-p13', x:1.22,  y:35.1, z:-322.18, width:1.1, height:0.4, depth:1.1, color:'#3d2a00', glowColor:'#ffaa00', type:'platform' },
  { id:'m3-p14', x:-1.4,  y:36.3, z:-329.04, width:1.3, height:0.4, depth:1.3, color:'#2a0040', glowColor:'#aa00ff', type:'platform' },

  // Map 3 → Map 4 gate. Used to be the finish line — it isn't anymore
  // (see MAP 4 below). Same gold "milestone" treatment as the other two
  // gates, `type:'platform'` so it just carries you into Map 4's own
  // platforms instead of ending the run.
  { id:'map3-gate', x:0, y:37.3, z:-337.93, width:6, height:0.6, depth:6,
    color:'#5a4000', glowColor:'#ffd700', type:'platform' },

  // ══════════════════════════════════════════════════════════════
  // MAP 4 — "الحرم البلوري" (The Crystal Sanctuary). Deliberately a
  // different *place*, not just smaller versions of Maps 1-3: a single
  // coherent amethyst-and-gold palette instead of the rainbow-per-
  // platform scheme used earlier, every platform gets a floating
  // crystal shard + hover-ring (theme:'crystal', see buildPlatformMeshes
  // in GameRenderer3D.tsx), the local fog/sky tint shifts to violet as
  // the player enters this zone, and there's a genuine shape change —
  // two long crystal "bridge" planks — partway through, instead of only
  // ever landing on squarish islands.
  //
  // Difficulty: smallest footprints in the whole course (down to 1.2,
  // vs Map 3's 1.1 floor) and back-to-back tough jumps with almost no
  // breathers, but every single jump reuses a forward/height combo
  // that's already proven reachable elsewhere in this file (see the
  // GRAVITY/JUMP_VELOCITY notes at the top and the map1-gate/finish
  // jumps below) — hard, not impossible. Checkpoint 3 (CHECKPOINTS[3]
  // below) is the start pad. The final pad is the ONLY real finish
  // line in the whole course now.
  // ══════════════════════════════════════════════════════════════
  { id:'m4-start', x:0, y:37.3, z:-345, width:6, height:0.5, depth:6,
    color:'#140d28', glowColor:'#8a5cff', type:'ground', theme:'crystal' },

  { id:'m4-p1',  x:2.4,  y:38.6, z:-352.2, width:1.6, height:0.4, depth:1.6, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },
  { id:'m4-p2',  x:-2.0, y:39.9, z:-359.4, width:1.5, height:0.4, depth:1.5, color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal' },
  { id:'m4-p3',  x:2.6,  y:38.7, z:-366.4, width:1.5, height:0.4, depth:1.5, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },
  { id:'m4-p4',  x:-2.0, y:40.3, z:-373.4, width:1.4, height:0.4, depth:1.4, color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal' },
  { id:'m4-p5',  x:2.6,  y:39.4, z:-380.2, width:1.4, height:0.4, depth:1.4, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },
  { id:'m4-p6',  x:0,    y:40.8, z:-386.9, width:2.0, height:0.4, depth:2.0, color:'#2a0040', glowColor:'#e08cff', type:'platform', theme:'crystal' }, // breather

  // Twin crystal bridge — long thin planks instead of small islands, a
  // deliberate silhouette change so Map 4 doesn't read as "the same
  // cube language, just smaller" the way Map 3 does over Map 2.
  { id:'m4-bridge1', x:0,   y:41.4, z:-393.1, width:1.3, height:0.4, depth:4.5, color:'#0d3040', glowColor:'#7ef9ff', type:'platform', theme:'crystal' },
  { id:'m4-bridge2', x:0.3, y:41.9, z:-399.6, width:1.3, height:0.4, depth:4.5, color:'#0d3040', glowColor:'#7ef9ff', type:'platform', theme:'crystal' },

  { id:'m4-p7',  x:-2.4, y:43.2, z:-406.4, width:1.4, height:0.4, depth:1.4, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },
  { id:'m4-p8',  x:2.6,  y:42.1, z:-413.2, width:1.4, height:0.4, depth:1.4, color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal' },
  { id:'m4-p9',  x:-2.0, y:43.8, z:-420.0, width:1.3, height:0.4, depth:1.3, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },
  { id:'m4-p10', x:0,    y:44.8, z:-426.6, width:1.9, height:0.4, depth:1.9, color:'#2a0040', glowColor:'#e08cff', type:'platform', theme:'crystal' }, // breather
  { id:'m4-p11', x:2.6,  y:43.8, z:-433.4, width:1.3, height:0.4, depth:1.3, color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal' },
  { id:'m4-p12', x:-2.0, y:45.4, z:-440.2, width:1.3, height:0.4, depth:1.3, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },
  { id:'m4-p13', x:2.4,  y:44.3, z:-447.0, width:1.2, height:0.4, depth:1.2, color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal' },

  // ══════════════════════════════════════════════════════════════
  // MAP 4 EXTENSION — "ممر الأشباح" (The Wraith Passage). This is the
  // part that makes Map 4 an actually different course instead of a
  // short detour through slightly smaller crystal islands: real moving
  // and vanishing obstacles, not just static footprints. Every jump
  // still reuses the same validated dz/dy envelope as the rest of the
  // file — what changed is that some of the landing spots now move
  // (m4-move*, sine-wave platforms you have to time), some disappear on
  // a cycle (m4-blink*, always visible so the timing is readable, but
  // only solid part of the time), and there are floating crystal spike
  // hazards (HAZARDS below) patrolling several of the gaps that respawn
  // you on contact — a genuine "avoid this, don't just jump it" threat
  // that doesn't exist anywhere earlier in the course.
  // ══════════════════════════════════════════════════════════════

  // Shifting Spires — two platforms that swing side-to-side; you have
  // to lead your jump toward where the platform will be, not where it
  // is right now.
  { id:'m4-move1', x:-1.8, y:45.6, z:-453.8, width:1.5, height:0.4, depth:1.5,
    color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal',
    move:{ axis:'x', range:1.6, speed:1.6 } },
  { id:'m4-move2', x:-1.7, y:48.3, z:-467.4, width:1.4, height:0.4, depth:1.4,
    color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal',
    move:{ axis:'x', range:1.7, speed:1.3, phase:2 } },

  // Blinking Shards — solid most of the time (readable timing window),
  // but land mid-vanish and you fall straight through.
  { id:'m4-blink1', x:1.9, y:47.0, z:-460.6, width:1.6, height:0.4, depth:1.6,
    color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal',
    blink:{ period:2.2, onRatio:0.6 } },
  { id:'m4-blink2', x:-1.8, y:48.6, z:-481.0, width:1.6, height:0.4, depth:1.6,
    color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal',
    blink:{ period:2.0, onRatio:0.55, phase:1 } },

  { id:'m4-p16', x:1.6, y:50.0, z:-487.8, width:1.2, height:0.4, depth:1.2,
    color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },

  // A platform that patrols depth instead of side-to-side — the gap
  // ahead of it is sometimes short, sometimes long.
  { id:'m4-move3', x:-1.4, y:51.3, z:-494.6, width:1.4, height:0.4, depth:1.4,
    color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal',
    move:{ axis:'z', range:1.2, speed:1.5 } },

  // Twin crystal bridge #2 — a second long thin plank, echoing the
  // Section-3 bridge but higher up and further from anything else.
  { id:'m4-bridge3', x:0, y:52.6, z:-504.5, width:1.2, height:0.4, depth:5.0,
    color:'#0d3040', glowColor:'#7ef9ff', type:'platform', theme:'crystal' },

  { id:'m4-p18', x:0,    y:53.6, z:-511.5, width:2.0, height:0.4, depth:2.0, color:'#2a0040', glowColor:'#e08cff', type:'platform', theme:'crystal' }, // breather
  { id:'m4-p19', x:2.2,  y:52.6, z:-518.3, width:1.3, height:0.4, depth:1.3, color:'#3d2a00', glowColor:'#ffd700', type:'platform', theme:'crystal' },
  { id:'m4-p20', x:-2.0, y:54.0, z:-525.1, width:1.3, height:0.4, depth:1.3, color:'#241040', glowColor:'#c23bff', type:'platform', theme:'crystal' },

  // Finish — the ONLY win trigger in the whole course now. This jump
  // (dz:8.9, dx:+0.9, dy:+1.0) reuses the exact proven map-gate/finish
  // jump shape used throughout this file ("small platform → big
  // landing pad"), kept deliberately unchanged even here at the very
  // last jump of the run so it stays inside the fully-validated
  // envelope.
  { id:'finish', x:-1.1, y:55.0, z:-534.0, width:6.5, height:0.6, depth:6.5,
    color:'#5a4000', glowColor:'#ffd700', type:'finish', theme:'crystal' },

  // ── PvP Arena — "Crimson Coliseum" ──────────────────────
  // Positioned behind spawn (+Z), opposite the parkour course (-Z) —
  // walk backward from the start platform to reach it. Built as a
  // continuous ground floor (so nothing here is a death-fall — you just
  // land back on the arena floor) with four elevated corner sniper decks
  // reached by a single stair step each, a large central raised hub
  // platform holding the legendary weapon, and scattered cover blocks of
  // two different heights across the (now much bigger) mid-field for
  // tactical engagements at both melee and ranged distance. Combat/
  // weapons/health are only active inside PVP_ARENA_BOUNDS below (the
  // z:26–88 portion).
  { id:'pvp-walkway', x:0, y:0, z:16, width:8, height:0.5, depth:20,
    color:'#0d1830', glowColor:'#3366cc', type:'ground' },
  { id:'pvp-ground', x:0, y:0, z:57, width:40, height:0.5, depth:62,
    color:'#241012', glowColor:'#ff3333', type:'ground', arena:true },

  // Central hub — the contested "king of the hill" objective, holds the
  // legendary railgun (w7 above). Single step up from the open floor.
  { id:'pvp-hub-step', x:0, y:1.0, z:50, width:5, height:1.0, depth:5,
    color:'#3a1414', glowColor:'#ff7a3a', type:'platform', arena:true },
  { id:'pvp-hub', x:0, y:2.0, z:57, width:9, height:0.6, depth:9,
    color:'#3a1414', glowColor:'#ffb020', type:'platform', arena:true },

  // Corner sniper decks — one stair step + one deck each, mirrored
  // across all four corners of the (much wider) arena for symmetric
  // competitive play.
  { id:'pvp-nw-step', x:-16, y:1.2, z:35, width:3.2, height:1.2, depth:3.2,
    color:'#1a1030', glowColor:'#3aa0ff', type:'platform', arena:true },
  { id:'pvp-nw-deck', x:-16, y:2.6, z:30, width:5, height:0.5, depth:5,
    color:'#1a1030', glowColor:'#3aa0ff', type:'platform', arena:true },

  { id:'pvp-ne-step', x:16, y:1.2, z:35, width:3.2, height:1.2, depth:3.2,
    color:'#1a1030', glowColor:'#39ff6a', type:'platform', arena:true },
  { id:'pvp-ne-deck', x:16, y:2.6, z:30, width:5, height:0.5, depth:5,
    color:'#1a1030', glowColor:'#39ff6a', type:'platform', arena:true },

  { id:'pvp-sw-step', x:-16, y:1.2, z:79, width:3.2, height:1.2, depth:3.2,
    color:'#1a1030', glowColor:'#c23bff', type:'platform', arena:true },
  { id:'pvp-sw-deck', x:-16, y:2.6, z:84, width:5, height:0.5, depth:5,
    color:'#1a1030', glowColor:'#c23bff', type:'platform', arena:true },

  { id:'pvp-se-step', x:16, y:1.2, z:79, width:3.2, height:1.2, depth:3.2,
    color:'#1a1030', glowColor:'#ffcc33', type:'platform', arena:true },
  { id:'pvp-se-deck', x:16, y:2.6, z:84, width:5, height:0.5, depth:5,
    color:'#1a1030', glowColor:'#ffcc33', type:'platform', arena:true },

  // Mid-field cover blocks — two heights (short crouch-cover and tall
  // line-of-sight blockers) spread across three rows so the much bigger
  // floor doesn't leave one long empty sightline from gate to back wall.
  { id:'pvp-cover-1', x:-8,  y:1.6, z:42, width:2.2, height:1.6, depth:2.2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-2', x:8,   y:1.6, z:42, width:2.2, height:1.6, depth:2.2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-3', x:-11, y:1.2, z:57, width:2.6, height:1.2, depth:2.6,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-4', x:11,  y:1.2, z:57, width:2.6, height:1.2, depth:2.6,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-5', x:-8,  y:1.6, z:72, width:2.2, height:1.6, depth:2.2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-6', x:8,   y:1.6, z:72, width:2.2, height:1.6, depth:2.2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
];

// ── Map 4 hazards — "Wraith Passage" spike patrols ──────────────────
// Floating crystal spikes seeded through the new Map 4 gauntlet (see
// m4-move*/m4-blink* above). Each one respawns the player on contact —
// exactly like falling off the course — so they're a genuine "avoid
// this" threat, not just another platform. Most patrol on `move` so
// standing still and waiting isn't a safe strategy either. See
// buildHazardMeshes in GameRenderer3D.tsx for how these render (a
// small spinning thorn-cluster with a danger-red glow).
export const HAZARDS: Hazard3D[] = [
  // Bobs vertically in the gap right after the first moving platform —
  // times its low point to threaten the jump onto m4-blink1.
  { id:'h1', x:0,    y:46.6, z:-457.2, radius:0.55, move:{ axis:'y', range:0.8, speed:2.0 } },
  // Sweeps side-to-side across the middle of the passage, between the
  // two blinking shards.
  { id:'h2', x:0,    y:49.6, z:-470.8, radius:0.55, move:{ axis:'x', range:1.3, speed:1.8, phase:1.5 } },
  // Sits beside m4-p16's approach — stationary, but placed to punish a
  // sloppy line rather than a slow one.
  { id:'h3', x:-0.6, y:49.4, z:-484.6, radius:0.5 },
  // Vertical patrol guarding the entrance to bridge #2.
  { id:'h4', x:0,    y:52.0, z:-498.0, radius:0.55, move:{ axis:'y', range:1.0, speed:2.2, phase:0.7 } },
  // Slow horizontal sweep along bridge #2 itself — the bridge is long
  // enough that standing still waiting it out isn't an option.
  { id:'h5', x:0,    y:53.4, z:-504.5, radius:0.5, move:{ axis:'x', range:1.4, speed:1.1 } },
];

// ── Physics-hot-path lookup structures ───────────────────────────────
// Computed once at module load — the physics step below runs every
// frame the player is grounded (i.e. almost always), so it must never
// re-derive these from PLATFORMS by scanning/filtering on the fly.
//
// O(1) lookup by id, used for the moving-platform "carry" check — was a
// PLATFORMS.find() (a full linear scan) running on every single grounded
// physics step, not just while standing on a mover. With Map 4 having
// grown PLATFORMS by ~35 entries, that scan was real, avoidable, global
// per-frame cost, unrelated to which chunk is currently rendered.
const PLATFORM_BY_ID: Map<string, Platform3D> = new Map(PLATFORMS.map(p => [p.id, p]));

// Split once so the collision loop can use a plain property read for the
// ~90% of platforms that never move or blink, instead of paying a
// function-call (getPlatformPosition/isPlatformSolid) for every single
// platform on every step regardless of whether it actually needs the
// time-based check.
const STATIC_PLATFORMS: Platform3D[] = PLATFORMS.filter(p => !p.move && !p.blink);
const DYNAMIC_PLATFORMS: Platform3D[] = PLATFORMS.filter(p => p.move || p.blink);

// ── PvP Arena — decorative structures (no collision) ────────
// Pure set-dressing rendered once and never touched by physics: corner
// towers, perimeter energy walls + light pillars, an entrance gate, and
// hanging banners. This is what turns the arena from "a floor with boxes
// on it" into a real-looking coliseum silhouette when viewed from a
// distance — see buildArenaDecor() in GameRenderer3D.tsx for the actual
// meshes built from this data.
export interface ArenaPillar { x: number; z: number; height: number; radius: number }
export const PVP_PILLARS: ArenaPillar[] = [
  // Four corner towers, taller now to match the bigger arena footprint.
  { x: -20.6, z: 26.5, height: 12, radius: 0.65 },
  { x: 20.6,  z: 26.5, height: 12, radius: 0.65 },
  { x: -20.6, z: 87.5, height: 12, radius: 0.65 },
  { x: 20.6,  z: 87.5, height: 12, radius: 0.65 },
  // Mid-wall towers on both long sides, breaking up what would otherwise
  // be a bare 62-unit wall with nothing on it.
  { x: -20.6, z: 57, height: 10, radius: 0.55 },
  { x: 20.6,  z: 57, height: 10, radius: 0.55 },
  // Entrance gate pillars, framing the walkway → arena transition
  { x: -4, z: 25.2, height: 8, radius: 0.4 },
  { x: 4,  z: 25.2, height: 8, radius: 0.4 },
];

export interface ArenaWallSegment { x: number; z: number; width: number; depth: number; height: number }
export const PVP_WALL_SEGMENTS: ArenaWallSegment[] = [
  // Long perimeter walls, split into three segments per side for rhythm
  // across the wider arena (small gaps between segments read as "seams"
  // in the structure rather than one flat monotonous slab).
  { x: -20.8, z: 33, width: 0.6, depth: 15, height: 3.6 },
  { x: -20.8, z: 57, width: 0.6, depth: 15, height: 3.6 },
  { x: -20.8, z: 81, width: 0.6, depth: 15, height: 3.6 },
  { x: 20.8,  z: 33, width: 0.6, depth: 15, height: 3.6 },
  { x: 20.8,  z: 57, width: 0.6, depth: 15, height: 3.6 },
  { x: 20.8,  z: 81, width: 0.6, depth: 15, height: 3.6 },
  // Back wall, split with a center gap for a skyline silhouette
  { x: -11, z: 88.8, width: 18, depth: 0.6, height: 4.2 },
  { x: 11,  z: 88.8, width: 18, depth: 0.6, height: 4.2 },
];

// Hanging team-color banners near the gate and each corner tower — cheap
// (one draw call, flat planes) but they do a lot to make the arena read
// as a designed space instead of a floor with boxes scattered on it.
export interface ArenaBanner { x: number; z: number; height: number; color: string }
export const PVP_BANNERS: ArenaBanner[] = [
  { x: -4, z: 25.0, height: 6.5, color: '#ffb020' },
  { x: 4,  z: 25.0, height: 6.5, color: '#ffb020' },
  { x: -20.4, z: 26.7, height: 9.5, color: '#3aa0ff' },
  { x: 20.4,  z: 26.7, height: 9.5, color: '#39ff6a' },
  { x: -20.4, z: 87.3, height: 9.5, color: '#c23bff' },
  { x: 20.4,  z: 87.3, height: 9.5, color: '#ffcc33' },
];

// Distance (|z|) of the finish line from the start — used by the HUD to
// compute the progress-bar percentage. Keep this in sync with PLATFORMS.
// Matches the finish platform's z (see 'finish' in PLATFORMS below) — now
// at the end of Map 4, not Map 1, since finishing an earlier map no
// longer ends the run. Used only for the progress-percentage HUD bar.
// Updated for the longer "Wraith Passage" Map 4 extension (moving +
// blinking platforms and spike hazards) — the finish moved from
// z:-463.2 to z:-534.0.
export const FINISH_DISTANCE = 534.0;

// Respawn points for the 4-map course — index i is where the player
// reappears after falling anywhere in Map (i+1). stepPhysics3D advances
// state.checkpointIndex as the player passes each gate below, and always
// respawns at CHECKPOINTS[state.checkpointIndex] rather than hardcoding
// Map 1's origin, so dying in Map 2, 3, or 4 sends you back to that
// map's own start, not all the way back to the very beginning.
export interface Checkpoint { x: number; y: number; z: number }
export const CHECKPOINTS: Checkpoint[] = [
  { x: 0, y: 0.5,  z: 0 },        // Map 1 start
  { x: 0, y: 13.5, z: -126 },     // Map 2 start (m2-start pad)
  { x: 0, y: 24.9, z: -233.81 },  // Map 3 start (m3-start pad)
  { x: 0, y: 37.8, z: -345 },     // Map 4 start (m4-start pad)
];

// ── Physics Step ───────────────────────────────────────────
// `t` is the current time in seconds, used to evaluate moving/blinking
// obstacles (m4-move*/m4-blink* in PLATFORMS, and HAZARDS). It's
// optional and defaults to real time — existing callers that don't pass
// it keep working exactly as before; nothing here changes unless the
// map actually contains a `move`/`blink` platform or a hazard.
export function stepPhysics3D(
  state: PhysState3D,
  input: Input3D,
  t: number = Date.now() / 1000,
): PhysState3D {
  if (state.finished) return state;

  let { x, y, z, vx, vy, vz, onGround, facingAngle } = state;

  // If the player was standing on a moving platform last step, carry
  // them along with however far it travelled since then, before any of
  // this step's own movement is applied. `platformT` is the `t` of the
  // step that last set `standingPlatformId`, so the delta below is
  // exactly this platform's motion over the elapsed time — clamped so a
  // long gap between steps (e.g. a paused game) can't fling the player.
  if (onGround && state.standingPlatformId) {
    const standingOn = PLATFORM_BY_ID.get(state.standingPlatformId);
    if (standingOn && standingOn.move) {
      const prevT = state.platformT ?? t;
      const dt = Math.max(0, Math.min(0.25, t - prevT));
      const prevPos = getPlatformPosition(standingOn, t - dt);
      const currPos = getPlatformPosition(standingOn, t);
      x += currPos.x - prevPos.x;
      y += currPos.y - prevPos.y;
      z += currPos.z - prevPos.z;
    }
  }

  // Horizontal intent — analog joystick vector (already rotated to world
  // space by the caller, camera-relative) takes priority when present;
  // otherwise fall back to the legacy boolean D-pad directions, which are
  // still fully supported for anyone using GameControls' old props.
  let dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dirZ = (input.forward ? -1 : 0) + (input.backward ? 1 : 0);
  let magnitude = 1; // booleans are always a full push
  const analogLen = Math.sqrt((input.moveX ?? 0) ** 2 + (input.moveZ ?? 0) ** 2);
  if (analogLen > 0.08) {
    dirX = input.moveX!;
    dirZ = input.moveZ!;
    magnitude = Math.min(1, analogLen);
  }
  const len = Math.sqrt(dirX * dirX + dirZ * dirZ);
  const nx = len > 0 ? dirX / len : 0;
  const nz = len > 0 ? dirZ / len : 0;

  vx = nx * MOVE_SPEED * magnitude;
  vz = nz * MOVE_SPEED * magnitude;
  if (len > 0) facingAngle = Math.atan2(nx, nz);

  // Jump
  if (input.jump && onGround) {
    vy = JUMP_VELOCITY;
    onGround = false;
  }

  // Gravity
  if (!onGround) {
    vy = Math.max(vy - GRAVITY, -MAX_FALL_SPEED);
  }

  // World X bounds — a safety wall stopping the player from drifting
  // infinitely sideways off the (narrow, ~5-unit-wide) parkour course.
  //
  // IMPORTANT: this must stay wide enough to cover the PvP arena too
  // (PVP_ARENA_BOUNDS, currently X: -20..20) — the arena's corner decks
  // sit at X=±16, so clamping tighter than that silently walls them off
  // completely, with no visual indication anything is blocking you. This
  // used to be ±13, a leftover from when the arena was only 24 units
  // wide; it's now wide enough for both the parkour course and the full
  // current arena width, with a small margin.
  const newX = Math.max(-22, Math.min(22, x + vx));
  const newY = y + vy;
  const newZ = z + vz;

  // Checkpoint progress — advance (never regress) as the player passes
  // each gate's z. A small +3 margin means you have to actually be at
  // or past the gate, not just technically closer in z while still
  // mid-jump toward it from the previous map.
  let checkpointIndex = state.checkpointIndex ?? 0;
  while (
    checkpointIndex + 1 < CHECKPOINTS.length &&
    newZ <= CHECKPOINTS[checkpointIndex + 1].z + 3
  ) {
    checkpointIndex++;
  }

  // Respawn if fallen — at the current map's own checkpoint, not always
  // back at Map 1's origin.
  if (newY < DEATH_Y) {
    const cp = CHECKPOINTS[checkpointIndex];
    return {
      x: cp.x, y: cp.y, z: cp.z,
      vx: 0, vy: 0, vz: 0, onGround: false, facingAngle: 0,
      finished: false, checkpointIndex,
    };
  }

  // Hazard collision — floating crystal spikes (Map 4's "Wraith
  // Passage") are lethal on contact: touching one respawns the player
  // exactly like falling off the course, even if they're still mid-air
  // above a platform. Checked before platform collision since a hazard
  // should kill even if you'd otherwise have landed safely.
  for (const h of HAZARDS) {
    const hp = getHazardPosition(h, t);
    const dx = newX - hp.x;
    const dy = newY + PLAYER_HEIGHT / 2 - hp.y;
    const dz = newZ - hp.z;
    const hitDist = h.radius + PLAYER_RADIUS;
    if (dx * dx + dy * dy + dz * dz < hitDist * hitDist) {
      const cp = CHECKPOINTS[checkpointIndex];
      return {
        x: cp.x, y: cp.y, z: cp.z,
        vx: 0, vy: 0, vz: 0, onGround: false, facingAngle: 0,
        finished: false, checkpointIndex,
      };
    }
  }

  // Platform collision (feet land on top). Split into two passes:
  // STATIC_PLATFORMS (the vast majority) use a plain property read —
  // exactly as fast as before Map 4 ever had moving/blinking platforms.
  // Only DYNAMIC_PLATFORMS (m4-move*/m4-blink*, a handful) pay for the
  // time-based getPlatformPosition/isPlatformSolid calls, since those
  // are the only ones that actually need them.
  for (const p of STATIC_PLATFORMS) {
    const halfW = p.width / 2 + PLAYER_RADIUS - 0.05;
    const halfD = p.depth / 2 + PLAYER_RADIUS - 0.05;

    if (
      Math.abs(newX - p.x) < halfW &&
      Math.abs(newZ - p.z) < halfD &&
      vy <= 0 &&
      y >= p.y - 0.12 &&
      newY <= p.y
    ) {
      const finished = p.type === 'finish';
      return {
        x: newX, y: p.y, z: newZ,
        vx, vy: 0, vz,
        onGround: true, facingAngle,
        finished, checkpointIndex,
        standingPlatformId: p.id, platformT: t,
      };
    }
  }

  for (const p of DYNAMIC_PLATFORMS) {
    if (!isPlatformSolid(p, t)) continue;
    const pos = getPlatformPosition(p, t);
    const halfW = p.width / 2 + PLAYER_RADIUS - 0.05;
    const halfD = p.depth / 2 + PLAYER_RADIUS - 0.05;

    if (
      Math.abs(newX - pos.x) < halfW &&
      Math.abs(newZ - pos.z) < halfD &&
      vy <= 0 &&
      y >= pos.y - 0.12 &&
      newY <= pos.y
    ) {
      const finished = p.type === 'finish';
      return {
        x: newX, y: pos.y, z: newZ,
        vx, vy: 0, vz,
        onGround: true, facingAngle,
        finished, checkpointIndex,
        standingPlatformId: p.id, platformT: t,
      };
    }
  }

  return {
    x: newX, y: newY, z: newZ, vx, vy, vz, onGround: false, facingAngle,
    finished: false, checkpointIndex, standingPlatformId: undefined, platformT: t,
  };
}
