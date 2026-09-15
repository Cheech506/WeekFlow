import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView } from 'react-native';

import { Text, View } from '@/components/Themed';
import { fetchServerTasks, type ServerTask } from '@/lib/taskApi';

export default function ServerTasksScreen() {
  const [tasks, setTasks] = useState<ServerTask[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadTasks() {
    const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

    if (!baseUrl) {
      setError('The API address is missing from .env.local.');
      return;
    }

    setLoading(true);
    setError(null);
    setTasks(null);

    try {
      setTasks(await fetchServerTasks(baseUrl));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not load tasks.'
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Server tasks' }} />

      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: '700' }}>
          Server tasks
        </Text>

        <Text>This screen only reads tasks from the API.</Text>

        <Pressable
          accessibilityRole="button"
          disabled={loading}
          onPress={() => {
            void loadTasks();
          }}
          style={{
            backgroundColor: '#2563eb',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <Text style={{ color: '#fff', fontWeight: '700' }}>
            {loading ? 'Loading...' : 'Read server tasks'}
          </Text>
        </Pressable>

        {error ? <Text>{error}</Text> : null}
        {tasks?.length === 0 ? <Text>No server tasks found.</Text> : null}

        {tasks?.map((task) => (
          <View key={task.id} style={{ padding: 12 }}>
            <Text style={{ fontWeight: '700' }}>{task.title}</Text>
            <Text>{task.completed ? 'Completed' : 'Not completed'}</Text>
            <Text>{task.due_date ?? 'No due date'}</Text>
          </View>
        ))}
      </ScrollView>
    </>
  );
}