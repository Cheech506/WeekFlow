/** Collect a server address before the mobile authentication flow starts. */
import { useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator, KeyboardAvoidingView, Platform, Pressable,
    ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import { normalizeServerAddress, ServerAddressStorageError } from '@/lib/serverAddressStorage';

export type ServerAddressScreenProps = {
  initialAddress?: string;
  isLoading?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | null;
  onContinue: (address: string) => Promise<void>;
  onRetry?: () => Promise<void>;
};

export function ServerAddressScreen({
  initialAddress = '', isLoading = false, isSubmitting = false,
  errorMessage = null, onContinue, onRetry,
}: ServerAddressScreenProps) {
  const dark = useColorScheme() === 'dark';
  const [address, setAddress] = useState(initialAddress);
  const [localError, setLocalError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const mountedRef = useRef(false);
  const busyRef = useRef(false);
  const operationRef = useRef(0);
  const busy = working || isSubmitting || isLoading;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; operationRef.current += 1; };
  }, []);

  async function perform(action: () => Promise<void>) {
    // Prevent two taps from starting two saves before React updates the button.
    if (!mountedRef.current || busyRef.current || isSubmitting || isLoading) return;
    busyRef.current = true;
    const operation = ++operationRef.current;
    setWorking(true);
    setLocalError(null);
    try {
      await action();
    } catch (cause) {
      if (mountedRef.current && operationRef.current === operation) {
        setLocalError(cause instanceof ServerAddressStorageError ? cause.message
          : 'The server address could not be selected. Please try again.');
      }
    } finally {
      if (mountedRef.current && operationRef.current === operation) {
        busyRef.current = false;
        setWorking(false);
      }
    }
  }

  function submit() {
    if (busy || busyRef.current || !mountedRef.current) return;
    let selected: string;
    try {
      selected = normalizeServerAddress(address);
    } catch {
      setLocalError('Enter a complete HTTPS address, such as https://192.168.1.50:9443, without a page path.');
      return;
    }
    // The parent saves this address and starts authentication for that server.
    // This screen does not send credentials or read private WeekFlow data.
    void perform(() => onContinue(selected));
  }

  const color = dark ? '#f9fafb' : '#111827';
  const muted = dark ? '#cbd5e1' : '#4b5563';
  const cardColor = dark ? '#1f2937' : '#ffffff';
  const visibleError = localError ?? errorMessage;

  return (
    <SafeAreaView style={[styles.page, { backgroundColor: dark ? '#111827' : '#f3f4f6' }]}>
      <KeyboardAvoidingView style={styles.page} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <View style={[styles.card, { backgroundColor: cardColor }]}>
            <Text style={[styles.brand, { color }]}>WeekFlow</Text>
            <Text accessibilityRole="header" style={[styles.title, { color }]}>
              {isLoading ? 'Loading your server address…' : 'Choose your server'}
            </Text>
            {isLoading ? (
              <View style={styles.loading} accessibilityLiveRegion="polite">
                <ActivityIndicator size="large" color={dark ? '#93c5fd' : '#2563eb'} />
                <Text style={[styles.message, { color: muted }]}>Checking the address saved on this device.</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.message, { color: muted }]}>
                  Enter the HTTPS address of the computer running your WeekFlow server.
                  You will sign in to that server next.
                </Text>
                <Text style={[styles.label, { color }]}>Server address</Text>
                <TextInput accessibilityLabel="Server address" value={address}
                  onChangeText={value => { setAddress(value); setLocalError(null); }}
                  editable={!busy} autoCapitalize="none" autoCorrect={false}
                  autoComplete="off" textContentType="URL" keyboardType="url"
                  placeholder="https://192.168.1.50:9443" placeholderTextColor={dark ? '#94a3b8' : '#6b7280'}
                  returnKeyType="go" onSubmitEditing={submit}
                  style={[styles.input, { color, backgroundColor: cardColor, borderColor: dark ? '#64748b' : '#9ca3af' }]} />
                <Text style={[styles.message, { color: muted }]}>
                  Use the server address only, without /api or another page path.
                  The server must be reachable from your phone and have a trusted HTTPS certificate.
                </Text>
              </>
            )}
            {visibleError ? (
              <Text accessibilityRole="alert" accessibilityLiveRegion="polite"
                style={[styles.message, { color: dark ? '#fca5a5' : '#b91c1c' }]}>{visibleError}</Text>
            ) : null}
            {!isLoading ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel="Continue"
                  accessibilityState={{ disabled: busy, busy }} disabled={busy}
                  onPress={submit} style={[styles.button, busy && styles.disabled]}>
                  <Text style={styles.buttonText}>{busy ? 'Selecting server…' : 'Continue'}</Text>
                </Pressable>
                {onRetry ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Retry loading saved address"
                    accessibilityState={{ disabled: busy, busy }} disabled={busy}
                    onPress={() => { void perform(onRetry); }} style={[styles.retry, busy && styles.disabled]}>
                    <Text style={{ color: dark ? '#93c5fd' : '#1d4ed8' }}>Retry loading saved address</Text>
                  </Pressable>
                ) : null}
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
  card: { width: '100%', maxWidth: 460, padding: 24, borderRadius: 16, gap: 12 },
  brand: { fontSize: 28, fontWeight: '800' },
  title: { fontSize: 22, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 21 },
  label: { fontSize: 15, fontWeight: '600', marginTop: 4 },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16 },
  loading: { alignItems: 'center', gap: 16, paddingVertical: 16 },
  button: { minHeight: 48, borderRadius: 8, backgroundColor: '#2563eb', padding: 13, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  retry: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  disabled: { opacity: 0.5 },
});
