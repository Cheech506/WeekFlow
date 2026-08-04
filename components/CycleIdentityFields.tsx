import { StyleSheet, TextInput } from 'react-native';

import { Text, View } from '@/components/Themed';
import {
  MAX_CYCLE_NAME_LENGTH,
  MAX_CYCLE_PRIMARY_FOCUS_LENGTH,
  MAX_CYCLE_THEME_LENGTH,
} from '@/lib/cycleIdentityUtils';

export default function CycleIdentityFields({
  name,
  primaryFocus,
  theme,
  onNameChange,
  onPrimaryFocusChange,
  onThemeChange,
}: {
  name: string;
  primaryFocus: string;
  theme: string;
  onNameChange: (value: string) => void;
  onPrimaryFocusChange: (value: string) => void;
  onThemeChange: (value: string) => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.field}>
        <Text style={styles.label}>Cycle name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={onNameChange}
          placeholder="Example: Fall 2026"
          maxLength={MAX_CYCLE_NAME_LENGTH}
        />
        <Text style={styles.help}>
          Optional. A recognizable name for this 12-week folder.
        </Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Primary focus</Text>
        <TextInput
          style={styles.textArea}
          value={primaryFocus}
          onChangeText={onPrimaryFocusChange}
          placeholder="What is the main outcome tying this cycle together?"
          multiline
          maxLength={MAX_CYCLE_PRIMARY_FOCUS_LENGTH}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Cycle theme</Text>
        <TextInput
          style={styles.input}
          value={theme}
          onChangeText={onThemeChange}
          placeholder="Example: Build the foundation"
          maxLength={MAX_CYCLE_THEME_LENGTH}
        />
        <Text style={styles.help}>
          Optional. A short phrase that describes how you want to approach the cycle.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    backgroundColor: 'transparent',
  },
  field: {
    backgroundColor: 'transparent',
  },
  label: {
    marginBottom: 6,
    fontWeight: '700',
    color: '#334155',
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: 16,
  },
  textArea: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#ffffff',
    color: '#111827',
    fontSize: 16,
    textAlignVertical: 'top',
  },
  help: {
    marginTop: 6,
    color: '#64748b',
    fontSize: 13,
  },
});
