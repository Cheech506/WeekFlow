import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import type { Goal } from '@/context/GoalContext';
import { getPlanningCycleDisplayName } from '@/lib/cycleIdentityUtils';
import type { PlanningCycle } from '@/lib/cycleStorage';
import {
  countHistoryFilters,
  createDefaultHistoryFilters,
  type HistoryContentFilter,
  type HistoryDatePreset,
  type HistoryFilterState,
  type HistoryPriorityFilter,
  type HistoryRecurrenceFilter,
} from '@/lib/historyFilters';

type HistoryFiltersProps = {
  filters: HistoryFilterState;
  goals: Goal[];
  cycles: PlanningCycle[];
  resultSummary: string;
  dateRangeError: string | null;
  onChange: (filters: HistoryFilterState) => void;
};

const contentChoices: { value: HistoryContentFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'goals', label: 'Goals' },
  { value: 'cycles', label: 'Cycle Reports' },
  { value: 'brainDumps', label: 'Brain Dumps' },
];

const dateChoices: { value: HistoryDatePreset; label: string }[] = [
  { value: 'all', label: 'All Time' },
  { value: '7days', label: 'Last 7 Days' },
  { value: '30days', label: 'Last 30 Days' },
  { value: '90days', label: 'Last 90 Days' },
  { value: 'custom', label: 'Custom' },
];

const priorityChoices: { value: HistoryPriorityFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 0, label: 'Low' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'High' },
];

const recurrenceChoices: {
  value: HistoryRecurrenceFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'standalone', label: 'Standalone' },
];

