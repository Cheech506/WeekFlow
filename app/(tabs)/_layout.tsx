import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Tabs, type Href } from 'expo-router';
import React from 'react';
import { Pressable } from 'react-native';

import { useClientOnlyValue } from '@/components/useClientOnlyValue';
import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors[colorScheme].tint,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },

        // The in-page heading names the current workflow. Keeping the native
        // navigation title branded as WeekFlow avoids repeating "Weekly",
        // "Inbox", etc. twice on small screens.
        headerTitle: 'WeekFlow',
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,

        // Keeps the header stable on web.
        headerShown: useClientOnlyValue(false, true),

        // Settings stays outside the permanent bottom navigation so the main
        // WeekFlow workflow remains focused on the five core tabs.
        headerRight: () => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open WeekFlow settings"
            hitSlop={10}
            style={{ marginRight: 15 }}
            onPress={() => router.push('/settings' as Href)}
          >
            {({ pressed }) => (
              <Ionicons
                name="settings-outline"
                size={25}
                color={Colors[colorScheme].text}
                style={{ opacity: pressed ? 0.5 : 1 }}
              />
            )}
          </Pressable>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Goals',
          tabBarIcon: ({ color }) => (
            <Ionicons name="flag-outline" color={color} size={28} />
          ),
        }}
      />

      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Inbox',
          tabBarIcon: ({ color }) => (
            <Ionicons name="file-tray-outline" color={color} size={28} />
          ),
        }}
      />

      <Tabs.Screen
        name="daily"
        options={{
          title: 'Daily',
          tabBarIcon: ({ color }) => (
            <Ionicons name="checkmark-circle-outline" color={color} size={28} />
          ),
        }}
      />

      <Tabs.Screen
        name="weekly"
        options={{
          title: 'Weekly',
          tabBarIcon: ({ color }) => (
            <Ionicons name="calendar-outline" color={color} size={28} />
          ),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color }) => (
            <Ionicons name="time-outline" color={color} size={28} />
          ),
        }}
      />
    </Tabs>
  );
}
