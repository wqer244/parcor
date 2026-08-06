// ────────────────────────────────────────────────────────
// Audio settings — SFX volume, call (voice chat) volume, and a master
// volume that scales both at once.
// ────────────────────────────────────────────────────────
// Plain module-level state + a tiny pub/sub, not React state or context —
// this needs to be readable from services/sfx.ts's play() function on
// every single sound effect call, which isn't a React component and
// shouldn't have to thread a value down through props just for that.
// The settings screen (game.tsx) subscribes via subscribeAudioSettings()
// so its sliders re-render when a value changes from anywhere (including
// on initial load, once loadAudioSettings() finishes reading from disk).
//
// All three values are 0..1 internally (sliders show them as 0-100%).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setCallPlaybackVolume } from './voiceChat';

const KEY_SFX = 'audioSettings:sfxVolume';
const KEY_CALL = 'audioSettings:callVolume';
const KEY_MASTER = 'audioSettings:masterVolume';

// Defaults: SFX and master at 100% (unmodified from how the game always
// sounded), call at 50% — which maps to the exact same Agora playback
// boost (200 out of its 0-400 range) that was already hardcoded before
// this became user-adjustable. Nobody's experience changes until they
// actually touch a slider.
let sfxVolume = 1;
let callVolume = 0.5;
let masterVolume = 1;
let loaded = false;

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach((l) => l());
}

/** Subscribe to any audio-setting change (e.g. to re-render sliders).
 *  Returns an unsubscribe function. */
export function subscribeAudioSettings(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

/** Reads saved volumes from disk and applies them (call volume gets
 *  pushed to the voice engine too). Call once, early — game.tsx does
 *  this on mount. Safe to call more than once; later calls are no-ops. */
export async function loadAudioSettings(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const [sfx, call, master] = await Promise.all([
      AsyncStorage.getItem(KEY_SFX),
      AsyncStorage.getItem(KEY_CALL),
      AsyncStorage.getItem(KEY_MASTER),
    ]);
    if (sfx !== null) sfxVolume = clamp01(parseFloat(sfx));
    if (call !== null) callVolume = clamp01(parseFloat(call));
    if (master !== null) masterVolume = clamp01(parseFloat(master));
  } catch (err) {
    // No saved settings yet, or storage unavailable — keep the defaults
    // above. Never let a storage read failure block audio from working.
    console.warn('[audioSettings] failed to load saved volumes, using defaults:', err);
  }
  setCallPlaybackVolume(callVolume * masterVolume);
  notify();
}

export function getSfxVolume(): number {
  return sfxVolume;
}
export function getCallVolume(): number {
  return callVolume;
}
export function getMasterVolume(): number {
  return masterVolume;
}
/** What services/sfx.ts should actually multiply into every clip's
 *  volume — SFX slider combined with the master slider. */
export function getEffectiveSfxVolume(): number {
  return sfxVolume * masterVolume;
}

export function setSfxVolume(v: number): void {
  sfxVolume = clamp01(v);
  AsyncStorage.setItem(KEY_SFX, String(sfxVolume)).catch((err) => {
    console.warn('[audioSettings] failed to save SFX volume:', err);
  });
  notify();
}

export function setCallVolume(v: number): void {
  callVolume = clamp01(v);
  AsyncStorage.setItem(KEY_CALL, String(callVolume)).catch((err) => {
    console.warn('[audioSettings] failed to save call volume:', err);
  });
  setCallPlaybackVolume(callVolume * masterVolume);
  notify();
}

export function setMasterVolume(v: number): void {
  masterVolume = clamp01(v);
  AsyncStorage.setItem(KEY_MASTER, String(masterVolume)).catch((err) => {
    console.warn('[audioSettings] failed to save master volume:', err);
  });
  setCallPlaybackVolume(callVolume * masterVolume);
  notify();
}
