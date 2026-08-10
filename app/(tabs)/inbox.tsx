import { useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
} from 'react-native';

import { ActiveTaskFilters } from '@/components/ActiveTaskFilters';
import InboxOverviewCard from '@/components/InboxOverviewCard';
import { TaskDatePicker } from '@/components/TaskDatePicker';
import { TaskWeeklyCommitmentButton } from '@/components/TaskWeeklyCommitmentButton';
import { Text, View } from '@/components/Themed';
import {
  type BrainDump,
  useBrainDumps,
} from '@/context/BrainDumpContext';
import { useGoals } from '@/context/GoalContext';
import {
  type RecurrenceFrequency,
  type RecurringRule,
  type Task,
  useTasks,
} from '@/context/TaskContext';
import {
  createDefaultActiveTaskFilters,
  filterActiveTasks,
  type ActiveTaskFilterState,
} from '@/lib/activeTaskFilters';
import {
  calculateInboxOverview,
  createInboxQuickFilterState,
  getSelectedInboxQuickFilter,
  type InboxQuickFilter,
} from '@/lib/inboxOverviewUtils';
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
  | 'twelveWeeks'
  | 'custom';
type RecurringEditScope = 'single' | 'future';

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
  { value: 'everyTwoWeeks', label: 'Every 2 Weeks' },
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
  { value: 'custom', label: 'Custom Date', days: null },
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

function resolveRepeatEndDate(
  startDateKey: string,
  preset: RepeatEndPreset,
  customEndDate: string
) {
  const startDate = parseLocalDateKey(startDateKey);

  if (!startDate) {
    throw new Error(
      'Enter a valid start date in YYYY-MM-DD format.'
    );
  }

  if (preset === 'none') return null;

  if (preset === 'custom') {
    const trimmedEndDate = customEndDate.trim();
    const endDate = parseLocalDateKey(trimmedEndDate);

    if (!endDate) {
      throw new Error(
        'Enter a valid custom end date in YYYY-MM-DD format.'
      );
    }

    if (endDate.getTime() < startDate.getTime()) {
      throw new Error(
        'The recurring end date cannot be before the start date.'
      );
    }

    return getLocalDateKey(endDate);
  }

  return getRepeatEndDate(startDateKey, preset);
}

function getRepeatEndPresetFromDates(
  startDateKey: string,
  endDateKey: string | null
): RepeatEndPreset {
  if (!endDateKey) return 'none';

  const startDate = parseLocalDateKey(startDateKey);
  const endDate = parseLocalDateKey(endDateKey);

  if (!startDate || !endDate) return 'custom';

  const differenceInDays = Math.round(
    (endDate.getTime() - startDate.getTime()) /
      (24 * 60 * 60 * 1000)
  );

  if (differenceInDays === 14) return 'twoWeeks';
  if (differenceInDays === 28) return 'fourWeeks';
  if (differenceInDays === 84) return 'twelveWeeks';

  return 'custom';
}

