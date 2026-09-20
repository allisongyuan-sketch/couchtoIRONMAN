import { create } from 'zustand';
import type { AuthUser, SignInOutcome } from '@/core/auth/types';
import { syncAll } from '@/core/sync/syncAll';
import type { SyncReport } from '@/core/sync/types';
import { authService, remoteStores, repositories } from './container';
import { useLibraryStore } from './libraryStore';
import { useHistoryStore } from './historyStore';

/**
 * Account state.
 *
 * Nothing in the app waits on this. The user can import, edit and train signed out;
 * signing in is what makes the data outlive the device (PRD §26), so this store's
 * real job is to run a sync at the moments that matter and to say plainly what
 * happened.
 */
interface AuthState {
  user: AuthUser | null;
  /** True until the stored session has been checked, so the UI doesn't flicker. */
  loading: boolean;
  busy: boolean;
  /** Set after an email sign-in, so the UI can say "check your inbox". */
  pendingEmail: string | null;
  message: string | null;
  lastSync: SyncReport | null;

  initialize: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  sync: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: true,
  busy: false,
  pendingEmail: null,
  message: null,
  lastSync: null,

  async initialize() {
    const user = await authService.currentUser();
    set({ user, loading: false });

    authService.onAuthChange((next) => {
      const previous = get().user;
      set({ user: next, pendingEmail: null });
      // Signing in is exactly when local work needs claiming, and it is also how a
      // returning user on a new device gets their library back.
      if (next && next.id !== previous?.id) void get().sync();
    });

    if (user) void get().sync();
  },

  async signInWithApple() {
    await runSignIn(set, () => authService.signInWithApple());
  },

  async signInWithGoogle() {
    await runSignIn(set, () => authService.signInWithGoogle());
  },

  async signInWithEmail(email) {
    await runSignIn(set, () => authService.signInWithEmail(email));
  },

  async signOut() {
    // Sync before leaving, so nothing created in this session is stranded on a
    // device the user may be about to hand over or replace.
    await get().sync();
    await authService.signOut();
    set({ user: null, message: null, pendingEmail: null, lastSync: null });
  },

  async sync() {
    const user = get().user;
    if (!user) return;

    set({ busy: true });
    try {
      const outcome = await syncAll({
        userId: user.id,
        local: { workouts: repositories.workouts, sessions: repositories.sessions },
        remote: remoteStores,
      });

      if (outcome.status === 'ok') {
        set({ lastSync: outcome.report, message: null });
        // Anything downloaded should appear without the user pulling to refresh.
        if (outcome.report.workoutsDownloaded > 0) void useLibraryStore.getState().load();
        if (outcome.report.historyDownloaded > 0) void useHistoryStore.getState().load();
      } else if (outcome.status === 'failed') {
        // Never fatal: the local copy is intact and the next attempt picks up from
        // wherever this one stopped.
        set({ message: 'Couldn’t sync just now. Your workouts are safe on this device.' });
      }
    } finally {
      set({ busy: false });
    }
  },
}));

async function runSignIn(
  set: (partial: Partial<AuthState>) => void,
  attempt: () => Promise<SignInOutcome>,
): Promise<void> {
  set({ busy: true, message: null, pendingEmail: null });
  try {
    const outcome = await attempt();

    if (outcome.status === 'signed_in') {
      set({ user: outcome.user });
      return;
    }
    if (outcome.status === 'verification_sent') {
      set({ pendingEmail: outcome.email, message: `Check ${outcome.email} for your sign-in link.` });
      return;
    }
    // A cancellation is the user changing their mind, not something to report at them.
    if (outcome.status === 'failed') set({ message: outcome.reason });
  } finally {
    set({ busy: false });
  }
}
