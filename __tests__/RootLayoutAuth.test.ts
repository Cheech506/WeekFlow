/** Root composition tests: authenticated content stays below the login gate. */
jest.mock('expo-font', () => ({ useFonts: jest.fn() }));
jest.mock('expo-splash-screen', () => ({ preventAutoHideAsync: jest.fn(async () => undefined), hideAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-reanimated', () => ({}));
jest.mock('../assets/fonts/SpaceMono-Regular.ttf', () => 123);
jest.mock('react-native', () => ({ Pressable: 'Button', Text: 'Text' }));
jest.mock('expo-router', () => {
  const React = require('react');
  const Stack = ({ children }: { children: unknown }) => React.createElement('Navigation', null, children);
  Stack.Screen = (props: unknown) => React.createElement('Route', props);
  return { Stack, router: { replace: jest.fn() }, ErrorBoundary: () => null };
});
jest.mock('expo-router/react-navigation', () => ({
  DarkTheme: { dark: true }, DefaultTheme: { dark: false },
  ThemeProvider: (props: Record<string, unknown>) => require('react').createElement('Theme', props),
}));
jest.mock('@/components/useColorScheme', () => ({ useColorScheme: jest.fn(() => 'light') }));
jest.mock('@/context/AuthContext', () => ({ useAuth: jest.fn(), AuthProvider: wrapper('AuthProvider') }));
jest.mock('@/components/AuthScreen', () => ({ AuthScreen: (props: unknown) => require('react').createElement('AccountScreen', props) }));
jest.mock('@/context/CelebrationContext', () => ({ CelebrationProvider: wrapper('CelebrationProvider') }));
jest.mock('@/context/TaskContext', () => ({ TaskProvider: wrapper('TaskProvider') }));
jest.mock('@/context/CycleContext', () => ({ CycleProvider: wrapper('CycleProvider') }));
jest.mock('@/context/GoalContext', () => ({ GoalProvider: wrapper('GoalProvider') }));
jest.mock('@/context/BrainDumpContext', () => ({ BrainDumpProvider: wrapper('BrainDumpProvider') }));
jest.mock('@/context/WeeklyReviewContext', () => ({ WeeklyReviewProvider: wrapper('WeeklyReviewProvider') }));
jest.mock('@/context/CycleReviewContext', () => ({ CycleReviewProvider: wrapper('CycleReviewProvider') }));
jest.mock('@/components/ApiDataBoundary', () => ({ ApiDataBoundary: wrapper('ApiDataBoundary') }));
jest.mock('@/components/CompletionCelebration', () => ({ CompletionCelebration: wrapper('CompletionCelebration') }));

import { useColorScheme } from '@/components/useColorScheme';
import { useAuth, type AuthContextValue, type AuthStatus } from '@/context/AuthContext';
import { useFonts } from 'expo-font';
import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { act, useEffect } from 'react';
import { createRoot } from 'test-renderer';
import RootLayout, { unstable_settings } from '../app/_layout';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: ReturnType<typeof createRoot> | undefined;
let auth: AuthContextValue;
let mounted: jest.Mock, removed: jest.Mock;
const SESSION = 'db24bdc4-d32a-4cd2-8ec6-2454e07b2b18';
const PRIVATE = ['CelebrationProvider', 'TaskProvider', 'CycleProvider', 'GoalProvider',
  'BrainDumpProvider', 'WeeklyReviewProvider', 'CycleReviewProvider', 'ApiDataBoundary', 'CompletionCelebration'];
function wrapper(name: string) {
  return function Wrapper({ children }: { children?: React.ReactNode }) {
    useEffect(() => { mounted(name); return () => { removed(name); }; }, []);
    return React.createElement('Wrapper', { name }, children);
  };
}
function identity(sessionId = SESSION) {
  return { sessionId, accountId: 1 as const, username: 'corey', clientType: 'web' as const,
    expiresAt: '2026-11-08T20:00:00Z' };
}
function nodes(type: string) { return root!.container.queryAll(node => node.type === type); }
async function render() { await act(async () => { root!.render(React.createElement(RootLayout)); }); }
async function mount() { root = createRoot(); await render(); }
function signIn() { auth.status = 'authenticated'; auth.identity = identity(); }
beforeEach(() => {
  jest.clearAllMocks(); mounted = jest.fn(); removed = jest.fn();
  jest.mocked(useFonts).mockReturnValue([true, null]);
  jest.mocked(useColorScheme).mockReturnValue('light');
  auth = { status: 'checking', identity: null, setupReady: false, isSubmitting: false,
    errorMessage: null, noticeMessage: null, suggestedUsername: '',
    refreshAuthentication: jest.fn(async () => undefined), createOwner: jest.fn(async () => undefined),
    signIn: jest.fn(async () => undefined), signOut: jest.fn(async () => undefined) };
  jest.mocked(useAuth).mockImplementation(() => auth);
});
afterEach(async () => {
  if (root) await act(async () => { root!.unmount(); }); root = undefined;
});

test.each<AuthStatus>(['checking', 'setup', 'login', 'error'])('%s mounts authentication without mounting private data providers', async status => {
  auth.status = status; await mount();
  expect(mounted).toHaveBeenCalledWith('AuthProvider');
  for (const name of PRIVATE) expect(mounted).not.toHaveBeenCalledWith(name);
  expect(nodes('Navigation')).toHaveLength(0);
  expect(nodes('AccountScreen')[0].props.status).toBe(status);
});
test('the setup form receives server readiness through the root boundary', async () => {
  auth.status = 'setup'; auth.setupReady = true; await mount();
  expect(nodes('AccountScreen')[0].props.setupReady).toBe(true);
  expect(nodes('AccountScreen')[0].props.onCreateOwner).toBe(auth.createOwner);
});
test('verified authentication mounts the full private provider tree and navigation', async () => {
  signIn(); await mount();
  for (const name of PRIVATE) expect(mounted).toHaveBeenCalledWith(name);
  expect(nodes('Navigation')).toHaveLength(1); expect(nodes('AccountScreen')).toHaveLength(0);
});
test('logging in mounts data providers only after authenticated state arrives', async () => {
  auth.status = 'login'; await mount(); expect(mounted).not.toHaveBeenCalledWith('TaskProvider');
  signIn(); await render(); expect(mounted).toHaveBeenCalledWith('TaskProvider');
  expect(nodes('AccountScreen')).toHaveLength(0);
});
test('an inconsistent authenticated status cannot start data loading', async () => {
  auth.status = 'authenticated'; await mount();
  for (const name of PRIVATE) expect(mounted).not.toHaveBeenCalledWith(name);
  expect(nodes('AccountScreen')[0].props.status).toBe('error');
});
test('logout removes all private provider state and navigation', async () => {
  signIn(); await mount(); auth.status = 'login'; auth.identity = null; await render();
  for (const name of PRIVATE) expect(removed).toHaveBeenCalledWith(name);
  expect(nodes('Navigation')).toHaveLength(0); expect(nodes('AccountScreen')).toHaveLength(1);
});
test('a replacement session remounts all private providers', async () => {
  signIn(); await mount(); mounted.mockClear(); removed.mockClear();
  auth.identity = identity('63a424ed-a3f5-4fc1-b3fe-0825dac39a83'); await render();
  for (const name of PRIVATE) {
    expect(removed).toHaveBeenCalledWith(name); expect(mounted).toHaveBeenCalledWith(name);
  }
});
test('font loading keeps the splash screen and delays both auth and private providers', async () => {
  jest.mocked(useFonts).mockReturnValueOnce([false, null]); await mount();
  expect(mounted).not.toHaveBeenCalled(); expect(SplashScreen.hideAsync).not.toHaveBeenCalled();
  await render(); expect(mounted).toHaveBeenCalledWith('AuthProvider');
  expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);
});
test('the light and dark theme remains outside the auth gate', async () => {
  await mount(); expect(nodes('Theme')[0].props.value).toEqual({ dark: false });
  jest.mocked(useColorScheme).mockReturnValue('dark'); await render();
  expect(nodes('Theme')[0].props.value).toEqual({ dark: true });
});
test('authenticated navigation keeps the tab, settings, and modal routes', async () => {
  signIn(); await mount();
  expect(nodes('Route').map(node => node.props.name)).toEqual(['(tabs)', 'settings', 'modal']);
  expect(nodes('Route')[0].props.options.headerShown).toBe(false);
  expect(nodes('Route')[2].props.options.presentation).toBe('modal');
  expect(unstable_settings.anchor).toBe('(tabs)');
});
test.each([true, false])('the Settings back button handles existing history %s', async canGoBack => {
  signIn(); await mount();
  const navigation = { canGoBack: jest.fn(() => canGoBack), goBack: jest.fn() };
  const route = nodes('Route').find(node => node.props.name === 'settings')!;
  const options = route.props.options({ navigation });
  const button = options.headerLeft({ tintColor: '#123456' });
  button.props.onPress();
  if (canGoBack) { expect(navigation.goBack).toHaveBeenCalledTimes(1); expect(router.replace).not.toHaveBeenCalled(); }
  else { expect(navigation.goBack).not.toHaveBeenCalled(); expect(router.replace).toHaveBeenCalledWith('/'); }
});
