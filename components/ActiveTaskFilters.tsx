import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
} from 'react-native';

import { Text, View } from '@/components/Themed';
import type { Goal } from '@/context/GoalContext';
import {
  countActiveTaskFilters,
  createDefaultActiveTaskFilters,
  type ActiveTaskFilterState,
  type ActiveTaskPriorityFilter,
  type ActiveTaskRecurrenceFilter,
  type ActiveTaskScheduleFilter,
} from '@/lib/activeTaskFilters';

type ActiveTaskFiltersProps = {
  goals: Goal[];
  filters: ActiveTaskFilterState;
  onChange: (filters: ActiveTaskFilterState) => void;
  totalCount: number;
  resultCount: number;
  scheduleChoices?: ActiveTaskScheduleFilter[];
  showDueDate?: boolean;
  defaultExpanded?: boolean;
};

const priorityChoices: {
  value: ActiveTaskPriorityFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 0, label: 'Low' },
  { value: 1, label: 'Medium' },
  { value: 2, label: 'High' },
];

const recurrenceChoices: {
  value: ActiveTaskRecurrenceFilter;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'standalone', label: 'Standalone' },
];

const scheduleLabels: Record<ActiveTaskScheduleFilter, string> = {
  all: 'All',
  overdue: 'Overdue',
  today: 'Today',
  upcoming: 'Upcoming',
  unscheduled: 'Unscheduled',
};

export function ActiveTaskFilters({
  goals,
  filters,
  onChange,
  totalCount,
  resultCount,
  scheduleChoices = ['all', 'overdue', 'today', 'upcoming', 'unscheduled'],
  showDueDate = true,
  defaultExpanded = false,
}: ActiveTaskFiltersProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const activeFilterCount = countActiveTaskFilters(filters);

  function updateFilters(changes: Partial<ActiveTaskFilterState>) {
    onChange({ ...filters, ...changes });
  }

  function resetFilters() {
    onChange(createDefaultActiveTaskFilters());
  }

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.header}
        onPress={() => setIsExpanded((current) => !current)}
        accessibilityRole="button"
        accessibilityState={{ expanded: isExpanded }}
        accessibilityLabel={`${isExpanded ? 'Collapse' : 'Expand'} active task search and filters.`}
      >
        <View style={styles.headerTextWrap}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Search & Filters</Text>
            {activeFilterCount > 0 ? (
              <Text style={styles.activeBadge}>
                {activeFilterCount} active
              </Text>
            ) : null}
          </View>

          <Text style={styles.summary}>
            Showing {resultCount} of {totalCount} active task
            {totalCount === 1 ? '' : 's'}
          </Text>
        </View>

        <Text style={styles.chevron}>{isExpanded ? '▼' : '▶'}</Text>
      </Pressable>

      {isExpanded ? (
        <View style={styles.body}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search task titles or notes..."
            value={filters.searchText}
            onChangeText={(searchText) => updateFilters({ searchText })}
            returnKeyType="search"
          />

          {showDueDate ? (
            <TextInput
              style={styles.searchInput}
              placeholder="Exact due date: YYYY-MM-DD"
              value={filters.dueDate}
              onChangeText={(dueDate) => updateFilters({ dueDate })}
              autoCapitalize="none"
              autoCorrect={false}
            />
          ) : null}

          <FilterGroup label="Priority">
            {priorityChoices.map((choice) => (
              <FilterPill
                key={String(choice.value)}
                label={choice.label}
                selected={filters.priority === choice.value}
                onPress={() => updateFilters({ priority: choice.value })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Schedule">
            {scheduleChoices.map((choice) => (
              <FilterPill
                key={choice}
                label={scheduleLabels[choice]}
                selected={filters.schedule === choice}
                onPress={() => updateFilters({ schedule: choice })}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Task Type">
            {recurrenceChoices.map((choice) => (
              <FilterPill
                key={choice.value}
                label={choice.label}
                selected={filters.recurrence === choice.value}
                onPress={() => updateFilters({ recurrence: choice.value })}
              />
            ))}
          </FilterGroup>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Linked Goal</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.horizontalPills}
            >
              <FilterPill
                label="All"
                selected={filters.goal === 'all'}
                onPress={() => updateFilters({ goal: 'all' })}
              />
              <FilterPill
                label="Goal Linked"
                selected={filters.goal === 'linked'}
                onPress={() => updateFilters({ goal: 'linked' })}
              />
              <FilterPill
                label="No Goal"
                selected={filters.goal === 'unlinked'}
                onPress={() => updateFilters({ goal: 'unlinked' })}
              />
              {goals.map((goal) => {
                const value = `goal:${goal.id}` as const;

                return (
                  <FilterPill
                    key={goal.id}
                    label={goal.title}
                    selected={filters.goal === value}
                    onPress={() => updateFilters({ goal: value })}
                  />
                );
              })}
            </ScrollView>
          </View>

          {activeFilterCount > 0 ? (
            <Pressable style={styles.resetButton} onPress={resetFilters}>
              <Text style={styles.resetButtonText}>Clear All Filters</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupLabel}>{label}</Text>
      <View style={styles.pillRow}>{children}</View>
    </View>
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
    width: '100%',
    marginBottom: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    backgroundColor: '#eff6ff',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 16,
    backgroundColor: 'transparent',
  },
  headerTextWrap: { flex: 1, backgroundColor: 'transparent' },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  title: { fontSize: 19, fontWeight: '900', color: '#111827' },
  activeBadge: {
    fontSize: 11,
    fontWeight: '900',
    color: '#1d4ed8',
    backgroundColor: '#dbeafe',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  summary: { marginTop: 4, fontSize: 13, color: '#4b5563' },
  chevron: { fontSize: 18, fontWeight: '900', color: '#2563eb' },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 14,
    backgroundColor: 'transparent',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: '#cbd5e1',
    borderRadius: 12,
    paddingHorizontal: 13,
    paddingVertical: 11,
    fontSize: 15,
    color: '#111827',
    backgroundColor: 'white',
  },
  group: { gap: 8, backgroundColor: 'transparent' },
  groupLabel: { fontSize: 13, fontWeight: '800', color: '#374151' },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    backgroundColor: 'transparent',
  },
  horizontalPills: { gap: 8, paddingRight: 6 },
  pill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: 'white',
  },
  pillSelected: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  pillText: { fontSize: 13, fontWeight: '700', color: '#374151' },
  pillTextSelected: { color: 'white' },
  resetButton: {
    alignSelf: 'flex-start',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: '#e11d48',
  },
  resetButtonText: { color: 'white', fontWeight: '800' },
});
