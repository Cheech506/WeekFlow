import { Pressable, StyleSheet, TextInput } from 'react-native';

import CycleIdentityFields from '@/components/CycleIdentityFields';
import { Text, View } from '@/components/Themed';
import { formatDateKey } from '@/lib/dateUtils';
import { getFirstCycleGoalTransferSummary } from '@/lib/firstCycleOnboardingUtils';

export default function FirstCycleOnboarding({
  cycleName,
  cyclePrimaryFocus,
  cycleTheme,
  cycleStartDate,
  cycleEndDate,
  waitingGoalCount,
  message,
  dateError,
  onCycleNameChange,
  onCyclePrimaryFocusChange,
  onCycleThemeChange,
  onCycleStartDateChange,
  onStartCycle,
}: {
  cycleName: string;
  cyclePrimaryFocus: string;
  cycleTheme: string;
  cycleStartDate: string;
  cycleEndDate: string | null;
  waitingGoalCount: number;
  message: string;
  dateError: string;
  onCycleNameChange: (value: string) => void;
  onCyclePrimaryFocusChange: (value: string) => void;
  onCycleThemeChange: (value: string) => void;
  onCycleStartDateChange: (value: string) => void;
  onStartCycle: () => void;
}) {
  const goalTransferSummary =
    getFirstCycleGoalTransferSummary(waitingGoalCount);

  return (
    <View style={styles.container}>
      <View style={styles.introCard}>
        <Text style={styles.eyebrow}>FIRST CYCLE SETUP</Text>
        <Text style={styles.title}>Build your first 12-week cycle</Text>
        <Text style={styles.subtitle}>
          A cycle is the main planning folder for your goals. WeekFlow keeps it
          to twelve execution weeks, then uses Week 13 for the cycle review and
          next-cycle decisions.
        </Text>
      </View>

      <View style={styles.stepsGrid}>
        <View style={styles.stepCard}>
          <Text style={styles.stepNumber}>1</Text>
          <Text style={styles.stepTitle}>Give the cycle context</Text>
          <Text style={styles.stepText}>
            Name, primary focus, and theme are optional. They make this cycle
            easier to recognize later in History and cycle reports.
          </Text>
        </View>

        <View style={styles.stepCard}>
          <Text style={styles.stepNumber}>2</Text>
          <Text style={styles.stepTitle}>Choose the first day</Text>
          <Text style={styles.stepText}>
            WeekFlow calculates the final day automatically so the cycle always
            contains twelve complete seven-day weeks.
          </Text>
        </View>

        <View style={styles.stepCard}>
          <Text style={styles.stepNumber}>3</Text>
          <Text style={styles.stepTitle}>{goalTransferSummary.title}</Text>
          <Text style={styles.stepText}>
            {goalTransferSummary.description}
          </Text>
        </View>
      </View>

      <View style={styles.setupSection}>
        <Text style={styles.sectionTitle}>Cycle details</Text>

        <CycleIdentityFields
          name={cycleName}
          primaryFocus={cyclePrimaryFocus}
          theme={cycleTheme}
          onNameChange={onCycleNameChange}
          onPrimaryFocusChange={onCyclePrimaryFocusChange}
          onThemeChange={onCycleThemeChange}
        />

        <View style={styles.cycleForm}>
          <View style={styles.cycleDateField}>
            <Text style={styles.label}>Cycle start date</Text>
            <TextInput
              style={styles.dateInput}
              value={cycleStartDate}
              onChangeText={onCycleStartDateChange}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.cycleDatePreview}>
            <Text style={styles.previewLabel}>Calculated end date</Text>
            <Text style={styles.previewValue}>
              {cycleEndDate
                ? formatDateKey(cycleEndDate)
                : 'Enter a valid start date'}
            </Text>
          </View>
        </View>

        {message || dateError ? (
          <Text style={styles.errorText}>{message || dateError}</Text>
        ) : (
          <Text style={styles.helpText}>
            Nothing is deleted when you start. Existing active goals are linked
            to this first cycle, and you can keep adding goals afterward.
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          style={styles.startButton}
          onPress={onStartCycle}
        >
          <Text style={styles.startButtonText}>Start My First Cycle</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 14,
    backgroundColor: 'transparent',
  },
  introCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#ffffff',
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    color: '#2563eb',
  },
  title: {
    marginTop: 5,
    fontSize: 22,
    fontWeight: '900',
    color: '#111827',
  },
  subtitle: {
    marginTop: 7,
    fontSize: 13,
    lineHeight: 19,
    color: '#4b5563',
  },
  stepsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: 'transparent',
  },
  stepCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 210,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#dbeafe',
    backgroundColor: '#ffffff',
  },
  stepNumber: {
    alignSelf: 'flex-start',
    minWidth: 26,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'center',
  },
  stepTitle: {
    marginTop: 9,
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
  },
  stepText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 18,
    color: '#64748b',
  },
  setupSection: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#93c5fd',
    backgroundColor: '#f8fbff',
    gap: 14,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: '#111827',
  },
  cycleForm: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    gap: 10,
    backgroundColor: 'transparent',
  },
  cycleDateField: {
    flex: 1,
    minWidth: 190,
    backgroundColor: 'transparent',
  },
  label: {
    marginBottom: 6,
    fontWeight: '700',
    color: '#334155',
  },
  dateInput: {
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
  cycleDatePreview: {
    flex: 1,
    minWidth: 190,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#ffffff',
  },
  previewLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#6b7280',
  },
  previewValue: {
    marginTop: 3,
    fontSize: 14,
    fontWeight: '900',
    color: '#1e3a8a',
  },
  helpText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#4b5563',
  },
  errorText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#b91c1c',
  },
  startButton: {
    alignSelf: 'flex-start',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#2563eb',
  },
  startButtonText: {
    color: '#ffffff',
    fontWeight: '900',
  },
});
