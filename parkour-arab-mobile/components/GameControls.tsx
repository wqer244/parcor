// ────────────────────────────────────────────────────────────────────────────
// Landscape Game Controls
//
// Each direction/jump button is its own Pressable with onPressIn/onPressOut.
// This is the standard, reliable RN approach — every Pressable manages its
// own native touch responder independently, so multiple fingers pressing
// different buttons at the same time all work correctly. (Previous version
// used a single manual hit-test overlay based on View.measure(), which does
// not reliably receive raw onTouchStart/Move/End events under the New
// Architecture (Fabric) — that's why none of the buttons responded.)
// ────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  onForwardStart: () => void;
  onForwardEnd: () => void;
  onBackStart: () => void;
  onBackEnd: () => void;
  onLeftStart: () => void;
  onLeftEnd: () => void;
  onRightStart: () => void;
  onRightEnd: () => void;
  onJump: () => void;
  onJumpEnd?: () => void;
}

// ── Layout constants ─────────────────────────────────────────────────────────
const BTN = 52;
const GAP = 4;
const JUMP_SIZE = 80;
const DPAD_H = BTN * 3 + GAP * 2; // 164

// ── Single control button ────────────────────────────────────────────────────
function CtrlBtn({
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
  return (
    <Pressable
      hitSlop={8}
      onPressIn={onStart}
      onPressOut={onEnd}
      style={({ pressed }) => [
        styles.dirBtn,
        { width: size, height: size, borderRadius: size >= JUMP_SIZE ? size / 2 : 10 },
        pressed && styles.dirBtnActive,
        style,
      ]}
    >
      <Ionicons name={icon as 'arrow-up'} size={iconSize} color={iconColor} />
    </Pressable>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function GameControls({
  onForwardStart, onForwardEnd,
  onBackStart,   onBackEnd,
  onLeftStart,   onLeftEnd,
  onRightStart,  onRightEnd,
  onJump,        onJumpEnd,
}: Props) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        { bottom: insets.bottom + 12, left: insets.left + 16, right: insets.right + 16 },
      ]}
      pointerEvents="box-none"
    >
      {/* ── D-pad ─────────────────────────────────────────────────────── */}
      <View style={styles.dpad}>
        <View style={styles.dpadRow}>
          <View style={styles.dpadSpacer} />
          <CtrlBtn icon="arrow-up" size={BTN} onStart={onForwardStart} onEnd={onForwardEnd} />
          <View style={styles.dpadSpacer} />
        </View>
        <View style={styles.dpadRow}>
          <CtrlBtn icon="arrow-back" size={BTN} onStart={onLeftStart} onEnd={onLeftEnd} />
          <View style={[styles.dirBtn, styles.dpadCenter, { width: BTN, height: BTN }]} />
          <CtrlBtn icon="arrow-forward" size={BTN} onStart={onRightStart} onEnd={onRightEnd} />
        </View>
        <View style={styles.dpadRow}>
          <View style={styles.dpadSpacer} />
          <CtrlBtn icon="arrow-down" size={BTN} onStart={onBackStart} onEnd={onBackEnd} />
          <View style={styles.dpadSpacer} />
        </View>
      </View>

      {/* ── Jump button ───────────────────────────────────────────────── */}
      <CtrlBtn
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
    height: DPAD_H,
  },
  dpad: { flexDirection: 'column', gap: GAP },
  dpadRow: { flexDirection: 'row', gap: GAP, alignItems: 'center' },
  dpadSpacer: { width: BTN, height: BTN },
  dpadCenter: {
    borderRadius: 10,
    backgroundColor: 'rgba(0,255,204,0.04)',
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
