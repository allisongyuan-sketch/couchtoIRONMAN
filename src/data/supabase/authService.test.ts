import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseAuthService } from './authService';

/** Only the auth surface this service touches. */
function stubClient(overrides: Record<string, unknown> = {}) {
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    signInWithIdToken: vi.fn().mockResolvedValue({
      data: { user: { id: 'u1', email: 'a@b.com', user_metadata: {} } },
      error: null,
    }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    }),
    ...overrides,
  };
  return { auth, client: { auth } as unknown as SupabaseClient };
}

describe('SupabaseAuthService', () => {
  it('sends a one-time link rather than asking for a password', async () => {
    const { client, auth } = stubClient();
    const service = new SupabaseAuthService({
      client,
      emailRedirectTo: 'repurpose://auth-callback',
    });

    const outcome = await service.signInWithEmail('  Coach@Example.com  ');

    expect(outcome).toEqual({ status: 'verification_sent', email: 'Coach@Example.com' });
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: 'Coach@Example.com',
      options: { emailRedirectTo: 'repurpose://auth-callback' },
    });
  });

  it('rejects an obvious typo without spending a request', async () => {
    const { client, auth } = stubClient();
    const service = new SupabaseAuthService({ client });

    expect(await service.signInWithEmail('not-an-email')).toMatchObject({
      status: 'failed',
      retryable: false,
    });
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('signs in with a native Apple token', async () => {
    const { client, auth } = stubClient();
    const service = new SupabaseAuthService({
      client,
      nativeProviders: { appleIdToken: async () => 'apple-token' },
    });

    const outcome = await service.signInWithApple();

    expect(outcome).toMatchObject({ status: 'signed_in' });
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({
      provider: 'apple',
      token: 'apple-token',
    });
  });

  it('treats a dismissed native sheet as a cancellation, not an error', async () => {
    // The native sheet throws when the user swipes it away. Showing them an error
    // for changing their mind would be wrong.
    const { client } = stubClient();
    const service = new SupabaseAuthService({
      client,
      nativeProviders: {
        appleIdToken: async () => {
          throw new Error('The operation was cancelled');
        },
      },
    });

    expect(await service.signInWithApple()).toEqual({ status: 'cancelled' });
  });

  it('treats a null token as a cancellation too', async () => {
    const { client } = stubClient();
    const service = new SupabaseAuthService({
      client,
      nativeProviders: { appleIdToken: async () => null },
    });

    expect(await service.signInWithApple()).toEqual({ status: 'cancelled' });
  });

  it('reports a method that is not configured for this deployment', async () => {
    const { client } = stubClient();
    const service = new SupabaseAuthService({ client });

    expect(await service.signInWithGoogle()).toMatchObject({ status: 'failed' });
    // And does not offer a button for it.
    expect(service.availableMethods).toEqual(['email']);
  });

  it('advertises only the methods this deployment has set up', () => {
    const { client } = stubClient();
    const service = new SupabaseAuthService({
      client,
      nativeProviders: {
        appleIdToken: async () => 't',
        googleIdToken: async () => 't',
      },
    });

    // Apple first: it is the one iOS requires when other providers are offered.
    expect(service.availableMethods).toEqual(['apple', 'email', 'google']);
  });

  it('marks rate limiting retryable and a rejected credential not', async () => {
    const limited = stubClient({
      signInWithOtp: vi.fn().mockResolvedValue({ error: { message: 'slow down', status: 429 } }),
    });
    expect(
      await new SupabaseAuthService({ client: limited.client }).signInWithEmail('a@b.com'),
    ).toMatchObject({ status: 'failed', retryable: true });

    const rejected = stubClient({
      signInWithOtp: vi.fn().mockResolvedValue({ error: { message: 'bad request', status: 400 } }),
    });
    expect(
      await new SupabaseAuthService({ client: rejected.client }).signInWithEmail('a@b.com'),
    ).toMatchObject({ status: 'failed', retryable: false });
  });

  it('reads the display name out of provider metadata', async () => {
    const { client } = stubClient({
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'u1', email: 'a@b.com', user_metadata: { full_name: 'Lena Cross' } } },
        error: null,
      }),
    });

    expect(await new SupabaseAuthService({ client }).currentUser()).toEqual({
      id: 'u1',
      email: 'a@b.com',
      displayName: 'Lena Cross',
    });
  });

  it('reports no user rather than throwing when the session is gone', async () => {
    const { client } = stubClient({
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: { message: 'no session' } }),
    });
    expect(await new SupabaseAuthService({ client }).currentUser()).toBeNull();
  });
});
