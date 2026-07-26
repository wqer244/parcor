import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  db,
  ref,
  set,
  onValue,
  remove,
  onDisconnect,
  off,
} from '@/services/firebase';
import { PLAYER_COLORS } from '@/services/game3DPhysics';
import { DEFAULT_SKIN_ID, getSkin } from '@/constants/skins';

export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  color: string;
  skinId?: string;
  name: string;
  serverId: string;
  lastUpdate: number;
}

interface PlayerContextValue {
  playerId: string;
  playerColor: string;
  playerSkinId: string;
  playerName: string;
  remotePlayers: RemotePlayer[];
  isReady: boolean;
  joinServer: (serverId: string) => Promise<void>;
  leaveServer: () => Promise<void>;
  syncPosition: (x: number, y: number, z: number, vx: number, vy: number, vz: number) => void;
  setPlayerSkin: (skinId: string) => Promise<void>;
}

const PlayerContext = createContext<PlayerContextValue | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const [playerId, setPlayerId] = useState('');
  const [playerColor, setPlayerColor] = useState('#00CED1');
  const [playerSkinId, setPlayerSkinId] = useState(DEFAULT_SKIN_ID);
  const [playerName, setPlayerName] = useState('');
  const [remotePlayers, setRemotePlayers] = useState<RemotePlayer[]>([]);
  const [isReady, setIsReady] = useState(false);

  const currentServerRef = useRef<string | null>(null);
  const syncThrottleRef = useRef(0);
  const playerColorRef = useRef(playerColor);
  const playerSkinIdRef = useRef(playerSkinId);
  const playerNameRef = useRef(playerName);
  const playerIdRef = useRef('');

  useEffect(() => {
    playerColorRef.current = playerColor;
    playerSkinIdRef.current = playerSkinId;
    playerNameRef.current = playerName;
    playerIdRef.current = playerId;
  }, [playerColor, playerSkinId, playerName, playerId]);

  useEffect(() => {
    async function initPlayer() {
      try {
        let id = await AsyncStorage.getItem('parcour_player_id');
        if (!id) {
          id = Date.now().toString() + Math.random().toString(36).substring(2, 9);
          await AsyncStorage.setItem('parcour_player_id', id);
        }
        const storedIdx = await AsyncStorage.getItem('parcour_color_idx');
        let colorIdx =
          storedIdx != null ? parseInt(storedIdx) : Math.floor(Math.random() * PLAYER_COLORS.length);
        if (storedIdx == null) {
          await AsyncStorage.setItem('parcour_color_idx', colorIdx.toString());
        }
        let name = await AsyncStorage.getItem('parcour_player_name');
        if (!name) {
          name = 'لاعب_' + id.slice(-4).toUpperCase();
          await AsyncStorage.setItem('parcour_player_name', name);
        }
        const storedSkinId = await AsyncStorage.getItem('parcour_skin_id');
        const skinId = storedSkinId ?? DEFAULT_SKIN_ID;

        setPlayerId(id);
        setPlayerSkinId(skinId);
        setPlayerColor(getSkin(skinId).accent);
        setPlayerName(name);
        setIsReady(true);
      } catch {
        const fallbackId = Date.now().toString() + Math.random().toString(36).substring(2, 7);
        setPlayerId(fallbackId);
        setIsReady(true);
      }
    }
    initPlayer();
  }, []);

  const setPlayerSkin = useCallback(async (skinId: string) => {
    const accent = getSkin(skinId).accent;
    setPlayerSkinId(skinId);
    setPlayerColor(accent);
    playerSkinIdRef.current = skinId;
    playerColorRef.current = accent;
    try {
      await AsyncStorage.setItem('parcour_skin_id', skinId);
    } catch { /* ignore */ }
    // If already in a server, push the new skin immediately so remote
    // players see the change without waiting for the next position sync.
    const id = playerIdRef.current;
    if (id && currentServerRef.current) {
      set(ref(db, `game3d/players/${id}/skinId`), skinId).catch(() => {});
      set(ref(db, `game3d/players/${id}/color`), accent).catch(() => {});
    }
  }, []);

  const joinServer = useCallback(async (serverId: string) => {
    const id = playerIdRef.current;
    if (!id) return;
    currentServerRef.current = serverId;
    try {
      const playerRef = ref(db, `game3d/players/${id}`);
      await onDisconnect(playerRef).remove();
      await set(playerRef, {
        x: 0, y: 0.5, z: 0,
        vx: 0, vy: 0, vz: 0,
        color: playerColorRef.current,
        skinId: playerSkinIdRef.current,
        name: playerNameRef.current || 'لاعب',
        serverId,
        lastUpdate: Date.now(),
      });

      const playersRef = ref(db, 'game3d/players');
      onValue(playersRef, (snap) => {
        const data = snap.val() as Record<string, RemotePlayer> | null;
        if (!data) { setRemotePlayers([]); return; }
        const others = Object.entries(data)
          .filter(([pid, p]) => pid !== id && p.serverId === serverId)
          .map(([pid, p]) => ({ ...p, id: pid }));
        setRemotePlayers(others);
      });
    } catch {
      // Firebase unavailable — solo play
    }
  }, []);

  const leaveServer = useCallback(async () => {
    const id = playerIdRef.current;
    if (!id) return;
    try {
      const playersRef = ref(db, 'game3d/players');
      off(playersRef);
      await remove(ref(db, `game3d/players/${id}`));
    } catch { /* ignore */ }
    currentServerRef.current = null;
    setRemotePlayers([]);
  }, []);

  const syncPosition = useCallback(
    (x: number, y: number, z: number, vx: number, vy: number, vz: number) => {
      const id = playerIdRef.current;
      if (!id || !currentServerRef.current) return;
      const now = Date.now();
      if (now - syncThrottleRef.current < 100) return; // ~10 fps
      syncThrottleRef.current = now;
      set(ref(db, `game3d/players/${id}`), {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        z: Math.round(z * 10) / 10,
        vx: Math.round(vx * 10) / 10,
        vy: Math.round(vy * 10) / 10,
        vz: Math.round(vz * 10) / 10,
        color: playerColorRef.current,
        skinId: playerSkinIdRef.current,
        name: playerNameRef.current || 'لاعب',
        serverId: currentServerRef.current,
        lastUpdate: Date.now(),
      }).catch(() => {});
    },
    [],
  );

  return (
    <PlayerContext.Provider
      value={{
        playerId,
        playerColor,
        playerSkinId,
        playerName,
        remotePlayers,
        isReady,
        joinServer,
        leaveServer,
        syncPosition,
        setPlayerSkin,
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
}

export function usePlayer(): PlayerContextValue {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}
