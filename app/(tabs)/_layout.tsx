import { TaskProvider } from '@/context/TaskContext';
import { Link, Tabs } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import React from 'react';
import { Pressable } from 'react-native';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <TaskProvider>
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
    </Tabs>
    </TaskProvider>
  );
}