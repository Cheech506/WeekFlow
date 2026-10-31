import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';
import { useBrainDumps } from '@/context/BrainDumpContext';
import { useCycle } from '@/context/CycleContext';
import { useCycleReviews } from '@/context/CycleReviewContext';
import { useGoals } from '@/context/GoalContext';
import { useTasks } from '@/context/TaskContext';
import { useWeeklyReviews } from '@/context/WeeklyReviewContext';

/**
 * Place inside all six data providers, around the app's navigation stack.
 * Initial API failures must not look like a successful empty database.
 * After a successful load, retain the screens and expose later request errors.
 */
export function ApiDataBoundary({ children }: { children: ReactNode }) {
  const taskData = useTasks();
  const goalData = useGoals();
  const cycleData = useCycle();
  const noteData = useBrainDumps();
  const weeklyData = useWeeklyReviews();
  const reportData = useCycleReviews();
  const dark = useColorScheme() === 'dark';
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const refreshInProgressRef = useRef(false);
  const mountedRef = useRef(false);

  const providers = [taskData, goalData, cycleData, noteData, weeklyData, reportData];
  const isLoading = providers.some(provider => provider.isLoading);
  const isSaving = providers.some(provider => provider.isSaving);
  const failure = providers.find(provider => provider.error !== null)?.error ?? null;
  const busy = isLoading || isSaving || isRefreshing;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!isLoading && !failure) setHasLoaded(true);
  }, [failure, isLoading]);

  async function refreshData() {
    if (refreshInProgressRef.current || busy || !mountedRef.current) return;
    refreshInProgressRef.current = true;
    setIsRefreshing(true);
    try {
      // These refresh functions reload state; they do not resend a failed edit,
      // conversion, import, or finalization. Task refresh also runs the existing
      // safe missing-occurrence generator for active schedules.
      const refreshes = [
        taskData.refreshTasks, goalData.refreshGoals, cycleData.refreshCycles,
        noteData.refreshBrainDumps, weeklyData.refreshWeeklyReviews, reportData.refreshCycleReviews,
      ];
      await Promise.allSettled(refreshes.map(refresh => Promise.resolve().then(refresh)));
      // Each provider retains its own error if its refresh fails. Wait for all
      // providers so another click cannot overlap unfinished refresh requests.
    } finally {
      refreshInProgressRef.current = false;
      if (mountedRef.current) setIsRefreshing(false);
    }
  }

  const backgroundColor = dark ? '#111827' : '#ffffff';
  const color = dark ? '#f9fafb' : '#111827';
  const mutedColor = dark ? '#d1d5db' : '#4b5563';
  const noticeColor = dark ? '#292318' : '#fff7ed';
  const button = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh WeekFlow data"
      accessibilityState={{ disabled: busy }}
      disabled={busy}
      onPress={() => { void refreshData(); }}
      style={[styles.button, busy && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{isRefreshing ? 'Refreshing…' : 'Refresh data'}</Text>
    </Pressable>
  );

  if (!hasLoaded) {
    return (
      <View style={[styles.initial, { backgroundColor }]}>
        {failure ? (
          <View style={styles.initialContent} accessibilityLiveRegion="polite">
            <Text style={[styles.title, { color }]}>WeekFlow could not load your data</Text>
            <Text style={[styles.message, { color: mutedColor }]}>
              Check your connection to the WeekFlow server, then refresh.
            </Text>
            <Text style={[styles.message, { color: mutedColor }]}>{failure.message}</Text>
            {button}
          </View>
        ) : (
          <View style={styles.initialContent} accessibilityLiveRegion="polite">
            <ActivityIndicator size="large" color={dark ? '#93c5fd' : '#2563eb'} />
            <Text style={[styles.title, { color }]}>Loading WeekFlow…</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor }]}>
      {failure ? (
        <View style={[styles.notice, { backgroundColor: noticeColor }]} accessibilityLiveRegion="polite">
          <Text style={[styles.noticeTitle, { color }]}>A request needs attention</Text>
          <Text style={[styles.message, { color }]}>{failure.message}</Text>
          <Text style={[styles.message, { color: mutedColor }]}>
            Refresh to check the saved data before submitting that action again.
          </Text>
          {button}
        </View>
      ) : busy ? (
        <View style={styles.progress} accessibilityLiveRegion="polite">
          <ActivityIndicator size="small" color={dark ? '#93c5fd' : '#2563eb'} />
          <Text style={{ color: mutedColor }}>{isSaving ? 'Saving changes…' : 'Refreshing WeekFlow…'}</Text>
        </View>
      ) : null}
      <View style={styles.container}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  initial: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  initialContent: { width: '100%', maxWidth: 520, alignItems: 'center', gap: 16 },
  title: { fontSize: 21, fontWeight: '700', textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 21 },
  notice: { paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  noticeTitle: { fontSize: 16, fontWeight: '700' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
  button: { alignSelf: 'center', backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 11 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
});
