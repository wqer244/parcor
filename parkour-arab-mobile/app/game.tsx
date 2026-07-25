// ────────────────────────────────────────────────────────
// 3D Game Screen — Landscape Parkour
// ────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { usePlayer } from '@/context/PlayerContext';
import { joinVoiceChannel, leaveVoiceChannel, setVoiceMuted, destroyVoiceEngine } from '@/services/voiceChat';
import { GameControls } from '@/components/GameControls';
import { VoiceButton } from '@/components/VoiceButton';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GameRenderer3D, RemotePlayer3D, CameraMode } from '@/components/GameRenderer3D';
import {
  stepPhysics3D,
  PhysState3D,
  Input3D,
  FINISH_DISTANCE,
} from '@/services/game3DPhysics';

function makeInitState(): PhysState3D {
  return { x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, facingAngle: 0, finished: false };
}

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const { playerColor, playerName, remotePlayers, joinServer, leaveServer, syncPosition } =
    usePlayer();

  // Refs — updated every frame without re-render
  const physRef = useRef<PhysState3D>(makeInitState());
  const inputRef = useRef<Input3D>({ forward: false, backward: false, left: false, right: false, jump: false });
  const frameRef = useRef(0);
  const remotePlayersRef = useRef<RemotePlayer3D[]>([]);
  const cameraModeRef = useRef<CameraMode>('third');

  // Free-look drag state (radians), read every frame by GameRenderer3D.
  // yaw: horizontal turn (unbounded, wraps naturally via sin/cos).
  // pitch: vertical tilt, clamped so the third-person camera never dips
  // below the player and first-person look stays within a sane range.
  const orbitYawRef = useRef(0);
  const orbitPitchRef = useRef(0.447); // ~25.6° — matches the old fixed chase-cam angle
  const PITCH_MIN = 0.08;
  const PITCH_MAX = 1.35;
  const DRAG_SENSITIVITY = 0.006;

  const lookGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .onChange((e) => {
          orbitYawRef.current -= e.changeX * DRAG_SENSITIVITY;
          orbitPitchRef.current = Math.max(
            PITCH_MIN,
            Math.min(PITCH_MAX, orbitPitchRef.current + e.changeY * DRAG_SENSITIVITY)
          );
        })
        .runOnJS(true),
    []
  );

  // Cycle order + display info for the camera-perspective button
  const CAMERA_ORDER: CameraMode[] = ['third', 'first', 'top'];
  const CAMERA_INFO: Record<CameraMode, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
    third: { icon: 'body', label: 'الشخص الثالث' },
    first: { icon: 'eye', label: 'الشخص الأول' },
    top: { icon: 'grid', label: 'منظور علوي' },
  };

  // State — triggers UI updates only
  const [isMuted, setIsMuted] = useState(true);
  const [cameraMode, setCameraMode] = useState<CameraMode>('third');
  const [hasFinished, setHasFinished] = useState(false);
  const [onlinePlayers, setOnlinePlayers] = useState(1);
  const [, forceUpdate] = useState(0);

  // Keep remote players ref in sync
  useEffect(() => {
    remotePlayersRef.current = remotePlayers.map((rp) => ({
      id: rp.id,
      x: rp.x,
      y: rp.y,
      z: rp.z ?? 0,
      color: rp.color,
      name: rp.name,
    }));
    setOnlinePlayers(remotePlayers.length + 1);
  }, [remotePlayers]);

  useEffect(() => {
    joinServer('parkour-arab-3d');
    // Voice channel name matches the game room, so everyone in the same
    // room hears each other. uid 0 lets Agora assign one automatically.
    joinVoiceChannel('parkour-arab-3d', 0);
    return () => {
      leaveServer();
      leaveVoiceChannel();
      destroyVoiceEngine();
    };
  }, [joinServer, leaveServer]);

  // Push the mute toggle to the actual mic every time it changes. Starts
  // muted (isMuted defaults to true) so nobody is broadcast without
  // explicitly tapping the mic button first.
  useEffect(() => {
    setVoiceMuted(isMuted);
  }, [isMuted]);

  // Physics loop — 30 fps
  useEffect(() => {
    const loop = setInterval(() => {
      const inp = inputRef.current;
      const next = stepPhysics3D(physRef.current, inp);
      physRef.current = next;

      // Consume single-press jump
      if (inp.jump && next.vy > 0) inp.jump = false;

      // Finish detection
      if (next.finished && !hasFinished) {
        setHasFinished(true);
      }

      // Firebase sync every 3 frames
      frameRef.current++;
      if (frameRef.current % 3 === 0) {
        const { x, y, z, vx, vy, vz } = next;
        syncPosition(x, y, z, vx, vy, vz);
      }

      // Trigger re-render for HUD (not GLView)
      if (frameRef.current % 10 === 0) {
        forceUpdate((n) => n + 1);
      }
    }, 33);

    return () => clearInterval(loop);
  }, [syncPosition, hasFinished]);

  // Input helpers
  const startForward  = () => { inputRef.current.forward  = true; };
  const stopForward   = () => { inputRef.current.forward  = false; };
  const startBackward = () => { inputRef.current.backward = true; };
  const stopBackward  = () => { inputRef.current.backward = false; };
  const startLeft     = () => { inputRef.current.left     = true; };
  const stopLeft      = () => { inputRef.current.left     = false; };
  const startRight    = () => { inputRef.current.right    = true; };
  const stopRight     = () => { inputRef.current.right    = false; };
  const doJump        = () => { inputRef.current.jump     = true; };

  const cycleCamera = () => {
    const nextIdx = (CAMERA_ORDER.indexOf(cameraModeRef.current) + 1) % CAMERA_ORDER.length;
    const next = CAMERA_ORDER[nextIdx];
    cameraModeRef.current = next;
    setCameraMode(next);
  };

  const restart = () => {
    physRef.current = makeInitState();
    inputRef.current = { forward: false, backward: false, left: false, right: false, jump: false };
    setHasFinished(false);
  };

  const topPad = Platform.OS === 'web' ? 8 : insets.top + 4;

  const pos = physRef.current;
  const progress = Math.max(0, Math.min(100, Math.round((Math.abs(pos.z) / FINISH_DISTANCE) * 100)));

  return (
    <View style={styles.root}>
      {/* ── 3D View ─────────────────────────────────── */}
      <GameRenderer3D
        physStateRef={physRef}
        playerColor={playerColor}
        remotePlayersRef={remotePlayersRef}
        cameraModeRef={cameraModeRef}
        orbitYawRef={orbitYawRef}
        orbitPitchRef={orbitPitchRef}
      />

      {/* ── Free-look drag layer ────────────────────────
          Sits above the 3D view but below the HUD/buttons (which are
          rendered after it, so they still receive their own touches
          first). Dragging anywhere on the open game area rotates the
          camera — same interaction as Roblox / Minecraft. */}
      <GestureDetector gesture={lookGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>

      {/* ── HUD top bar ─────────────────────────────── */}
      <View style={[styles.hud, { top: topPad }]} pointerEvents="box-none">
        <Pressable style={styles.hudBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={20} color="#00ffcc" />
        </Pressable>

        <View style={styles.hudCenter}>
          <Text style={styles.serverName}>باركور العرب 3D</Text>
          <Text style={styles.playerCount}>
            <Ionicons name="people" size={11} color="#00ffcc" /> {onlinePlayers} متصل
          </Text>
        </View>

        {/* Progress bar */}
        <View style={styles.progressWrap}>
          <View style={[styles.progressBar, { width: `${progress}%` as `${number}%` }]} />
          <Text style={styles.progressTxt}>{progress}%</Text>
        </View>

        <Pressable style={styles.camBtn} onPress={cycleCamera}>
          <Ionicons name={CAMERA_INFO[cameraMode].icon} size={20} color="#00ffcc" />
        </Pressable>

        <VoiceButton isMuted={isMuted} onToggle={() => setIsMuted((m) => !m)} />
      </View>

      {/* Current perspective label — brief, fades with the HUD */}
      <View style={[styles.camLabel, { top: topPad + 44 }]} pointerEvents="none">
        <Text style={styles.camLabelText}>{CAMERA_INFO[cameraMode].label}</Text>
      </View>

      {/* ── Controls ────────────────────────────────── */}
      <GameControls
        onForwardStart={startForward}  onForwardEnd={stopForward}
        onBackStart={startBackward}    onBackEnd={stopBackward}
        onLeftStart={startLeft}        onLeftEnd={stopLeft}
        onRightStart={startRight}      onRightEnd={stopRight}
        onJump={doJump}
      />

      {/* ── Finish Modal ─────────────────────────────── */}
      <Modal visible={hasFinished} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <LinearGradient
            colors={['#1a1000', '#2d1f00', '#1a1000']}
            style={styles.modalCard}
          >
            <Text style={styles.trophyIcon}>🏆</Text>
            <Text style={styles.modalTitle}>أكملت المسار!</Text>
            <Text style={styles.modalSub}>باركور العرب 3D</Text>
            <View style={styles.modalBtns}>
              <Pressable style={styles.restartBtn} onPress={restart}>
                <Text style={styles.restartTxt}>العب مجدداً</Text>
              </Pressable>
              <Pressable style={styles.exitBtn} onPress={() => router.back()}>
                <Text style={styles.exitTxt}>خروج</Text>
              </Pressable>
            </View>
          </LinearGradient>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#06060f',
  },
  hud: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 8,
  },
  hudBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,255,204,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,204,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,255,204,0.12)',
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,204,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  camLabel: {
    position: 'absolute',
    alignSelf: 'center',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  camLabelText: {
    fontSize: 10,
    color: 'rgba(0,255,204,0.7)',
    backgroundColor: 'rgba(6,6,18,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  hudCenter: {
    flex: 1,
    alignItems: 'center',
  },
  serverName: {
    color: '#00ffcc',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  playerCount: {
    color: 'rgba(0,255,204,0.65)',
    fontSize: 10,
    marginTop: 1,
  },
  progressWrap: {
    width: 80,
    height: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 4,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  progressBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#ffd700',
    borderRadius: 4,
  },
  progressTxt: {
    color: '#ffd700',
    fontSize: 9,
    fontWeight: '700',
    textAlign: 'center',
    zIndex: 1,
  },
  // ── Finish modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCard: {
    width: 280,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#ffd70055',
  },
  trophyIcon: { fontSize: 52 },
  modalTitle: {
    color: '#ffd700',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 12,
    textAlign: 'center',
  },
  modalSub: {
    color: 'rgba(255,215,0,0.55)',
    fontSize: 13,
    marginTop: 4,
  },
  modalBtns: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
  },
  restartBtn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    backgroundColor: '#ffd700',
    borderRadius: 10,
  },
  restartTxt: { color: '#1a1000', fontWeight: '800', fontSize: 14 },
  exitBtn: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    backgroundColor: 'rgba(255,215,0,0.12)',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#ffd70066',
  },
  exitTxt: { color: '#ffd700', fontWeight: '700', fontSize: 14 },
});
