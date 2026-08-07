// ────────────────────────────────────────────────────────────────────────────
// Volume slider — a labeled track + fill + knob, shows a live percentage,
// and lets you either tap anywhere on the track to jump there or drag the
// knob. Used by the new sound settings screen (game.tsx) for SFX / call /
// master volume.
//
// Same UI-thread-driven approach as VirtualJoystick.tsx (see the big
// comment there for why): the fill width and knob position update via a
// Reanimated shared value from a worklet, not React state, so dragging
// stays smooth even while the game's physics/render loops are busy on
// the JS thread. onChange is still called (via runOnJS) so the parent
// can persist the value and apply it to actual game/voice volume.
// ────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { StyleSheet, Text, View, LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  runOnJS,
} from 'react-native-reanimated';

const TRACK_HEIGHT = 8;
const KNOB_SIZE = 22;

interface Props {
  label: string;
  icon?: React.ReactNode;
  /** 0-100 */
  value: number;
  /** Called continuously while dragging, and on tap — receives 0-100 (rounded). */
  onChange: (value: number) => void;
}

export function VolumeSlider({ label, icon, value, onChange }: Props) {
  const trackWidthShared = useSharedValue(0);
  const fillPercent = useSharedValue(value / 100);

  const draggingRef = React.useRef(false);
  const setDragging = React.useCallback((v: boolean) => {
    draggingRef.current = v;
  }, []);
  React.useEffect(() => {
    if (!draggingRef.current) {
      fillPercent.value = value / 100;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function handleLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    // Modal fade-in transitions can trigger a spurious layout pass
    // reporting width 0 before the real size settles. If that ever won
    // the race and got stored, EVERY gesture callback's `if (w <= 0)
    // return;` guard would silently no-op forever — the slider would
    // look normal but nothing would happen when you dragged or tapped
    // it, and the knob (only rendered while trackWidth > 0, in the old
    // version of this component) would vanish and never come back. This
    // ignores non-positive readings entirely so a stale 0 can never
    // overwrite a real, already-measured width.
    if (w > 0) {
      trackWidthShared.value = w;
    }
  }

  const commit = React.useCallback(
    (percent: number) => {
      onChange(Math.round(Math.max(0, Math.min(1, percent)) * 100));
    },
    [onChange],
  );

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      'worklet';
      runOnJS(setDragging)(true);
      const w = trackWidthShared.value;
      if (w <= 0) return;
      const percent = Math.max(0, Math.min(1, e.x / w));
      fillPercent.value = percent;
      runOnJS(commit)(percent);
    })
    .onChange((e) => {
      'worklet';
      const w = trackWidthShared.value;
      if (w <= 0) return;
      const percent = Math.max(0, Math.min(1, e.x / w));
      fillPercent.value = percent;
      runOnJS(commit)(percent);
    })
    .onFinalize(() => {
      'worklet';
      runOnJS(setDragging)(false);
    });

  const fillStyle = useAnimatedStyle(() => ({
    width: `${fillPercent.value * 100}%`,
  }));
  // Positioned with a PERCENTAGE (`left`), exactly like the fill bar
  // above — not with pixels computed from a JS-measured trackWidth. A
  // percentage is resolved by the native layout engine itself, so the
  // knob always lands in the right spot the instant fillPercent changes,
  // with zero dependency on onLayout having already fired with the
  // correct number by that point. trackWidth is now only used for
  // turning a touch's raw x position into a percentage during drag —
  // it no longer has any say in where the knob is drawn.
  const knobStyle = useAnimatedStyle(() => ({
    left: `${fillPercent.value * 100}%`,
    transform: [{ translateX: -KNOB_SIZE / 2 }],
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={styles.labelLeft}>
          {icon}
          <Text style={styles.label}>{label}</Text>
        </View>
        <Text style={styles.percent}>{Math.round(value)}%</Text>
      </View>
      <GestureDetector gesture={gesture}>
        <View style={styles.trackTouchArea} onLayout={handleLayout} hitSlop={12}>
          <View style={styles.track}>
            <Animated.View style={[styles.fill, fillStyle]} />
          </View>
          {/* Always mounted now — see handleLayout's comment above for
              why this used to sometimes disappear and never come back. */}
          <Animated.View style={[styles.knob, knobStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    marginBottom: 18,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    color: '#e8faf5',
    fontSize: 14,
    fontWeight: '700',
  },
  percent: {
    color: '#00ffcc',
    fontSize: 13,
    fontWeight: '800',
  },
  trackTouchArea: {
    height: KNOB_SIZE + 8,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: '#00ffcc',
    borderRadius: TRACK_HEIGHT / 2,
  },
  knob: {
    position: 'absolute',
    left: 0,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: '#00ffcc',
    borderWidth: 2,
    borderColor: '#06060f',
    top: '50%',
    marginTop: -KNOB_SIZE / 2,
  },
});
