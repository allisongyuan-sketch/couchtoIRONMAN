import { useEffect, useMemo } from 'react';
import { SectionList, StyleSheet, View } from 'react-native';
import { Card, Screen, Text, spacing } from '@/ui';
import { useHistoryStore } from '@/state/historyStore';
import { formatDuration } from '@/core/schema/workout';
import type { SessionSummary } from '@/core/schema/session';

/**
 * History (PRD §17).
 *
 * A log of completed workouts, grouped by day. Volume, weights, personal records and
 * training analytics are explicitly out of scope — the stored sessions already carry
 * enough detail to add them later without a migration.
 */
export default function HistoryScreen() {
  const entries = useHistoryStore((state) => state.entries);
  const load = useHistoryStore((state) => state.load);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(() => groupByDay(entries), [entries]);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text variant="title">History</Text>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.sessionId}
        contentContainerStyle={styles.list}
        stickySectionHeadersEnabled={false}
        ListEmptyComponent={
          <Card>
            <Text variant="body" tone="secondary">
              Workouts you finish will show up here.
            </Text>
          </Card>
        }
        renderSectionHeader={({ section }) => (
          <Text variant="label" tone="secondary" uppercase style={styles.sectionHeader}>
            {section.title}
          </Text>
        )}
        renderItem={({ item }) => (
          <Card>
            <Text variant="heading">
              {item.workoutTitle}
              {item.creatorHandle ? ` — ${item.creatorHandle}` : ''}
            </Text>
            <View style={styles.metaRow}>
              <Text variant="small" tone="secondary">
                {formatDuration(item.durationSeconds)}
              </Text>
              <Text variant="small" tone="muted">
                Completed {item.exercisesCompleted}/{item.exercisesTotal} exercises
              </Text>
            </View>
          </Card>
        )}
      />
    </Screen>
  );
}

function groupByDay(entries: SessionSummary[]): { title: string; data: SessionSummary[] }[] {
  const sections = new Map<string, SessionSummary[]>();

  for (const entry of entries) {
    const title = new Date(entry.completedAt).toLocaleDateString(undefined, {
      month: 'long',
      day: 'numeric',
    });
    const existing = sections.get(title);
    if (existing) existing.push(entry);
    else sections.set(title, [entry]);
  }

  return [...sections.entries()].map(([title, data]) => ({ title, data }));
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl, paddingBottom: spacing.md },
  list: { padding: spacing.lg, gap: spacing.md },
  sectionHeader: { marginTop: spacing.md, marginBottom: spacing.xs },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});
