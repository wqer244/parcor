import { initializeApp, getApps } from 'firebase/app';
import {
  getDatabase,
  ref,
  set,
  get,
  update,
  onValue,
  remove,
  onDisconnect,
  increment,
  off,
  push,
} from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyCYQwDuffVOLT6MP3GcpZiPBcOlLAWVXGI',
  authDomain: 'instalite-g8ani.firebaseapp.com',
  databaseURL:
    'https://instalite-g8ani-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'instalite-g8ani',
  storageBucket: 'instalite-g8ani.firebasestorage.app',
  messagingSenderId: '386952224474',
  appId: '1:386952224474:android:d6d60fab4492d58de78fe3',
};

const firebaseApp =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const db = getDatabase(firebaseApp);

export {
  ref,
  set,
  get,
  update,
  onValue,
  remove,
  onDisconnect,
  increment,
  off,
  push,
};

/** Ensure the "باركور العرب" server exists in the database */
export async function ensureServerExists(): Promise<void> {
  try {
    const serverRef = ref(db, 'servers/parkour-arab');
    const snap = await get(serverRef);
    if (!snap.exists()) {
      await set(serverRef, {
        name: 'باركور العرب',
        region: 'العالم العربي',
        createdAt: Date.now(),
      });
    }
  } catch {
    // Offline – ignore
  }
}
