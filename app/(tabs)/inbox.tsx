import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import {
  type RecurrenceFrequency,
  type RecurringRule,
  type Task,
  useTasks,
} from '@/context/TaskContext';
import {
  addDays,
  DAY_NAMES,
  formatDateKey,
  getLocalDateKey,
  getUpcomingDays,
  parseLocalDateKey,
} from '@/lib/dateUtils';

type RepeatChoice = 'none' | RecurrenceFrequency;
type RepeatEndPreset =
  | 'none'
  | 'twoWeeks'
  | 'fourWeeks'
  | 'twelveWeeks';

const selectableWeekdays = [
  { index: 1, label: 'Mon' },
  { index: 2, label: 'Tue' },
  { index: 3, label: 'Wed' },
  { index: 4, label: 'Thu' },
  { index: 5, label: 'Fri' },
  { index: 6, label: 'Sat' },
  { index: 0, label: 'Sun' },
];

const repeatChoices: {
  value: RepeatChoice;
  label: string;
}[] = [
  { value: 'none', label: 'Does Not Repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'certainDays', label: 'Certain Days' },
  { value: 'monthly', label: 'Monthly' },
];

const repeatEndChoices: {
  value: RepeatEndPreset;
  label: string;
  days: number | null;
}[] = [
  { value: 'none', label: 'No End', days: null },
  { value: 'twoWeeks', label: '2 Weeks', days: 14 },
  { value: 'fourWeeks', label: '4 Weeks', days: 28 },
  { value: 'twelveWeeks', label: '12 Weeks', days: 84 },
];

function getPriorityLabel(priority: number) {
  if (priority === 2) return 'High';
  if (priority === 1) return 'Medium';
  return 'Low';
}

function formatCreatedDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getRepeatEndDate(
  startDateKey: string,
  preset: RepeatEndPreset
) {
  const startDate = parseLocalDateKey(startDateKey);
  const option = repeatEndChoices.find(
    (item) => item.value === preset
  );

  if (!startDate || !option || option.days === null) {
    return null;
  }

  return getLocalDateKey(addDays(startDate, option.days));
}

function getRecurringRuleDescription(rule: RecurringRule) {
  const startDate = parseLocalDateKey(rule.startDate);

  if (rule.frequency === 'daily') return 'Every day';

  if (rule.frequency === 'weekly') {
    return startDate
      ? `Every ${DAY_NAMES[startDate.getDay()]}`
      : 'Every week';
  }

  if (rule.frequency === 'certainDays') {
    const labels = selectableWeekdays
      .filter((weekday) =>
        rule.weekdays.includes(weekday.index)
      )
      .map((weekday) => weekday.label);

    return labels.join(', ') || 'Selected weekdays';
  }

  return startDate
    ? `Monthly on day ${startDate.getDate()}`
    : 'Every month';
}

export default function InboxScreen() {
  const [taskText, setTaskText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [priority, setPriority] = useState(0);
  const [selectedGoalId, setSelectedGoalId] =
    useState<number | null>(null);
  const [brainDumpText, setBrainDumpText] = useState('');

  const [repeatChoice, setRepeatChoice] =
    useState<RepeatChoice>('none');
  const [repeatStartDate, setRepeatStartDate] = useState(
    getLocalDateKey(new Date())
  );
  const [selectedWeekdays, setSelectedWeekdays] = useState<
    number[]
  >([]);
  const [repeatEndPreset, setRepeatEndPreset] =
    useState<RepeatEndPreset>('none');
  const [repeatError, setRepeatError] = useState('');
  const [
    isRecurringManagerExpanded,
    setIsRecurringManagerExpanded,
  ] = useState(false);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] =
    useState<number | null>(null);

  const [editingTaskId, setEditingTaskId] =
    useState<number | null>(null);
  const [editTaskText, setEditTaskText] = useState('');
  const [editNotesText, setEditNotesText] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [editGoalId, setEditGoalId] =
    useState<number | null>(null);

  const {
    tasks,
    recurringRules,
    addTask,
    createRecurringTask,
    toggleRecurringRule,
    deleteRecurringRule,
    editTask,
    completeTask,
    deleteTask,
    scheduleTask,
    getInboxTasks,
  } = useTasks();

  const {
    addBrainDump,
    archiveBrainDump,
    deleteBrainDump,
    getActiveBrainDumps,
  } = useBrainDumps();

  const { goals } = useGoals();
  const inboxTasks = getInboxTasks();
  const activeBrainDumps = getActiveBrainDumps();
  const scheduleOptions = getUpcomingDays(14);
  const todayKey = getLocalDateKey(new Date());

  function resetTaskForm() {
    setTaskText('');
    setNotesText('');
    setPriority(0);
    setSelectedGoalId(null);
    setRepeatChoice('none');
    setRepeatStartDate(getLocalDateKey(new Date()));
    setSelectedWeekdays([]);
    setRepeatEndPreset('none');
    setRepeatError('');
  }

  function toggleSelectedWeekday(weekday: number) {
    setSelectedWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday]
    );
  }

  async function handleAddTask() {
    if (!taskText.trim()) return;

    if (repeatChoice === 'none') {
      await addTask(
        taskText,
        'Inbox',
        notesText,
        priority,
        selectedGoalId
      );
      resetTaskForm();
      return;
    }

    if (
      repeatChoice === 'certainDays' &&
      selectedWeekdays.length === 0
    ) {
      setRepeatError(
        'Choose at least one weekday for Certain Days.'
      );
      return;
    }

    try {
      setRepeatError('');

      await createRecurringTask({
        title: taskText,
        notes: notesText,
        priority,
        goalId: selectedGoalId,
        frequency: repeatChoice,
        startDate: repeatStartDate,
        endDate: getRepeatEndDate(
          repeatStartDate,
          repeatEndPreset
        ),
        weekdays:
          repeatChoice === 'certainDays'
            ? selectedWeekdays
            : [],
      });

      resetTaskForm();
      setIsRecurringManagerExpanded(true);
    } catch (error) {
      setRepeatError(
        error instanceof Error
          ? error.message
          : 'The recurring task could not be created.'
      );
    }
  }

  async function handleAddBrainDump() {
    await addBrainDump(brainDumpText);
    setBrainDumpText('');
  }

  async function handleTurnBrainDumpIntoTask(
    id: number,
    body: string
  ) {
    await addTask(body, 'Inbox');
    await deleteBrainDump(id);
  }

  function startEditingTask(task: Task) {
    setEditingTaskId(task.id);
    setEditTaskText(task.title);
    setEditNotesText(task.notes ?? '');
    setEditPriority(task.priority);
    setEditGoalId(task.goalId);
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setEditTaskText('');
    setEditNotesText('');
    setEditPriority(0);
    setEditGoalId(null);
  }

  async function handleSaveEditedTask() {
    if (editingTaskId === null) return;

    await editTask(
      editingTaskId,
      editTaskText,
      editNotesText,
      editPriority,
      editGoalId
    );

    cancelEditingTask();
  }

  return (
    <ScrollView
      style={styles.page}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          Capture tasks, reminders, and random thoughts before
          they get lost.
        </Text>
      </View>

      <View style={styles.progressCard}>
        <Text style={styles.progressTitle}>Inbox Overview</Text>
        <Text style={styles.progressText}>
          {inboxTasks.length} unscheduled task
          {inboxTasks.length === 1 ? '' : 's'} •{' '}
          {activeBrainDumps.length} brain dump note
          {activeBrainDumps.length === 1 ? '' : 's'} •{' '}
          {recurringRules.length} recurring schedule
          {recurringRules.length === 1 ? '' : 's'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Task</Text>
        <Text style={styles.sectionSubtitle}>
          Create a one-time Inbox task or build a recurring
          schedule.
        </Text>

        <View style={styles.form}>
          <TextInput
            style={styles.input}
            placeholder="Quick add something..."
            value={taskText}
            onChangeText={setTaskText}
            onSubmitEditing={handleAddTask}
            returnKeyType="done"
          />

          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Add notes... optional"
            value={notesText}
            onChangeText={setNotesText}
            multiline
          />

          <View style={styles.rowWrap}>
            {[0, 1, 2].map((level) => (
              <Pressable
                key={level}
                style={[
                  styles.pill,
                  priority === level &&
                    styles.prioritySelected,
                ]}
                onPress={() => setPriority(level)}
              >
                <Text
                  style={[
                    styles.pillText,
                    priority === level &&
                      styles.selectedText,
                  ]}
                >
                  {getPriorityLabel(level)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.pickerLabel}>Link to goal:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalRow}
          >
            <Pressable
              style={[
                styles.pill,
                selectedGoalId === null &&
                  styles.goalSelected,
              ]}
              onPress={() => setSelectedGoalId(null)}
            >
              <Text
                style={[
                  styles.pillText,
                  selectedGoalId === null &&
                    styles.selectedText,
                ]}
              >
                None
              </Text>
            </Pressable>

            {goals.map((goal) => (
              <Pressable
                key={goal.id}
                style={[
                  styles.pill,
                  selectedGoalId === goal.id &&
                    styles.goalSelected,
                ]}
                onPress={() =>
                  setSelectedGoalId(goal.id)
                }
              >
                <Text
                  style={[
                    styles.pillText,
                    selectedGoalId === goal.id &&
                      styles.selectedText,
                  ]}
                  numberOfLines={1}
                >
                  {goal.title}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.pickerLabel}>Repeat:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.horizontalRow}
          >
            {repeatChoices.map((choice) => (
              <Pressable
                key={choice.value}
                style={[
                  styles.pill,
                  repeatChoice === choice.value &&
                    styles.repeatSelected,
                ]}
                onPress={() => {
                  setRepeatChoice(choice.value);
                  setRepeatError('');
                }}
              >
                <Text
                  style={[
                    styles.pillText,
                    repeatChoice === choice.value &&
                      styles.selectedText,
                  ]}
                >
                  {choice.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>

          {repeatChoice !== 'none' ? (
            <View style={styles.recurringSetup}>
              <Text style={styles.recurringHelp}>
                {repeatChoice === 'daily'
                  ? 'Creates one task every day.'
                  : repeatChoice === 'weekly'
                    ? 'Repeats on the weekday of the selected start date.'
                    : repeatChoice === 'certainDays'
                      ? 'Repeats on every selected weekday.'
                      : 'Repeats on the same day number each month. Shorter months use their final day.'}
              </Text>

              {repeatChoice === 'certainDays' ? (
                <View style={styles.rowWrap}>
                  {selectableWeekdays.map((weekday) => {
                    const selected =
                      selectedWeekdays.includes(
                        weekday.index
                      );

                    return (
                      <Pressable
                        key={weekday.index}
                        style={[
                          styles.weekdayButton,
                          selected &&
                            styles.weekdaySelected,
                        ]}
                        onPress={() =>
                          toggleSelectedWeekday(
                            weekday.index
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.weekdayText,
                            selected &&
                              styles.selectedText,
                          ]}
                        >
                          {weekday.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}

              <Text style={styles.pickerLabel}>
                First scheduled date:
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalRow}
              >
                {scheduleOptions.map((option) => {
                  const selected =
                    repeatStartDate === option.dateKey;

                  return (
                    <Pressable
                      key={option.dateKey}
                      style={[
                        styles.dateButton,
                        selected &&
                          styles.dateButtonSelected,
                      ]}
                      onPress={() =>
                        setRepeatStartDate(
                          option.dateKey
                        )
                      }
                    >
                      <Text
                        style={[
                          styles.dateDay,
                          selected &&
                            styles.selectedText,
                        ]}
                      >
                        {option.isToday
                          ? 'Today'
                          : option.shortDayName}
                      </Text>
                      <Text
                        style={[
                          styles.dateDate,
                          selected &&
                            styles.selectedText,
                        ]}
                      >
                        {option.monthDayLabel}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Text style={styles.pickerLabel}>
                Repeat until:
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalRow}
              >
                {repeatEndChoices.map((choice) => (
                  <Pressable
                    key={choice.value}
                    style={[
                      styles.pill,
                      repeatEndPreset === choice.value &&
                        styles.endSelected,
                    ]}
                    onPress={() =>
                      setRepeatEndPreset(choice.value)
                    }
                  >
                    <Text
                      style={[
                        styles.pillText,
                        repeatEndPreset === choice.value &&
                          styles.selectedText,
                      ]}
                    >
                      {choice.label}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>

              {repeatEndPreset !== 'none' ? (
                <Text style={styles.endDateText}>
                  Ends:{' '}
                  {formatDateKey(
                    getRepeatEndDate(
                      repeatStartDate,
                      repeatEndPreset
                    ) ?? repeatStartDate
                  )}
                </Text>
              ) : null}
            </View>
          ) : null}

          {repeatError ? (
            <Text style={styles.errorText}>
              {repeatError}
            </Text>
          ) : null}

          <Pressable
            style={styles.addButton}
            onPress={handleAddTask}
          >
            <Text style={styles.addButtonText}>
              {repeatChoice === 'none'
                ? 'Add to Inbox'
                : 'Create Recurring Task'}
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.section}>
        <Pressable
          style={styles.managerHeader}
          onPress={() =>
            setIsRecurringManagerExpanded(
              (current) => !current
            )
          }
          accessibilityRole="button"
          accessibilityState={{
            expanded: isRecurringManagerExpanded,
          }}
        >
          <View style={styles.transparent}>
            <Text style={styles.sectionTitle}>
              Manage Recurring Tasks
            </Text>
            <Text style={styles.sectionSubtitleNoMargin}>
              {recurringRules.length} saved schedule
              {recurringRules.length === 1 ? '' : 's'}
            </Text>
          </View>

          <Text style={styles.chevron}>
            {isRecurringManagerExpanded ? '▼' : '▶'}
          </Text>
        </Pressable>

        {isRecurringManagerExpanded ? (
          <View style={styles.list}>
            {recurringRules.length === 0 ? (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>
                  No recurring tasks yet
                </Text>
                <Text style={styles.emptyText}>
                  Pick a repeat option in Quick Task.
                </Text>
              </View>
            ) : (
              recurringRules.map((rule) => {
                const nextTask = tasks
                  .filter(
                    (task) =>
                      task.recurringRuleId === rule.id &&
                      !task.completed &&
                      task.dueDate !== null &&
                      task.dueDate >= todayKey
                  )
                  .sort((a, b) =>
                    (a.dueDate ?? '').localeCompare(
                      b.dueDate ?? ''
                    )
                  )[0];

                const linkedGoal = goals.find(
                  (goal) => goal.id === rule.goalId
                );

                return (
                  <View
                    key={rule.id}
                    style={[
                      styles.ruleCard,
                      !rule.active &&
                        styles.ruleCardPaused,
                    ]}
                  >
                    <View style={styles.titleRow}>
                      <Text style={styles.taskTitle}>
                        {rule.title}
                      </Text>
                      <Text
                        style={[
                          styles.statusBadge,
                          !rule.active &&
                            styles.statusBadgePaused,
                        ]}
                      >
                        {rule.active
                          ? 'Active'
                          : 'Paused'}
                      </Text>
                    </View>

                    <Text style={styles.taskMeta}>
                      {getRecurringRuleDescription(rule)}
                    </Text>
                    <Text style={styles.taskMeta}>
                      Starts: {formatDateKey(rule.startDate)}
                    </Text>
                    <Text style={styles.taskMeta}>
                      Ends:{' '}
                      {rule.endDate
                        ? formatDateKey(rule.endDate)
                        : 'No end date'}
                    </Text>
                    <Text style={styles.taskMeta}>
                      Next existing task:{' '}
                      {nextTask?.dueDate
                        ? formatDateKey(nextTask.dueDate)
                        : 'None in current window'}
                    </Text>
                    <Text style={styles.taskMeta}>
                      Priority:{' '}
                      {getPriorityLabel(rule.priority)}
                    </Text>
                    {linkedGoal ? (
                      <Text style={styles.taskMeta}>
                        Goal: {linkedGoal.title}
                      </Text>
                    ) : null}
                    {rule.notes ? (
                      <Text style={styles.taskNotes}>
                        {rule.notes}
                      </Text>
                    ) : null}

                    <View style={styles.rowWrap}>
                      <Pressable
                        style={[
                          styles.smallButton,
                          styles.pauseButton,
                          !rule.active &&
                            styles.resumeButton,
                        ]}
                        onPress={() =>
                          toggleRecurringRule(rule.id)
                        }
                      >
                        <Text style={styles.buttonText}>
                          {rule.active ? 'Pause' : 'Resume'}
                        </Text>
                      </Pressable>

                      {confirmDeleteRuleId === rule.id ? (
                        <View style={styles.deleteChoicePanel}>
                          <Text style={styles.deleteChoiceTitle}>
                            How should this schedule be removed?
                          </Text>

                          <Text style={styles.deleteChoiceText}>
                            Stop Schedule Only keeps all generated tasks.
                            Delete Schedule + Unfinished Tasks removes every
                            incomplete occurrence but keeps completed History.
                          </Text>

                          <View style={styles.rowWrap}>
                            <Pressable
                              style={[
                                styles.smallButton,
                                styles.stopOnlyButton,
                              ]}
                              onPress={async () => {
                                await deleteRecurringRule(
                                  rule.id,
                                  'stopOnly'
                                );
                                setConfirmDeleteRuleId(null);
                              }}
                            >
                              <Text style={styles.buttonText}>
                                Stop Schedule Only
                              </Text>
                            </Pressable>

                            <Pressable
                              style={[
                                styles.smallButton,
                                styles.confirmDeleteButton,
                              ]}
                              onPress={async () => {
                                await deleteRecurringRule(
                                  rule.id,
                                  'deleteUnfinished'
                                );
                                setConfirmDeleteRuleId(null);
                              }}
                            >
                              <Text style={styles.buttonText}>
                                Delete Schedule + Unfinished Tasks
                              </Text>
                            </Pressable>

                            <Pressable
                              style={[
                                styles.smallButton,
                                styles.cancelButton,
                              ]}
                              onPress={() =>
                                setConfirmDeleteRuleId(null)
                              }
                            >
                              <Text style={styles.buttonText}>
                                Cancel
                              </Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : (
                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.deleteButton,
                          ]}
                          onPress={() =>
                            setConfirmDeleteRuleId(rule.id)
                          }
                        >
                          <Text style={styles.buttonText}>
                            Delete Schedule
                          </Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })
            )}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Brain Dump Notes
        </Text>
        <Text style={styles.sectionSubtitle}>
          Thoughts, reminders, and ideas that are not tasks yet.
        </Text>

        <View style={styles.form}>
          <TextInput
            style={[styles.input, styles.brainDumpInput]}
            placeholder="Write anything here..."
            value={brainDumpText}
            onChangeText={setBrainDumpText}
            multiline
          />
          <Pressable
            style={styles.brainDumpButton}
            onPress={handleAddBrainDump}
          >
            <Text style={styles.buttonText}>
              Save Brain Dump
            </Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {activeBrainDumps.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No brain dumps yet
              </Text>
              <Text style={styles.emptyText}>
                Use this area for thoughts that are not really
                tasks yet.
              </Text>
            </View>
          ) : (
            activeBrainDumps.map((brainDump) => (
              <View
                key={brainDump.id}
                style={styles.horizontalCard}
              >
                <View style={styles.flex}>
                  <Text style={styles.brainDumpBody}>
                    {brainDump.body}
                  </Text>
                  <Text style={styles.taskMeta}>
                    Saved:{' '}
                    {formatCreatedDate(
                      brainDump.createdAt
                    )}
                  </Text>
                </View>

                <View style={styles.actionColumn}>
                  <Pressable
                    style={[
                      styles.smallButton,
                      styles.editButton,
                    ]}
                    onPress={() =>
                      handleTurnBrainDumpIntoTask(
                        brainDump.id,
                        brainDump.body
                      )
                    }
                  >
                    <Text style={styles.buttonText}>
                      Turn Into Task
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.smallButton,
                      styles.archiveButton,
                    ]}
                    onPress={() =>
                      archiveBrainDump(brainDump.id)
                    }
                  >
                    <Text style={styles.buttonText}>
                      Archive
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.smallButton,
                      styles.deleteButton,
                    ]}
                    onPress={() =>
                      deleteBrainDump(brainDump.id)
                    }
                  >
                    <Text style={styles.buttonText}>
                      Delete
                    </Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Unscheduled Tasks
        </Text>
        <Text style={styles.sectionSubtitle}>
          Pick a calendar date to move each task into Daily and
          Weekly.
        </Text>

        <View style={styles.list}>
          {inboxTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Inbox is clear ✅
              </Text>
              <Text style={styles.emptyText}>
                Add a task when you need to capture something.
              </Text>
            </View>
          ) : (
            inboxTasks.map((task) => {
              const linkedGoal = goals.find(
                (goal) => goal.id === task.goalId
              );
              const isEditing =
                editingTaskId === task.id;

              if (isEditing) {
                return (
                  <View
                    key={task.id}
                    style={styles.taskCard}
                  >
                    <Text style={styles.editTitle}>
                      Edit Task
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={editTaskText}
                      onChangeText={setEditTaskText}
                    />
                    <TextInput
                      style={[
                        styles.input,
                        styles.notesInput,
                      ]}
                      value={editNotesText}
                      onChangeText={setEditNotesText}
                      multiline
                    />

                    <View style={styles.rowWrap}>
                      {[0, 1, 2].map((level) => (
                        <Pressable
                          key={level}
                          style={[
                            styles.pill,
                            editPriority === level &&
                              styles.prioritySelected,
                          ]}
                          onPress={() =>
                            setEditPriority(level)
                          }
                        >
                          <Text
                            style={[
                              styles.pillText,
                              editPriority === level &&
                                styles.selectedText,
                            ]}
                          >
                            {getPriorityLabel(level)}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={
                        styles.horizontalRow
                      }
                    >
                      <Pressable
                        style={[
                          styles.pill,
                          editGoalId === null &&
                            styles.goalSelected,
                        ]}
                        onPress={() =>
                          setEditGoalId(null)
                        }
                      >
                        <Text
                          style={[
                            styles.pillText,
                            editGoalId === null &&
                              styles.selectedText,
                          ]}
                        >
                          No Goal
                        </Text>
                      </Pressable>

                      {goals.map((goal) => (
                        <Pressable
                          key={goal.id}
                          style={[
                            styles.pill,
                            editGoalId === goal.id &&
                              styles.goalSelected,
                          ]}
                          onPress={() =>
                            setEditGoalId(goal.id)
                          }
                        >
                          <Text
                            style={[
                              styles.pillText,
                              editGoalId === goal.id &&
                                styles.selectedText,
                            ]}
                          >
                            {goal.title}
                          </Text>
                        </Pressable>
                      ))}
                    </ScrollView>

                    <View style={styles.row}>
                      <Pressable
                        style={[
                          styles.flexButton,
                          styles.doneButton,
                        ]}
                        onPress={handleSaveEditedTask}
                      >
                        <Text style={styles.buttonText}>
                          Save
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.flexButton,
                          styles.cancelButton,
                        ]}
                        onPress={cancelEditingTask}
                      >
                        <Text style={styles.buttonText}>
                          Cancel
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }

              return (
                <View
                  key={task.id}
                  style={styles.taskCard}
                >
                  <View style={styles.horizontalCardInner}>
                    <View style={styles.flex}>
                      <View style={styles.titleRow}>
                        <Text style={styles.taskTitle}>
                          {task.title}
                        </Text>
                        {task.recurringRuleId !== null ? (
                          <Text style={styles.recurringBadge}>
                            Recurring Occurrence
                          </Text>
                        ) : null}
                      </View>

                      <Text style={styles.taskMeta}>
                        Unscheduled
                      </Text>
                      <Text style={styles.taskMeta}>
                        Priority:{' '}
                        {getPriorityLabel(task.priority)}
                      </Text>
                      {linkedGoal ? (
                        <Text style={styles.taskMeta}>
                          Goal: {linkedGoal.title}
                        </Text>
                      ) : null}
                      {task.notes ? (
                        <Text style={styles.taskNotes}>
                          {task.notes}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.actionColumn}>
                      <Pressable
                        style={[
                          styles.smallButton,
                          styles.editButton,
                        ]}
                        onPress={() =>
                          startEditingTask(task)
                        }
                      >
                        <Text style={styles.buttonText}>
                          Edit
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.smallButton,
                          styles.doneButton,
                        ]}
                        onPress={() =>
                          completeTask(task.id)
                        }
                      >
                        <Text style={styles.buttonText}>
                          Done
                        </Text>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.smallButton,
                          styles.deleteButton,
                        ]}
                        onPress={() =>
                          deleteTask(task.id)
                        }
                      >
                        <Text style={styles.buttonText}>
                          Delete
                        </Text>
                      </Pressable>
                    </View>
                  </View>

                  <Text style={styles.pickerLabel}>
                    Schedule for:
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={
                      styles.horizontalRow
                    }
                  >
                    {scheduleOptions.map((option) => (
                      <Pressable
                        key={option.dateKey}
                        style={[
                          styles.dateButton,
                          option.isToday &&
                            styles.dateButtonSelected,
                        ]}
                        onPress={() =>
                          scheduleTask(
                            task.id,
                            option.dateKey
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.dateDay,
                            option.isToday &&
                              styles.selectedText,
                          ]}
                        >
                          {option.isToday
                            ? 'Today'
                            : option.shortDayName}
                        </Text>
                        <Text
                          style={[
                            styles.dateDate,
                            option.isToday &&
                              styles.selectedText,
                          ]}
                        >
                          {option.monthDayLabel}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              );
            })
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  header: { marginBottom: 20 },
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
  progressCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: '#f5f3ff',
    marginBottom: 18,
  },
  progressTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
    color: '#111827',
  },
  progressText: { fontSize: 15, color: '#374151' },
  section: {
    marginBottom: 26,
    backgroundColor: 'transparent',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 12,
    lineHeight: 20,
  },
  sectionSubtitleNoMargin: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
  form: { gap: 10, backgroundColor: 'transparent' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    backgroundColor: 'white',
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  brainDumpInput: {
    minHeight: 110,
    textAlignVertical: 'top',
  },
  pickerLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '700',
  },
  horizontalRow: { gap: 8, paddingRight: 4 },
  row: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: 'transparent',
  },
  rowWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
    maxWidth: 220,
  },
  pillText: { fontWeight: '700', color: '#374151' },
  selectedText: { color: 'white' },
  prioritySelected: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  goalSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  repeatSelected: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
  },
  endSelected: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  recurringSetup: {
    gap: 10,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
  },
  recurringHelp: {
    fontSize: 13,
    color: '#115e59',
    lineHeight: 19,
  },
  weekdayButton: {
    minWidth: 54,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  weekdaySelected: {
    backgroundColor: '#0f766e',
    borderColor: '#0f766e',
  },
  weekdayText: { fontWeight: '800', color: '#115e59' },
  dateButton: {
    minWidth: 76,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d1d5db',
    backgroundColor: 'white',
    alignItems: 'center',
  },
  dateButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  dateDay: {
    fontSize: 13,
    fontWeight: '800',
    color: '#374151',
  },
  dateDate: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: '700',
    color: '#6b7280',
  },
  endDateText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5b21b6',
  },
  errorText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b91c1c',
  },
  addButton: {
    backgroundColor: '#7c3aed',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  addButtonText: {
    color: 'white',
    fontWeight: '700',
    fontSize: 16,
  },
  managerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: '#f0fdfa',
  },
  transparent: { backgroundColor: 'transparent' },
  chevron: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f766e',
  },
  list: { gap: 12, marginTop: 14 },
  ruleCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#99f6e4',
    backgroundColor: 'white',
    gap: 5,
  },
  ruleCardPaused: {
    borderColor: '#d1d5db',
    backgroundColor: '#f9fafb',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '900',
    color: '#166534',
    backgroundColor: '#dcfce7',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusBadgePaused: {
    color: '#4b5563',
    backgroundColor: '#e5e7eb',
  },
  recurringBadge: {
    fontSize: 10,
    fontWeight: '900',
    color: '#0f766e',
    backgroundColor: '#ccfbf1',
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: 999,
    overflow: 'hidden',
  },
  brainDumpButton: {
    backgroundColor: '#0f766e',
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  taskCard: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
    gap: 14,
  },
  horizontalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  horizontalCardInner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: 'transparent',
  },
  flex: { flex: 1, backgroundColor: 'transparent' },
  taskTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  taskMeta: {
    marginTop: 4,
    fontSize: 13,
    color: '#6b7280',
  },
  taskNotes: {
    marginTop: 6,
    fontSize: 14,
    color: '#374151',
    lineHeight: 20,
  },
  brainDumpBody: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
    lineHeight: 21,
  },
  editTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  actionColumn: {
    gap: 8,
    alignItems: 'flex-end',
    backgroundColor: 'transparent',
  },
  smallButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  flexButton: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '700' },
  editButton: { backgroundColor: '#2563eb' },
  doneButton: { backgroundColor: '#16a34a' },
  pauseButton: { backgroundColor: '#f59e0b' },
  resumeButton: { backgroundColor: '#16a34a' },
  archiveButton: { backgroundColor: '#f59e0b' },
  deleteButton: { backgroundColor: '#dc2626' },
  deleteChoicePanel: {
    width: '100%',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
  },
  deleteChoiceTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#991b1b',
  },
  deleteChoiceText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#7f1d1d',
  },
  stopOnlyButton: { backgroundColor: '#7c3aed' },
  confirmDeleteButton: { backgroundColor: '#991b1b' },
  cancelButton: { backgroundColor: '#6b7280' },
  emptyCard: {
    padding: 18,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: 'white',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
    color: '#111827',
  },
  emptyText: {
    fontSize: 14,
    color: '#6b7280',
    lineHeight: 20,
  },
});
