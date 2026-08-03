import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { router, Stack, type Href } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, Text } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { BrainDumpProvider } from '@/context/BrainDumpContext';
import { CycleProvider } from '@/context/CycleContext';
import { GoalProvider } from '@/context/GoalContext';
import { TaskProvider } from '@/context/TaskContext';
import { WeeklyReviewProvider } from '@/context/WeeklyReviewContext';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure direct visits to secondary screens always have the tab route available.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/*
       * Providers live above the Stack so both the main tabs and secondary
       * screens such as Settings share one in-memory view of the SQLite data.
       */}
      <TaskProvider>
        <CycleProvider>
          <GoalProvider>
            <BrainDumpProvider>
              <WeeklyReviewProvider>
                <Stack>
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen
                    name="settings"
                    options={({ navigation }) => ({
                      title: 'Settings',
                      headerBackVisible: false,
                      headerLeft: ({ tintColor }) => (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Return to WeekFlow"
                          hitSlop={10}
                          onPress={() => {
                            /*
                             * Fast refresh or opening /settings directly can leave
                             * the stack without a previous screen. Fall back to the
                             * Goals tab instead of dispatching an invalid GO_BACK.
                             */
                            if (navigation.canGoBack()) {
                              navigation.goBack();
                            } else {
                              router.replace('/' as Href);
                            }
                          }}
                          style={({ pressed }) => ({
                            paddingHorizontal: 4,
                            opacity: pressed ? 0.5 : 1,
                          })}
                        >
                          <Text
                            style={{
                              color: tintColor,
                              fontSize: 16,
                              fontWeight: '600',
                            }}
                          >
                            ‹ Back
                          </Text>
                        </Pressable>
                      ),
                    })}
                  />
                  <Stack.Screen
                    name="modal"
                    options={{ presentation: 'modal' }}
                  />
                </Stack>
              </WeeklyReviewProvider>
            </BrainDumpProvider>
          </GoalProvider>
        </CycleProvider>
      </TaskProvider>
    </ThemeProvider>
  );
}
