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
// ⚠️ SETUP REQUIRED — read this before it will work:
//
// 1. Install the native SDK (this repo's package.json now lists it, but the
//    package itself has to be fetched from npm with a real internet
//    connection — something this assistant cannot do from its sandbox):
//       npm install
//    If `npm ci` complains about the lockfile being out of sync, delete
//    package-lock.json and commit that — the same fix used earlier for the
//    babel-preset-expo issue. EAS will regenerate a correct lockfile.
//
// 2. This is a native module, so it only works in an EAS/dev build (which
//    you're already using) — NOT in Expo Go.
//
// 3. Agora App ID `af3d133c3cbe403895240eafde8e6d5b` was already in the old
//    placeholder code. For joining WITHOUT a token server (simplest path),
//    open this project in the Agora Console → Project Management → make
//    sure "App Certificate" is DISABLED (primary-certificate-free / testing
//    mode). If a certificate is enabled, every joinChannel call needs a
//    signed token from a backend server, which is outside what this app
//    currently has — ask me if you want that added later.
//
// 4. react-native-agora's exact API can shift slightly between versions.
//    If the build fails on an unfamiliar method/type name from this file,
//    check node_modules/react-native-agora's TypeScript defs and tell me
//    the mismatch — I'll adjust this file to match.
// ────────────────────────────────────────────────────────────────────────────
import { PermissionsAndroid, Platform } from 'react-native';
import {
  createAgoraRtcEngine,
  IRtcEngine,
  ChannelProfileType,
  ClientRoleType,
} from 'react-native-agora';

const AGORA_APP_ID = 'af3d133c3cbe403895240eafde8e6d5b';

// ⚠️ TEMPORARY TESTING TOKEN — generated manually from the Agora Console
// for the channel name below only. It expires ~24h after being generated
// (created 2026-07-25). This is NOT a production solution: every user
// needs their own valid token, and it must be generated fresh per session
// by a backend server (Agora provides a token-generation library for
// Node/etc. for this). Once real voice chat is confirmed working with
// this temp token, ask me to help set up a proper token server — don't
// ship this hardcoded token in a real release.
const TEMP_TESTING_TOKEN =
  '007eJxTYIhk7p7vdq1el8ekbr0Q63rPOJnfp04fWezGE7DrY+eu/9YKDIlpximGxsbJxslJqSYGxhaWpkYmBqmJaSmpFqlmKaZJcxRTsxoCGRlYnmxgZmSAQBCfn6EgsSg7v7RIN7EoMUnXOIWBAQCDayL6';
const TEMP_TESTING_CHANNEL = 'parkour-arab-3d';

let engine: IRtcEngine | null = null;
let joinedChannel: string | null = null;

// ── Debug status — surfaced on-screen in game.tsx, since there's no way
//    to see device logs remotely. This is the fastest way to tell WHICH
//    step is failing (permission / join / token-rejected / etc).
export type VoiceStatus =
  | { state: 'idle' }
  | { state: 'requesting-permission' }
  | { state: 'permission-denied' }
  | { state: 'joining' }
  | { state: 'joined'; remoteCount: number }
  | { state: 'error'; message: string };

let statusListener: ((s: VoiceStatus) => void) | null = null;
let lastStatus: VoiceStatus = { state: 'idle' };
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

function getEngine(): IRtcEngine {
  if (!engine) {
    engine = createAgoraRtcEngine();
    engine.initialize({
      appId: AGORA_APP_ID,
      channelProfile: ChannelProfileType.ChannelProfileCommunication,
    });
    engine.enableAudio();

    // These fire for EVERY event Agora reports — logging them here means
    // any join failure (bad App ID, certificate/token mismatch, network
    // block, etc.) shows up in `adb logcat` even without extra setup, and
    // also drives the on-screen status badge in game.tsx.
    engine.registerEventHandler({
      onJoinChannelSuccess: (_connection, elapsed) => {
        console.log('[voiceChat] onJoinChannelSuccess, elapsed=', elapsed);
        setStatus({ state: 'joined', remoteCount: remoteUids.size });
      },
      onUserJoined: (_connection, remoteUid) => {
        console.log('[voiceChat] remote user joined:', remoteUid);
        remoteUids.add(remoteUid);
        setStatus({ state: 'joined', remoteCount: remoteUids.size });
      },
      onUserOffline: (_connection, remoteUid) => {
        console.log('[voiceChat] remote user left:', remoteUid);
        remoteUids.delete(remoteUid);
        setStatus({ state: 'joined', remoteCount: remoteUids.size });
      },
      onError: (err, msg) => {
        console.warn('[voiceChat] Agora onError:', err, msg);
        setStatus({ state: 'error', message: `code ${err}: ${msg}` });
      },
      onConnectionStateChanged: (_connection, state, reason) => {
        console.log('[voiceChat] connection state:', state, 'reason:', reason);
      },
    });
  }
  return engine;
}

/** Join the shared voice channel for a game room. Everyone who joins the
 *  same `channelName` hears each other automatically — no server-side
 *  audio routing needed, Agora's network handles it. */
export async function joinVoiceChannel(channelName: string, uid: number): Promise<boolean> {
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
    if (joinedChannel === channelName) return true;
    if (joinedChannel) e.leaveChannel();

    // ⚠️ Empty token ('') only works if this Agora project's "App
    // Certificate" is DISABLED (Testing Mode) in the Agora Console. If it's
    // enabled, this join is silently rejected — nobody connects, so no
    // audio flows in either direction, on any device. That symmetric
    // total-silence symptom is the #1 sign this is the actual cause.
    // Use the temp testing token ONLY for the exact channel it was
    // generated for; any other channel name still tries token-less join
    // (which will keep failing until Certificate is disabled or a real
    // token server exists).
    const token = channelName === TEMP_TESTING_CHANNEL ? TEMP_TESTING_TOKEN : '';
    e.joinChannel(token, channelName, uid, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    });
    joinedChannel = channelName;
    return true;
  } catch (err) {
    setStatus({ state: 'error', message: `joinChannel threw: ${String(err)}` });
    console.warn('[voiceChat] joinVoiceChannel failed:', err);
    return false;
  }
}

export function leaveVoiceChannel(): void {
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
  try {
    engine?.muteLocalAudioStream(muted);
  } catch (err) {
    console.warn('[voiceChat] setVoiceMuted failed:', err);
  }
}

/** Call once when leaving the game screen entirely (not just muting). */
export function destroyVoiceEngine(): void {
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
