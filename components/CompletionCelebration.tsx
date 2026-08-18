import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useCelebrations } from '@/context/CelebrationContext';

export function CompletionCelebration() {
  const { activeCelebration, dismissCelebration } = useCelebrations();
  const progress = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (isMounted) setReduceMotion(enabled);
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion
    );

    return () => {
      isMounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!activeCelebration) {
      progress.setValue(0);
      return;
    }

    progress.stopAnimation();

    if (reduceMotion) {
      progress.setValue(1);
    } else {
      progress.setValue(0);
      Animated.spring(progress, {
        toValue: 1,
        damping: 16,
        stiffness: 220,
        mass: 0.8,
        useNativeDriver: true,
      }).start();
    }

    const timeout = setTimeout(
      dismissCelebration,
      activeCelebration.durationMs
    );

    return () => {
      clearTimeout(timeout);
      progress.stopAnimation();
    };
  }, [
    activeCelebration,
    dismissCelebration,
    progress,
    reduceMotion,
  ]);

  if (!activeCelebration) return null;

  const isCompact = activeCelebration.emphasis === 'compact';
  const isStrong = activeCelebration.emphasis === 'strong';

  const animatedStyle = reduceMotion
    ? undefined
    : {
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [-14, 0],
            }),
          },
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1],
            }),
          },
        ],
      };

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <Animated.View
        style={[
          styles.card,
          isCompact && styles.compactCard,
          isStrong && styles.strongCard,
          animatedStyle,
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss completion celebration"
          onPress={dismissCelebration}
          style={styles.pressable}
        >
          <View
            style={[
              styles.symbol,
              isCompact && styles.compactSymbol,
              isStrong && styles.strongSymbol,
            ]}
          >
            <Text
              style={[
                styles.symbolText,
                isCompact && styles.compactSymbolText,
              ]}
            >
              {activeCelebration.symbol}
            </Text>
          </View>

          <View style={styles.copy}>
            {activeCelebration.eyebrow ? (
              <Text style={styles.eyebrow}>
                {activeCelebration.eyebrow}
              </Text>
            ) : null}

            <Text
              style={[
                styles.title,
                isCompact && styles.compactTitle,
                isStrong && styles.strongTitle,
              ]}
              numberOfLines={isCompact ? 1 : 2}
            >
              {activeCelebration.title}
            </Text>

            {activeCelebration.detail ? (
              <Text
                style={[
                  styles.detail,
                  isCompact && styles.compactDetail,
                ]}
                numberOfLines={isCompact ? 1 : 2}
              >
                {activeCelebration.detail}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1000,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 62,
    paddingHorizontal: 18,
  },
  card: {
    width: '100%',
    maxWidth: 430,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: '#f0fdf4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 8,
  },
  compactCard: {
    maxWidth: 340,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  strongCard: {
    borderColor: '#c4b5fd',
    backgroundColor: '#f5f3ff',
  },
  pressable: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
  },
  symbol: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#16a34a',
  },
  compactSymbol: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#2563eb',
  },
  strongSymbol: {
    backgroundColor: '#7c3aed',
  },
  symbolText: {
    color: 'white',
    fontSize: 22,
    fontWeight: '900',
  },
  compactSymbolText: {
    fontSize: 18,
  },
  copy: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  eyebrow: {
    color: '#15803d',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    marginBottom: 3,
  },
  title: {
    color: '#14532d',
    fontSize: 17,
    fontWeight: '900',
  },
  compactTitle: {
    color: '#1e3a8a',
    fontSize: 15,
  },
  strongTitle: {
    color: '#5b21b6',
    fontSize: 20,
  },
  detail: {
    color: '#3f6212',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 3,
  },
  compactDetail: {
    color: '#475569',
    fontSize: 12,
    marginTop: 1,
  },
});
