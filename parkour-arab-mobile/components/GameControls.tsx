// ────────────────────────────────────────────────────────────────────────────
// Landscape Game Controls — true simultaneous multi-touch
//
// Uses raw onTouchStart/Move/End on a single overlay View (not Pressable).
// This matters because Android, by default, only routes touch input to the
// ONE view a gesture "responder" was granted to — pressing two separate
// <Pressable> buttons at once (e.g. move + jump) does NOT reliably fire
// both. Raw touch events bypass that: every finger is tracked here by its
// own touch `identifier`, so forward+jump (or any two buttons) work
// together correctly.
//
// Button rectangles are computed analytically from insets + screen size
// (not via View.measure()), since measure() can return stale/zero values
// on the first frames — that was the earlier "buttons don't respond" bug.
// ────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useRef, useState } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
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

type BtnId = 'forward' | 'back' | 'left' | 'right' | 'jump';

// ── Layout constants ─────────────────────────────────────────────────────────
const BTN = 52;
const GAP = 4;
const JUMP_SIZE = 80;
const DPAD_H = BTN * 3 + GAP * 2; // 164
const MARGIN_H = 16; // left/right margin of the whole control strip
const MARGIN_B = 12; // bottom margin of the whole control strip

// Button rects relative to the overlay's own top-left [x, y, w, h]
function buildRects(overlayW: number) {
  return {
    forward: [BTN + GAP, 0, BTN, BTN],
    left: [0, BTN + GAP, BTN, BTN],
    right: [(BTN + GAP) * 2, BTN + GAP, BTN, BTN],
    back: [BTN + GAP, (BTN + GAP) * 2, BTN, BTN],
    jump: [overlayW - JUMP_SIZE, DPAD_H - JUMP_SIZE, JUMP_SIZE, JUMP_SIZE],
  } as Record<BtnId, number[]>;
}

