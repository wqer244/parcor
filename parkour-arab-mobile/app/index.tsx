import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ensureServerExists } from '@/services/firebase';

const { width: SW, height: SH } = Dimensions.get('window');

// Seeded particle positions (no Math.random for consistency)
const PARTICLES = Array.from({ length: 30 }, (_, i) => ({
  id: i,
  x: (Math.sin(i * 23.45 + 1) * 0.5 + 0.5) * SW,
  y: (Math.cos(i * 17.89 + 0.3) * 0.5 + 0.5) * SH,
  size: 1.5 + (i % 4) * 0.8,
  delay: (i * 200) % 2000,
  duration: 2000 + (i * 300) % 1500,
}));

function Particle({ item }: { item: (typeof PARTICLES)[0] }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(item.delay),
        Animated.timing(opacity, {
          toValue: 0.6,
          duration: item.duration,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
        Animated.timing(opacity, {
          toValue: 0.05,
          duration: item.duration,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.sin),
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.View
      style={[
        styles.particle,
        {
          left: item.x,
          top: item.y,
          width: item.size,
          height: item.size,
          borderRadius: item.size / 2,
          opacity,
        },
      ]}
    />
  );
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();
  const titleScale = useRef(new Animated.Value(0.85)).current;
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const btnOpacity = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    ensureServerExists();

    Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.spring(titleScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
      ]),
      Animated.timing(btnOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, { toValue: 1, duration: 1800, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
        Animated.timing(glowAnim, { toValue: 0, duration: 1800, useNativeDriver: true, easing: Easing.inOut(Easing.sin) }),
      ]),
    ).start();
  }, []);

  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  return (
    <LinearGradient colors={['#060612', '#0a0a20', '#0d0d2e']} style={styles.container}>
      {/* Background particles */}
      {PARTICLES.map((p) => (
        <Particle key={p.id} item={p} />
      ))}

      {/* Grid lines */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {Array.from({ length: 8 }, (_, i) => (
          <View
            key={`h${i}`}
            style={[styles.gridLine, { top: (SH / 8) * i, width: SW }]}
          />
        ))}
        {Array.from({ length: 6 }, (_, i) => (
          <View
            key={`v${i}`}
            style={[styles.gridLineV, { left: (SW / 6) * i, height: SH }]}
          />
        ))}
      </View>

      {/* Logo area */}
      <View style={[styles.logoArea, { paddingTop: topPad + 60 }]}>
        {/* Glow blob */}
        <Animated.View style={[styles.glowBlob, { opacity: glowOpacity }]} />

        <Animated.View style={{ opacity: titleOpacity, transform: [{ scale: titleScale }] }}>
          {/* Arabic title */}
          <Text style={styles.titleAr}>باركور العرب</Text>
          <Text style={styles.subtitle}>لعبة الباركور الأونلاين</Text>

          {/* Tagline */}
          <Text style={styles.tagline}>العب · اقفز · تنافس</Text>
        </Animated.View>
      </View>

      {/* City silhouette */}
      <View style={styles.cityRow} pointerEvents="none">
        {[40, 70, 55, 90, 45, 80, 60, 95, 50, 75, 65, 85, 50, 70].map((h, i) => (
          <View
            key={i}
            style={[
              styles.building,
              {
                height: h,
                width: SW / 14 - 2,
                opacity: 0.15 + (i % 3) * 0.05,
              },
            ]}
          />
        ))}
      </View>

      {/* CTA */}
      <Animated.View style={[styles.btnArea, { opacity: btnOpacity, paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 40 }]}>
        <Pressable
          style={({ pressed }) => [styles.startBtn, pressed && styles.startBtnPressed]}
          onPress={() => router.push('/servers')}
        >
          <LinearGradient
            colors={['#00ffcc', '#00cc99']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.startBtnGradient}
          >
            <Text style={styles.startBtnText}>ابدأ اللعب</Text>
          </LinearGradient>
        </Pressable>
        <Text style={styles.hint}>انضم إلى لاعبين من العالم العربي</Text>
      </Animated.View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  particle: {
    position: 'absolute',
    backgroundColor: '#00ffcc',
  },
  gridLine: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(0,255,204,0.04)',
  },
  gridLineV: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(0,170,255,0.04)',
  },
  logoArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowBlob: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(0,255,204,0.06)',
  },
  titleAr: {
    fontSize: 46,
    fontWeight: '900',
    color: '#00ffcc',
    textAlign: 'center',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,255,204,0.6)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 20,
    fontFamily: 'Inter_700Bold',
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(0,255,204,0.7)',
    textAlign: 'center',
    marginTop: 6,
    letterSpacing: 0.5,
    fontFamily: 'Inter_400Regular',
  },
  tagline: {
    fontSize: 13,
    color: 'rgba(170,187,255,0.6)',
    textAlign: 'center',
    marginTop: 16,
    letterSpacing: 3,
    fontFamily: 'Inter_500Medium',
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 2,
    marginBottom: -2,
  },
  building: {
    backgroundColor: '#0d1a3a',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    marginHorizontal: 1,
  },
  btnArea: {
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  startBtn: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#00ffcc',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 8,
  },
  startBtnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  startBtnGradient: {
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  startBtnText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#060612',
    letterSpacing: 0.5,
    fontFamily: 'Inter_700Bold',
  },
  hint: {
    marginTop: 14,
    fontSize: 12,
    color: 'rgba(85,102,170,0.8)',
    textAlign: 'center',
    fontFamily: 'Inter_400Regular',
  },
});
