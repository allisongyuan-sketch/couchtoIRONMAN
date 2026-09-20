import { describe, expect, it } from 'vitest';
import { mergeById, mergeHistory } from './merge';

interface Doc {
  id: string;
  title: string;
  updatedAt: string;
}

const opts = {
  getId: (doc: Doc) => doc.id,
  getVersion: (doc: Doc) => doc.updatedAt,
};

function doc(id: string, title: string, updatedAt: string): Doc {
  return { id, title, updatedAt };
}

describe('mergeById', () => {
  it('keeps everything from both sides', () => {
    // The failure that would destroy trust in a local-first app: signing in and
    // watching your workouts vanish. A union cannot do that.
    const local = [doc('a', 'Leg Day', '2026-01-01T00:00:00Z')];
    const remote = [doc('b', 'Push Day', '2026-01-02T00:00:00Z')];

    const result = mergeById(local, remote, opts);

    expect(result.merged.map((d) => d.id).sort()).toEqual(['a', 'b']);
    expect(result.toUpload.map((d) => d.id)).toEqual(['a']);
    expect(result.toDownload.map((d) => d.id)).toEqual(['b']);
    expect(result.conflicts).toEqual([]);
  });

  it('uploads everything when the account is new', () => {
    const local = [doc('a', 'A', '2026-01-01T00:00:00Z'), doc('b', 'B', '2026-01-01T00:00:00Z')];
    const result = mergeById(local, [], opts);

    expect(result.toUpload).toHaveLength(2);
    expect(result.toDownload).toHaveLength(0);
  });

  it('downloads everything onto a fresh device', () => {
    const remote = [doc('a', 'A', '2026-01-01T00:00:00Z')];
    const result = mergeById([], remote, opts);

    expect(result.toDownload).toHaveLength(1);
    expect(result.toUpload).toHaveLength(0);
  });

  it('lets the newer copy win when the same record exists on both sides', () => {
    const local = [doc('a', 'Renamed here', '2026-02-01T00:00:00Z')];
    const remote = [doc('a', 'Old name', '2026-01-01T00:00:00Z')];

    const result = mergeById(local, remote, opts);

    expect(result.merged).toHaveLength(1);
    expect(result.merged[0]?.title).toBe('Renamed here');
    expect(result.conflicts).toEqual([{ id: 'a', winner: 'local' }]);
    expect(result.toUpload).toHaveLength(1);
  });

  it('lets the remote copy win when it is newer', () => {
    const local = [doc('a', 'Stale', '2026-01-01T00:00:00Z')];
    const remote = [doc('a', 'Edited elsewhere', '2026-03-01T00:00:00Z')];

    const result = mergeById(local, remote, opts);

    expect(result.merged[0]?.title).toBe('Edited elsewhere');
    expect(result.toDownload).toHaveLength(1);
    expect(result.toUpload).toHaveLength(0);
  });

  it('writes nothing when both sides already agree', () => {
    // A tie is not a conflict worth a round trip.
    const same = [doc('a', 'A', '2026-01-01T00:00:00Z')];
    const result = mergeById(same, [...same], opts);

    expect(result.toUpload).toHaveLength(0);
    expect(result.toDownload).toHaveLength(0);
    expect(result.merged).toHaveLength(1);
  });

  it('never drops a record that is missing from one side', () => {
    // Absence means "not seen here yet", never "deleted". Treating it as a delete
    // without tombstones would destroy data.
    const local = [doc('a', 'A', '2026-01-01T00:00:00Z'), doc('b', 'B', '2026-01-01T00:00:00Z')];
    const remote = [doc('a', 'A', '2026-01-01T00:00:00Z')];

    expect(mergeById(local, remote, opts).merged).toHaveLength(2);
  });

  it('handles both sides being empty', () => {
    const result = mergeById<Doc>([], [], opts);
    expect(result.merged).toEqual([]);
    expect(result.toUpload).toEqual([]);
    expect(result.toDownload).toEqual([]);
  });

  it('compares numeric versions numerically', () => {
    // String comparison would put 9 after 10.
    const local = [{ id: 'a', title: 'newer', updatedAt: 10 }];
    const remote = [{ id: 'a', title: 'older', updatedAt: 9 }];

    const result = mergeById(local, remote, {
      getId: (d) => d.id,
      getVersion: (d) => d.updatedAt,
    });

    expect(result.merged[0]?.title).toBe('newer');
  });
});

describe('mergeHistory', () => {
  it('unions completed sessions and orders them newest first', () => {
    const local = [{ sessionId: 'a', completedAt: 100 }];
    const remote = [
      { sessionId: 'b', completedAt: 300 },
      { sessionId: 'c', completedAt: 200 },
    ];

    const result = mergeHistory(
      local,
      remote,
      (s) => s.sessionId,
      (s) => s.completedAt,
    );

    expect(result.merged.map((s) => s.sessionId)).toEqual(['b', 'c', 'a']);
  });
});
