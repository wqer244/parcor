import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { db, ref, onValue, off } from '@/services/firebase';
import { usePlayer } from '@/context/PlayerContext';

interface ServerData {
  name: string;
  region: string;
}

export default function ServersScreen() {
  const insets = useSafeAreaInsets();
  const { isReady } = usePlayer();

  const [server, setServer] = useState<ServerData | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    // Listen to server info
    const serverRef = ref(db, 'servers/parkour-arab');
    onValue(serverRef, (snap) => {
      const data = snap.val() as ServerData | null;
      setServer(data ?? { name: 'باركور العرب', region: 'العالم العربي' });
      setLoading(false);
    });

    // Count players in this server
    const playersRef = ref(db, 'game/players');
    onValue(playersRef, (snap) => {
      const data = snap.val() as Record<string, { serverId: string }> | null;
      if (!data) { setPlayerCount(0); return; }
      const count = Object.values(data).filter(
        (p) => p.serverId === 'parkour-arab',
      ).length;
      setPlayerCount(count);
    });

    return () => {
      off(serverRef);
      off(ref(db, 'game/players'));
    };
  }, []);

  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  async function handleJoin() {
    setJoining(true);
    router.push('/game');
  }

  return (
    <LinearGradient colors={['#060612', '#0a0a20']} style={styles.container}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#00ffcc" />
        </Pressable>
        <Text style={styles.headerTitle}>اختر السيرفر</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.body}>
        <Text style={styles.sectionLabel}>السيرفرات المتاحة</Text>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#00ffcc" />
          </View>
        ) : (
          <View style={styles.serverCard}>
            {/* Glow border */}
            <LinearGradient
              colors={['rgba(0,255,204,0.3)', 'rgba(0,170,255,0.15)', 'transparent']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View style={styles.cardInner}>
              {/* Left: Server info */}
              <View style={styles.cardLeft}>
                {/* Status indicator */}
                <View style={styles.statusRow}>
                  <View style={styles.statusDot} />
                  <Text style={styles.statusText}>أونلاين</Text>
                </View>

                <Text style={styles.serverName}>{server?.name ?? 'باركور العرب'}</Text>
                <Text style={styles.serverRegion}>{server?.region ?? 'العالم العربي'}</Text>

                {/* Players */}
                <View style={styles.playersRow}>
                  <Ionicons name="people" size={14} color="#5566aa" />
                  <Text style={styles.playersText}>
                    {playerCount} {playerCount === 1 ? 'لاعب نشط' : 'لاعبين نشطين'}
                  </Text>
                </View>
              </View>

              {/* Right: Join button */}
              <Pressable
                style={({ pressed }) => [styles.joinBtn, pressed && styles.joinBtnPressed]}
                onPress={handleJoin}
                disabled={joining || !isReady}
              >
                {joining ? (
                  <ActivityIndicator color="#060612" size="small" />
                ) : (
                  <>
                    <Ionicons name="play" size={18} color="#060612" />
                    <Text style={styles.joinBtnText}>انضم</Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {/* Info box */}
        <View style={styles.infoBox}>
          <Ionicons name="information-circle" size={16} color="#5566aa" />
          <Text style={styles.infoText}>
            ستظهر حركتك لجميع اللاعبين المتصلين بالسيرفر بشكل فوري
          </Text>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,255,204,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e0e8ff',
    fontFamily: 'Inter_700Bold',
  },
  body: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  sectionLabel: {
    fontSize: 12,
    color: '#5566aa',
    letterSpacing: 1.5,
    marginBottom: 12,
    textTransform: 'uppercase',
    fontFamily: 'Inter_500Medium',
  },
  loadingBox: {
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverCard: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: 'rgba(10,10,30,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,204,0.25)',
    marginBottom: 20,
  },
  cardInner: {
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: { flex: 1 },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00ffcc',
    marginRight: 6,
  },
  statusText: {
    fontSize: 11,
    color: '#00ffcc',
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
  serverName: {
    fontSize: 22,
    fontWeight: '800',
    color: '#e0e8ff',
    marginBottom: 4,
    fontFamily: 'Inter_700Bold',
  },
  serverRegion: {
    fontSize: 13,
    color: '#5566aa',
    marginBottom: 12,
    fontFamily: 'Inter_400Regular',
  },
  playersRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playersText: {
    fontSize: 13,
    color: '#5566aa',
    fontFamily: 'Inter_400Regular',
  },
  joinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#00ffcc',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 6,
  },
  joinBtnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.96 }],
  },
  joinBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#060612',
    fontFamily: 'Inter_700Bold',
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: 'rgba(85,102,170,0.1)',
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(85,102,170,0.2)',
  },
  infoText: {
    flex: 1,
    fontSize: 12,
    color: '#5566aa',
    lineHeight: 18,
    fontFamily: 'Inter_400Regular',
  },
});
