import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Supabase client, when one is configured.
 *
 * **On the anon key being an `EXPO_PUBLIC_` variable.** Unlike the Anthropic and
 * Deepgram keys — which must never leave the server — the Supabase anon key is
 * *designed* to ship to clients. It identifies the project, it does not authorise
 * anything by itself, and every table's access is decided by Row Level Security.
 *
 * That safety is conditional, and the condition is ours to keep: the policies in
 * `supabase/migrations/0001_init.sql` enable RLS on every table holding user data and
 * scope each row to `auth.uid()`. If RLS were ever disabled on a table, this key
 * would become a public read/write credential for it. That is the one thing to check
 * before adding a table.
 */

const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = !!url && !!anonKey;

export function createSupabaseClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;

  return createClient(url, anonKey, {
    auth: {
      // The session has to survive app restarts, so it is persisted where the rest
      // of the app's local data lives.
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // There is no URL to read a session back from in a native app; the deep-link
      // handler does that explicitly.
      detectSessionInUrl: false,
    },
  });
}

export const supabase: SupabaseClient | null = createSupabaseClient();
