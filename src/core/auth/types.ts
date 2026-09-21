/**
 * Authentication (PRD §26).
 *
 * The governing rule is "try first, account later": a user must reach their first
 * converted workout before anyone asks them to register. Everything the app does —
 * import, edit, train, history — works signed out, because the repositories are
 * local-first and carry no user id.
 *
 * So an account is not a gate. It is what you create when you want the data to
 * outlive the device: save permanently, sync, preserve history.
 */

export interface AuthUser {
  id: string;
  email?: string;
  displayName?: string;
}

export type AuthMethod = 'apple' | 'google' | 'email';

export type SignInOutcome =
  | { status: 'signed_in'; user: AuthUser }
  /** Email sign-in sends a link or a code; nothing else happens until they use it. */
  | { status: 'verification_sent'; email: string }
  | { status: 'cancelled' }
  | { status: 'failed'; reason: string; retryable: boolean };

/**
 * The seam. One implementation today (Supabase), plus a no-op used when no backend
 * is configured — which is a supported state, not a broken one.
 */
export interface AuthService {
  readonly id: string;
  /** The methods this deployment actually offers, for rendering the buttons. */
  readonly availableMethods: AuthMethod[];
  currentUser(): Promise<AuthUser | null>;
  signInWithApple(): Promise<SignInOutcome>;
  signInWithGoogle(): Promise<SignInOutcome>;
  signInWithEmail(email: string): Promise<SignInOutcome>;
  signOut(): Promise<void>;
  /** Returns an unsubscribe function. */
  onAuthChange(listener: (user: AuthUser | null) => void): () => void;
}

/**
 * Used when no backend is configured. Every method reports that accounts are
 * unavailable rather than throwing, so the Profile screen can say so plainly and
 * the rest of the app carries on unaffected.
 */
export class UnavailableAuthService implements AuthService {
  readonly id = 'unavailable';
  readonly availableMethods: AuthMethod[] = [];

  async currentUser(): Promise<AuthUser | null> {
    return null;
  }
  async signInWithApple(): Promise<SignInOutcome> {
    return unavailable();
  }
  async signInWithGoogle(): Promise<SignInOutcome> {
    return unavailable();
  }
  async signInWithEmail(): Promise<SignInOutcome> {
    return unavailable();
  }
  async signOut(): Promise<void> {}
  onAuthChange(): () => void {
    return () => {};
  }
}

function unavailable(): SignInOutcome {
  return { status: 'failed', reason: 'Accounts are not available yet', retryable: false };
}

/** Basic shape check before spending a network call on an obvious typo. */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}
