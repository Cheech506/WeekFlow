/** The account setup/login form. AuthProvider will supply the actions and state. */
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { ApiError } from '@/lib/api/apiClient';
import type { AuthLoginInput, AuthOwnerSetupInput } from '@/lib/api/authApi';

export type AuthScreenStatus = 'checking' | 'setup' | 'login' | 'error';
export type AuthScreenProps = {
  status: AuthScreenStatus;
  setupReady?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  noticeMessage?: string | null;
  suggestedUsername?: string;
  serverAddress?: string;
  onChangeServer?: () => Promise<void>;
  onRetry: () => Promise<void>;
  onLogin: (input: AuthLoginInput) => Promise<void>;
  onCreateOwner: (input: AuthOwnerSetupInput) => Promise<void>;
};

export function AuthScreen({
  status, setupReady = false, isSubmitting = false,
  errorMessage = null, noticeMessage = null, suggestedUsername = '',
  serverAddress, onChangeServer,
  onRetry, onLogin, onCreateOwner,
}: AuthScreenProps) {
  const dark = useColorScheme() === 'dark';
  const [username, setUsername] = useState(suggestedUsername);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const operationRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const busy = working || isSubmitting;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current += 1; };
  }, []);

  useEffect(() => {
    // Moving between setup, login, and error must not retain secret fields.
    operationRef.current += 1;
    busyRef.current = false;
    setWorking(false);
    setPassword('');
    setConfirmation('');
    setSetupCode('');
    setShowPasswords(false);
    setLocalError(null);
  }, [status, setupReady]);

  useEffect(() => { setUsername(suggestedUsername); }, [suggestedUsername]);

  async function perform(action: () => Promise<void>) {
    // A ref blocks repeated taps immediately, before React rerenders.
    if (!mountedRef.current || busyRef.current || isSubmitting) return;
    busyRef.current = true;
    const operation = ++operationRef.current;
    setWorking(true);
    setLocalError(null);
    try {
      await action();
    } catch (cause) {
      if (mountedRef.current && operationRef.current === operation) {
        // Known API errors have controlled messages. Do not render an
        // unexpected exception that could contain request data or secrets.
        setLocalError(cause instanceof ApiError ? cause.message
          : 'That request could not be completed. Please try again.');
      }
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        busyRef.current = false;
        setWorking(false);
      }
    }
  }

  function submit() {
    if (busyRef.current || busy || (status !== 'login' && status !== 'setup')) return;
    if (status === 'setup' && !setupReady) return;
    if (!username.trim() || !password) {
      setLocalError('Enter your username and password.');
      return;
    }
    if (status === 'setup' && (!setupCode.trim() || password !== confirmation)) {
      setLocalError(!setupCode.trim() ? 'Enter the one-time setup code.' : 'The passwords do not match.');
      return;
    }
    // Snapshot the form. Never save these values in device/browser storage.
    const input = { username: username.trim(), password };
    const code = setupCode.trim();
    const creating = status === 'setup';
    // Clear secret fields after each submitted attempt, including failures.
    // The action receives the snapshot while the visible form is cleared.
    setPassword('');
    setConfirmation('');
    setSetupCode('');
    setShowPasswords(false);
    void perform(() => creating ? onCreateOwner({ ...input, setupCode: code }) : onLogin(input));
  }

  const color = dark ? '#f9fafb' : '#111827';
  const muted = dark ? '#cbd5e1' : '#4b5563';
  const backgroundColor = dark ? '#111827' : '#f3f4f6';
  const cardColor = dark ? '#1f2937' : '#ffffff';
  const borderColor = dark ? '#64748b' : '#9ca3af';
  const inputStyle = [styles.input, { color, borderColor, backgroundColor: cardColor }];
  const creating = status === 'setup';
  const formVisible = status === 'login' || (creating && setupReady);
  const visibleError = localError ?? errorMessage;
  const title = status === 'checking' ? 'Checking your account…'
    : status === 'setup' ? 'Create your account'
    : status === 'login' ? 'Sign in' : 'WeekFlow could not connect';

  function retryButton(label: string) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }} disabled={busy}
        onPress={() => { void perform(onRetry); }} style={[styles.button, busy && styles.disabled]}>
        <Text style={styles.buttonText}>{busy ? 'Checking…' : label}</Text>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={[styles.page, { backgroundColor }]}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: cardColor }]}>
            <Text style={[styles.brand, { color }]}>WeekFlow</Text>
            <Text accessibilityRole="header" style={[styles.title, { color }]}>{title}</Text>
            {status === 'checking' ? (
              <View style={styles.checking} accessibilityLiveRegion="polite">
                <ActivityIndicator size="large" color={dark ? '#93c5fd' : '#2563eb'} />
                <Text style={[styles.message, { color: muted }]}>Connecting to your WeekFlow instance.</Text>
              </View>
            ) : null}
            {noticeMessage ? <Text accessibilityLiveRegion="polite" style={[styles.message, { color: muted }]}>{noticeMessage}</Text> : null}
            {visibleError ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                style={[styles.message, { color: dark ? '#fca5a5' : '#b91c1c' }]}>{visibleError}</Text>
            ) : null}
            {creating && !setupReady ? (
              <>
                <Text style={[styles.message, { color: muted }]}>
                  A one-time setup code is needed before you can create the account.
                  Get a code from the person running this WeekFlow instance, then check again.
                </Text>
                {retryButton('Check setup again')}
              </>
            ) : null}
            {formVisible ? (
              <>
                {creating ? (
                  <>
                    <Text style={[styles.message, { color: muted }]}>Use your one-time setup code to create this instance’s owner account.</Text>
                    <Text style={[styles.label, { color }]}>Setup code</Text>
                    <TextInput accessibilityLabel="Setup code" value={setupCode} onChangeText={setSetupCode}
                      editable={!busy} secureTextEntry autoCapitalize="none" autoCorrect={false}
                      autoComplete="off" textContentType="none" style={inputStyle} />
                  </>
                ) : null}
                <Text style={[styles.label, { color }]}>Username</Text>
                <TextInput accessibilityLabel="Username" value={username} onChangeText={setUsername}
                  editable={!busy} autoCapitalize="none" autoCorrect={false}
                  autoComplete="username" textContentType="username" style={inputStyle} />
                <Text style={[styles.label, { color }]}>Password</Text>
                <TextInput accessibilityLabel="Password" value={password} onChangeText={setPassword}
                  editable={!busy} secureTextEntry={!showPasswords} autoCapitalize="none" autoCorrect={false}
                  autoComplete={creating ? 'new-password' : 'current-password'}
                  textContentType={creating ? 'newPassword' : 'password'}
                  returnKeyType={creating ? 'next' : 'go'}
                  onSubmitEditing={creating ? undefined : submit} style={inputStyle} />
                {creating ? (
                  <>
                    <Text style={[styles.message, { color: muted }]}>Use 15–128 characters. Spaces and Unicode are supported.</Text>
                    <Text style={[styles.label, { color }]}>Confirm password</Text>
                    <TextInput accessibilityLabel="Confirm password" value={confirmation} onChangeText={setConfirmation}
                      editable={!busy} secureTextEntry={!showPasswords} autoCapitalize="none" autoCorrect={false}
                      autoComplete="new-password" textContentType="newPassword"
                      returnKeyType="go" onSubmitEditing={submit} style={inputStyle} />
                  </>
                ) : null}
                <Pressable accessibilityRole="checkbox" accessibilityLabel="Show passwords"
                  accessibilityState={{ checked: showPasswords, disabled: busy }} disabled={busy}
                  onPress={() => { setShowPasswords(value => !value); }} style={styles.toggle}>
                  <Text style={{ color: dark ? '#93c5fd' : '#1d4ed8' }}>{showPasswords ? 'Hide passwords' : 'Show passwords'}</Text>
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={creating ? 'Create account' : 'Sign in'}
                  accessibilityState={{ disabled: busy, busy }} disabled={busy}
                  onPress={submit} style={[styles.button, busy && styles.disabled]}>
                  <Text style={styles.buttonText}>{busy ? (creating ? 'Creating account…' : 'Signing in…') : (creating ? 'Create account' : 'Sign in')}</Text>
                </Pressable>
              </>
            ) : null}
            {status === 'error' ? retryButton('Try again') : null}
            {serverAddress && onChangeServer && status !== 'checking' ? (
              <>
                <Text style={[styles.message, { color: muted }]}>Server: {serverAddress}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Change server"
                  accessibilityState={{ disabled: busy, busy }} disabled={busy}
                  onPress={() => {
                    setPassword('');
                    setConfirmation('');
                    setSetupCode('');
                    setShowPasswords(false);
                    void perform(onChangeServer);
                  }} style={[styles.toggle, busy && styles.disabled]}>
                  <Text style={{ color: dark ? '#93c5fd' : '#1d4ed8' }}>Change server</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 460, borderRadius: 16, padding: 24, gap: 12 },
  brand: { fontSize: 28, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  message: { fontSize: 14, lineHeight: 21 },
  checking: { gap: 16, alignItems: 'center', paddingVertical: 16 },
  label: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  toggle: { paddingVertical: 10, minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  button: { minHeight: 48, backgroundColor: '#2563eb', borderRadius: 8, paddingHorizontal: 18, paddingVertical: 13, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
