// ────────────────────────────────────────────────────────────────────────────
// Virtual Joystick — camera-relative movement stick
//
// Replaces the old 4-button D-pad (forward/back/left/right), which forced
// the player to hold a "backward" button just to walk toward anything
// behind them (like the PvP arena) — awkward and not how any real 3D game
// controls. This is a single drag-anywhere-on-the-base stick: push it in
// any direction and the character walks that way *relative to where the
// camera is currently looking* (rotation math lives in game.tsx, since it
// needs the live camera yaw every physics tick, not just when the stick
// moves). Combined with the existing look-drag camera, this gives the
// standard modern-game feel: drag to look around, push the stick to walk
// wherever you're facing — including straight into the arena without ever
// touching a "back" button.
// ────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';

const BASE_SIZE = 116;
const KNOB_SIZE = 54;
const MAX_RADIUS = (BASE_SIZE - KNOB_SIZE) / 2 + 6; // a little extra travel feels less stiff

interface Props {
  // Called continuously while dragging with normalized push values in
  // -1..1: `right` is sideways push (screen-relative), `forward` is
  // up/down push (up = positive). Called with (0, 0) on release.
  onMove: (right: number, forward: number) => void;
}

export function VirtualJoystick({ onMove }: Props) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onStart(() => setActive(true))
        .onChange((e) => {
          let dx = e.translationX;
          let dy = e.translationY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > MAX_RADIUS) {
            const scale = MAX_RADIUS / dist;
            dx *= scale;
            dy *= scale;
          }
          setKnob({ x: dx, y: dy });
          onMove(dx / MAX_RADIUS, -dy / MAX_RADIUS);
        })
        .onEnd(() => {
          setActive(false);
          setKnob({ x: 0, y: 0 });
          onMove(0, 0);
        })
        .onFinalize(() => {
          setActive(false);
          setKnob({ x: 0, y: 0 });
          onMove(0, 0);
        })
        .runOnJS(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMove],
  );

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.base} hitSlop={20}>
        <View style={[styles.ring, active && styles.ringActive]} />
        <View
          style={[
            styles.knob,
            active && styles.knobActive,
            { transform: [{ translateX: knob.x }, { translateY: knob.y }] },
          ]}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  base: {
    width: BASE_SIZE,
    height: BASE_SIZE,
    borderRadius: BASE_SIZE / 2,
    backgroundColor: 'rgba(0,255,204,0.06)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,204,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: BASE_SIZE - 12,
    height: BASE_SIZE - 12,
    borderRadius: (BASE_SIZE - 12) / 2,
    borderWidth: 1,
    borderColor: 'rgba(0,255,204,0.15)',
  },
  ringActive: {
    borderColor: 'rgba(0,255,204,0.4)',
  },
  knob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: 'rgba(0,255,204,0.18)',
    borderWidth: 2,
    borderColor: 'rgba(0,255,204,0.55)',
  },
  knobActive: {
    backgroundColor: 'rgba(0,255,204,0.35)',
    borderColor: '#00ffcc',
  },
});
