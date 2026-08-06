// ────────────────────────────────────────────────────────────────────────────
// Real-time voice chat — Agora RTC
//
// This is the piece that was previously MISSING. VoiceButton.tsx only ever
// toggled UI state; nothing actually recorded or transmitted audio, and
// nothing asked for the RECORD_AUDIO permission. This file does the real
// work: request the mic permission, join a shared voice "channel" (one
// channel per game server, so everyone in the same room hears each other),
// and mute/unmute the local mic.
//
// ⚠️ IMPORTANT — react-native-agora is a NATIVE module. It only works in an
// EAS/dev build, NOT in Expo Go. Importing/calling it there used to CRASH
// the whole app the instant you pressed "انضم" (Join), because the game
// screen called joinVoiceChannel() on mount and the native module simply
// doesn't exist in Expo Go.
//
// FIX: everything Agora-related is now loaded lazily via require() inside a
// try/catch, and every exported function checks `isVoiceAvailable()` before
// touching the engine. If the native module can't be loaded (Expo Go, or a
// build where it wasn't linked for any reason), voice chat silently
// disables itself — the game still loads and plays normally, it just runs
// without voice. No more crash-on-join.
//
// SETUP REQUIRED for voice chat to actually work:
// 1. `npm install` with a real internet connection so react-native-agora's
//    native code is present.
// 2. Run a real EAS/dev build (`expo run:android` / `expo run:ios`, or an
//    EAS dev-client build) — NOT Expo Go.
// 3. This project's Agora App Certificate is enabled and can't be turned
//    back off, so every join needs a real signed token. That token is now
//    fetched fresh from a small serverless endpoint (see
//    agora-token-vercel/) instead of being hardcoded here — deploy that
//    once on Vercel, then set TOKEN_ENDPOINT below to its URL.
// 4. react-native-agora's exact API can shift slightly between versions.
//    If the build fails on an unfamiliar method/type name from this file,
//    check node_modules/react-native-agora's TypeScript defs.
// ────────────────────────────────────────────────────────────────────────────
import { PermissionsAndroid, Platform } from 'react-native';

// ── Lazy / safe load of the native Agora module ─────────────────────────
// Using require() (not a static `import`) is what lets us wrap this in a
// try/catch. A static `import { createAgoraRtcEngine } from 'react-native-agora'`
// at the top of the file would run — and could throw — before any of our
// code has a chance to react, taking the whole app down with it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let AgoraModule: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  AgoraModule = require('react-native-agora');
  if (!AgoraModule?.createAgoraRtcEngine) {
    // Module resolved but doesn't expose what we expect (e.g. running in
    // Expo Go where a JS stub with no native backing is present).
    throw new Error('react-native-agora loaded without createAgoraRtcEngine');
  }
} catch (err) {
  AgoraModule = null;
  console.warn(
    '[voiceChat] Native Agora module unavailable — voice chat disabled. ' +
      'This is expected in Expo Go; build a dev client to enable voice. ' +
      `Reason: ${String(err)}`,
  );
}

/** True if the native voice engine is actually usable on this runtime. */
export function isVoiceAvailable(): boolean {
  return AgoraModule != null;
}

const AGORA_APP_ID = '5b677e06373d435ab2f38479dcb764c4'; // "parcor-voice" project

// ── Token server ─────────────────────────────────────────────────────────
// A hardcoded token (even a "10-year" one) is exactly what Agora's abuse
// detection flags — tokens are meant to be short-lived, minted per
// session, not baked into the app forever. So instead of a constant
// token, every join now fetches a fresh one (1h expiry) from a small
// serverless endpoint that holds the App Certificate server-side — see
// agora-token-vercel/api/agora-token.js for the endpoint itself and full
// deploy steps (Vercel — no billing-plan upgrade needed, unlike Firebase
// Cloud Functions). This also means the App Certificate (the actual
// secret) never ships inside the app bundle anymore, unlike the old
// approach.
//
// ⚠️ Deploy that endpoint first, then paste its URL here.
const TOKEN_ENDPOINT = 'https://severe-parcor.vercel.app/api/agora-token';

