// ────────────────────────────────────────────────────────
// PvP combat state — health, held weapon, attacking, and picking up
// weapon crates. Lives outside PlayerContext because it's specific to
// the arena and needs the local physics position every frame, which the
// game screen already owns.
// ────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WeaponType,
  WEAPON_DEFS,
  PVP_WEAPON_SPAWNS,
  PVP_MAX_HEALTH,
  MELEE_DAMAGE,
  MELEE_RANGE,
  ATTACK_ARC,
  ATTACK_COOLDOWN_MS,
  WEAPON_PICKUP_RADIUS,
  isInPvPArena,
} from '@/services/game3DPhysics';
import { listenForHits, sendHit, tryPickupWeapon, listenWeaponStates } from '@/services/pvp';
import { RemotePlayer3D } from '@/components/GameRenderer3D';

export interface PvPState {
  health: number;
  maxHealth: number;
  inArena: boolean;
  currentWeapon: WeaponType | null;
  weaponTakenAt: Record<string, number>; // weaponId -> last-taken timestamp, for crate visibility
  nearestWeaponId: string | null;         // in pickup range right now, if any
  justDied: boolean;                       // one-frame flag the screen can use for feedback
  lastDamageAt: number;                    // Date.now() of the most recent hit taken, for hit-flash feedback
}

export function usePvP(playerId: string) {
  const [health, setHealth] = useState(PVP_MAX_HEALTH);
  const [inArena, setInArena] = useState(false);
  const [currentWeapon, setCurrentWeapon] = useState<WeaponType | null>(null);
  const [weaponTakenAt, setWeaponTakenAt] = useState<Record<string, number>>({});
  const [nearestWeaponId, setNearestWeaponId] = useState<string | null>(null);
  const [lastDamageAt, setLastDamageAt] = useState(0);

  const healthRef = useRef(health);
  healthRef.current = health;
  const lastAttackRef = useRef(0);
  const wasInArenaRef = useRef(false);
  const respawnRequestRef = useRef<{ x: number; y: number; z: number } | null>(null);

  // Incoming damage
  useEffect(() => {
    if (!playerId) return;
    const unsub = listenForHits(playerId, (damage) => {
      setHealth((h) => Math.max(0, h - damage));
      setLastDamageAt(Date.now());
    });
    return unsub;
  }, [playerId]);

  // Live weapon-crate availability (for rendering + pickup checks)
  useEffect(() => {
    const unsub = listenWeaponStates(setWeaponTakenAt);
    return unsub;
  }, []);

  // Death -> respawn with full health at the arena spawn point
  useEffect(() => {
    if (health <= 0) {
      respawnRequestRef.current = { x: 0, y: 0.5, z: 33 };
      setHealth(PVP_MAX_HEALTH);
      setCurrentWeapon(null);
    }
  }, [health]);

  // Called every physics tick by the game screen with the local player's
  // current position — drives arena enter/leave and nearest-weapon checks.
  const updatePosition = useCallback((x: number, z: number) => {
    const nowInArena = isInPvPArena(x, z);
    if (nowInArena !== wasInArenaRef.current) {
      wasInArenaRef.current = nowInArena;
      setInArena(nowInArena);
      if (nowInArena) {
        // Fresh fight — reset to full health on entry.
        setHealth(PVP_MAX_HEALTH);
      } else {
        setCurrentWeapon(null);
      }
    }
    if (nowInArena) {
      let closest: string | null = null;
      let closestDist = WEAPON_PICKUP_RADIUS;
      for (const w of PVP_WEAPON_SPAWNS) {
        const dx = w.x - x;
        const dz = w.z - z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < closestDist) { closest = w.id; closestDist = dist; }
      }
      setNearestWeaponId(closest);
    } else if (nearestWeaponId) {
      setNearestWeaponId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Consumes a pending respawn request (game screen calls this each
  // frame; non-null exactly once right after death).
  const consumeRespawn = useCallback(() => {
    const r = respawnRequestRef.current;
    respawnRequestRef.current = null;
    return r;
  }, []);

  const pickupNearestWeapon = useCallback(async () => {
    if (!nearestWeaponId) return;
    const spawn = PVP_WEAPON_SPAWNS.find((w) => w.id === nearestWeaponId);
    if (!spawn) return;
    const claimed = await tryPickupWeapon(nearestWeaponId);
    if (claimed) setCurrentWeapon(spawn.type);
  }, [nearestWeaponId]);

  // Attacks whoever's in range/arc in front of the local player. Melee if
  // unarmed, otherwise the held weapon's stats. Damage is delivered by
  // writing directly to each target's hit inbox (see services/pvp.ts).
  const attack = useCallback(
    (x: number, z: number, facingAngle: number, remotes: RemotePlayer3D[]) => {
      if (!inArena) return false;
      const now = Date.now();
      if (now - lastAttackRef.current < ATTACK_COOLDOWN_MS) return false;
      lastAttackRef.current = now;

      const def = currentWeapon ? WEAPON_DEFS[currentWeapon] : null;
      const range = def ? def.range : MELEE_RANGE;
      const damage = def ? def.damage : MELEE_DAMAGE;

      for (const rp of remotes) {
        const dx = rp.x - x;
        const dz = rp.z - z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist > range) continue;
        // Angle between where we're facing and the direction to the target
        const toTarget = Math.atan2(dx, dz);
        let diff = Math.abs(toTarget - facingAngle);
        if (diff > Math.PI) diff = Math.PI * 2 - diff;
        if (diff > ATTACK_ARC / 2) continue;
        sendHit(rp.id, playerId, damage);
      }
      return true;
    },
    [inArena, currentWeapon, playerId],
  );

  // Precision shot at a specific, explicitly-locked target (see the aim/
  // target-lock system in game.tsx) — only a range check applies, no
  // facing-arc requirement, since the player deliberately aimed the
  // camera at this exact opponent through the zoom/lock UI rather than
  // relying on a "swing and hope something's in the cone" attack.
  const attackTarget = useCallback(
    (targetId: string, x: number, z: number, remotes: RemotePlayer3D[]) => {
      if (!inArena) return false;
      const now = Date.now();
      if (now - lastAttackRef.current < ATTACK_COOLDOWN_MS) return false;

      const target = remotes.find((r) => r.id === targetId);
      if (!target) return false;

      const def = currentWeapon ? WEAPON_DEFS[currentWeapon] : null;
      const range = def ? def.range : MELEE_RANGE;
      const damage = def ? def.damage : MELEE_DAMAGE;

      const dx = target.x - x;
      const dz = target.z - z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > range) return false;

      lastAttackRef.current = now;
      sendHit(target.id, playerId, damage);
      return true;
    },
    [inArena, currentWeapon, playerId],
  );

  const state: PvPState = {
    health,
    maxHealth: PVP_MAX_HEALTH,
    inArena,
    currentWeapon,
    weaponTakenAt,
    nearestWeaponId,
    justDied: false,
    lastDamageAt,
  };

  return { ...state, updatePosition, attack, attackTarget, pickupNearestWeapon, consumeRespawn };
}
