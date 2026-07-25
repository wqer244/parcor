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

let engine: IRtcEngine | null = null;
let joinedChannel: string | null = null;

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
  } catch {
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
  }
  return engine;
}

/** Join the shared voice channel for a game room. Everyone who joins the
 *  same `channelName` hears each other automatically — no server-side
 *  audio routing needed, Agora's network handles it. */
export async function joinVoiceChannel(channelName: string, uid: number): Promise<boolean> {
  const granted = await requestMicPermission();
  if (!granted) return false;

  try {
    const e = getEngine();
    if (joinedChannel === channelName) return true;
    if (joinedChannel) e.leaveChannel();

    e.joinChannel('', channelName, uid, {
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
    });
    joinedChannel = channelName;
    return true;
  } catch (err) {
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
