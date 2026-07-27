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
  { id: 'w1', type: 'sword',   x: 0,  y: 0.5, z: 38 },
  { id: 'w2', type: 'blaster', x: 0,  y: 0.5, z: 48 },
  { id: 'w3', type: 'bow',     x: -9, y: 2.9, z: 30 },
  { id: 'w4', type: 'hammer',  x: 9,  y: 2.9, z: 30 },
  { id: 'w5', type: 'staff',   x: 9,  y: 2.9, z: 56 },
  { id: 'w6', type: 'sword',   x: -9, y: 2.9, z: 56 },
  { id: 'w7', type: 'railgun', x: 0,  y: 2.3, z: 43 },
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
export const PVP_ARENA_BOUNDS = { minX: -12, maxX: 12, minZ: 26, maxZ: 60 };
export function isInPvPArena(x: number, z: number): boolean {
  return (
    x >= PVP_ARENA_BOUNDS.minX && x <= PVP_ARENA_BOUNDS.maxX &&
    z >= PVP_ARENA_BOUNDS.minZ && z <= PVP_ARENA_BOUNDS.maxZ
  );
}
// Where a player respawns after their health hits 0 in the arena.
export const PVP_SPAWN = { x: 0, y: 0.5, z: 33 };

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
}

export interface Input3D {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  jump: boolean;
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

  // Finish
  { id:'finish', x:0, y:13.0, z:-119.25, width:6, height:0.6, depth:6,
    color:'#5a4000', glowColor:'#ffd700', type:'finish' },

  // ── PvP Arena — "Crimson Coliseum" ──────────────────────
  // Positioned behind spawn (+Z), opposite the parkour course (-Z) —
  // walk backward from the start platform to reach it. Built as a
  // continuous ground floor (so nothing here is a death-fall — you just
  // land back on the arena floor) with four elevated corner sniper decks
  // reached by a single stair step each, a central raised hub platform
  // holding the legendary weapon, and low cover blocks scattered across
  // the mid-field for tactical melee engagements. Combat/weapons/health
  // are only active inside PVP_ARENA_BOUNDS below (the z:26–60 portion).
  { id:'pvp-walkway', x:0, y:0, z:16, width:8, height:0.5, depth:20,
    color:'#0d1830', glowColor:'#3366cc', type:'ground' },
  { id:'pvp-ground', x:0, y:0, z:43, width:26, height:0.5, depth:34,
    color:'#241012', glowColor:'#ff3333', type:'ground', arena:true },

  // Central hub — the contested "king of the hill" objective, holds the
  // legendary railgun (w7 above). Single step up from the open floor.
  { id:'pvp-hub-step', x:0, y:0.9, z:37.5, width:3.2, height:0.9, depth:3.2,
    color:'#3a1414', glowColor:'#ff7a3a', type:'platform', arena:true },
  { id:'pvp-hub', x:0, y:1.8, z:43, width:6.5, height:0.5, depth:6.5,
    color:'#3a1414', glowColor:'#ffb020', type:'platform', arena:true },

  // Corner sniper decks — one stair step + one deck each, mirrored
  // across all four corners of the arena for symmetric competitive play.
  { id:'pvp-nw-step', x:-9, y:1.2, z:33.5, width:2.8, height:1.2, depth:2.8,
    color:'#1a1030', glowColor:'#3aa0ff', type:'platform', arena:true },
  { id:'pvp-nw-deck', x:-9, y:2.4, z:29.5, width:4.2, height:0.5, depth:4.2,
    color:'#1a1030', glowColor:'#3aa0ff', type:'platform', arena:true },

  { id:'pvp-ne-step', x:9, y:1.2, z:33.5, width:2.8, height:1.2, depth:2.8,
    color:'#1a1030', glowColor:'#39ff6a', type:'platform', arena:true },
  { id:'pvp-ne-deck', x:9, y:2.4, z:29.5, width:4.2, height:0.5, depth:4.2,
    color:'#1a1030', glowColor:'#39ff6a', type:'platform', arena:true },

  { id:'pvp-sw-step', x:-9, y:1.2, z:52.5, width:2.8, height:1.2, depth:2.8,
    color:'#1a1030', glowColor:'#c23bff', type:'platform', arena:true },
  { id:'pvp-sw-deck', x:-9, y:2.4, z:56.5, width:4.2, height:0.5, depth:4.2,
    color:'#1a1030', glowColor:'#c23bff', type:'platform', arena:true },