async function fetchAgoraToken(channelName: string, uid: number): Promise<string | null> {
  if (!TOKEN_ENDPOINT || TOKEN_ENDPOINT.startsWith('PASTE_')) {
    console.warn('[voiceChat] TOKEN_ENDPOINT not configured yet — deploy agora-token-vercel first.');
    return null;
  }
  try {
    const res = await fetch(`${TOKEN_ENDPOINT}?channel=${encodeURIComponent(channelName)}&uid=${uid}`);
    if (!res.ok) throw new Error(`token endpoint returned HTTP ${res.status}`);
    const data = await res.json();
    return typeof data.token === 'string' ? data.token : null;
  } catch (err) {
    console.warn('[voiceChat] failed to fetch Agora token:', err);
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engine: any = null;
let joinedChannel: string | null = null;
// Playback (call) volume, in Agora's own 0-400 units. Set via
// setCallPlaybackVolume() below (driven by the new settings slider in
// game.tsx) — stored here so it can be applied immediately if the engine
// already exists, or the moment it's created if a volume was set before
// the player ever joined a channel. 200 is the pre-existing default boost
// this already had hardcoded before it became user-adjustable — keeping
// it as the fallback means nobody's experience changes until they
// actually touch the new slider.
let pendingPlaybackVolume: number | null = null;

// ── Debug status — surfaced on-screen in game.tsx, since there's no way
//    to see device logs remotely. This is the fastest way to tell WHICH
//    step is failing (permission / join / token-rejected / etc).
export type VoiceStatus =
  | { state: 'idle' }
  | { state: 'unavailable'; message: string }
  | { state: 'requesting-permission' }
  | { state: 'permission-denied' }
  | { state: 'joining' }
  | { state: 'joined'; remoteCount: number }
  | { state: 'error'; message: string };

let statusListener: ((s: VoiceStatus) => void) | null = null;
let lastStatus: VoiceStatus = isVoiceAvailable()
  ? { state: 'idle' }
  : { state: 'unavailable', message: 'الشات الصوتي غير مدعوم في هذه النسخة (يحتاج Dev Build)' };
let remoteUids = new Set<number>();

function setStatus(s: VoiceStatus) {
  lastStatus = s;
  statusListener?.(s);
}

export function onVoiceStatusChange(cb: (s: VoiceStatus) => void): () => void {
  statusListener = cb;
  cb(lastStatus);
  return () => { if (statusListener === cb) statusListener = null; };
}

/** Ask Android for the microphone permission. No-op on iOS (the system
 *  prompt fires automatically the first time Agora touches the mic, driven
 *  by the NSMicrophoneUsageDescription string in app.json). */
export async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'صلاحية المايك',
        message: 'يحتاج التطبيق صلاحية المايك حتى تتكلم مع اللاعبين بالغرفة.',
        buttonPositive: 'موافق',
        buttonNegative: 'رفض',
      }
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch (err) {
    setStatus({ state: 'error', message: `permission request threw: ${String(err)}` });
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getEngine(): any | null {
  if (!isVoiceAvailable()) return null;
  if (!engine) {
    try {
      const { createAgoraRtcEngine, ChannelProfileType } = AgoraModule;
      engine = createAgoraRtcEngine();
      engine.initialize({
        appId: AGORA_APP_ID,
        channelProfile: ChannelProfileType.ChannelProfileCommunication,
      });
      engine.enableAudio();

      // ── Force loudspeaker routing ────────────────────────────────
      // ChannelProfileCommunication puts the device's audio session into
      // "phone call" mode. Left alone, that routes EVERYTHING — the
      // voice chat itself AND every other sound the app plays (weapon
      // fire, hit impacts, UI beeps — anything through expo-audio in
      // services/sfx.ts) — through the tiny earpiece speaker instead of
      // the main loudspeaker, and noticeably quieter, exactly like
      // being on a phone call. Explicitly forcing speakerphone-on fixes
      // both the voice chat AND every game sound effect at once, since
      // they share the same OS audio output route.
      try {
        engine.setDefaultAudioRouteToSpeakerphone(true);
        engine.setEnableSpeakerphone(true);
      } catch (err) {
        console.warn('[voiceChat] failed to force speakerphone routing:', err);
      }
      // Recording volume boost — Agora's default (100) is tuned
      // conservatively for typical phone-call proximity; games are
      // usually played with the phone held at arm's length in landscape,
      // further from the mic, so voices came through noticeably faint.
      // 100–400 is Agora's supported range; 200 (2x) is a solid, safe
      // "clear and audible" boost without pushing into clipping/distortion.
      try {
        engine.adjustRecordingSignalVolume(200);
      } catch (err) {
        console.warn('[voiceChat] failed to boost recording volume:', err);
      }
      // Playback (call) volume — apply whatever was set via
      // setCallPlaybackVolume() before the engine existed, defaulting to
      // the same 200 this used to be hardcoded to.
      try {
        engine.adjustPlaybackSignalVolume(pendingPlaybackVolume ?? 200);
      } catch (err) {
        console.warn('[voiceChat] failed to set initial playback volume:', err);
      }

      // These fire for EVERY event Agora reports — logging them here means
      // any join failure (bad App ID, certificate/token mismatch, network
      // block, etc.) shows up in `adb logcat` even without extra setup, and
      // also drives the on-screen status badge in game.tsx.
      engine.registerEventHandler({
        onJoinChannelSuccess: (_connection: unknown, elapsed: number) => {
          console.log('[voiceChat] onJoinChannelSuccess, elapsed=', elapsed);
          setStatus({ state: 'joined', remoteCount: remoteUids.size });
        },
        onUserJoined: (_connection: unknown, remoteUid: number) => {
          console.log('[voiceChat] remote user joined:', remoteUid);
          remoteUids.add(remoteUid);
          setStatus({ state: 'joined', remoteCount: remoteUids.size });
        },
        onUserOffline: (_connection: unknown, remoteUid: number) => {
          console.log('[voiceChat] remote user left:', remoteUid);
          remoteUids.delete(remoteUid);
          setStatus({ state: 'joined', remoteCount: remoteUids.size });
        },
        onError: (err: number, msg: string) => {
          console.warn('[voiceChat] Agora onError:', err, msg);
          setStatus({ state: 'error', message: `code ${err}: ${msg}` });
        },
        onConnectionStateChanged: (_connection: unknown, state: unknown, reason: unknown) => {
          console.log('[voiceChat] connection state:', state, 'reason:', reason);
        },
      });
    } catch (err) {
      // Belt-and-suspenders: even if the module loaded, engine creation
      // itself can still fail on a misconfigured build. Never let that
      // escape and crash the app.
      console.warn('[voiceChat] failed to create/initialize Agora engine:', err);
      engine = null;
      setStatus({ state: 'error', message: `engine init failed: ${String(err)}` });
      return null;
    }
  }
  return engine;
}

/** Join the shared voice channel for a game room. Everyone who joins the
 *  same `channelName` hears each other automatically — no server-side
 *  audio routing needed, Agora's network handles it.
 *
 *  Safe to call even when voice isn't available (Expo Go, etc.) — it just
 *  reports `unavailable` status and resolves `false` instead of throwing. */
export async function joinVoiceChannel(channelName: string, uid: number): Promise<boolean> {
  if (!isVoiceAvailable()) {
    setStatus({
      state: 'unavailable',
      message: 'الشات الصوتي غير مدعوم في هذه النسخة (يحتاج Dev Build)',
    });
    return false;
  }

  setStatus({ state: 'requesting-permission' });
  const granted = await requestMicPermission();
  if (!granted) {
    setStatus({ state: 'permission-denied' });
    return false;
  }

  try {
    setStatus({ state: 'joining' });
    remoteUids = new Set();
    const e = getEngine();
    if (!e) {
      setStatus({ state: 'error', message: 'تعذر تشغيل محرك الصوت' });
      return false;
    }
    if (joinedChannel === channelName) return true;
    if (joinedChannel) e.leaveChannel();

    const { ClientRoleType } = AgoraModule;

    const token = await fetchAgoraToken(channelName, uid);
    if (!token) {
      setStatus({
        state: 'error',
        message: 'تعذر الحصول على تصريح الدخول من الخادم — تأكد من نشر agora-token-vercel ووضع رابطه بـ TOKEN_ENDPOINT',
      });
      return false;
    }
    e.joinChannel(token, channelName, uid, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    });
    joinedChannel = channelName;
    // Some Agora SDK versions reset the audio route the moment a channel
    // is actually joined (as opposed to just when the engine is created),
    // so re-assert speakerphone here too — belt and suspenders.
    try {
      e.setEnableSpeakerphone(true);
    } catch {
      // non-fatal — the init-time call above is the primary fix
    }
    return true;
  } catch (err) {
    setStatus({ state: 'error', message: `joinChannel threw: ${String(err)}` });
    console.warn('[voiceChat] joinVoiceChannel failed:', err);
    return false;
  }
}

export function leaveVoiceChannel(): void {
  if (!isVoiceAvailable()) return;
  try {
    engine?.leaveChannel();
  } catch {
    // ignore
  } finally {
    joinedChannel = null;
    remoteUids = new Set();
    setStatus({ state: 'idle' });
  }
}

/** true = mic is OFF (muted), matching VoiceButton's `isMuted` prop */
export function setVoiceMuted(muted: boolean): void {
  if (!isVoiceAvailable()) return;
  try {
    engine?.muteLocalAudioStream(muted);
  } catch (err) {
    console.warn('[voiceChat] setVoiceMuted failed:', err);
  }
}

/** Sets how loud OTHER players' voices sound to you (0..1, mapped to
 *  Agora's own 0-400 playback-volume range — 1.0 here means "the loudest
 *  boost Agora allows", not "Agora's own unboosted default"). Safe to
 *  call before the voice engine exists yet (e.g. from the settings
 *  screen before ever joining a channel) — the value is remembered and
 *  applied automatically the moment the engine is created. */
export function setCallPlaybackVolume(percent0to1: number): void {
  if (!isVoiceAvailable()) return;
  const agoraVal = Math.round(Math.max(0, Math.min(1, percent0to1)) * 400);
  pendingPlaybackVolume = agoraVal;
  if (engine) {
    try {
      engine.adjustPlaybackSignalVolume(agoraVal);
    } catch (err) {
      console.warn('[voiceChat] setCallPlaybackVolume failed:', err);
    }
  }
}

/** Call once when leaving the game screen entirely (not just muting). */
export function destroyVoiceEngine(): void {
  if (!isVoiceAvailable()) return;
  try {
    engine?.leaveChannel();
    engine?.release();
  } catch {
    // ignore
  } finally {
    engine = null;
    joinedChannel = null;
  }
}
