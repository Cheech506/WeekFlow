import { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import type {
  WeeklyReview,
  WeeklyReviewStatus,
} from '@/lib/weeklyReview';
import {
  MAX_WEEKLY_REVIEW_RESPONSE_LENGTH,
  type StoredWeeklyReview,
  type WeeklyReviewReflectionInput,
} from '@/lib/weeklyReviewStorage';

type GuidedWeeklyReviewCardProps = {
  weekLabel: string;
  status: WeeklyReviewStatus;
  review: WeeklyReview;
  storedReview: StoredWeeklyReview | null;
  onSave: (reflection: WeeklyReviewReflectionInput) => Promise<void>;
};

export function GuidedWeeklyReviewCard({
  weekLabel,
  status,
  review,
  storedReview,
  onSave,
}: GuidedWeeklyReviewCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [whatWentWell, setWhatWentWell] = useState('');
  const [whatCausedProblems, setWhatCausedProblems] = useState('');
  const [whatLearned, setWhatLearned] = useState('');
  const [whatChangeNextWeek, setWhatChangeNextWeek] = useState('');
  const [nextWeekFocus, setNextWeekFocus] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setWhatWentWell(storedReview?.whatWentWell ?? '');
    setWhatCausedProblems(storedReview?.whatCausedProblems ?? '');
    setWhatLearned(storedReview?.whatLearned ?? '');
    setWhatChangeNextWeek(storedReview?.whatChangeNextWeek ?? '');
    setNextWeekFocus(storedReview?.nextWeekFocus ?? '');
    setSavedMessage(null);
    setIsExpanded(false);
  }, [storedReview, weekLabel]);

  if (status === 'future') {
    return null;
  }

  async function handleSave() {
    if (isSaving) return;

    setIsSaving(true);
    setSavedMessage(null);

    try {
      await onSave({
        whatWentWell,
        whatCausedProblems,
        whatLearned,
        whatChangeNextWeek,
        nextWeekFocus,
      });
      setSavedMessage('Weekly review saved.');
    } catch (error) {
      Alert.alert(
        'Could Not Save Review',
        error instanceof Error
          ? error.message
          : 'WeekFlow could not save this weekly review.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.headerRow}
        onPress={() => setIsExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`${
          storedReview ? 'Saved' : 'Unsaved'
        } guided weekly review for ${weekLabel}. ${
          isExpanded ? 'Collapse' : 'Expand'
        } review.`}
      >
        <View style={styles.transparentView}>
          <Text style={styles.title}>Guided Weekly Review</Text>
          <Text style={styles.subtitle}>
            {storedReview
              ? `${review.completedCount} completed • ${review.completionRate}% saved snapshot`
              : `Reflect on ${weekLabel} and decide what should change next.`}
          </Text>
        </View>

        <View style={styles.headerActions}>
          {storedReview ? (
            <Text style={styles.savedBadge}>Saved</Text>
          ) : null}
          <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
        </View>
      </Pressable>

      {isExpanded ? (
        <View style={styles.expandedBody}>
          <View style={styles.snapshotRow}>
            <View style={styles.snapshotCard}>
              <Text style={styles.snapshotValue}>{review.completedCount}</Text>
              <Text style={styles.snapshotLabel}>Completed</Text>
            </View>
            <View style={styles.snapshotCard}>
              <Text style={styles.snapshotValue}>{review.completionRate}%</Text>
              <Text style={styles.snapshotLabel}>Completion</Text>
            </View>
            <View style={styles.snapshotCard}>
              <Text style={styles.snapshotValue}>
                {review.goalsProgressedCount}
              </Text>
              <Text style={styles.snapshotLabel}>Goals Worked On</Text>
            </View>
            <View style={styles.snapshotCard}>
              <Text style={styles.snapshotValue}>
                {review.highPriorityCompletedCount}
              </Text>
              <Text style={styles.snapshotLabel}>High Priority</Text>
            </View>
          </View>

          <ReviewField
            label="What went well?"
            value={whatWentWell}
            onChangeText={setWhatWentWell}
            placeholder="Wins, useful choices, or work that felt strong..."
          />
          <ReviewField
            label="What caused problems?"
            value={whatCausedProblems}
            onChangeText={setWhatCausedProblems}
            placeholder="Delays, distractions, planning issues, or obstacles..."
          />
          <ReviewField
            label="What did you learn?"
            value={whatLearned}
            onChangeText={setWhatLearned}
            placeholder="A lesson you want to remember next week..."
          />
          <ReviewField
            label="What should change next week?"
            value={whatChangeNextWeek}
            onChangeText={setWhatChangeNextWeek}
            placeholder="A specific adjustment to your plan or routine..."
          />
          <ReviewField
            label="What is your number-one focus next week?"
            value={nextWeekFocus}
            onChangeText={setNextWeekFocus}
            placeholder="The most important outcome for the next week..."
          />

          {storedReview ? (
            <Text style={styles.snapshotNote}>
              The numbers above are the saved snapshot from the first time this
              review was completed. Editing the written reflection will not
              rewrite that historical result.
            </Text>
          ) : (
            <Text style={styles.snapshotNote}>
              Saving for the first time records the current weekly numbers as a
              historical snapshot. Written answers can still be edited later.
            </Text>
          )}

          <Pressable
            style={[styles.saveButton, isSaving && styles.disabledButton]}
            disabled={isSaving}
            onPress={() => void handleSave()}
          >
            <Text style={styles.saveButtonText}>
              {isSaving
                ? 'Saving...'
                : storedReview
                  ? 'Update Reflection'
                  : 'Save Weekly Review'}
            </Text>
          </Pressable>

          {savedMessage ? (
            <Text style={styles.savedMessage}>{savedMessage}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function ReviewField({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        multiline
        maxLength={MAX_WEEKLY_REVIEW_RESPONSE_LENGTH}
        textAlignVertical="top"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#86efac',
    backgroundColor: '#f0fdf4',
    marginBottom: 18,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  transparentView: { flex: 1, backgroundColor: 'transparent' },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'transparent',
  },
  title: { fontSize: 20, fontWeight: '900', color: '#111827' },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    color: '#4b5563',
    lineHeight: 18,
  },
  savedBadge: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#dcfce7',
    color: '#166534',
    fontSize: 12,
    fontWeight: '900',
  },
  chevron: { color: '#15803d', fontSize: 16, fontWeight: '900' },
  expandedBody: { backgroundColor: 'transparent' },
  snapshotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  snapshotCard: {
    flexGrow: 1,
    flexBasis: 135,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  snapshotValue: { fontSize: 20, fontWeight: '900', color: '#111827' },
  snapshotLabel: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '700',
    color: '#6b7280',
    textAlign: 'center',
  },
  field: { marginTop: 14, backgroundColor: 'transparent' },
  fieldLabel: {
    marginBottom: 6,
    fontSize: 14,
    fontWeight: '800',
    color: '#1f2937',
  },
  input: {
    minHeight: 92,
    padding: 12,
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 10,
    backgroundColor: 'white',
    color: '#111827',
    fontSize: 14,
    lineHeight: 20,
  },
  snapshotNote: {
    marginTop: 12,
    fontSize: 12,
    lineHeight: 17,
    color: '#4b5563',
  },
  saveButton: {
    marginTop: 16,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#16a34a',
  },
  saveButtonText: { color: 'white', fontSize: 15, fontWeight: '900' },
  disabledButton: { opacity: 0.5 },
  savedMessage: {
    marginTop: 9,
    textAlign: 'center',
    color: '#166534',
    fontSize: 13,
    fontWeight: '800',
  },
});
