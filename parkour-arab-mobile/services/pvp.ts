// ────────────────────────────────────────────────────────
// PvP networking — thin wrappers around Firebase Realtime DB.
//
// Trust model: each client owns and reports its own health. When you
// attack, your client computes who's in range and pushes a "hit" event
// directly to the target's inbox; the target's own client applies the
// damage to itself. This is standard for a casual peer-to-peer game —
// there's no server authority, so a modified client could in theory
// under-report damage taken, but it keeps the whole feature achievable
// without a dedicated game server.
// ────────────────────────────────────────────────────────
import { db, ref, set, get, onValue, remove, off, push } from '@/services/firebase';
import { PVP_WEAPON_SPAWNS, WEAPON_RESPAWN_MS } from './game3DPhysics';

export interface HitEvent {
  attackerId: string;
  damage: number;
  ts: number;
}

// Listens for incoming hits addressed to `playerId`. Each hit is removed
// immediately after being delivered so it's only ever applied once.
// Returns an unsubscribe function.
export function listenForHits(
  playerId: string,
  onHit: (damage: number, attackerId: string) => void,
): () => void {
  const hitsRef = ref(db, `game3d/pvpHits/${playerId}`);
  onValue(hitsRef, (snap) => {
    const data = snap.val() as Record<string, HitEvent> | null;
    if (!data) return;
    for (const [hitId, hit] of Object.entries(data)) {
      onHit(hit.damage, hit.attackerId);
      remove(ref(db, `game3d/pvpHits/${playerId}/${hitId}`)).catch(() => {});
    }
  });
  return () => off(hitsRef);
}

export function sendHit(targetId: string, attackerId: string, damage: number) {
  const hitRef = push(ref(db, `game3d/pvpHits/${targetId}`));
  set(hitRef, { attackerId, damage, ts: Date.now() } as HitEvent).catch(() => {});
}

// Attempts to claim a weapon pickup. Returns true if it was available
// (i.e. never taken, or its respawn cooldown has elapsed) and the claim
// succeeded. Small race window between two players grabbing the same
// crate at the same instant is possible but rare and low-stakes here.
export async function tryPickupWeapon(weaponId: string): Promise<boolean> {
  try {
    const weaponRef = ref(db, `game3d/pvpWeapons/${weaponId}`);
    const snap = await get(weaponRef);
    const takenAt = (snap.val()?.takenAt as number) ?? 0;
    if (Date.now() - takenAt < WEAPON_RESPAWN_MS) return false;
    await set(weaponRef, { takenAt: Date.now() });
    return true;
  } catch {
    return false;
  }
}

// Live map of weaponId -> takenAt timestamp (0 = never taken / available).
// Used to render crates as gone while on cooldown.
export function listenWeaponStates(
  onChange: (takenAtById: Record<string, number>) => void,
): () => void {
  const weaponsRef = ref(db, 'game3d/pvpWeapons');
  onValue(weaponsRef, (snap) => {
    const data = snap.val() as Record<string, { takenAt: number }> | null;
    const states: Record<string, number> = {};
    for (const spawn of PVP_WEAPON_SPAWNS) {
      states[spawn.id] = data?.[spawn.id]?.takenAt ?? 0;
    }
    onChange(states);
  });
  return () => off(weaponsRef);
}
