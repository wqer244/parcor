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
//
// ── Why the knob's position is a Reanimated shared value, not React state ──
// An earlier version of this component tracked the knob's x/y with
// useState, updated from the gesture's onChange handler. That works, but
// EVERY touch-move event had to: cross from the native gesture thread to
// the JS thread, run the React state setter, and wait for a full React
// re-render before the knob visually moved. Under normal conditions
// that's fine — but this game's JS thread is also running a 33ms physics
// tick AND (in GameRenderer3D) a Three.js WebGL render loop, both
// competing for the same thread. When the JS thread falls behind, those
// state-driven knob updates get delayed or coalesced, which is exactly
// what showed up as "the knob responds (movement still works) but
// visually lags, or gets stuck mid-drag, or stays pushed forward/back
// after I've actually stopped" — the INPUT was fine (it doesn't depend on
// the knob's visual position), only the visual feedback was starving for
// JS-thread time.
//
// Reanimated shared values sidestep that whole problem: `.onChange` here
// runs as a UI-thread worklet, mutating knobX/knobY directly on the UI
// thread, and useAnimatedStyle reads them there too — the knob tracks the
// finger at native frame rate completely independent of whatever the JS
// thread is doing. The one thing that DOES need the JS thread — calling
// onMove() to update the physics input ref — is explicitly bounced over
// with runOnJS, just for that one call, not the whole gesture.
// ────────────────────────────────────────────────────────────────────────────
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';

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
  // Visual-only, UI-thread-driven — see the big comment above for why
  // this isn't useState.
  const knobX = useSharedValue(0);
  const knobY = useSharedValue(0);
  // `active` only flips twice per gesture (press/release), not on every
  // move, so it's nowhere near hot enough to need a shared value — plain
  // React state here has no performance impact.
  const [active, setActive] = useState(false);

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onStart(() => {
          runOnJS(setActive)(true);
        })
        .onChange((e) => {
          'worklet';
          let dx = e.translationX;
          let dy = e.translationY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > MAX_RADIUS) {
            const scale = MAX_RADIUS / dist;
            dx *= scale;
            dy *= scale;
          }
          knobX.value = dx;
          knobY.value = dy;
          runOnJS(onMove)(dx / MAX_RADIUS, -dy / MAX_RADIUS);
        })
        .onEnd(() => {
          'worklet';
          knobX.value = 0;
          knobY.value = 0;
          runOnJS(setActive)(false);
          runOnJS(onMove)(0, 0);
        })
        .onFinalize(() => {
          'worklet';
          // Belt-and-suspenders: onEnd doesn't fire for a gesture that
          // gets cancelled/interrupted (e.g. the OS taking over for a
          // system gesture) — onFinalize always fires, so this is what
          // guarantees the knob never gets stuck visually pushed off-
          // center from an interrupted drag, matching the exact "stuck
          // forward/back" symptom being fixed here.
          knobX.value = 0;
          knobY.value = 0;
          runOnJS(setActive)(false);
          runOnJS(onMove)(0, 0);
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMove],
  );

  const knobStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: knobX.value }, { translateY: knobY.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View style={styles.base} hitSlop={20}>
        <View style={[styles.ring, active && styles.ringActive]} />
        <Animated.View
          style={[styles.knob, active && styles.knobActive, knobStyle]}
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
