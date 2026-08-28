import { StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { Text, View } from '@/components/Themed';

type ScreenIntroProps = {
  title: string;
  subtitle: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Shared top-of-screen copy keeps the five primary tabs and Settings visually
 * consistent while still allowing each screen to provide its own description.
 */
export function ScreenIntro({ title, subtitle, style }: ScreenIntroProps) {
  return (
    <View style={[styles.container, style]}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    opacity: 0.7,
    lineHeight: 22,
  },
});
