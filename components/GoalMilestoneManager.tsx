import { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useGoals } from '@/context/GoalContext';
import {
  MAX_MILESTONE_NOTES_LENGTH,
  MAX_MILESTONE_TITLE_LENGTH,
} from '@/lib/goalPlanningUtils';
import { formatDateKey } from '@/lib/dateUtils';

type GoalMilestoneManagerProps = {
  goalId: number;
};

export default function GoalMilestoneManager({
  goalId,
}: GoalMilestoneManagerProps) {
  const {
    milestones,
    addMilestone,
    editMilestone,
    toggleMilestone,
    deleteMilestone,
  } = useGoals();

  const [isExpanded, setIsExpanded] = useState(false);
  const [title, setTitle] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editTargetDate, setEditTargetDate] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const goalMilestones = useMemo(
    () => milestones.filter((milestone) => milestone.goalId === goalId),
    [goalId, milestones]
  );

  const completedCount = goalMilestones.filter(
    (milestone) => milestone.completed
  ).length;

  async function handleAddMilestone() {
    try {
      await addMilestone(goalId, title, targetDate, notes);
      setTitle('');
      setTargetDate('');
      setNotes('');
      setMessage('');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The milestone could not be added.'
      );
    }
  }

  function beginEditing(id: number) {
    const milestone = goalMilestones.find((item) => item.id === id);
    if (!milestone) return;

    setEditingId(id);
    setEditTitle(milestone.title);
    setEditTargetDate(milestone.targetDate ?? '');
    setEditNotes(milestone.notes ?? '');
    setMessage('');
  }

  function cancelEditing() {
    setEditingId(null);
    setEditTitle('');
    setEditTargetDate('');
    setEditNotes('');
    setMessage('');
  }

  async function handleSaveMilestone(id: number) {
    try {
      await editMilestone(id, editTitle, editTargetDate, editNotes);
      cancelEditing();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The milestone could not be updated.'
      );
    }
  }

  return (
    <View style={styles.wrapper}>
      <Pressable
        style={styles.summaryButton}
        onPress={() => setIsExpanded((current) => !current)}
      >
        <View style={styles.summaryTextWrap}>
          <Text style={styles.summaryTitle}>Milestones</Text>
          <Text style={styles.summaryText}>
            {completedCount} of {goalMilestones.length} completed
          </Text>
        </View>
        <Text style={styles.summaryAction}>
          {isExpanded ? 'Hide' : 'Manage'}
        </Text>
      </Pressable>

      {isExpanded ? (
        <View style={styles.expandedContent}>
          {goalMilestones.length === 0 ? (
            <Text style={styles.emptyText}>
              No milestones yet. Add major checkpoints for this goal.
            </Text>
          ) : (
            <View style={styles.list}>
              {goalMilestones.map((milestone) => (
                <View key={milestone.id} style={styles.milestoneCard}>
                  {editingId === milestone.id ? (
                    <View style={styles.editForm}>
                      <Text style={styles.fieldLabel}>Milestone title</Text>
                      <TextInput
                        style={styles.input}
                        value={editTitle}
                        onChangeText={(value) => {
                          setEditTitle(value);
                          setMessage('');
                        }}
                        maxLength={MAX_MILESTONE_TITLE_LENGTH}
                      />

                      <Text style={styles.fieldLabel}>
                        Optional target date
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={editTargetDate}
                        onChangeText={(value) => {
                          setEditTargetDate(value);
                          setMessage('');
                        }}
                        placeholder="YYYY-MM-DD"
                        autoCapitalize="none"
                        autoCorrect={false}
                      />

                      <Text style={styles.fieldLabel}>Optional notes</Text>
                      <TextInput
                        style={styles.notesInput}
                        value={editNotes}
                        onChangeText={(value) => {
                          setEditNotes(value);
                          setMessage('');
                        }}
                        multiline
                        maxLength={MAX_MILESTONE_NOTES_LENGTH}
                      />

                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.cancelButton}
                          onPress={cancelEditing}
                        >
                          <Text style={styles.cancelButtonText}>Cancel</Text>
                        </Pressable>
                        <Pressable
                          style={styles.saveButton}
                          onPress={() => handleSaveMilestone(milestone.id)}
                        >
                          <Text style={styles.saveButtonText}>Save</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.milestoneHeader}>
                        <Pressable
                          style={styles.checkButton}
                          onPress={() => toggleMilestone(milestone.id)}
                        >
                          <Text style={styles.checkText}>
                            {milestone.completed ? '☑' : '☐'}
                          </Text>
                        </Pressable>

                        <View style={styles.milestoneTextWrap}>
                          <Text
                            style={[
                              styles.milestoneTitle,
                              milestone.completed && styles.completedText,
                            ]}
                          >
                            {milestone.title}
                          </Text>
                          {milestone.targetDate ? (
                            <Text style={styles.targetDateText}>
                              Target: {formatDateKey(milestone.targetDate)}
                            </Text>
                          ) : null}
                          {milestone.notes ? (
                            <Text style={styles.notesText}>
                              {milestone.notes}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      <View style={styles.actionRow}>
                        <Pressable
                          style={styles.editButton}
                          onPress={() => beginEditing(milestone.id)}
                        >
                          <Text style={styles.editButtonText}>Edit</Text>
                        </Pressable>
                        <Pressable
                          style={styles.deleteButton}
                          onPress={() => deleteMilestone(milestone.id)}
                        >
                          <Text style={styles.deleteButtonText}>Delete</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              ))}
            </View>
          )}

          <View style={styles.addForm}>
            <Text style={styles.formTitle}>Add Milestone</Text>

            <Text style={styles.fieldLabel}>Milestone title</Text>
            <TextInput
              style={styles.input}
              placeholder="Example: Finish database backup lab"
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setMessage('');
              }}
              maxLength={MAX_MILESTONE_TITLE_LENGTH}
            />

            <Text style={styles.fieldLabel}>Optional target date</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              value={targetDate}
              onChangeText={(value) => {
                setTargetDate(value);
                setMessage('');
              }}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={styles.fieldLabel}>Optional notes</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="What does reaching this checkpoint involve?"
              value={notes}
              onChangeText={(value) => {
                setNotes(value);
                setMessage('');
              }}
              multiline
              maxLength={MAX_MILESTONE_NOTES_LENGTH}
            />

            {message ? (
              <Text style={styles.errorText}>{message}</Text>
            ) : null}

            <Pressable style={styles.addButton} onPress={handleAddMilestone}>
              <Text style={styles.addButtonText}>Add Milestone</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#f8fbff',
  },
  summaryButton: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: '#eff6ff',
  },
  summaryTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: '900',
    color: '#1e3a8a',
  },
  summaryText: {
    marginTop: 2,
    fontSize: 11,
    color: '#64748b',
  },
  summaryAction: {
    fontSize: 12,
    fontWeight: '900',
    color: '#2563eb',
  },
  expandedContent: {
    padding: 12,
    gap: 12,
    backgroundColor: 'transparent',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 17,
    color: '#64748b',
  },
  list: {
    gap: 9,
    backgroundColor: 'transparent',
  },
  milestoneCard: {
    padding: 11,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    gap: 9,
    backgroundColor: 'white',
  },
  milestoneHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    backgroundColor: 'transparent',
  },
  checkButton: {
    paddingTop: 1,
  },
  checkText: {
    fontSize: 21,
    color: '#2563eb',
  },
  milestoneTextWrap: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  milestoneTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#111827',
  },
  completedText: {
    textDecorationLine: 'line-through',
    color: '#6b7280',
  },
  targetDateText: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: '700',
    color: '#2563eb',
  },
  notesText: {
    marginTop: 5,
    fontSize: 12,
    lineHeight: 17,
    color: '#4b5563',
  },
  addForm: {
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: '#dbeafe',
    gap: 7,
    backgroundColor: 'transparent',
  },
  editForm: {
    gap: 7,
    backgroundColor: 'transparent',
  },
  formTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: '#111827',
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: '#374151',
  },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 10,
    backgroundColor: 'white',
  },
  notesInput: {
    minHeight: 68,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 9,
    paddingVertical: 9,
    paddingHorizontal: 10,
    textAlignVertical: 'top',
    backgroundColor: 'white',
  },
  errorText: {
    fontSize: 11,
    color: '#b91c1c',
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: 7,
    backgroundColor: 'transparent',
  },
  addButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 9,
    backgroundColor: '#2563eb',
  },
  addButtonText: {
    fontSize: 12,
    fontWeight: '900',
    color: 'white',
  },
  editButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#dbeafe',
  },
  editButtonText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#1e40af',
  },
  deleteButton: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: '#fee2e2',
  },
  deleteButtonText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#b91c1c',
  },
  cancelButton: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: '#e5e7eb',
  },
  cancelButtonText: {
    fontSize: 11,
    fontWeight: '900',
    color: '#374151',
  },
  saveButton: {
    paddingVertical: 8,
    paddingHorizontal: 11,
    borderRadius: 8,
    backgroundColor: '#2563eb',
  },
  saveButtonText: {
    fontSize: 11,
    fontWeight: '900',
    color: 'white',
  },
});
