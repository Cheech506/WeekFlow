import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View as NativeView,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import {
  addDays,
  addMonths,
  formatDateKey,
  getCalendarMonthDays,
  getLocalDateKey,
  parseLocalDateKey,
} from '@/lib/dateUtils';

const weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

type TaskDatePickerProps = {
  visible: boolean;
  taskTitle?: string;
  initialDateKey?: string | null;
  minimumDateKey?: string | null;
  onCancel: () => void;
  onSelectDate: (dateKey: string) => Promise<void> | void;
};

function resolveInitialDateKey(
  initialDateKey: string | null | undefined,
  minimumDateKey: string | null | undefined
) {
  const todayKey = getLocalDateKey(new Date());
  const parsedInitial = initialDateKey
    ? parseLocalDateKey(initialDateKey)
    : null;
  const parsedMinimum = minimumDateKey
    ? parseLocalDateKey(minimumDateKey)
    : null;

  let resolvedDateKey = parsedInitial
    ? getLocalDateKey(parsedInitial)
    : todayKey;

  if (
    parsedMinimum &&
    resolvedDateKey < getLocalDateKey(parsedMinimum)
  ) {
    resolvedDateKey = getLocalDateKey(parsedMinimum);
  }

  return resolvedDateKey;
}

/**
 * A dependency-free calendar picker used anywhere an active task can be
 * scheduled. Keeping this in one component prevents Inbox, Daily, and Weekly
 * from developing slightly different date-selection rules over time.
 */
