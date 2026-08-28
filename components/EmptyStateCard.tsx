import Ionicons from '@expo/vector-icons/Ionicons';
import { ComponentProps } from 'react';
import { StyleProp, StyleSheet, ViewStyle } from 'react-native';

import { Text, View } from '@/components/Themed';

type EmptyStateCardProps = {
  title: string;
  description?: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  style?: StyleProp<ViewStyle>;
};

/**
 * A single empty-state treatment makes "nothing here" feel intentional rather
 * than like a missing section. Callers can choose an icon that matches the
 * surrounding workflow without duplicating card styling on every screen.
 */
export function EmptyStateCard({
  title,
  description,
  icon = 'checkmark-circle-outline',
  style,
}: EmptyStateCardProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={20} color="#475569" />
      </View>

      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    backgroundColor: '#f8fafc',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#e2e8f0',
  },
  copy: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#111827',
  },
  description: {
    marginTop: 4,
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
});
