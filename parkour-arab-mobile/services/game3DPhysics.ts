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
export type WeaponType = 'sword' | 'hammer' | 'blaster' | 'bow' | 'staff';

export interface WeaponDef {
  name: string;
  damage: number;
  range: number;   // attack reach, in world units
  color: string;    // used for both the pickup crate glow and the held prop
  ranged: boolean;   // true = can hit from a distance; false = melee-only
}

export const WEAPON_DEFS: Record<WeaponType, WeaponDef> = {
  sword:   { name: 'سيف',        damage: 18, range: 1.8,  color: '#c8c8d8', ranged: false },
  hammer:  { name: 'مطرقة',      damage: 28, range: 1.6,  color: '#a06a35', ranged: false },
  blaster: { name: 'مسدس طاقة',  damage: 14, range: 14,   color: '#00aaff', ranged: true },
  bow:     { name: 'قوس',        damage: 16, range: 16,   color: '#33ff33', ranged: true },
  staff:   { name: 'عصا سحرية',  damage: 20, range: 12,   color: '#aa00ff', ranged: true },
};

export interface WeaponSpawn {
  id: string;
  type: WeaponType;
  x: number;
  y: number;
  z: number;
}

export const PVP_WEAPON_SPAWNS: WeaponSpawn[] = [
  { id: 'w1', type: 'sword',   x: -8, y: 0.5, z: 34 },
  { id: 'w2', type: 'blaster', x: 8,  y: 0.5, z: 34 },
  { id: 'w3', type: 'bow',     x: 0,  y: 0.5, z: 40 },
  { id: 'w4', type: 'staff',   x: -8, y: 0.5, z: 50 },
  { id: 'w5', type: 'hammer',  x: 8,  y: 0.5, z: 50 },
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

  // ── PvP Arena ──────────────────────────────────────────
  // Positioned behind spawn (+Z), opposite the parkour course (-Z) —
  // walk backward from the start platform to reach it. One flat platform
  // covers both the walkway and the arena floor for simplicity; the
  // actual PvP zone (health/combat/weapons) is the +Z half of it — see
  // PVP_ARENA_BOUNDS above.
  { id:'pvp-ground', x:0, y:0, z:33.5, width:26, height:0.5, depth:54,
    color:'#2a0d0d', glowColor:'#ff3333', type:'ground' },
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
