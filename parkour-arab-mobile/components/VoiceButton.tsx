/**
 * Voice chat button – UI is complete.
 * Full voice transmission uses Agora.io (App ID: af3d133c3cbe403895240eafde8e6d5b).
 * Agora's native SDK (react-native-agora) requires a dev build; the mute toggle
 * state is preserved here and will wire into AgoraRtcEngine in a dev build.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const AGORA_APP_ID = 'af3d133c3cbe403895240eafde8e6d5b';

interface Props {
  isMuted: boolean;
  onToggle: () => void;
}

export function VoiceButton({ isMuted, onToggle }: Props) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.btn,
        !isMuted && styles.btnActive,
        pressed && styles.btnPressed,
      ]}
      onPress={onToggle}
    >
      <Ionicons
        name={isMuted ? 'mic-off' : 'mic'}
        size={22}
        color={isMuted ? '#5566aa' : '#00ffcc'}
      />
      {!isMuted && <View style={styles.activeDot} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(10,10,30,0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(85,102,170,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnActive: {
    borderColor: '#00ffcc',
    backgroundColor: 'rgba(0,255,204,0.12)',
  },
  btnPressed: {
    opacity: 0.7,
  },
  activeDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ff4444',
  },
});