export function TaskDatePicker({
  visible,
  taskTitle,
  initialDateKey,
  minimumDateKey,
  onCancel,
  onSelectDate,
}: TaskDatePickerProps) {
  const { width } = useWindowDimensions();
  const [selectedDateKey, setSelectedDateKey] = useState(
    resolveInitialDateKey(initialDateKey, minimumDateKey)
  );
  const [displayMonth, setDisplayMonth] = useState(() => {
    const initialDate = parseLocalDateKey(
      resolveInitialDateKey(initialDateKey, minimumDateKey)
    );

    return initialDate ?? new Date();
  });
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!visible) return;

    const nextDateKey = resolveInitialDateKey(
      initialDateKey,
      minimumDateKey
    );
    const nextDate = parseLocalDateKey(nextDateKey) ?? new Date();

    setSelectedDateKey(nextDateKey);
    setDisplayMonth(nextDate);
    setIsSaving(false);
    setErrorMessage('');
  }, [visible, initialDateKey, minimumDateKey]);

  const calendarDays = useMemo(
    () => getCalendarMonthDays(displayMonth),
    [displayMonth]
  );

  const monthLabel = displayMonth.toLocaleDateString([], {
    month: 'long',
    year: 'numeric',
  });
  const normalizedMinimumDateKey = minimumDateKey &&
    parseLocalDateKey(minimumDateKey)
    ? minimumDateKey
    : null;
  const minimumDate = normalizedMinimumDateKey
    ? parseLocalDateKey(normalizedMinimumDateKey)
    : null;
  const previousMonth = addMonths(displayMonth, -1);
  const minimumMonth = minimumDate
    ? addMonths(minimumDate, 0)
    : null;
  const isPreviousMonthDisabled = Boolean(
    minimumMonth &&
      getLocalDateKey(previousMonth) <
        getLocalDateKey(minimumMonth)
  );
  const todayKey = getLocalDateKey(new Date());
  const tomorrowKey = getLocalDateKey(addDays(new Date(), 1));
  const pickerWidth = Math.min(Math.max(width - 32, 300), 520);

  function selectDate(dateKey: string) {
    if (
      normalizedMinimumDateKey &&
      dateKey < normalizedMinimumDateKey
    ) {
      return;
    }

    const selectedDate = parseLocalDateKey(dateKey);

    if (!selectedDate) return;

    setSelectedDateKey(dateKey);
    setDisplayMonth(selectedDate);
    setErrorMessage('');
  }

  async function confirmDate() {
    if (isSaving) return;

    try {
      setIsSaving(true);
      setErrorMessage('');
      await onSelectDate(selectedDateKey);
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'The task could not be scheduled.'
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <NativeView style={styles.overlay}>
        <View style={[styles.dialog, { width: pickerWidth }]}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.dialogContent}
          >
            <Text style={styles.title}>Choose a Date</Text>
          <Text style={styles.subtitle} numberOfLines={2}>
            {taskTitle
              ? `Schedule “${taskTitle}” for today or any future date.`
              : 'Schedule this task for today or any future date.'}
          </Text>

          <View style={styles.quickActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select today"
              style={[
                styles.quickButton,
                selectedDateKey === todayKey && styles.quickButtonSelected,
              ]}
              onPress={() => selectDate(todayKey)}
            >
              <Text
                style={[
                  styles.quickButtonText,
                  selectedDateKey === todayKey && styles.selectedText,
                ]}
              >
                Today
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Select tomorrow"
              style={[
                styles.quickButton,
                selectedDateKey === tomorrowKey && styles.quickButtonSelected,
              ]}
              onPress={() => selectDate(tomorrowKey)}
            >
              <Text
                style={[
                  styles.quickButtonText,
                  selectedDateKey === tomorrowKey && styles.selectedText,
                ]}
              >
                Tomorrow
              </Text>
            </Pressable>
          </View>

          <View style={styles.monthHeader}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              accessibilityState={{
                disabled: isPreviousMonthDisabled,
              }}
              disabled={isPreviousMonthDisabled}
              style={[
                styles.monthButton,
                isPreviousMonthDisabled && styles.buttonDisabled,
              ]}
              onPress={() =>
                setDisplayMonth((current) => addMonths(current, -1))
              }
            >
              <Text style={styles.monthButtonText}>‹</Text>
            </Pressable>

            <Text style={styles.monthLabel}>{monthLabel}</Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              style={styles.monthButton}
              onPress={() =>
                setDisplayMonth((current) => addMonths(current, 1))
              }
            >
              <Text style={styles.monthButtonText}>›</Text>
            </Pressable>
          </View>

          <View style={styles.weekdayRow}>
            {weekdayLabels.map((label) => (
              <Text key={label} style={styles.weekdayLabel}>
                {label}
              </Text>
            ))}
          </View>

          <View style={styles.calendarGrid}>
            {calendarDays.map((calendarDay) => {
              const isSelected =
                calendarDay.dateKey === selectedDateKey;
              const isDisabled = Boolean(
                normalizedMinimumDateKey &&
                  calendarDay.dateKey < normalizedMinimumDateKey
              );

              return (
                <Pressable
                  key={calendarDay.dateKey}
                  accessibilityRole="button"
                  accessibilityLabel={formatDateKey(
                    calendarDay.dateKey,
                    {
                      weekday: 'long',
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    }
                  )}
                  accessibilityState={{
                    selected: isSelected,
                    disabled: isDisabled,
                  }}
                  disabled={isDisabled}
                  style={[
                    styles.dayCell,
                    calendarDay.isToday && styles.todayCell,
                    isSelected && styles.selectedDayCell,
                    isDisabled && styles.disabledDayCell,
                  ]}
                  onPress={() => selectDate(calendarDay.dateKey)}
                >
                  <Text
                    style={[
                      styles.dayText,
                      !calendarDay.isCurrentMonth &&
                        styles.outsideMonthText,
                      calendarDay.isToday && styles.todayText,
                      isSelected && styles.selectedText,
                      isDisabled && styles.disabledDayText,
                    ]}
                  >
                    {calendarDay.dayNumber}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.selectionSummary}>
            <Text style={styles.selectionLabel}>Selected date</Text>
            <Text style={styles.selectionValue}>
              {formatDateKey(selectedDateKey, {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>

          {errorMessage ? (
            <Text style={styles.errorText}>{errorMessage}</Text>
          ) : null}

          <View style={styles.footerActions}>
            <Pressable
              accessibilityRole="button"
              style={[styles.footerButton, styles.cancelButton]}
              onPress={onCancel}
              disabled={isSaving}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              style={[
                styles.footerButton,
                styles.confirmButton,
                isSaving && styles.buttonDisabled,
              ]}
              onPress={confirmDate}
              disabled={isSaving}
            >
              <Text style={styles.confirmButtonText}>
                {isSaving ? 'Scheduling…' : 'Schedule Task'}
              </Text>
            </Pressable>
          </View>
          </ScrollView>
        </View>
      </NativeView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.62)',
  },
  dialog: {
    maxWidth: 520,
    maxHeight: '94%',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    overflow: 'hidden',
  },
  dialogContent: {
    padding: 18,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    marginTop: 5,
    fontSize: 14,
    lineHeight: 20,
    color: '#64748b',
  },
  quickActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  quickButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
  },
  quickButtonSelected: {
    backgroundColor: '#2563eb',
    borderColor: '#2563eb',
  },
  quickButtonText: {
    fontWeight: '800',
    color: '#334155',
  },
  monthHeader: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'transparent',
  },
  monthButton: {
    width: 42,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthButtonText: {
    fontSize: 28,
    lineHeight: 30,
    fontWeight: '700',
    color: '#334155',
  },
  monthLabel: {
    fontSize: 17,
    fontWeight: '800',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginTop: 14,
    backgroundColor: 'transparent',
  },
  weekdayLabel: {
    width: '14.285714%',
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    color: '#64748b',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    backgroundColor: 'transparent',
  },
  dayCell: {
    width: '14.285714%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  todayCell: {
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  selectedDayCell: {
    backgroundColor: '#2563eb',
  },
  disabledDayCell: {
    opacity: 0.35,
  },
  dayText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#334155',
  },
  outsideMonthText: {
    color: '#94a3b8',
  },
  todayText: {
    color: '#1d4ed8',
  },
  selectedText: {
    color: 'white',
  },
  disabledDayText: {
    color: '#94a3b8',
  },
  selectionSummary: {
    marginTop: 14,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#eff6ff',
  },
  selectionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1e40af',
  },
  selectionValue: {
    marginTop: 3,
    fontSize: 15,
    fontWeight: '800',
    color: '#1e3a8a',
  },
  errorText: {
    marginTop: 10,
    color: '#b91c1c',
    fontWeight: '700',
  },
  footerActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    backgroundColor: 'transparent',
  },
  footerButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  cancelButton: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#f8fafc',
  },
  cancelButtonText: {
    fontWeight: '800',
    color: '#334155',
  },
  confirmButton: {
    backgroundColor: '#2563eb',
  },
  confirmButtonText: {
    fontWeight: '800',
    color: 'white',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
});
