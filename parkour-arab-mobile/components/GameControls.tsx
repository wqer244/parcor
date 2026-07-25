// ────────────────────────────────────────────────────────────────────────────
// Landscape Game Controls — multi-touch
//
// Uses onTouchStart/Move/End directly (bypasses the responder system, so
// multiple simultaneous fingers all fire events independently).
// Button rects are computed mathematically from the overlay's measured
// on-screen position — no per-button refs needed.
// ────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useRef, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
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
// D-pad total size
const DPAD_W = BTN * 3 + GAP * 2; // 164
const DPAD_H = BTN * 3 + GAP * 2; // 164

// Button rects relative to overlay top-left [x, y, w, h]
// Overlay is laid out as: D-pad (left) | flex space | Jump (right, bottom-aligned)
function buildRects(overlayW: number) {
  return {
    forward: [BTN + GAP, 0,             BTN,       BTN      ],
    left:    [0,          BTN + GAP,     BTN,       BTN      ],
    right:   [(BTN+GAP)*2, BTN + GAP,   BTN,       BTN      ],
    back:    [BTN + GAP, (BTN+GAP)*2,   BTN,       BTN      ],
    // Jump is right-aligned, bottom-aligned inside the overlay
    jump:    [overlayW - JUMP_SIZE, DPAD_H - JUMP_SIZE, JUMP_SIZE, JUMP_SIZE],
  } as Record<BtnId, number[]>;
}

// ── Pure-visual button (no touch handlers) ────────────────────────────────────
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
  onBackStart,   onBackEnd,
  onLeftStart,   onLeftEnd,
  onRightStart,  onRightEnd,
  onJump,        onJumpEnd,
}: Props) {
  const insets = useSafeAreaInsets();

  // Overlay's top-left absolute position on screen (set by onLayout + measure)
  const overlayRef = useRef<View>(null);
  const overlayOrigin = useRef({ x: 0, y: 0, w: 0 });

  // Touch id → button mapping
  const touchMap = useRef<Map<number, BtnId>>(new Map());

  // Visual highlight state
  const [active, setActive] = useState<Set<BtnId>>(new Set());

  // ── Measure overlay absolute position after layout ────────────────────────
  const handleOverlayLayout = useCallback((_e: LayoutChangeEvent) => {
    overlayRef.current?.measure((_fx, _fy, width, _h, pageX, pageY) => {
      overlayOrigin.current = { x: pageX, y: pageY, w: width };
    });
  }, []);

  // ── Hit test: pageX/pageY → BtnId? ───────────────────────────────────────
  const hitTest = useCallback((pageX: number, pageY: number): BtnId | null => {
    const { x: ox, y: oy, w: ow } = overlayOrigin.current;
    if (ow === 0) return null; // not measured yet
    const lx = pageX - ox; // local x inside overlay
    const ly = pageY - oy; // local y inside overlay
    const rects = buildRects(ow);
    for (const [id, [rx, ry, rw, rh]] of Object.entries(rects) as [BtnId, number[]][]) {
      if (lx >= rx && lx <= rx + rw && ly >= ry && ly <= ry + rh) return id;
    }
    return null;
  }, []);

  // ── Button press / release ────────────────────────────────────────────────
  const pressBtn = useCallback((id: BtnId) => {
    setActive(prev => { const s = new Set(prev); s.add(id); return s; });
    if (id === 'forward') onForwardStart();
    else if (id === 'back')  onBackStart();
    else if (id === 'left')  onLeftStart();
    else if (id === 'right') onRightStart();
    else if (id === 'jump')  onJump();
  }, [onForwardStart, onBackStart, onLeftStart, onRightStart, onJump]);

  const releaseBtn = useCallback((id: BtnId) => {
    setActive(prev => { const s = new Set(prev); s.delete(id); return s; });
    if (id === 'forward') onForwardEnd();
    else if (id === 'back')  onBackEnd();
    else if (id === 'left')  onLeftEnd();
    else if (id === 'right') onRightEnd();
    else if (id === 'jump')  onJumpEnd?.();
  }, [onForwardEnd, onBackEnd, onLeftEnd, onRightEnd, onJumpEnd]);

  // ── Touch handlers (fire for every finger independently) ─────────────────
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
      ref={overlayRef}
      onLayout={handleOverlayLayout}
      style={[
        styles.root,
        { bottom: insets.bottom + 12, left: insets.left + 16, right: insets.right + 16 },
      ]}
      // Direct touch events — no responder negotiation needed
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
        {/* Row 1 — Forward */}
        <View style={styles.dpadRow}>
          <View style={styles.dpadSpacer} />
          <VisualBtn icon="arrow-up" active={active.has('forward')} />
          <View style={styles.dpadSpacer} />
        </View>
        {/* Row 2 — Left · Center · Right */}
        <View style={styles.dpadRow}>
          <VisualBtn icon="arrow-back" active={active.has('left')} />
          <View style={[styles.dirBtn, styles.dpadCenter]} />
          <VisualBtn icon="arrow-forward" active={active.has('right')} />
        </View>
        {/* Row 3 — Backward */}
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
    // Make the whole strip touchable
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
