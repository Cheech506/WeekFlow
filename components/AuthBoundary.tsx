/** Keep account setup/login outside the tree that loads private app data. */
import { AuthScreen } from '@/components/AuthScreen';
import { useAuth } from '@/context/AuthContext';
import { Fragment, type ReactNode } from 'react';

/** Place inside AuthProvider, above every API-backed data provider. */
export function AuthBoundary({ children }: { children: ReactNode }) {
  const auth = useAuth();

  if (auth.status === 'authenticated' && auth.identity !== null) {
    // A replacement session gets a fresh provider/navigation tree, so arrays
    // and unsaved screen state from an older session cannot carry across.
    return <Fragment key={auth.identity.sessionId}>{children}</Fragment>;
  }

  // Fail closed if state is ever inconsistent: an authenticated label without
  // a verified identity must not mount screens or start their data requests.
  const missingIdentity = auth.status === 'authenticated';
  return (
    <AuthScreen
      status={auth.status === 'authenticated' ? 'error' : auth.status}
      setupReady={auth.setupReady}
      isSubmitting={auth.isSubmitting}
      errorMessage={missingIdentity ? 'Your login could not be verified. Please try again.' : auth.errorMessage}
      noticeMessage={auth.noticeMessage}
      suggestedUsername={auth.suggestedUsername}
      onRetry={auth.refreshAuthentication}
      onLogin={auth.signIn}
      onCreateOwner={auth.createOwner}
    />
  );
}
