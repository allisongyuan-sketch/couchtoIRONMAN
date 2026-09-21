import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { AuthMethod, AuthService, AuthUser, SignInOutcome } from '@/core/auth/types';
import { isPlausibleEmail } from '@/core/auth/types';

/**
 * Supabase-backed authentication.
 *
 * Email sign-in uses a one-time link rather than a password: there is no password to
 * choose, forget, reuse or leak, and it removes a whole screen from a flow the PRD
 * wants kept as short as possible (§25, §26).
 */
export interface SupabaseAuthConfig {
  client: SupabaseClient;
  /** Deep link the one-time email link returns to, e.g. `repurpose://auth-callback`. */
  emailRedirectTo?: string;
  /** Apple/Google need native sign-in flows; injected so this stays testable. */
  nativeProviders?: {
    appleIdToken?: () => Promise<string | null>;
    googleIdToken?: () => Promise<string | null>;
  };
}

export class SupabaseAuthService implements AuthService {
  readonly id = 'supabase';

  constructor(private readonly config: SupabaseAuthConfig) {}

  get availableMethods(): AuthMethod[] {
    const methods: AuthMethod[] = ['email'];
    if (this.config.nativeProviders?.appleIdToken) methods.unshift('apple');
    if (this.config.nativeProviders?.googleIdToken) methods.push('google');
    return methods;
  }

  async currentUser(): Promise<AuthUser | null> {
    const { data, error } = await this.config.client.auth.getUser();
    if (error || !data.user) return null;
    return toAuthUser(data.user);
  }

  async signInWithEmail(email: string): Promise<SignInOutcome> {
    const trimmed = email.trim();
    if (!isPlausibleEmail(trimmed)) {
      return { status: 'failed', reason: 'That email address doesn’t look right', retryable: false };
    }

    const { error } = await this.config.client.auth.signInWithOtp({
      email: trimmed,
      ...(this.config.emailRedirectTo
        ? { options: { emailRedirectTo: this.config.emailRedirectTo } }
        : {}),
    });

    if (error) return toFailure(error);
    return { status: 'verification_sent', email: trimmed };
  }

  async signInWithApple(): Promise<SignInOutcome> {
    return this.signInWithIdToken('apple', this.config.nativeProviders?.appleIdToken);
  }

  async signInWithGoogle(): Promise<SignInOutcome> {
    return this.signInWithIdToken('google', this.config.nativeProviders?.googleIdToken);
  }

  private async signInWithIdToken(
    provider: 'apple' | 'google',
    getToken?: () => Promise<string | null>,
  ): Promise<SignInOutcome> {
    if (!getToken) {
      return { status: 'failed', reason: 'That sign-in method isn’t set up', retryable: false };
    }

    let token: string | null;
    try {
      token = await getToken();
    } catch {
      // The native sheet throws on dismissal, which is a cancellation rather than
      // an error worth showing.
      return { status: 'cancelled' };
    }

    if (!token) return { status: 'cancelled' };

    const { data, error } = await this.config.client.auth.signInWithIdToken({
      provider,
      token,
    });

    if (error) return toFailure(error);
    if (!data.user) {
      return { status: 'failed', reason: 'Sign-in did not complete', retryable: true };
    }
    return { status: 'signed_in', user: toAuthUser(data.user) };
  }

  async signOut(): Promise<void> {
    await this.config.client.auth.signOut();
  }

  onAuthChange(listener: (user: AuthUser | null) => void): () => void {
    const { data } = this.config.client.auth.onAuthStateChange((_event, session) => {
      listener(session?.user ? toAuthUser(session.user) : null);
    });
    return () => data.subscription.unsubscribe();
  }
}

function toAuthUser(user: User): AuthUser {
  const result: AuthUser = { id: user.id };
  if (user.email) result.email = user.email;

  const name = user.user_metadata?.['full_name'] ?? user.user_metadata?.['name'];
  if (typeof name === 'string' && name.trim()) result.displayName = name.trim();

  return result;
}

/** Rate limiting is worth retrying; a rejected credential is not. */
function toFailure(error: { message: string; status?: number }): SignInOutcome {
  const status = error.status ?? 0;
  return {
    status: 'failed',
    reason: status === 429 ? 'Too many attempts — try again shortly' : error.message,
    retryable: status === 429 || status >= 500,
  };
}
