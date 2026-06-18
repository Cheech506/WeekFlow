import { TaskProvider } from '@/context/TaskContext';
import { Link, Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Pressable } from 'react-native';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { BrainDumpProvider } from '@/context/BrainDumpContext';
import { GoalProvider } from '@/context/GoalContext';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <GoalProvider>
    <TaskProvider>
    <BrainDumpProvider>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,

        // Keeps header stable on web
        headerShown: useClientOnlyValue(false, true),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Goals',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'target',
                android: 'code',
                web: 'code',
              }}
              tintColor={color}
              size={28}
            />
          ),
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable style={{ marginRight: 15 }}>
                {({ pressed }) => (
                  <SymbolView
                    name={{ ios: 'info.circle', android: 'info', web: 'info' }}
                    size={25}
                    tintColor={Colors[colorScheme].text}
                    style={{ opacity: pressed ? 0.5 : 1 }}
                  />
                )}
              </Pressable>
            </Link>
          ),
        }}
      />

      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
              ios: 'tray',
              android: 'code',
              web: 'code',
              }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="daily"
        options={{
          title: 'Daily',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'checkmark.circle',
                android: 'code',
                web: 'code',
              }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="weekly"
        options={{
          title: 'Weekly',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'calendar',
                android: 'code',
                web: 'code',
              }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{
                ios: 'clock.arrow.circlepath',
                android: 'code',
                web: 'code',
              }}
              tintColor={color}
              size={28}
            />
          ),
        }}
      />
    </Tabs>
    </BrainDumpProvider>
    </TaskProvider>
    </GoalProvider>
  );
}