// ── Pure-visual button (no touch handlers of its own) ─────────────────────────
function VisualBtn({ icon, active, style }: { icon: string; active: boolean; style?: object }) {
  return (
    <View style={[styles.dirBtn, active && styles.dirBtnActive, style]}>
      <Ionicons name={icon as 'arrow-up'} size={22} color="#00ffcc" />
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function GameControls({
  onForwardStart, onForwardEnd,
  onBackStart, onBackEnd,
  onLeftStart, onLeftEnd,
  onRightStart, onRightEnd,
  onJump, onJumpEnd,
}: Props) {
  const insets = useSafeAreaInsets();
  const { width: SW, height: SH } = Dimensions.get('window');

  // Overlay's top-left position in absolute screen coordinates — computed
  // directly from the same values used in the `root` style below, so it's
  // always correct immediately, with no async measurement race.
  const originX = insets.left + MARGIN_H;
  const originY = SH - insets.bottom - MARGIN_B - DPAD_H;
  const overlayW = SW - (insets.left + MARGIN_H) - (insets.right + MARGIN_H);

  const rects = buildRects(overlayW);

  // Touch id → button mapping (lets multiple fingers act independently)
  const touchMap = useRef<Map<number, BtnId>>(new Map());

  // Visual highlight state
  const [active, setActive] = useState<Set<BtnId>>(new Set());

  const hitTest = useCallback((pageX: number, pageY: number): BtnId | null => {
    const lx = pageX - originX;
    const ly = pageY - originY;
    for (const [id, [rx, ry, rw, rh]] of Object.entries(rects) as [BtnId, number[]][]) {
      if (lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh) return id;
    }
    return null;
  }, [originX, originY, rects]);

  const pressBtn = useCallback((id: BtnId) => {
    setActive((prev) => { const s = new Set(prev); s.add(id); return s; });
    if (id === 'forward') onForwardStart();
    else if (id === 'back') onBackStart();
    else if (id === 'left') onLeftStart();
    else if (id === 'right') onRightStart();
    else if (id === 'jump') onJump();
  }, [onForwardStart, onBackStart, onLeftStart, onRightStart, onJump]);

  const releaseBtn = useCallback((id: BtnId) => {
    setActive((prev) => { const s = new Set(prev); s.delete(id); return s; });
    if (id === 'forward') onForwardEnd();
    else if (id === 'back') onBackEnd();
    else if (id === 'left') onLeftEnd();
    else if (id === 'right') onRightEnd();
    else if (id === 'jump') onJumpEnd?.();
  }, [onForwardEnd, onBackEnd, onLeftEnd, onRightEnd, onJumpEnd]);

  const onTouchStart = useCallback((e: { nativeEvent: { changedTouches: Array<{ identifier: number; pageX: number; pageY: number }> } }) => {
    for (const t of e.nativeEvent.changedTouches) {
      const btn = hitTest(t.pageX, t.pageY);
      if (btn) { touchMap.current.set(t.identifier, btn); pressBtn(btn); }
    }
  }, [hitTest, pressBtn]);

  const onTouchMove = useCallback((e: { nativeEvent: { changedTouches: Array<{ identifier: number; pageX: number; pageY: number }> } }) => {
    for (const t of e.nativeEvent.changedTouches) {
      const prev = touchMap.current.get(t.identifier) ?? null;
      const next = hitTest(t.pageX, t.pageY);
      if (prev !== next) {
        if (prev) releaseBtn(prev);
        if (next) { touchMap.current.set(t.identifier, next); pressBtn(next); }
        else touchMap.current.delete(t.identifier);
      }
    }
  }, [hitTest, pressBtn, releaseBtn]);

  const onTouchEnd = useCallback((e: { nativeEvent: { changedTouches: Array<{ identifier: number }> } }) => {
    for (const t of e.nativeEvent.changedTouches) {
      const btn = touchMap.current.get(t.identifier);
      if (btn) releaseBtn(btn);
      touchMap.current.delete(t.identifier);
    }
  }, [releaseBtn]);

  return (
    <View
      style={[
        styles.root,
        { bottom: insets.bottom + MARGIN_B, left: insets.left + MARGIN_H, right: insets.right + MARGIN_H },
      ]}
      // @ts-ignore — onTouchStart/Move/End are valid RN View props
      onTouchStart={onTouchStart}
      // @ts-ignore
      onTouchMove={onTouchMove}
      // @ts-ignore
      onTouchEnd={onTouchEnd}
      // @ts-ignore
      onTouchCancel={onTouchEnd}
    >
      {/* ── D-pad (visual only) ──────────────────────────────────────── */}
      <View style={styles.dpad}>
        <View style={styles.dpadRow}>
          <View style={styles.dpadSpacer} />
          <VisualBtn icon="arrow-up" active={active.has('forward')} />
          <View style={styles.dpadSpacer} />
        </View>
        <View style={styles.dpadRow}>
          <VisualBtn icon="arrow-back" active={active.has('left')} />
          <View style={[styles.dirBtn, styles.dpadCenter]} />
          <VisualBtn icon="arrow-forward" active={active.has('right')} />
        </View>
        <View style={styles.dpadRow}>
          <View style={styles.dpadSpacer} />
          <VisualBtn icon="arrow-down" active={active.has('back')} />
          <View style={styles.dpadSpacer} />
        </View>
      </View>

      {/* ── Jump button (visual only) ────────────────────────────────── */}
      <View style={[styles.jumpBtn, active.has('jump') && styles.jumpBtnActive]}>
        <Ionicons name="arrow-up-circle" size={36} color="#ffd700" />
      </View>
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
    width: BTN,
    height: BTN,
    borderRadius: 10,
    backgroundColor: 'rgba(0,255,204,0.04)',
  },
  dirBtn: {
    width: BTN,
    height: BTN,
    borderRadius: 10,
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
    width: JUMP_SIZE,
    height: JUMP_SIZE,
    borderRadius: JUMP_SIZE / 2,
    backgroundColor: 'rgba(255,215,0,0.10)',
    borderWidth: 2,
    borderColor: 'rgba(255,215,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jumpBtnActive: {
    backgroundColor: 'rgba(255,215,0,0.28)',
    borderColor: '#ffd700',
  },
});