function getRecurringRuleDescription(rule: RecurringRule) {
  const startDate = parseLocalDateKey(rule.startDate);

  if (rule.frequency === 'daily') return 'Every day';

  if (rule.frequency === 'weekly') {
    return startDate
      ? `Every ${DAY_NAMES[startDate.getDay()]}`
      : 'Every week';
  }

  if (rule.frequency === 'everyTwoWeeks') {
    return startDate
      ? `Every 2 weeks on ${DAY_NAMES[startDate.getDay()]}`
      : 'Every 2 weeks';
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
  const { width } = useWindowDimensions();

  const isDesktop = width >= 1100;
  const isWideDesktop = width >= 1400;

  const [taskText, setTaskText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [priority, setPriority] = useState(0);
  const [selectedGoalId, setSelectedGoalId] =
    useState<number | null>(null);
  const [brainDumpText, setBrainDumpText] = useState('');
  const [editingBrainDumpId, setEditingBrainDumpId] =
    useState<number | null>(null);
  const [editBrainDumpText, setEditBrainDumpText] = useState('');
  const [editBrainDumpError, setEditBrainDumpError] = useState('');
  const [templateMessage, setTemplateMessage] = useState('');
  const [editingTemplateId, setEditingTemplateId] =
    useState<number | null>(null);
  const [editTemplateTitle, setEditTemplateTitle] =
    useState('');
  const [editTemplateNotes, setEditTemplateNotes] =
    useState('');
  const [editTemplatePriority, setEditTemplatePriority] =
    useState(0);
  const [editTemplateGoalId, setEditTemplateGoalId] =
    useState<number | null>(null);
  const [isTaskTemplatesExpanded, setIsTaskTemplatesExpanded] =
    useState(false);
  const [taskFilters, setTaskFilters] = useState<ActiveTaskFilterState>(() => ({
    ...createDefaultActiveTaskFilters(),
    schedule: 'unscheduled' as const,
  }));
  const [datePickerTask, setDatePickerTask] =
    useState<Task | null>(null);

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
  const [customRepeatEndDate, setCustomRepeatEndDate] =
    useState('');
  const [useCustomRepeatStartDate, setUseCustomRepeatStartDate] =
    useState(false);
  const [repeatError, setRepeatError] = useState('');
  const [
    isRecurringManagerExpanded,
    setIsRecurringManagerExpanded,
  ] = useState(false);
  const [confirmDeleteRuleId, setConfirmDeleteRuleId] =
    useState<number | null>(null);
  const [editingRuleId, setEditingRuleId] =
    useState<number | null>(null);
  const [editRuleTitle, setEditRuleTitle] = useState('');
  const [editRuleNotes, setEditRuleNotes] = useState('');
  const [editRulePriority, setEditRulePriority] = useState(0);
  const [editRuleGoalId, setEditRuleGoalId] =
    useState<number | null>(null);
  const [editRuleFrequency, setEditRuleFrequency] =
    useState<RecurrenceFrequency>('daily');
  const [editRuleStartDate, setEditRuleStartDate] =
    useState('');
  const [editRuleEndPreset, setEditRuleEndPreset] =
    useState<RepeatEndPreset>('none');
  const [editRuleEndDate, setEditRuleEndDate] =
    useState('');
  const [editRuleWeekdays, setEditRuleWeekdays] = useState<
    number[]
  >([]);
  const [editRuleError, setEditRuleError] = useState('');

  const [editingTaskId, setEditingTaskId] =
    useState<number | null>(null);
  const [editTaskText, setEditTaskText] = useState('');
  const [editNotesText, setEditNotesText] = useState('');
  const [editPriority, setEditPriority] = useState(0);
  const [editGoalId, setEditGoalId] =
    useState<number | null>(null);
  const [editRepeatChoice, setEditRepeatChoice] =
    useState<RepeatChoice>('none');
  const [editRepeatStartDate, setEditRepeatStartDate] =
    useState(getLocalDateKey(new Date()));
  const [editSelectedWeekdays, setEditSelectedWeekdays] =
    useState<number[]>([]);
  const [editRepeatEndPreset, setEditRepeatEndPreset] =
    useState<RepeatEndPreset>('none');
  const [editCustomRepeatEndDate, setEditCustomRepeatEndDate] =
    useState('');
  const [
    editUseCustomRepeatStartDate,
    setEditUseCustomRepeatStartDate,
  ] = useState(false);
  const [editRepeatError, setEditRepeatError] =
    useState('');
  const [editRecurringScope, setEditRecurringScope] =
    useState<RecurringEditScope>('single');

  const {
    tasks,
    recurringRules,
    taskTemplates,
    addTask,
    addTaskTemplate,
    editTaskTemplate,
    deleteTaskTemplate,
    addTaskFromTemplate,
    createRecurringTask,
    convertTaskToRecurring,
    updateRecurringTask,
    updateRecurringTaskFromOccurrence,
    toggleRecurringRule,
    deleteRecurringRule,
    editTask,
    completeTask,
    deleteTask,
    scheduleTask,
    moveTaskToInbox,
  } = useTasks();

  const {
    addBrainDump,
    editBrainDump,
    archiveBrainDump,
    deleteBrainDump,
    turnBrainDumpIntoTask,
    getActiveBrainDumps,
  } = useBrainDumps();

  const { goals } = useGoals();

  /*
   * Inbox defaults to unscheduled work, but WF-029 can temporarily show every
   * active task when an overview metric or advanced schedule filter is chosen.
   */
  const activeTasks = useMemo(
    () => tasks.filter((task) => !task.completed),
    [tasks]
  );
  const filteredActiveTasks = useMemo(
    () => filterActiveTasks(activeTasks, taskFilters),
    [activeTasks, taskFilters]
  );
  const inboxOverview = useMemo(
    () => calculateInboxOverview(tasks, recurringRules),
    [recurringRules, tasks]
  );
  const selectedQuickFilter = useMemo(
    () => getSelectedInboxQuickFilter(taskFilters),
    [taskFilters]
  );
  const activeBrainDumps = getActiveBrainDumps();
  const scheduleOptions = getUpcomingDays(14);
  const todayKey = getLocalDateKey(new Date());
  const tomorrowKey = getLocalDateKey(addDays(new Date(), 1));

  function handleSelectQuickFilter(filter: InboxQuickFilter) {
    setTaskFilters(createInboxQuickFilterState(filter));
  }

  function resetTaskForm() {
    setTaskText('');
    setNotesText('');
    setPriority(0);
    setSelectedGoalId(null);
    setRepeatChoice('none');
    setRepeatStartDate(getLocalDateKey(new Date()));
    setSelectedWeekdays([]);
    setRepeatEndPreset('none');
    setCustomRepeatEndDate('');
    setUseCustomRepeatStartDate(false);
    setRepeatError('');
  }

  async function handleSaveCurrentAsTemplate() {
    if (!taskText.trim()) {
      setTemplateMessage(
        'Enter a task title before saving a template.'
      );
      return;
    }

    try {
      await addTaskTemplate(
        taskText,
        notesText,
        priority,
        selectedGoalId
      );
      setTemplateMessage(
        `Saved “${taskText.trim()}” as a task template.`
      );
      setIsTaskTemplatesExpanded(true);
    } catch (error) {
      setTemplateMessage(
        error instanceof Error
          ? error.message
          : 'The task template could not be saved.'
      );
    }
  }

  function handleLoadTemplate(
    template: (typeof taskTemplates)[number]
  ) {
    setTaskText(template.title);
    setNotesText(template.notes ?? '');
    setPriority(template.priority);
    setSelectedGoalId(template.goalId);

    // Templates intentionally describe one-time task details. Recurring
    // schedules continue to be managed by WeekFlow's recurring-task tools.
    setRepeatChoice('none');
    setRepeatStartDate(getLocalDateKey(new Date()));
    setSelectedWeekdays([]);
    setRepeatEndPreset('none');
    setCustomRepeatEndDate('');
    setUseCustomRepeatStartDate(false);
    setRepeatError('');
    setTemplateMessage(
      `Loaded “${template.title}” into Quick Task.`
    );
  }

  async function handleAddTaskFromTemplate(
    templateId: number,
    templateTitle: string
  ) {
    try {
      await addTaskFromTemplate(templateId);
      setTemplateMessage(
        `Added “${templateTitle}” to Inbox.`
      );
    } catch (error) {
      setTemplateMessage(
        error instanceof Error
          ? error.message
          : 'The template task could not be added.'
      );
    }
  }

  function startEditingTemplate(
    template: (typeof taskTemplates)[number]
  ) {
    setEditingTemplateId(template.id);
    setEditTemplateTitle(template.title);
    setEditTemplateNotes(template.notes ?? '');
    setEditTemplatePriority(template.priority);
    setEditTemplateGoalId(template.goalId);
    setTemplateMessage('');
  }

  function cancelEditingTemplate() {
    setEditingTemplateId(null);
    setEditTemplateTitle('');
    setEditTemplateNotes('');
    setEditTemplatePriority(0);
    setEditTemplateGoalId(null);
  }

  async function handleSaveEditedTemplate() {
    if (editingTemplateId === null) return;

    if (!editTemplateTitle.trim()) {
      setTemplateMessage('A task template needs a title.');
      return;
    }

    try {
      await editTaskTemplate(
        editingTemplateId,
        editTemplateTitle,
        editTemplateNotes,
        editTemplatePriority,
        editTemplateGoalId
      );
      setTemplateMessage(
        `Updated “${editTemplateTitle.trim()}”.`
      );
      cancelEditingTemplate();
    } catch (error) {
      setTemplateMessage(
        error instanceof Error
          ? error.message
          : 'The task template could not be updated.'
      );
    }
  }

  async function handleDeleteTemplate(
    templateId: number,
    templateTitle: string
  ) {
    try {
      await deleteTaskTemplate(templateId);

      if (editingTemplateId === templateId) {
        cancelEditingTemplate();
      }

      setTemplateMessage(
        `Deleted the “${templateTitle}” template.`
      );
    } catch (error) {
      setTemplateMessage(
        error instanceof Error
          ? error.message
          : 'The task template could not be deleted.'
      );
    }
  }

  function toggleSelectedWeekday(weekday: number) {
    setSelectedWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday]
    );
  }

  function toggleEditSelectedWeekday(weekday: number) {
    setEditSelectedWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday]
    );
    setEditRepeatError('');
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
        endDate: resolveRepeatEndDate(
          repeatStartDate,
          repeatEndPreset,
          customRepeatEndDate
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

  async function scheduleTaskForDate(
    task: Task,
    dateKey: string
  ) {
    await scheduleTask(task.id, dateKey);
  }

  async function handleScheduleDate(dateKey: string) {
    if (!datePickerTask) return;

    await scheduleTaskForDate(datePickerTask, dateKey);
    setDatePickerTask(null);
  }

  async function handleAddBrainDump() {
    await addBrainDump(brainDumpText);
    setBrainDumpText('');
  }

  async function handleTurnBrainDumpIntoTask(id: number) {
    await turnBrainDumpIntoTask(id);
  }

  function startEditingBrainDump(brainDump: BrainDump) {
    setEditingBrainDumpId(brainDump.id);
    setEditBrainDumpText(brainDump.body);
    setEditBrainDumpError('');
  }

  function cancelEditingBrainDump() {
    setEditingBrainDumpId(null);
    setEditBrainDumpText('');
    setEditBrainDumpError('');
  }

  async function handleSaveEditedBrainDump() {
    if (editingBrainDumpId === null) return;

    if (!editBrainDumpText.trim()) {
      setEditBrainDumpError(
        'Enter some text before saving the Brain Dump note.'
      );
      return;
    }

    try {
      setEditBrainDumpError('');
      await editBrainDump(
        editingBrainDumpId,
        editBrainDumpText
      );
      cancelEditingBrainDump();
    } catch (error) {
      setEditBrainDumpError(
        error instanceof Error
          ? error.message
          : 'The Brain Dump note could not be updated.'
      );
    }
  }

  function startEditingTask(task: Task) {
    const initialStartDate =
      task.dueDate ?? getLocalDateKey(new Date());
    const recurringRule =
      task.recurringRuleId === null
        ? null
        : recurringRules.find(
            (rule) => rule.id === task.recurringRuleId
          ) ?? null;
    const recurringEffectiveDate =
      task.recurrenceOccurrenceDate ?? initialStartDate;

    setEditingTaskId(task.id);
    setEditTaskText(task.title);
    setEditNotesText(task.notes ?? '');
    setEditPriority(task.priority);
    setEditGoalId(task.goalId);
    setEditRecurringScope('single');

    if (recurringRule) {
      setEditRepeatChoice(recurringRule.frequency);
      setEditRepeatStartDate(recurringEffectiveDate);
      setEditSelectedWeekdays(recurringRule.weekdays);
      setEditRepeatEndPreset(
        getRepeatEndPresetFromDates(
          recurringEffectiveDate,
          recurringRule.endDate
        )
      );
      setEditCustomRepeatEndDate(
        recurringRule.endDate ?? ''
      );
      setEditUseCustomRepeatStartDate(false);
    } else {
      setEditRepeatChoice('none');
      setEditRepeatStartDate(initialStartDate);
      setEditSelectedWeekdays([]);
      setEditRepeatEndPreset('none');
      setEditCustomRepeatEndDate('');
      setEditUseCustomRepeatStartDate(
        !scheduleOptions.some(
          (option) => option.dateKey === initialStartDate
        )
      );
    }

    setEditRepeatError('');
  }

  function cancelEditingTask() {
    setEditingTaskId(null);
    setEditTaskText('');
    setEditNotesText('');
    setEditPriority(0);
    setEditGoalId(null);
    setEditRepeatChoice('none');
    setEditRepeatStartDate(getLocalDateKey(new Date()));
    setEditSelectedWeekdays([]);
    setEditRepeatEndPreset('none');
    setEditCustomRepeatEndDate('');
    setEditUseCustomRepeatStartDate(false);
    setEditRecurringScope('single');
    setEditRepeatError('');
  }

  async function handleSaveEditedTask() {
    if (editingTaskId === null || !editTaskText.trim()) {
      return;
    }

    const task = tasks.find(
      (item) => item.id === editingTaskId
    );

    if (!task) {
      setEditRepeatError('The task could not be found.');
      return;
    }

    if (task.recurringRuleId !== null) {
      try {
        setEditRepeatError('');

        if (editRecurringScope === 'single') {
          await editTask(
            editingTaskId,
            editTaskText,
            editNotesText,
            editPriority,
            editGoalId
          );
        } else {
          if (editRepeatChoice === 'none') {
            throw new Error(
              'Choose a repeat frequency for future occurrences.'
            );
          }

          if (
            editRepeatChoice === 'certainDays' &&
            editSelectedWeekdays.length === 0
          ) {
            throw new Error(
              'Choose at least one weekday for Certain Days.'
            );
          }

          const effectiveDate =
            task.recurrenceOccurrenceDate;

          if (!effectiveDate) {
            throw new Error(
              'The recurring occurrence date could not be found.'
            );
          }

          await updateRecurringTaskFromOccurrence(
            editingTaskId,
            {
              title: editTaskText,
              notes: editNotesText,
              priority: editPriority,
              goalId: editGoalId,
              frequency: editRepeatChoice,
              endDate: resolveRepeatEndDate(
                effectiveDate,
                editRepeatEndPreset,
                editCustomRepeatEndDate
              ),
              weekdays:
                editRepeatChoice === 'certainDays'
                  ? editSelectedWeekdays
                  : [],
            }
          );
        }

        cancelEditingTask();
      } catch (error) {
        setEditRepeatError(
          error instanceof Error
            ? error.message
            : 'The recurring task could not be updated.'
        );
      }

      return;
    }

    if (editRepeatChoice === 'none') {
      await editTask(
        editingTaskId,
        editTaskText,
        editNotesText,
        editPriority,
        editGoalId
      );

      cancelEditingTask();
      return;
    }

    if (
      editRepeatChoice === 'certainDays' &&
      editSelectedWeekdays.length === 0
    ) {
      setEditRepeatError(
        'Choose at least one weekday for Certain Days.'
      );
      return;
    }

    try {
      setEditRepeatError('');

      await convertTaskToRecurring(editingTaskId, {
        title: editTaskText,
        notes: editNotesText,
        priority: editPriority,
        goalId: editGoalId,
        frequency: editRepeatChoice,
        startDate: editRepeatStartDate,
        endDate: resolveRepeatEndDate(
          editRepeatStartDate,
          editRepeatEndPreset,
          editCustomRepeatEndDate
        ),
        weekdays:
          editRepeatChoice === 'certainDays'
            ? editSelectedWeekdays
            : [],
      });

      cancelEditingTask();
      setIsRecurringManagerExpanded(true);
    } catch (error) {
      setEditRepeatError(
        error instanceof Error
          ? error.message
          : 'The task could not be converted into a recurring task.'
      );
    }
  }

  function startEditingRecurringRule(rule: RecurringRule) {
    setEditingRuleId(rule.id);
    setEditRuleTitle(rule.title);
    setEditRuleNotes(rule.notes ?? '');
    setEditRulePriority(rule.priority);
    setEditRuleGoalId(rule.goalId);
    setEditRuleFrequency(rule.frequency);
    setEditRuleStartDate(rule.startDate);
    setEditRuleEndPreset(
      getRepeatEndPresetFromDates(
        rule.startDate,
        rule.endDate
      )
    );
    setEditRuleEndDate(rule.endDate ?? '');
    setEditRuleWeekdays(rule.weekdays);
    setEditRuleError('');
    setConfirmDeleteRuleId(null);
  }

  function cancelEditingRecurringRule() {
    setEditingRuleId(null);
    setEditRuleTitle('');
    setEditRuleNotes('');
    setEditRulePriority(0);
    setEditRuleGoalId(null);
    setEditRuleFrequency('daily');
    setEditRuleStartDate('');
    setEditRuleEndPreset('none');
    setEditRuleEndDate('');
    setEditRuleWeekdays([]);
    setEditRuleError('');
  }

  function toggleEditRuleWeekday(weekday: number) {
    setEditRuleWeekdays((current) =>
      current.includes(weekday)
        ? current.filter((item) => item !== weekday)
        : [...current, weekday]
    );
    setEditRuleError('');
  }

  async function handleSaveRecurringRule() {
    if (editingRuleId === null) return;

    if (!editRuleTitle.trim()) {
      setEditRuleError(
        'A recurring task needs a title.'
      );
      return;
    }

    if (
      editRuleFrequency === 'certainDays' &&
      editRuleWeekdays.length === 0
    ) {
      setEditRuleError(
        'Choose at least one weekday for Certain Days.'
      );
      return;
    }

    try {
      setEditRuleError('');

      await updateRecurringTask(editingRuleId, {
        title: editRuleTitle,
        notes: editRuleNotes,
        priority: editRulePriority,
        goalId: editRuleGoalId,
        frequency: editRuleFrequency,
        startDate: editRuleStartDate,
        endDate: resolveRepeatEndDate(
          editRuleStartDate,
          editRuleEndPreset,
          editRuleEndDate
        ),
        weekdays:
          editRuleFrequency === 'certainDays'
            ? editRuleWeekdays
            : [],
      });

      cancelEditingRecurringRule();
    } catch (error) {
      setEditRuleError(
        error instanceof Error
          ? error.message
          : 'The recurring schedule could not be updated.'
      );
    }
  }

  return (
    <>
      <TaskDatePicker
        visible={datePickerTask !== null}
        taskTitle={datePickerTask?.title}
        initialDateKey={datePickerTask?.dueDate}
        minimumDateKey={todayKey}
        onCancel={() => setDatePickerTask(null)}
        onSelectDate={handleScheduleDate}
      />

      <ScrollView
        style={styles.page}
        contentContainerStyle={[
          styles.content,
          isDesktop && styles.contentDesktop,
        ]}
        keyboardShouldPersistTaps="handled"
      >
      <View
        style={[
          styles.header,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
        <Text style={styles.title}>Inbox</Text>
        <Text style={styles.subtitle}>
          Capture tasks, reminders, and random thoughts before
          they get lost.
        </Text>
      </View>

      <View style={isDesktop ? styles.fullWidthPanel : undefined}>
        <InboxOverviewCard
          snapshot={inboxOverview}
          activeFilter={selectedQuickFilter}
          brainDumpCount={activeBrainDumps.length}
          templateCount={taskTemplates.length}
          onSelectFilter={handleSelectQuickFilter}
        />
      </View>

      <View
        style={[
          styles.section,
          isDesktop && styles.workspacePrimary,
        ]}
      >
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
                    ? 'Repeats every week on the weekday of the selected start date.'
                    : repeatChoice === 'everyTwoWeeks'
                      ? 'Repeats every 2 weeks on the weekday of the selected start date.'
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
                    !useCustomRepeatStartDate &&
                    repeatStartDate === option.dateKey;

                  return (
                    <Pressable
                      key={option.dateKey}
                      style={[
                        styles.dateButton,
                        selected &&
                          styles.dateButtonSelected,
                      ]}
                      onPress={() => {
                        setRepeatStartDate(option.dateKey);
                        setUseCustomRepeatStartDate(false);
                        setRepeatError('');
                      }}
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
                <Pressable
                  style={[
                    styles.dateButton,
                    useCustomRepeatStartDate &&
                      styles.dateButtonSelected,
                  ]}
                  onPress={() => {
                    setUseCustomRepeatStartDate(true);
                    setRepeatError('');
                  }}
                >
                  <Text
                    style={[
                      styles.dateDay,
                      useCustomRepeatStartDate &&
                        styles.selectedText,
                    ]}
                  >
                    Custom
                  </Text>
                  <Text
                    style={[
                      styles.dateDate,
                      useCustomRepeatStartDate &&
                        styles.selectedText,
                    ]}
                  >
                    Date
                  </Text>
                </Pressable>
              </ScrollView>

              {useCustomRepeatStartDate ? (
                <>
                  <Text style={styles.pickerLabel}>
                    Custom first date (YYYY-MM-DD):
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={repeatStartDate}
                    onChangeText={(value) => {
                      setRepeatStartDate(value);
                      setRepeatError('');

                      if (repeatChoice === 'certainDays') {
                        const date = parseLocalDateKey(value);

                        if (date) {
                          setSelectedWeekdays((current) =>
                            current.includes(date.getDay())
                              ? current
                              : [...current, date.getDay()]
                          );
                        }
                      }
                    }}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              ) : null}

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
                    onPress={() => {
                      setRepeatEndPreset(choice.value);
                      setRepeatError('');
                    }}
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

              {repeatEndPreset === 'custom' ? (
                <>
                  <Text style={styles.pickerLabel}>
                    Custom end date (YYYY-MM-DD):
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={customRepeatEndDate}
                    onChangeText={(value) => {
                      setCustomRepeatEndDate(value);
                      setRepeatError('');
                    }}
                    placeholder="YYYY-MM-DD"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </>
              ) : repeatEndPreset !== 'none' ? (
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

          <Pressable
            style={styles.templateSaveButton}
            onPress={handleSaveCurrentAsTemplate}
          >
            <Text style={styles.templateSaveButtonText}>
              Save Details as Template
            </Text>
          </Pressable>

          <Text style={styles.templateHelpText}>
            Templates save the title, notes, priority, and linked goal.
            Repeat settings stay in Manage Recurring Tasks.
          </Text>

        </View>
      </View>

      <View
        style={[
          styles.section,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
        <Pressable
          style={[styles.managerHeader, styles.templateManagerHeader]}
          onPress={() =>
            setIsTaskTemplatesExpanded((current) => !current)
          }
          accessibilityRole="button"
          accessibilityState={{
            expanded: isTaskTemplatesExpanded,
          }}
        >
          <View style={styles.transparent}>
            <Text style={styles.sectionTitle}>Task Templates</Text>
            <Text style={styles.sectionSubtitleNoMargin}>
              {taskTemplates.length} saved template
              {taskTemplates.length === 1 ? '' : 's'}
            </Text>
          </View>

          <Text style={[styles.chevron, styles.templateChevron]}>
            {isTaskTemplatesExpanded ? '▼' : '▶'}
          </Text>
        </Pressable>

        {isTaskTemplatesExpanded ? (
          <View style={styles.list}>
            <Text style={styles.sectionSubtitleNoMargin}>
              Reuse common one-time task details without rebuilding the
              title, notes, priority, and goal link every time.
            </Text>

        {templateMessage ? (
          <Text style={styles.templateMessage}>
            {templateMessage}
          </Text>
        ) : null}

        {taskTemplates.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>
              No task templates yet
            </Text>
            <Text style={styles.emptyText}>
              Fill out Quick Task, then choose Save Details as Template.
            </Text>
          </View>
        ) : (
          <View style={styles.cardGrid}>
            {taskTemplates.map((template) => {
              const linkedGoal = goals.find(
                (goal) => goal.id === template.goalId
              );
              const isEditing =
                editingTemplateId === template.id;

              return (
                <View
                  key={template.id}
                  style={[
                    styles.taskCard,
                    isWideDesktop && styles.halfWidthCard,
                  ]}
                >
                  {isEditing ? (
                    <View style={styles.form}>
                      <Text style={styles.editTitle}>
                        Edit Template
                      </Text>

                      <TextInput
                        style={styles.input}
                        value={editTemplateTitle}
                        onChangeText={setEditTemplateTitle}
                        placeholder="Template title"
                      />

                      <TextInput
                        style={[styles.input, styles.notesInput]}
                        value={editTemplateNotes}
                        onChangeText={setEditTemplateNotes}
                        placeholder="Notes... optional"
                        multiline
                      />

                      <View style={styles.rowWrap}>
                        {[0, 1, 2].map((level) => (
                          <Pressable
                            key={level}
                            style={[
                              styles.pill,
                              editTemplatePriority === level &&
                                styles.prioritySelected,
                            ]}
                            onPress={() =>
                              setEditTemplatePriority(level)
                            }
                          >
                            <Text
                              style={[
                                styles.pillText,
                                editTemplatePriority === level &&
                                  styles.selectedText,
                              ]}
                            >
                              {getPriorityLabel(level)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>

                      <Text style={styles.pickerLabel}>
                        Link to goal:
                      </Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.horizontalRow}
                      >
                        <Pressable
                          style={[
                            styles.pill,
                            editTemplateGoalId === null &&
                              styles.goalSelected,
                          ]}
                          onPress={() =>
                            setEditTemplateGoalId(null)
                          }
                        >
                          <Text
                            style={[
                              styles.pillText,
                              editTemplateGoalId === null &&
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
                              editTemplateGoalId === goal.id &&
                                styles.goalSelected,
                            ]}
                            onPress={() =>
                              setEditTemplateGoalId(goal.id)
                            }
                          >
                            <Text
                              style={[
                                styles.pillText,
                                editTemplateGoalId === goal.id &&
                                  styles.selectedText,
                              ]}
                              numberOfLines={1}
                            >
                              {goal.title}
                            </Text>
                          </Pressable>
                        ))}
                      </ScrollView>

                      <View style={styles.rowWrap}>
                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.doneButton,
                          ]}
                          onPress={handleSaveEditedTemplate}
                        >
                          <Text style={styles.buttonText}>Save</Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.cancelButton,
                          ]}
                          onPress={cancelEditingTemplate}
                        >
                          <Text style={styles.buttonText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <>
                      <View style={styles.transparent}>
                        <Text style={styles.taskTitle}>
                          {template.title}
                        </Text>
                        <Text style={styles.taskMeta}>
                          Priority: {getPriorityLabel(template.priority)}
                        </Text>
                        <Text style={styles.taskMeta}>
                          Goal: {linkedGoal?.title ?? 'None'}
                        </Text>
                        {template.notes ? (
                          <Text style={styles.taskNotes}>
                            {template.notes}
                          </Text>
                        ) : null}
                      </View>

                      <View style={styles.rowWrap}>
                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.templateUseButton,
                          ]}
                          onPress={() =>
                            handleLoadTemplate(template)
                          }
                        >
                          <Text style={styles.buttonText}>
                            Load
                          </Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.doneButton,
                          ]}
                          onPress={() =>
                            handleAddTaskFromTemplate(
                              template.id,
                              template.title
                            )
                          }
                        >
                          <Text style={styles.buttonText}>
                            Add to Inbox
                          </Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.editButton,
                          ]}
                          onPress={() =>
                            startEditingTemplate(template)
                          }
                        >
                          <Text style={styles.buttonText}>Edit</Text>
                        </Pressable>

                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.deleteButton,
                          ]}
                          onPress={() =>
                            handleDeleteTemplate(
                              template.id,
                              template.title
                            )
                          }
                        >
                          <Text style={styles.buttonText}>Delete</Text>
                        </Pressable>
                      </View>
                    </>
                  )}
                </View>
              );
            })}
          </View>
        )}
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.section,
          isDesktop && styles.workspaceSecondary,
        ]}
      >
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

                    {editingRuleId === rule.id ? (
                      <View style={styles.seriesEditPanel}>
                        <Text style={styles.editTitle}>
                          Edit Saved Schedule
                        </Text>
                        <Text style={styles.seriesEditHelp}>
                          Completed occurrences stay unchanged.
                          Unfinished occurrences from today forward
                          are rebuilt from the updated schedule. A
                          paused schedule stays paused.
                        </Text>

                        <TextInput
                          style={styles.input}
                          value={editRuleTitle}
                          onChangeText={setEditRuleTitle}
                          placeholder="Recurring task title"
                        />

                        <TextInput
                          style={[
                            styles.input,
                            styles.notesInput,
                          ]}
                          value={editRuleNotes}
                          onChangeText={setEditRuleNotes}
                          placeholder="Notes... optional"
                          multiline
                        />

                        <Text style={styles.pickerLabel}>
                          Priority:
                        </Text>
                        <View style={styles.rowWrap}>
                          {[0, 1, 2].map((level) => (
                            <Pressable
                              key={level}
                              style={[
                                styles.pill,
                                editRulePriority === level &&
                                  styles.prioritySelected,
                              ]}
                              onPress={() =>
                                setEditRulePriority(level)
                              }
                            >
                              <Text
                                style={[
                                  styles.pillText,
                                  editRulePriority === level &&
                                    styles.selectedText,
                                ]}
                              >
                                {getPriorityLabel(level)}
                              </Text>
                            </Pressable>
                          ))}
                        </View>

                        <Text style={styles.pickerLabel}>
                          Link to goal:
                        </Text>
                        <ScrollView
                          horizontal={!isWideDesktop}
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={[
                            styles.horizontalRow,
                            isWideDesktop &&
                              styles.horizontalRowDesktop,
                          ]}
                        >
                          <Pressable
                            style={[
                              styles.pill,
                              editRuleGoalId === null &&
                                styles.goalSelected,
                            ]}
                            onPress={() =>
                              setEditRuleGoalId(null)
                            }
                          >
                            <Text
                              style={[
                                styles.pillText,
                                editRuleGoalId === null &&
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
                                editRuleGoalId === goal.id &&
                                  styles.goalSelected,
                              ]}
                              onPress={() =>
                                setEditRuleGoalId(goal.id)
                              }
                            >
                              <Text
                                style={[
                                  styles.pillText,
                                  editRuleGoalId === goal.id &&
                                    styles.selectedText,
                                ]}
                              >
                                {goal.title}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>

                        <Text style={styles.pickerLabel}>
                          Repeat:
                        </Text>
                        <View style={styles.rowWrap}>
                          {repeatChoices
                            .filter(
                              (choice) =>
                                choice.value !== 'none'
                            )
                            .map((choice) => (
                              <Pressable
                                key={choice.value}
                                style={[
                                  styles.pill,
                                  editRuleFrequency ===
                                    choice.value &&
                                    styles.repeatSelected,
                                ]}
                                onPress={() => {
                                  setEditRuleFrequency(
                                    choice.value as RecurrenceFrequency
                                  );
                                  setEditRuleError('');
                                }}
                              >
                                <Text
                                  style={[
                                    styles.pillText,
                                    editRuleFrequency ===
                                      choice.value &&
                                      styles.selectedText,
                                  ]}
                                >
                                  {choice.label}
                                </Text>
                              </Pressable>
                            ))}
                        </View>

                        {editRuleFrequency ===
                        'certainDays' ? (
                          <View style={styles.rowWrap}>
                            {selectableWeekdays.map(
                              (weekday) => {
                                const selected =
                                  editRuleWeekdays.includes(
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
                                      toggleEditRuleWeekday(
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
                              }
                            )}
                          </View>
                        ) : null}

                        <Text style={styles.pickerLabel}>
                          Start date (YYYY-MM-DD):
                        </Text>
                        <TextInput
                          style={styles.input}
                          value={editRuleStartDate}
                          onChangeText={(value) => {
                            setEditRuleStartDate(value);
                            setEditRuleError('');
                          }}
                          placeholder="YYYY-MM-DD"
                          autoCapitalize="none"
                          autoCorrect={false}
                        />

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
                                editRuleEndPreset === choice.value &&
                                  styles.endSelected,
                              ]}
                              onPress={() => {
                                setEditRuleEndPreset(choice.value);
                                setEditRuleError('');
                              }}
                            >
                              <Text
                                style={[
                                  styles.pillText,
                                  editRuleEndPreset === choice.value &&
                                    styles.selectedText,
                                ]}
                              >
                                {choice.label}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>

                        {editRuleEndPreset === 'custom' ? (
                          <>
                            <Text style={styles.pickerLabel}>
                              Custom end date (YYYY-MM-DD):
                            </Text>
                            <TextInput
                              style={styles.input}
                              value={editRuleEndDate}
                              onChangeText={(value) => {
                                setEditRuleEndDate(value);
                                setEditRuleError('');
                              }}
                              placeholder="YYYY-MM-DD"
                              autoCapitalize="none"
                              autoCorrect={false}
                            />
                          </>
                        ) : editRuleEndPreset !== 'none' ? (
                          <Text style={styles.endDateText}>
                            Ends:{' '}
                            {formatDateKey(
                              getRepeatEndDate(
                                editRuleStartDate,
                                editRuleEndPreset
                              ) ?? editRuleStartDate
                            )}
                          </Text>
                        ) : null}

                        {editRuleError ? (
                          <Text style={styles.errorText}>
                            {editRuleError}
                          </Text>
                        ) : null}

                        <View style={styles.rowWrap}>
                          <Pressable
                            style={[
                              styles.smallButton,
                              styles.doneButton,
                            ]}
                            onPress={handleSaveRecurringRule}
                          >
                            <Text style={styles.buttonText}>
                              Save Schedule
                            </Text>
                          </Pressable>

                          <Pressable
                            style={[
                              styles.smallButton,
                              styles.cancelButton,
                            ]}
                            onPress={
                              cancelEditingRecurringRule
                            }
                          >
                            <Text style={styles.buttonText}>
                              Cancel
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.rowWrap}>
                      {editingRuleId !== rule.id ? (
                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.editButton,
                          ]}
                          onPress={() =>
                            startEditingRecurringRule(rule)
                          }
                        >
                          <Text style={styles.buttonText}>
                            Edit Schedule
                          </Text>
                        </Pressable>
                      ) : null}

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

      <View
        style={[
          styles.section,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
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

        <View
          style={[
            styles.list,
            isDesktop && styles.cardGrid,
          ]}
        >
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
            activeBrainDumps.map((brainDump) => {
              const isEditingBrainDump =
                editingBrainDumpId === brainDump.id;

              return (
                <View
                  key={brainDump.id}
                  style={[
                    styles.horizontalCard,
                    isEditingBrainDump &&
                      styles.brainDumpEditingCard,
                    isDesktop && styles.halfWidthCard,
                  ]}
                >
                  {isEditingBrainDump ? (
                    <>
                      <View style={styles.flex}>
                        <Text style={styles.editTitle}>
                          Edit Brain Dump
                        </Text>
                        <TextInput
                          style={[
                            styles.input,
                            styles.brainDumpEditInput,
                          ]}
                          value={editBrainDumpText}
                          onChangeText={(value) => {
                            setEditBrainDumpText(value);
                            setEditBrainDumpError('');
                          }}
                          placeholder="Update this note..."
                          multiline
                          autoFocus
                        />
                        {editBrainDumpError ? (
                          <Text style={styles.errorText}>
                            {editBrainDumpError}
                          </Text>
                        ) : null}
                        <Text style={styles.taskMeta}>
                          Originally saved:{' '}
                          {formatCreatedDate(
                            brainDump.createdAt
                          )}
                        </Text>
                      </View>

                      <View style={styles.editActionRow}>
                        <Pressable
                          style={[
                            styles.flexButton,
                            styles.editButton,
                          ]}
                          onPress={handleSaveEditedBrainDump}
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
                          onPress={cancelEditingBrainDump}
                        >
                          <Text style={styles.buttonText}>
                            Cancel
                          </Text>
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <>
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
                            startEditingBrainDump(brainDump)
                          }
                        >
                          <Text style={styles.buttonText}>
                            Edit
                          </Text>
                        </Pressable>
                        <Pressable
                          style={[
                            styles.smallButton,
                            styles.editButton,
                          ]}
                          onPress={() =>
                            handleTurnBrainDumpIntoTask(
                              brainDump.id
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
                    </>
                  )}
                </View>
              );
            })
          )}
        </View>
      </View>

      <View
        style={[
          styles.section,
          isDesktop && styles.fullWidthPanel,
        ]}
      >
        <Text style={styles.sectionTitle}>
          Task Organizer
        </Text>
        <Text style={styles.sectionSubtitle}>
          Review unscheduled, overdue, today, upcoming, recurring, or
          goal-linked work from one place. Inbox remains the task creation and
          scheduling center.
        </Text>

        <ActiveTaskFilters
          goals={goals}
          filters={taskFilters}
          onChange={setTaskFilters}
          totalCount={activeTasks.length}
          resultCount={filteredActiveTasks.length}
          scheduleChoices={['all', 'unscheduled', 'overdue', 'today', 'upcoming']}
          showDueDate
        />

        <View
          style={[
            styles.list,
            isDesktop && styles.cardGrid,
          ]}
        >
          {activeTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Inbox is clear ✅
              </Text>
              <Text style={styles.emptyText}>
                Add a task when you need to capture something.
              </Text>
            </View>
          ) : filteredActiveTasks.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                No tasks match these filters
              </Text>
              <Text style={styles.emptyText}>
                Clear or adjust Search & Filters to show more active tasks.
              </Text>
            </View>
          ) : (
            filteredActiveTasks.map((task) => {
              const linkedGoal = goals.find(
                (goal) => goal.id === task.goalId
              );
              const isEditing =
                editingTaskId === task.id;

              if (isEditing) {
                return (
                  <View
                    key={task.id}
                    style={[
                      styles.taskCard,
                      isDesktop && styles.halfWidthCard,
                    ]}
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

                    {task.recurringRuleId === null ? (
                      <>
                        <Text style={styles.pickerLabel}>
                          Repeat after saving:
                        </Text>
                        <ScrollView
                          horizontal
                          showsHorizontalScrollIndicator={false}
                          contentContainerStyle={
                            styles.horizontalRow
                          }
                        >
                          {repeatChoices.map((choice) => (
                            <Pressable
                              key={choice.value}
                              style={[
                                styles.pill,
                                editRepeatChoice ===
                                  choice.value &&
                                  styles.repeatSelected,
                              ]}
                              onPress={() => {
                                setEditRepeatChoice(
                                  choice.value
                                );
                                setEditRepeatError('');

                                if (
                                  choice.value ===
                                    'certainDays' &&
                                  editSelectedWeekdays.length ===
                                    0
                                ) {
                                  const startDate =
                                    parseLocalDateKey(
                                      editRepeatStartDate
                                    );

                                  if (startDate) {
                                    setEditSelectedWeekdays([
                                      startDate.getDay(),
                                    ]);
                                  }
                                }
                              }}
                            >
                              <Text
                                style={[
                                  styles.pillText,
                                  editRepeatChoice ===
                                    choice.value &&
                                    styles.selectedText,
                                ]}
                              >
                                {choice.label}
                              </Text>
                            </Pressable>
                          ))}
                        </ScrollView>

                        {editRepeatChoice !== 'none' ? (
                          <View style={styles.recurringSetup}>
                            <Text
                              style={styles.recurringHelp}
                            >
                              The current task becomes the first
                              occurrence. WeekFlow creates only
                              the future occurrences after it.
                            </Text>

                            {editRepeatChoice ===
                            'certainDays' ? (
                              <>
                                <Text
                                  style={styles.pickerLabel}
                                >
                                  Repeat on:
                                </Text>
                                <View style={styles.rowWrap}>
                                  {selectableWeekdays.map(
                                    (weekday) => {
                                      const selected =
                                        editSelectedWeekdays.includes(
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
                                            toggleEditSelectedWeekday(
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
                                    }
                                  )}
                                </View>
                              </>
                            ) : null}

                            <Text style={styles.pickerLabel}>
                              First scheduled date:
                            </Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={
                                false
                              }
                              contentContainerStyle={
                                styles.horizontalRow
                              }
                            >
                              {scheduleOptions.map((option) => {
                                const selected =
                                  !editUseCustomRepeatStartDate &&
                                  editRepeatStartDate ===
                                  option.dateKey;

                                return (
                                  <Pressable
                                    key={option.dateKey}
                                    style={[
                                      styles.dateButton,
                                      selected &&
                                        styles.dateButtonSelected,
                                    ]}
                                    onPress={() => {
                                      setEditRepeatStartDate(
                                        option.dateKey
                                      );
                                      setEditUseCustomRepeatStartDate(
                                        false
                                      );
                                      setEditRepeatError('');

                                      if (
                                        editRepeatChoice ===
                                        'certainDays'
                                      ) {
                                        const date =
                                          parseLocalDateKey(
                                            option.dateKey
                                          );

                                        if (date) {
                                          setEditSelectedWeekdays(
                                            (current) =>
                                              current.includes(
                                                date.getDay()
                                              )
                                                ? current
                                                : [
                                                    ...current,
                                                    date.getDay(),
                                                  ]
                                          );
                                        }
                                      }
                                    }}
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
                              <Pressable
                                style={[
                                  styles.dateButton,
                                  editUseCustomRepeatStartDate &&
                                    styles.dateButtonSelected,
                                ]}
                                onPress={() => {
                                  setEditUseCustomRepeatStartDate(
                                    true
                                  );
                                  setEditRepeatError('');
                                }}
                              >
                                <Text
                                  style={[
                                    styles.dateDay,
                                    editUseCustomRepeatStartDate &&
                                      styles.selectedText,
                                  ]}
                                >
                                  Custom
                                </Text>
                                <Text
                                  style={[
                                    styles.dateDate,
                                    editUseCustomRepeatStartDate &&
                                      styles.selectedText,
                                  ]}
                                >
                                  Date
                                </Text>
                              </Pressable>
                            </ScrollView>

                            {editUseCustomRepeatStartDate ? (
                              <>
                                <Text style={styles.pickerLabel}>
                                  Custom first date (YYYY-MM-DD):
                                </Text>
                                <TextInput
                                  style={styles.input}
                                  value={editRepeatStartDate}
                                  onChangeText={(value) => {
                                    setEditRepeatStartDate(value);
                                    setEditRepeatError('');

                                    if (
                                      editRepeatChoice ===
                                      'certainDays'
                                    ) {
                                      const date =
                                        parseLocalDateKey(value);

                                      if (date) {
                                        setEditSelectedWeekdays(
                                          (current) =>
                                            current.includes(
                                              date.getDay()
                                            )
                                              ? current
                                              : [
                                                  ...current,
                                                  date.getDay(),
                                                ]
                                        );
                                      }
                                    }
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                />
                              </>
                            ) : null}

                            <Text style={styles.pickerLabel}>
                              Repeat until:
                            </Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={
                                false
                              }
                              contentContainerStyle={
                                styles.horizontalRow
                              }
                            >
                              {repeatEndChoices.map((choice) => (
                                <Pressable
                                  key={choice.value}
                                  style={[
                                    styles.pill,
                                    editRepeatEndPreset ===
                                      choice.value &&
                                      styles.endSelected,
                                  ]}
                                  onPress={() => {
                                    setEditRepeatEndPreset(
                                      choice.value
                                    );
                                    setEditRepeatError('');
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.pillText,
                                      editRepeatEndPreset ===
                                        choice.value &&
                                        styles.selectedText,
                                    ]}
                                  >
                                    {choice.label}
                                  </Text>
                                </Pressable>
                              ))}
                            </ScrollView>

                            {editRepeatEndPreset === 'custom' ? (
                              <>
                                <Text style={styles.pickerLabel}>
                                  Custom end date (YYYY-MM-DD):
                                </Text>
                                <TextInput
                                  style={styles.input}
                                  value={editCustomRepeatEndDate}
                                  onChangeText={(value) => {
                                    setEditCustomRepeatEndDate(value);
                                    setEditRepeatError('');
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                />
                              </>
                            ) : editRepeatEndPreset !== 'none' ? (
                              <Text style={styles.endDateText}>
                                Ends:{' '}
                                {formatDateKey(
                                  getRepeatEndDate(
                                    editRepeatStartDate,
                                    editRepeatEndPreset
                                  ) ?? editRepeatStartDate
                                )}
                              </Text>
                            ) : null}
                          </View>
                        ) : null}

                        {editRepeatError ? (
                          <Text style={styles.errorText}>
                            {editRepeatError}
                          </Text>
                        ) : null}
                      </>
                    ) : (
                      <View style={styles.recurringSetup}>
                        <Text style={styles.pickerLabel}>
                          Apply changes to:
                        </Text>
                        <View style={styles.rowWrap}>
                          <Pressable
                            style={[
                              styles.pill,
                              editRecurringScope === 'single' &&
                                styles.repeatSelected,
                            ]}
                            onPress={() => {
                              setEditRecurringScope('single');
                              setEditRepeatError('');
                            }}
                          >
                            <Text
                              style={[
                                styles.pillText,
                                editRecurringScope === 'single' &&
                                  styles.selectedText,
                              ]}
                            >
                              This Occurrence Only
                            </Text>
                          </Pressable>
                          <Pressable
                            style={[
                              styles.pill,
                              editRecurringScope === 'future' &&
                                styles.repeatSelected,
                            ]}
                            onPress={() => {
                              setEditRecurringScope('future');
                              setEditRepeatError('');
                            }}
                          >
                            <Text
                              style={[
                                styles.pillText,
                                editRecurringScope === 'future' &&
                                  styles.selectedText,
                              ]}
                            >
                              This & Future Occurrences
                            </Text>
                          </Pressable>
                        </View>

                        <Text style={styles.recurringHelp}>
                          {editRecurringScope === 'single'
                            ? 'Only this task changes. The saved schedule and every other occurrence stay untouched.'
                            : 'This task becomes the first occurrence of the revised schedule. Earlier tasks and completed History stay untouched.'}
                        </Text>

                        {editRecurringScope === 'future' ? (
                          <>
                            <Text style={styles.pickerLabel}>
                              Changes begin:
                            </Text>
                            <Text style={styles.endDateText}>
                              {formatDateKey(
                                task.recurrenceOccurrenceDate ??
                                  editRepeatStartDate
                              )}
                            </Text>

                            <Text style={styles.pickerLabel}>
                              Repeat:
                            </Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={
                                styles.horizontalRow
                              }
                            >
                              {repeatChoices
                                .filter(
                                  (choice) =>
                                    choice.value !== 'none'
                                )
                                .map((choice) => (
                                  <Pressable
                                    key={choice.value}
                                    style={[
                                      styles.pill,
                                      editRepeatChoice ===
                                        choice.value &&
                                        styles.repeatSelected,
                                    ]}
                                    onPress={() => {
                                      setEditRepeatChoice(
                                        choice.value
                                      );
                                      setEditRepeatError('');

                                      if (
                                        choice.value ===
                                          'certainDays' &&
                                        editSelectedWeekdays.length ===
                                          0
                                      ) {
                                        const effectiveDate =
                                          parseLocalDateKey(
                                            task.recurrenceOccurrenceDate ??
                                              editRepeatStartDate
                                          );

                                        if (effectiveDate) {
                                          setEditSelectedWeekdays([
                                            effectiveDate.getDay(),
                                          ]);
                                        }
                                      }
                                    }}
                                  >
                                    <Text
                                      style={[
                                        styles.pillText,
                                        editRepeatChoice ===
                                          choice.value &&
                                          styles.selectedText,
                                      ]}
                                    >
                                      {choice.label}
                                    </Text>
                                  </Pressable>
                                ))}
                            </ScrollView>

                            {editRepeatChoice ===
                            'certainDays' ? (
                              <>
                                <Text style={styles.pickerLabel}>
                                  Repeat on:
                                </Text>
                                <View style={styles.rowWrap}>
                                  {selectableWeekdays.map(
                                    (weekday) => {
                                      const selected =
                                        editSelectedWeekdays.includes(
                                          weekday.index
                                        );

                                      return (
                                        <Pressable
                                          key={weekday.index}
                                          style={[
                                            styles.pill,
                                            selected &&
                                              styles.weekdaySelected,
                                          ]}
                                          onPress={() =>
                                            toggleEditSelectedWeekday(
                                              weekday.index
                                            )
                                          }
                                        >
                                          <Text
                                            style={[
                                              styles.pillText,
                                              selected &&
                                                styles.selectedText,
                                            ]}
                                          >
                                            {weekday.label}
                                          </Text>
                                        </Pressable>
                                      );
                                    }
                                  )}
                                </View>
                              </>
                            ) : null}

                            <Text style={styles.pickerLabel}>
                              Repeat until:
                            </Text>
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              contentContainerStyle={
                                styles.horizontalRow
                              }
                            >
                              {repeatEndChoices.map((choice) => (
                                <Pressable
                                  key={choice.value}
                                  style={[
                                    styles.pill,
                                    editRepeatEndPreset ===
                                      choice.value &&
                                      styles.endSelected,
                                  ]}
                                  onPress={() => {
                                    setEditRepeatEndPreset(
                                      choice.value
                                    );
                                    setEditRepeatError('');
                                  }}
                                >
                                  <Text
                                    style={[
                                      styles.pillText,
                                      editRepeatEndPreset ===
                                        choice.value &&
                                        styles.selectedText,
                                    ]}
                                  >
                                    {choice.label}
                                  </Text>
                                </Pressable>
                              ))}
                            </ScrollView>

                            {editRepeatEndPreset === 'custom' ? (
                              <>
                                <Text style={styles.pickerLabel}>
                                  Custom end date (YYYY-MM-DD):
                                </Text>
                                <TextInput
                                  style={styles.input}
                                  value={editCustomRepeatEndDate}
                                  onChangeText={(value) => {
                                    setEditCustomRepeatEndDate(value);
                                    setEditRepeatError('');
                                  }}
                                  placeholder="YYYY-MM-DD"
                                  autoCapitalize="none"
                                  autoCorrect={false}
                                />
                              </>
                            ) : editRepeatEndPreset !== 'none' ? (
                              <Text style={styles.endDateText}>
                                Ends:{' '}
                                {formatDateKey(
                                  getRepeatEndDate(
                                    task.recurrenceOccurrenceDate ??
                                      editRepeatStartDate,
                                    editRepeatEndPreset
                                  ) ?? editRepeatStartDate
                                )}
                              </Text>
                            ) : null}
                          </>
                        ) : null}

                        {editRepeatError ? (
                          <Text style={styles.errorText}>
                            {editRepeatError}
                          </Text>
                        ) : null}
                      </View>
                    )}

                    <View style={styles.row}>
                      <Pressable
                        style={[
                          styles.flexButton,
                          styles.doneButton,
                        ]}
                        onPress={handleSaveEditedTask}
                      >
                        <Text style={styles.buttonText}>
                          {task.recurringRuleId !== null
                            ? editRecurringScope === 'future'
                              ? 'Save This & Future'
                              : 'Save Occurrence'
                            : editRepeatChoice !== 'none'
                              ? 'Save & Make Recurring'
                              : 'Save'}
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
                  style={[
                    styles.taskCard,
                    isDesktop && styles.halfWidthCard,
                  ]}
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
                        {task.dueDate
                          ? `Scheduled: ${formatDateKey(task.dueDate)}`
                          : 'Unscheduled'}
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
                      <TaskWeeklyCommitmentButton task={task} compact />
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
                    {task.dueDate ? 'Reschedule this task:' : 'Choose where this task goes:'}
                  </Text>
                  <View style={styles.rowWrap}>
                    <Pressable
                      style={[
                        styles.dateButton,
                        task.dueDate === null && styles.dateButtonSelected,
                      ]}
                      disabled={task.dueDate === null}
                      onPress={() => moveTaskToInbox(task.id)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: task.dueDate === null }}
                    >
                      <Text
                        style={[
                          styles.dateDay,
                          task.dueDate === null && styles.selectedText,
                        ]}
                      >
                        Inbox
                      </Text>
                      <Text
                        style={[
                          styles.dateDate,
                          task.dueDate === null && styles.selectedText,
                        ]}
                      >
                        Unscheduled
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.dateButton,
                        task.dueDate === todayKey && styles.dateButtonSelected,
                      ]}
                      disabled={task.dueDate === todayKey}
                      onPress={() =>
                        scheduleTaskForDate(task, todayKey)
                      }
                    >
                      <Text style={[
                        styles.dateDay,
                        task.dueDate === todayKey && styles.selectedText,
                      ]}>Today</Text>
                      <Text style={[
                        styles.dateDate,
                        task.dueDate === todayKey && styles.selectedText,
                      ]}>
                        {formatDateKey(todayKey, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={[
                        styles.dateButton,
                        task.dueDate === tomorrowKey && styles.dateButtonSelected,
                      ]}
                      disabled={task.dueDate === tomorrowKey}
                      onPress={() =>
                        scheduleTaskForDate(task, tomorrowKey)
                      }
                    >
                      <Text style={[
                        styles.dateDay,
                        task.dueDate === tomorrowKey && styles.selectedText,
                      ]}>Tomorrow</Text>
                      <Text style={[
                        styles.dateDate,
                        task.dueDate === tomorrowKey && styles.selectedText,
                      ]}>
                        {formatDateKey(tomorrowKey, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </Text>
                    </Pressable>

                    <Pressable
                      style={styles.dateButton}
                      onPress={() => setDatePickerTask(task)}
                    >
                      <Text style={styles.dateDay}>Choose Date</Text>
                      <Text style={styles.dateDate}>Any date</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { padding: 20, paddingBottom: 40 },
  contentDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: 18,
  },
  fullWidthPanel: { width: '100%' },
  workspacePrimary: { width: '58%' },
  workspaceSecondary: { width: '40%' },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    columnGap: 14,
  },
  halfWidthCard: { width: '49%' },
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
  brainDumpEditInput: {
    minHeight: 100,
    marginTop: 10,
    textAlignVertical: 'top',
  },
  pickerLabel: {
    fontSize: 13,
    color: '#6b7280',
    fontWeight: '700',
  },
  horizontalRow: { gap: 8, paddingRight: 4 },
  horizontalRowDesktop: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
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
  seriesEditPanel: {
    marginTop: 10,
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
  },
  seriesEditHelp: {
    fontSize: 12,
    lineHeight: 18,
    color: '#1e3a8a',
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
  templateSaveButton: {
    borderWidth: 1,
    borderColor: '#7c3aed',
    padding: 13,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#f5f3ff',
  },
  templateSaveButtonText: {
    color: '#6d28d9',
    fontWeight: '800',
    fontSize: 15,
  },
  templateHelpText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#6b7280',
  },
  templateMessage: {
    marginBottom: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#ede9fe',
    color: '#5b21b6',
    fontWeight: '700',
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
  templateManagerHeader: {
    borderColor: '#ddd6fe',
    backgroundColor: '#f5f3ff',
  },
  transparent: { backgroundColor: 'transparent' },
  chevron: {
    fontSize: 18,
    fontWeight: '900',
    color: '#0f766e',
  },
  templateChevron: {
    color: '#6d28d9',
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
  brainDumpEditingCard: {
    flexDirection: 'column',
  },
  editActionRow: {
    flexDirection: 'row',
    gap: 10,
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
  templateUseButton: { backgroundColor: '#7c3aed' },
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
