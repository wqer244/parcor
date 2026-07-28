// ────────────────────────────────────────────────────────
// 3D Game Screen — Landscape Parkour
// ────────────────────────────────────────────────────────
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import { MiniMap } from '@/components/MiniMap';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { GameRenderer3D, RemotePlayer3D, CameraMode } from '@/components/GameRenderer3D';
import {
  stepPhysics3D,
  PhysState3D,
  Input3D,
  FINISH_DISTANCE,
  WEAPON_DEFS,
  WeaponType,
} from '@/services/game3DPhysics';
import { SKINS, getSkin } from '@/constants/skins';
import { usePvP } from '@/hooks/usePvP';

function makeInitState(): PhysState3D {
  return { x: 0, y: 0.5, z: 0, vx: 0, vy: 0, vz: 0, onGround: false, facingAngle: 0, finished: false };
}

export default function GameScreen() {
  const insets = useSafeAreaInsets();
  const { playerId, playerColor, playerSkinId, playerName, remotePlayers, joinServer, leaveServer, syncPosition, setPlayerSkin, setPlayerWeapon, notifyAttack } =
    usePlayer();
  const playerSkin = getSkin(playerSkinId);
  const pvp = usePvP(playerId);

  // Refs PvP needs to read every frame without triggering re-renders —
  // kept in sync with the hook's state via the effect below.
  const weaponTakenAtRef = useRef<Record<string, number>>({});
  const currentWeaponRef = useRef(pvp.currentWeapon);
  useEffect(() => { weaponTakenAtRef.current = pvp.weaponTakenAt; }, [pvp.weaponTakenAt]);
  useEffect(() => { currentWeaponRef.current = pvp.currentWeapon; }, [pvp.currentWeapon]);
  useEffect(() => { setPlayerWeapon(pvp.currentWeapon); }, [pvp.currentWeapon, setPlayerWeapon]);
  // Drives the swing/fire animation on the local rig (set in doAttack
  // below) and the red hit-flash when damage comes in (kept in sync with
  // the hook's lastDamageAt) — see GameRenderer3D's animate loop.
  const localAttackRef = useRef<{ at: number; weapon: WeaponType | null }>({ at: 0, weapon: null });
  const localDamageAtRef = useRef(0);
  useEffect(() => { localDamageAtRef.current = pvp.lastDamageAt; }, [pvp.lastDamageAt]);

  // Screen-space feedback — a quick red pulse when hit, a white pulse on
  // respawn. Driven by Animated directly (not React state) so it's a real
  // smooth fade regardless of the HUD's own re-render cadence.
  const hitFlashOpacity = useRef(new Animated.Value(0)).current;
  const respawnFlashOpacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (pvp.lastDamageAt === 0) return;
    hitFlashOpacity.stopAnimation();
    hitFlashOpacity.setValue(0.4);
    Animated.timing(hitFlashOpacity, { toValue: 0, duration: 380, useNativeDriver: true }).start();
  }, [pvp.lastDamageAt, hitFlashOpacity]);

  // Refs — updated every frame without re-render
  const physRef = useRef<PhysState3D>(makeInitState());
  const inputRef = useRef<Input3D>({ forward: false, backward: false, left: false, right: false, jump: false });
  // Raw joystick push, in screen-relative units (-1..1): x = right push,
  // y = forward push (up = positive). Rotated into a world-space move
  // vector every physics tick below, using the *current* camera yaw — not
  // just once when the stick moves — so movement direction stays correct
  // even while the player is mid-drag looking around with the other hand.
  const joystickPushRef = useRef({ x: 0, y: 0 });
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
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [, forceUpdate] = useState(0);

  // Keep remote players ref in sync
  useEffect(() => {
    remotePlayersRef.current = remotePlayers.map((rp) => ({
      id: rp.id,
      x: rp.x,
      y: rp.y,
      z: rp.z ?? 0,
      color: rp.color,
      skinId: rp.skinId,
      weapon: rp.weapon,
      attackedAt: rp.attackedAt,
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
      // Rotate the joystick's screen-relative push by the camera's
      // current yaw so "push up" always means "walk toward what the
      // camera is looking at" — this is what lets the player walk into
      // the arena (or anywhere else) just by looking at it and pushing
      // forward, with no separate "backward" button needed.
      const jp = joystickPushRef.current;
      if (jp.x !== 0 || jp.y !== 0) {
        const yaw = orbitYawRef.current;
        const sinYaw = Math.sin(yaw);
        const cosYaw = Math.cos(yaw);
        inputRef.current.moveX = jp.y * -sinYaw + jp.x * cosYaw;
        inputRef.current.moveZ = jp.y * -cosYaw + jp.x * -sinYaw;
      } else {
        inputRef.current.moveX = 0;
        inputRef.current.moveZ = 0;
      }

      const inp = inputRef.current;
      const next = stepPhysics3D(physRef.current, inp);
      physRef.current = next;

      // Consume single-press jump
      if (inp.jump && next.vy > 0) inp.jump = false;

      // PvP — arena zone tracking + death/respawn
      pvp.updatePosition(next.x, next.z);
      const respawn = pvp.consumeRespawn();
      if (respawn) {
        physRef.current = { ...physRef.current, x: respawn.x, y: respawn.y, z: respawn.z, vx: 0, vy: 0, vz: 0 };
        respawnFlashOpacity.stopAnimation();
        respawnFlashOpacity.setValue(0.65);
        Animated.timing(respawnFlashOpacity, { toValue: 0, duration: 550, useNativeDriver: true }).start();
      }

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
  const handleJoystickMove = (right: number, forward: number) => {
    joystickPushRef.current = { x: right, y: forward };
  };
  const doJump = () => { inputRef.current.jump = true; };

  const doAttack = () => {
    const s = physRef.current;
    const performed = pvp.attack(s.x, s.z, s.facingAngle, remotePlayersRef.current);
    if (performed) {
      localAttackRef.current = { at: Date.now(), weapon: pvp.currentWeapon };
      notifyAttack();
    }
  };
  const doPickup = () => { pvp.pickupNearestWeapon(); };

  const cycleCamera = () => {
    const nextIdx = (CAMERA_ORDER.indexOf(cameraModeRef.current) + 1) % CAMERA_ORDER.length;
    const next = CAMERA_ORDER[nextIdx];
    cameraModeRef.current = next;
    setCameraMode(next);
  };

  const restart = () => {
    physRef.current = makeInitState();
    inputRef.current = { forward: false, backward: false, left: false, right: false, jump: false };
    joystickPushRef.current = { x: 0, y: 0 };
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
        playerSkin={playerSkin}
        remotePlayersRef={remotePlayersRef}
        cameraModeRef={cameraModeRef}
        orbitYawRef={orbitYawRef}
        orbitPitchRef={orbitPitchRef}
        weaponTakenAtRef={weaponTakenAtRef}
        currentWeaponRef={currentWeaponRef}
        localAttackRef={localAttackRef}
        localDamageAtRef={localDamageAtRef}
      />

      {/* ── Damage / respawn screen flashes ─────────────
          Sit above the 3D view, below every touch layer (pointerEvents
          none so they never intercept taps). */}
      <Animated.View
        pointerEvents="none"
        style={[styles.screenFlash, { backgroundColor: '#ff1a1a', opacity: hitFlashOpacity }]}
      />
      <Animated.View
        pointerEvents="none"
        style={[styles.screenFlash, { backgroundColor: '#ffffff', opacity: respawnFlashOpacity }]}
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

        <Pressable style={styles.camBtn} onPress={() => setSettingsVisible(true)}>
          <Ionicons name="settings-sharp" size={19} color="#00ffcc" />
        </Pressable>

        <VoiceButton isMuted={isMuted} onToggle={() => setIsMuted((m) => !m)} />
      </View>

      {/* Current perspective label — brief, fades with the HUD */}
      <View style={[styles.camLabel, { top: topPad + 44 }]} pointerEvents="none">
        <Text style={styles.camLabelText}>{CAMERA_INFO[cameraMode].label}</Text>
      </View>

      {/* ── Minimap — shows every player's live position ─────────── */}
      <View style={[styles.miniMapWrap, { top: topPad + 46 }]} pointerEvents="none">
        <MiniMap physStateRef={physRef} remotePlayersRef={remotePlayersRef} playerColor={playerColor} />
      </View>

      {/* ── PvP health bar — only visible inside the arena ──────── */}
      {pvp.inArena && (
        <View style={[styles.healthWrap, { top: topPad + 46 }]} pointerEvents="none">
          <View style={styles.healthBarBg}>
            <View style={[styles.healthBarFill, { width: `${(pvp.health / pvp.maxHealth) * 100}%` as `${number}%` }]} />
          </View>
          <Text style={styles.healthTxt}>{Math.round(pvp.health)} / {pvp.maxHealth}</Text>
          {pvp.currentWeapon && (
            <Text style={styles.weaponTxt}>🗡 {WEAPON_DEFS[pvp.currentWeapon].name}</Text>
          )}
        </View>
      )}

      {/* ── PvP action buttons — attack always available in the arena,
          pickup only pops up standing near an available weapon crate ── */}
      {pvp.inArena && (
        <View style={styles.pvpBtns} pointerEvents="box-none">
          {pvp.nearestWeaponId && (
            <Pressable style={styles.pickupBtn} onPress={doPickup}>
              <Ionicons name="hand-left" size={18} color="#06060f" />
              <Text style={styles.pickupBtnTxt}>التقط</Text>
            </Pressable>
          )}
          <Pressable style={styles.attackBtn} onPress={doAttack}>
            <Ionicons name="flash" size={26} color="#06060f" />
          </Pressable>
        </View>
      )}

      {/* ── Controls ────────────────────────────────── */}
      <GameControls
        onMove={handleJoystickMove}
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

      {/* ── Settings / Skin Picker Modal ─────────────────── */}
      <Modal visible={settingsVisible} transparent animationType="fade" onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalOverlay}>
          <LinearGradient
            colors={['#06060f', '#0d0d22', '#06060f']}
            style={styles.settingsCard}
          >
            <View style={styles.settingsHeader}>
              <Text style={styles.settingsTitle}>الإعدادات</Text>
              <Pressable style={styles.closeBtn} onPress={() => setSettingsVisible(false)}>
                <Ionicons name="close" size={20} color="#00ffcc" />
              </Pressable>
            </View>

            <Text style={styles.settingsSubTitle}>اختر السكن</Text>

            <ScrollView
              style={styles.skinScroll}
              contentContainerStyle={styles.skinGrid}
              showsVerticalScrollIndicator={true}
            >
              {SKINS.map((skin) => {
                const selected = skin.id === playerSkinId;
                return (
                  <Pressable
                    key={skin.id}
                    style={[styles.skinCard, selected && styles.skinCardSelected]}
                    onPress={() => setPlayerSkin(skin.id)}
                  >
                    <View style={styles.skinPreview}>
                      <View style={[styles.skinPreviewHair, { backgroundColor: skin.hair }]} />
                      <View style={[styles.skinPreviewHead, { backgroundColor: skin.skin }]} />
                      <View style={[styles.skinPreviewBody, { backgroundColor: skin.suit }]} />
                      <View style={[styles.skinPreviewLegs, { backgroundColor: skin.pants }]} />
                      <View style={[styles.skinPreviewAccent, { backgroundColor: skin.accent }]} />
                    </View>
                    <Text style={styles.skinName} numberOfLines={1}>{skin.name}</Text>
                    {selected && (
                      <View style={styles.skinCheckBadge}>
                        <Ionicons name="checkmark" size={12} color="#06060f" />
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable style={styles.doneBtn} onPress={() => setSettingsVisible(false)}>
              <Text style={styles.doneBtnTxt}>تم</Text>
            </Pressable>
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
  screenFlash: {
    ...StyleSheet.absoluteFillObject,
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
  miniMapWrap: {
    position: 'absolute',
    left: 14,
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
  // ── Settings / skin picker modal
  settingsCard: {
    width: '86%',
    maxWidth: 420,
    maxHeight: '86%',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(0,255,204,0.25)',
  },
  settingsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  settingsTitle: {
    color: '#00ffcc',
    fontSize: 18,
    fontWeight: '800',
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(0,255,204,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsSubTitle: {
    color: 'rgba(0,255,204,0.7)',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 10,
  },
  skinScroll: {
    maxHeight: 340,
  },
  skinGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-start',
    paddingBottom: 4,
  },
  skinCard: {
    width: 84,
    height: 104,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  skinCardSelected: {
    borderColor: '#00ffcc',
    backgroundColor: 'rgba(0,255,204,0.1)',
  },
  skinPreview: {
    width: 40,
    height: 56,
    alignItems: 'center',
    marginBottom: 6,
  },
  skinPreviewHair: {
    position: 'absolute',
    top: 0,
    width: 16,
    height: 8,
    borderRadius: 4,
  },
  skinPreviewHead: {
    position: 'absolute',
    top: 4,
    width: 16,
    height: 16,
    borderRadius: 8,
  },
  skinPreviewBody: {
    position: 'absolute',
    top: 20,
    width: 26,
    height: 20,
    borderRadius: 6,
  },
  skinPreviewLegs: {
    position: 'absolute',
    top: 38,
    width: 22,
    height: 18,
    borderRadius: 5,
  },
  skinPreviewAccent: {
    position: 'absolute',
    top: 20,
    width: 6,
    height: 20,
    borderRadius: 3,
  },
  skinName: {
    color: '#e8f8f5',
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  skinCheckBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#00ffcc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtn: {
    marginTop: 16,
    backgroundColor: '#00ffcc',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  doneBtnTxt: {
    color: '#06060f',
    fontWeight: '800',
    fontSize: 15,
  },
  // ── PvP HUD
  healthWrap: {
    position: 'absolute',
    right: 14,
    alignItems: 'flex-end',
  },
  healthBarBg: {
    width: 130,
    height: 12,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,51,51,0.4)',
    overflow: 'hidden',
  },
  healthBarFill: {
    height: '100%',
    backgroundColor: '#ff3333',
    borderRadius: 6,
  },
  healthTxt: {
    color: '#ff8888',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  weaponTxt: {
    color: '#ffd700',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  pvpBtns: {
    position: 'absolute',
    right: 14,
    bottom: 150,
    alignItems: 'center',
    gap: 10,
  },
  attackBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#ff3333',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#ffaaaa',
  },
  pickupBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#ffd700',
  },
  pickupBtnTxt: {
    color: '#06060f',
    fontWeight: '800',
    fontSize: 12,
  },
});
