/**
 * What happens to local data when someone signs in.
 *
 * This is the decision that matters in sync, and it is small on purpose.
 *
 * **Union by id. Never delete, never silently drop.**
 *
 * Ids are generated on the device (`createId`) and are globally unique, so the same
 * record never exists twice under different ids by accident. That makes a union
 * lossless: everything local and everything remote survives a merge. Nobody signs in
 * and watches their workouts disappear, which is the failure mode that would destroy
 * trust in a local-first app instantly.
 *
 * When the *same* id exists on both sides — the same workout edited on two devices —
 * the newer `updatedAt` wins. Last-write-wins is a real tradeoff: a concurrent edit
 * on the other device loses. It is acceptable here because a workout is edited by one
 * person on one device at a time, and the alternative (field-level merge, or asking
 * the user to resolve conflicts) is a great deal of machinery for a case this rare.
 * If that stops being true, this function is where it changes.
 *
 * Deletion is deliberately NOT synced. A record missing from one side means
 * "not seen here yet", not "deleted" — telling those apart needs tombstones, and
 * guessing wrong deletes a user's data. Until tombstones exist, a delete is local.
 */

export interface MergeResult<T> {
  /** Everything, after merging. Both sides should end up holding this. */
  merged: T[];
  /** Present locally but not remotely — needs uploading. */
  toUpload: T[];
  /** Present remotely but not locally — needs downloading. */
  toDownload: T[];
  /**
   * Existed on both sides with *differing* versions, and the newer copy won.
   * Identical versions are not conflicts and are not listed.
   */
  conflicts: { id: string; winner: 'local' | 'remote' }[];
}

export interface MergeOptions<T> {
  getId: (item: T) => string;
  /** Comparable recency marker — an ISO string or epoch ms. Higher/later wins. */
  getVersion: (item: T) => string | number;
}

export function mergeById<T>(
  local: T[],
  remote: T[],
  { getId, getVersion }: MergeOptions<T>,
): MergeResult<T> {
  const localById = new Map(local.map((item) => [getId(item), item]));
  const remoteById = new Map(remote.map((item) => [getId(item), item]));

  const merged: T[] = [];
  const toUpload: T[] = [];
  const toDownload: T[] = [];
  const conflicts: { id: string; winner: 'local' | 'remote' }[] = [];

  for (const [id, localItem] of localById) {
    const remoteItem = remoteById.get(id);

    if (!remoteItem) {
      merged.push(localItem);
      toUpload.push(localItem);
      continue;
    }

    const comparison = compareVersions(getVersion(localItem), getVersion(remoteItem));

    // Same version means the same revision on both sides. Nothing to reconcile and
    // nothing to write — a merge that changes nothing must cost no round trips.
    if (comparison === 0) {
      merged.push(remoteItem);
      continue;
    }

    const localWins = comparison > 0;
    conflicts.push({ id, winner: localWins ? 'local' : 'remote' });

    if (localWins) {
      merged.push(localItem);
      toUpload.push(localItem);
    } else {
      merged.push(remoteItem);
      toDownload.push(remoteItem);
    }
  }

  for (const [id, remoteItem] of remoteById) {
    if (localById.has(id)) continue;
    merged.push(remoteItem);
    toDownload.push(remoteItem);
  }

  return { merged, toUpload, toDownload, conflicts };
}

/** Negative when a is older, 0 when equal, positive when a is newer. */
function compareVersions(a: string | number, b: string | number): number {
  // Numbers must compare numerically: as strings, 9 sorts after 10.
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

/**
 * History is append-only — a completed session is a fact, not a document — so it
 * needs no conflict rule at all. Union by id, newest first.
 */
export function mergeHistory<T>(
  local: T[],
  remote: T[],
  getId: (item: T) => string,
  getCompletedAt: (item: T) => number,
): MergeResult<T> {
  const result = mergeById(local, remote, { getId, getVersion: getCompletedAt });
  return { ...result, merged: result.merged.sort((a, b) => getCompletedAt(b) - getCompletedAt(a)) };
}
