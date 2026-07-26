// ────────────────────────────────────────────────────────────────────────────
// Circular radar-style minimap — shows the local player (center, as a
// direction arrow) and every remote player currently in the room as
// colored dots, positioned relative to the local player and updated live
// as everyone moves.
//
// Reads physStateRef / remotePlayersRef on a plain interval (NOT on every
// 3D animation frame) — the minimap doesn't need 60fps precision, and
// polling independently keeps this fully decoupled from GameRenderer3D's
// render loop, so it can't affect 3D performance.
// ────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PhysState3D } from '@/services/game3DPhysics';
import type { RemotePlayer3D } from '@/components/GameRenderer3D';

interface Props {
  physStateRef: React.MutableRefObject<PhysState3D>;
  remotePlayersRef: React.MutableRefObject<RemotePlayer3D[]>;
  playerColor: string;
}

const MAP_SIZE = 116; // outer circle diameter, px
const MAP_RADIUS = MAP_SIZE / 2;
const DOT_SIZE = 9;
const WORLD_RADIUS = 26; // world units shown from center to edge of the circle
const PIXELS_PER_UNIT = (MAP_RADIUS - DOT_SIZE) / WORLD_RADIUS;

interface Snapshot {
  facingAngle: number;
  remotes: { id: string; dx: number; dz: number; color: string }[];
}

export function MiniMap({ physStateRef, remotePlayersRef, playerColor }: Props) {
  const [snap, setSnap] = useState<Snapshot>({ facingAngle: 0, remotes: [] });

  useEffect(() => {
    const interval = setInterval(() => {
      const s = physStateRef.current;
      const remotes = remotePlayersRef.current.map((rp) => ({
        id: rp.id,
        dx: rp.x - s.x,
        dz: rp.z - s.z,
        color: rp.color,
      }));
      setSnap({ facingAngle: s.facingAngle, remotes });
    }, 150);
    return () => clearInterval(interval);
  }, [physStateRef, remotePlayersRef]);

  // Local player arrow: forward (facingAngle = π) should point "up" on the
  // map — see the note in GameRenderer3D.tsx about this same convention.
  const arrowDeg = 180 - (snap.facingAngle * 180) / Math.PI;

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.circle}>
        {/* Faint range rings, purely decorative */}
        {[0.66, 0.33].map((frac) => {
          const size = MAP_SIZE * frac;
          return (
            <View
              key={frac}
              style={[
                styles.ring,
                {
                  width: size,
                  height: size,
                  borderRadius: size / 2,
                  left: MAP_RADIUS - size / 2,
                  top: MAP_RADIUS - size / 2,
                },
              ]}
            />
          );
        })}

        {/* Remote players */}
        {snap.remotes.map((r) => {
          const dist = Math.sqrt(r.dx * r.dx + r.dz * r.dz);
          const clampedDist = Math.min(dist, WORLD_RADIUS);
          const scale = dist > 0 ? clampedDist / dist : 0;
          const px = r.dx * scale * PIXELS_PER_UNIT;
          const py = r.dz * scale * PIXELS_PER_UNIT;
          return (
            <View
              key={r.id}
              style={[
                styles.dot,
                {
                  backgroundColor: r.color,
                  left: MAP_RADIUS + px - DOT_SIZE / 2,
                  top: MAP_RADIUS + py - DOT_SIZE / 2,
                  opacity: dist > WORLD_RADIUS ? 0.55 : 1,
                },
              ]}
            />
          );
        })}

        {/* Local player — direction arrow, always centered */}
        <View
          style={[
            styles.arrowWrap,
            { left: MAP_RADIUS - 8, top: MAP_RADIUS - 8, transform: [{ rotate: `${arrowDeg}deg` }] },
          ]}
        >
          <View style={[styles.arrow, { borderBottomColor: playerColor }]} />
        </View>
      </View>
      <Text style={styles.label}>الخريطة</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  circle: {
    width: MAP_SIZE,
    height: MAP_SIZE,
    borderRadius: MAP_RADIUS,
    backgroundColor: 'rgba(6,6,20,0.72)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,204,0.4)',
    overflow: 'hidden',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(0,255,204,0.12)',
  },
  dot: {
    position: 'absolute',
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  arrowWrap: {
    position: 'absolute',
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderBottomWidth: 11,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  label: {
    marginTop: 3,
    fontSize: 9,
    color: 'rgba(0,255,204,0.65)',
  },
});