export default function HistoryFilters({
  filters,
  goals,
  cycles,
  resultSummary,
  dateRangeError,
  onChange,
}: HistoryFiltersProps) {
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const activeCount = countHistoryFilters(filters);

  function update(changes: Partial<HistoryFilterState>) {
    onChange({ ...filters, ...changes });
  }

  function selectContent(content: HistoryContentFilter) {
    const next = { ...filters, content };

    if (content === 'goals' || content === 'cycles' || content === 'brainDumps') {
      next.priority = 'all';
      next.goal = 'all';
      next.recurrence = 'all';
    }

    if (content === 'brainDumps') {
      next.cycle = 'all';
    }

    onChange(next);
  }

  function selectTaskOnlyFilter(changes: Partial<HistoryFilterState>) {
    onChange({ ...filters, ...changes, content: 'tasks' });
  }

  return (
    <View style={styles.card}>
      <View style={styles.titleRow}>
        <View style={styles.titleTextWrap}>
          <Text style={styles.title}>Search & Filters</Text>
          <Text style={styles.summary}>{resultSummary}</Text>
        </View>

        {activeCount > 0 ? (
          <Text style={styles.activeBadge}>{activeCount} active</Text>
        ) : null}
      </View>

      <TextInput
        style={styles.searchInput}
        placeholder="Search tasks, goals, reports, reflections, or notes..."
        value={filters.searchText}
        onChangeText={(searchText) => update({ searchText })}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />

      <FilterLabel>Show</FilterLabel>
      <HorizontalPills>
        {contentChoices.map((choice) => (
          <FilterPill
            key={choice.value}
            label={choice.label}
            selected={filters.content === choice.value}
            onPress={() => selectContent(choice.value)}
          />
        ))}
      </HorizontalPills>

      <FilterLabel>Completed</FilterLabel>
      <HorizontalPills>
        {dateChoices.map((choice) => (
          <FilterPill
            key={choice.value}
            label={choice.label}
            selected={filters.datePreset === choice.value}
            onPress={() => update({ datePreset: choice.value })}
          />
        ))}
      </HorizontalPills>

      {filters.datePreset === 'custom' ? (
        <View style={styles.customDateRow}>
          <TextInput
            style={[styles.searchInput, styles.customDateInput]}
            placeholder="Start: YYYY-MM-DD"
            value={filters.customStartDate}
            onChangeText={(customStartDate) => update({ customStartDate })}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.searchInput, styles.customDateInput]}
            placeholder="End: YYYY-MM-DD"
            value={filters.customEndDate}
            onChangeText={(customEndDate) => update({ customEndDate })}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
      ) : null}

      {dateRangeError ? (
        <Text style={styles.errorText}>{dateRangeError}</Text>
      ) : null}

      <Pressable
        style={styles.advancedHeader}
        onPress={() => setAdvancedExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: advancedExpanded }}
      >
        <Text style={styles.advancedTitle}>Advanced Filters</Text>
        <Text style={styles.chevron}>{advancedExpanded ? '▼' : '▶'}</Text>
      </Pressable>

      {advancedExpanded ? (
        <View style={styles.advancedBody}>
          <FilterLabel>Task Priority</FilterLabel>
          <HorizontalPills>
            {priorityChoices.map((choice) => (
              <FilterPill
                key={String(choice.value)}
                label={choice.label}
                selected={filters.priority === choice.value}
                onPress={() =>
                  choice.value === 'all'
                    ? update({ priority: 'all' })
                    : selectTaskOnlyFilter({ priority: choice.value })
                }
              />
            ))}
          </HorizontalPills>

          <FilterLabel>Task Type</FilterLabel>
          <HorizontalPills>
            {recurrenceChoices.map((choice) => (
              <FilterPill
                key={choice.value}
                label={choice.label}
                selected={filters.recurrence === choice.value}
                onPress={() =>
                  choice.value === 'all'
                    ? update({ recurrence: 'all' })
                    : selectTaskOnlyFilter({ recurrence: choice.value })
                }
              />
            ))}
          </HorizontalPills>

          <FilterLabel>Linked Goal</FilterLabel>
          <HorizontalPills>
            <FilterPill
              label="All Goals"
              selected={filters.goal === 'all'}
              onPress={() => update({ goal: 'all' })}
            />
            <FilterPill
              label="No Goal"
              selected={filters.goal === 'none'}
              onPress={() => selectTaskOnlyFilter({ goal: 'none' })}
            />
            {goals.map((goal) => (
              <FilterPill
                key={goal.id}
                label={goal.title}
                selected={filters.goal === goal.id}
                onPress={() => selectTaskOnlyFilter({ goal: goal.id })}
              />
            ))}
          </HorizontalPills>

          <FilterLabel>Completed Cycle</FilterLabel>
          <HorizontalPills>
            <FilterPill
              label="All Cycles"
              selected={filters.cycle === 'all'}
              onPress={() => update({ cycle: 'all' })}
            />
            <FilterPill
              label="No Cycle"
              selected={filters.cycle === 'none'}
              onPress={() => update({ cycle: 'none' })}
            />
            {cycles.map((cycle, index) => {
              const fallbackNumber = Math.max(1, cycles.length - index);
              const label = getPlanningCycleDisplayName(
                cycle.name,
                fallbackNumber
              );

              return (
                <FilterPill
                  key={cycle.id}
                  label={label}
                  selected={filters.cycle === cycle.id}
                  onPress={() => update({ cycle: cycle.id })}
                />
              );
            })}
          </HorizontalPills>
        </View>
      ) : null}

      {activeCount > 0 ? (
        <Pressable
          style={styles.clearButton}
          onPress={() => onChange(createDefaultHistoryFilters())}
        >
          <Text style={styles.clearButtonText}>Clear All Filters</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FilterLabel({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

function HorizontalPills({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillRow}
    >
      {children}
    </ScrollView>
  );
}

function FilterPill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.pill, selected && styles.pillSelected]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={[styles.pillText, selected && styles.pillTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    marginBottom: 24,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    backgroundColor: 'transparent',
  },
  titleTextWrap: { flex: 1, backgroundColor: 'transparent' },
  title: { fontSize: 19, fontWeight: '900', color: '#111827' },
  summary: { marginTop: 3, fontSize: 12, color: '#64748b' },
  activeBadge: {
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#2563eb',
    color: '#ffffff',
    fontWeight: '900',
    fontSize: 11,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    fontSize: 15,
    backgroundColor: '#ffffff',
  },
  label: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: '900',
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  pillRow: { gap: 8, paddingRight: 8 },
  pill: {
    maxWidth: 220,
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  pillSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  pillText: { color: '#334155', fontSize: 13, fontWeight: '800' },
  pillTextSelected: { color: '#ffffff' },
  customDateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  customDateInput: { flexGrow: 1, flexBasis: 180 },
  errorText: { color: '#b91c1c', fontWeight: '700', fontSize: 12 },
  advancedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#ffffff',
  },
  advancedTitle: { color: '#334155', fontWeight: '900' },
  chevron: { color: '#2563eb', fontWeight: '900' },
  advancedBody: { gap: 10, backgroundColor: 'transparent' },
  clearButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: '#dc2626',
  },
  clearButtonText: { color: '#ffffff', fontWeight: '900' },
});
