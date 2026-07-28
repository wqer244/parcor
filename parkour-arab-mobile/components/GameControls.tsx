// ────────────────────────────────────────────────────────────────────────────
// Landscape Game Controls — reliable multi-touch "hold" buttons
//
// Built on react-native-gesture-handler (the same library that already
// wraps the whole app via GestureHandlerRootView in app/_layout.tsx).
//
// Earlier versions of this file tried manual RN "raw touch" handling
// (onTouchStart/Move/End) instead. That fights with GestureHandlerRootView
// for control of the touch stream on Android, which is exactly why buttons
// felt unresponsive / needed several taps to register, and why some
// buttons didn't fire together. Using react-native-gesture-handler's own
// Gesture API for every button removes that conflict entirely — every
// button gets its own independent native gesture recognizer, all of which
// can be active at the same time (walk + jump together works correctly).
// ────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { VirtualJoystick } from './VirtualJoystick';

interface Props {
  // Camera-relative movement — see VirtualJoystick. Replaces the old
  // 4-button D-pad (onForwardStart/onBackStart/onLeftStart/onRightStart)
  // so the player never has to hold a "backward" button to walk toward
  // something behind them, like the PvP arena.
  onMove: (right: number, forward: number) => void;
  onJump: () => void;
  onJumpEnd?: () => void;
}

// ── Layout constants ─────────────────────────────────────────────────────────
const JUMP_SIZE = 80;

// ── A single "hold" button: fires onStart the instant a finger touches it,
//    onEnd the instant that same finger lifts (or the gesture is cancelled).
function HoldButton({
  icon,
  size,
  onStart,
  onEnd,
  style,
  iconSize = 22,
  iconColor = '#00ffcc',
}: {
  icon: string;
  size: number;
  onStart: () => void;
  onEnd?: () => void;
  style?: object;
  iconSize?: number;
  iconColor?: string;
}) {
  const [pressed, setPressed] = React.useState(false);

  const gesture = React.useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(0) // fire immediately on touch-down, not after a delay
        .maxDistance(10000) // don't cancel if the finger drifts a bit
        .onStart(() => {
          setPressed(true);
          onStart();
        })
        .onEnd(() => {
          setPressed(false);
          onEnd?.();
        })
        .onFinalize(() => {
          setPressed(false);
          onEnd?.();
        })
        .runOnJS(true),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onStart, onEnd]
  );

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={[
          styles.dirBtn,
          { width: size, height: size, borderRadius: size >= JUMP_SIZE ? size / 2 : 10 },
          pressed && styles.dirBtnActive,
          style,
        ]}
      >
        <Ionicons name={icon as 'arrow-up'} size={iconSize} color={iconColor} />
      </View>
    </GestureDetector>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function GameControls({ onMove, onJump, onJumpEnd }: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        { bottom: insets.bottom + 12, left: insets.left + 16, right: insets.right + 16 },
      ]}
      pointerEvents="box-none"
    >
      {/* ── Joystick — drag any direction to walk that way relative to
          wherever the camera is currently facing ─────────────────── */}
      <VirtualJoystick onMove={onMove} />

      {/* ── Jump button ───────────────────────────────────────────────── */}
      <HoldButton
        icon="arrow-up-circle"
        size={JUMP_SIZE}
        iconSize={36}
        iconColor="#ffd700"
        onStart={onJump}
        onEnd={onJumpEnd}
        style={styles.jumpBtn}
      />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 118,
  },
  dirBtn: {
    backgroundColor: 'rgba(0,255,204,0.10)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,204,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dirBtnActive: {
    backgroundColor: 'rgba(0,255,204,0.28)',
    borderColor: '#00ffcc',
  },
  jumpBtn: {
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 2,
    borderColor: 'rgba(255,215,0,0.5)',
  },
});