  { id:'pvp-se-step', x:9, y:1.2, z:52.5, width:2.8, height:1.2, depth:2.8,
    color:'#1a1030', glowColor:'#ffcc33', type:'platform', arena:true },
  { id:'pvp-se-deck', x:9, y:2.4, z:56.5, width:4.2, height:0.5, depth:4.2,
    color:'#1a1030', glowColor:'#ffcc33', type:'platform', arena:true },

  // Mid-field cover blocks — tall enough to break line-of-sight for
  // ranged weapons and to duck behind mid-fight, jumpable for high ground.
  { id:'pvp-cover-1', x:-5, y:1.5, z:36, width:2, height:1.5, depth:2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-2', x:5,  y:1.5, z:36, width:2, height:1.5, depth:2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-3', x:-5, y:1.5, z:50, width:2, height:1.5, depth:2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
  { id:'pvp-cover-4', x:5,  y:1.5, z:50, width:2, height:1.5, depth:2,
    color:'#2a1818', glowColor:'#ff3333', type:'platform', arena:true },
];

// ── PvP Arena — decorative structures (no collision) ────────
// Pure set-dressing rendered once and never touched by physics: corner
// towers, perimeter energy walls, and an entrance gate. This is what
// turns the arena from "a floor with boxes on it" into a real-looking
// coliseum silhouette when viewed from a distance.
export interface ArenaPillar { x: number; z: number; height: number; radius: number }
export const PVP_PILLARS: ArenaPillar[] = [
  { x: -12.6, z: 26.5, height: 9,  radius: 0.55 },
  { x: 12.6,  z: 26.5, height: 9,  radius: 0.55 },
  { x: -12.6, z: 60.5, height: 9,  radius: 0.55 },
  { x: 12.6,  z: 60.5, height: 9,  radius: 0.55 },
  // Entrance gate pillars, framing the walkway → arena transition
  { x: -4, z: 25.2, height: 6.5, radius: 0.4 },
  { x: 4,  z: 25.2, height: 6.5, radius: 0.4 },
];

export interface ArenaWallSegment { x: number; z: number; width: number; depth: number; height: number }
export const PVP_WALL_SEGMENTS: ArenaWallSegment[] = [
  // Long perimeter walls, split into two segments per side for rhythm
  { x: -12.8, z: 33, width: 0.6, depth: 13, height: 3.2 },
  { x: -12.8, z: 53, width: 0.6, depth: 13, height: 3.2 },
  { x: 12.8,  z: 33, width: 0.6, depth: 13, height: 3.2 },
  { x: 12.8,  z: 53, width: 0.6, depth: 13, height: 3.2 },
  // Back wall, split with a center gap for a skyline silhouette
  { x: -6.5, z: 60.8, width: 9,  depth: 0.6, height: 3.6 },
  { x: 6.5,  z: 60.8, width: 9,  depth: 0.6, height: 3.6 },
];

// Distance (|z|) of the finish line from the start — used by the HUD to
// compute the progress-bar percentage. Keep this in sync with PLATFORMS.
export const FINISH_DISTANCE = 119.25;

// ── Physics Step ───────────────────────────────────────────
export function stepPhysics3D(
  state: PhysState3D,
  input: Input3D,
): PhysState3D {
  if (state.finished) return state;

  let { x, y, z, vx, vy, vz, onGround, facingAngle } = state;

  // Horizontal intent
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dz = (input.forward ? -1 : 0) + (input.backward ? 1 : 0);
  const len = Math.sqrt(dx * dx + dz * dz);
  const nx = len > 0 ? dx / len : 0;
  const nz = len > 0 ? dz / len : 0;

  vx = nx * MOVE_SPEED;
  vz = nz * MOVE_SPEED;
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

  const newX = Math.max(-13, Math.min(13, x + vx));
  const newY = y + vy;
  const newZ = z + vz;

  // Respawn if fallen
  if (newY < DEATH_Y) {
    return { x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, facingAngle: 0, finished: false };
  }

  // Platform collision (feet land on top)
  for (const p of PLATFORMS) {
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
        finished,
      };
    }
  }

  return { x: newX, y: newY, z: newZ, vx, vy, vz, onGround: false, facingAngle, finished: false };
}
