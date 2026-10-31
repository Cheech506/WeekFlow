import { Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { fetchApiTasks, type ApiTask } from '@/lib/api/taskApi';

const PREVIEW_LIMIT = 20;

/** Read-only connection check. Migration writes no longer belong in this page. */
export default function ServerTasksScreen() {
  const [serverTasks, setServerTasks] = useState<ApiTask[] | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current?.abort();
    };
  }, []);

  async function checkConnection() {
    if (requestRef.current || !mountedRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsChecking(true);
    setError(null);
    try {
      // A successful Task API read verifies the API can read stored task data.
      // Use the same API address and decoder as the rest of the connected app.
      const records = await fetchApiTasks({}, { signal: controller.signal });
      if (mountedRef.current) {
        setServerTasks(records);
        setCheckedAt(new Date().toLocaleString());
      }
    } catch (cause) {
      if (mountedRef.current) {
        setError(cause instanceof Error ? cause.message : 'WeekFlow could not reach the server.');
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mountedRef.current) setIsChecking(false);
    }
  }

  const completedCount = serverTasks?.filter(task => task.completed).length ?? 0;

  return (
    <>
      <Stack.Screen options={{ title: 'Server connection' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Server connection</Text>
        <Text style={styles.description}>
          Check that WeekFlow can read your saved tasks from the server.
          This check does not import or change your data.
        </Text>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check WeekFlow server connection"
          accessibilityState={{ disabled: isChecking }}
          disabled={isChecking}
          onPress={() => { void checkConnection(); }}
          style={[styles.button, isChecking && styles.disabled]}
        >
          <Text style={styles.buttonText}>{isChecking ? 'Checking…' : 'Check server connection'}</Text>
        </Pressable>

        {error ? (
          <View style={styles.section} accessibilityLiveRegion="polite">
            <Text style={styles.error}>{error}</Text>
            {serverTasks !== null ? (
              <Text style={styles.description}>The results below are from the last successful check.</Text>
            ) : null}
          </View>
        ) : null}

        {serverTasks !== null ? (
          <View style={styles.section}>
            {!error && !isChecking ? <Text style={styles.success}>Server connection successful.</Text> : null}
            <Text style={styles.subtitle}>Last successful check</Text>
            <Text style={styles.description}>{checkedAt}</Text>
            <Text style={styles.summary}>
              {serverTasks.length} tasks • {completedCount} completed
            </Text>
            {serverTasks.length === 0 ? (
              <Text>The server returned no tasks.</Text>
            ) : (
              <>
                <Text style={styles.description}>
                  Showing {Math.min(PREVIEW_LIMIT, serverTasks.length)} of {serverTasks.length} saved tasks.
                </Text>
                {serverTasks.slice(0, PREVIEW_LIMIT).map(task => (
                  <View key={task.id} style={styles.taskCard}>
                    <Text style={styles.taskTitle}>{task.title}</Text>
                    <Text>{task.completed ? 'Completed' : 'Not completed'}</Text>
                    <Text>{task.dueDate ?? 'Inbox'}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 24, gap: 20 },
  title: { fontSize: 24, fontWeight: '800' },
  subtitle: { fontSize: 18, fontWeight: '700' },
  description: { fontSize: 15, lineHeight: 22, opacity: 0.75 },
  section: { gap: 12 },
  summary: { fontSize: 18, fontWeight: '700' },
  button: { alignItems: 'center', backgroundColor: '#2563eb', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 13 },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#b91c1c', fontWeight: '600' },
  success: { color: '#047857', fontWeight: '700' },
  taskCard: { borderColor: '#d1d5db', borderRadius: 10, borderWidth: 1, gap: 5, padding: 12 },
  taskTitle: { fontWeight: '700' },
});
