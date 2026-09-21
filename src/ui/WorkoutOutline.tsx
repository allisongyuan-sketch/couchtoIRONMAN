import { StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { Card } from './Card';
import { CreatorCue, FieldBadges, NotSpecifiedBadge } from './ProvenanceBadge';
import { colors, spacing } from './theme';
import {
  blockRounds,
  formatDuration,
  hasNoPrescription,
  type Workout,
  type WorkoutBlock,
  type WorkoutExercise,
} from '@/core/schema/workout';
import { fieldStatus } from '@/core/schema/provenance';

/**
 * The read-only rendering of a structured workout, shared by the review screen and
 * the workout detail screen.
 *
 * Its whole job is to be honest about where each number came from: stated values read
 * plainly, uncertain values are marked Unclear, and missing values say "Not specified"
 * instead of showing a plausible default (PRD §6, §8, §9).
 */
export function WorkoutOutline({ workout }: { workout: Workout }) {
  return (
    <View style={styles.container}>
      {[...workout.blocks]
        .sort((a, b) => a.order - b.order)
        .map((block, index) => (
          <BlockSection key={block.id} block={block} position={index} />
        ))}
    </View>
  );
}

function BlockSection({ block, position }: { block: WorkoutBlock; position: number }) {
  const rounds = blockRounds(block);
  const roundsStated = block.rounds?.value != null;
  const restSeconds = block.restBetweenRoundsSeconds?.value;

  return (
    <View style={styles.block}>
      {rounds > 1 || block.kind !== 'straight_sets' ? (
        <View style={styles.blockHeader}>
          <Text variant="label" tone="accent" uppercase>
            {roundsStated && rounds > 1 ? `${rounds} rounds` : BLOCK_LABELS[block.kind]}
            {block.label ? ` · ${block.label}` : ''}
          </Text>
          {!roundsStated && block.kind !== 'straight_sets' && block.kind !== 'flow' ? (
            <NotSpecifiedBadge label="Rounds: Not specified" />
          ) : null}
        </View>
      ) : null}

      {[...block.exercises]
        .sort((a, b) => a.order - b.order)
        .map((exercise, index) => (
          <ExerciseRow
            key={exercise.id}
            exercise={exercise}
            position={position === 0 ? index + 1 : index + 1}
          />
        ))}

      {restSeconds != null ? (
        <View style={styles.roundRest}>
          <Text variant="small" tone="rest">
            Rest after round: {formatDuration(restSeconds)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function ExerciseRow({
  exercise,
  position,
}: {
  exercise: WorkoutExercise;
  position: number;
}) {
  const missingPrescription = hasNoPrescription(exercise);

  return (
    <Card>
      <Text variant="label" tone="muted" uppercase>
        Exercise {position}
      </Text>

      <View style={styles.nameRow}>
        <Text variant="heading" style={styles.name}>
          {exercise.name.value ?? 'Unnamed movement'}
        </Text>
      </View>
      <FieldBadges field={exercise.name} unclearLabel="Name" />

      <Prescription exercise={exercise} />

      {missingPrescription ? (
        <Text variant="small" tone="warning">
          ⚠️ The creator didn’t specify how many. You can add it.
        </Text>
      ) : null}

      {exercise.formCues.map((cue, index) =>
        cue.value ? <CreatorCue key={`${cue.value}-${index}`} cue={cue.value} /> : null,
      )}
    </Card>
  );
}

function Prescription({ exercise }: { exercise: WorkoutExercise }) {
  const parts: string[] = [];
  const sets = exercise.sets?.value;
  if (sets != null) parts.push(`${sets} ${sets === 1 ? 'set' : 'sets'}`);

  if (exercise.repsPerSide?.value != null) {
    parts.push(`${exercise.repsPerSide.value} reps / side`);
  } else if (exercise.reps?.value != null) {
    parts.push(`${exercise.reps.value} reps`);
  } else if (exercise.durationSeconds?.value != null) {
    parts.push(formatDuration(exercise.durationSeconds.value));
  }

  const unclearField = [exercise.reps, exercise.repsPerSide, exercise.durationSeconds].find(
    (field) => fieldStatus(field) === 'unclear',
  );

  return (
    <View style={styles.prescription}>
      {parts.length > 0 ? (
        <Text variant="body" tone="secondary">
          {parts.join(' × ')}
        </Text>
      ) : (
        <NotSpecifiedBadge label="Reps: Not specified" />
      )}

      {unclearField ? <FieldBadges field={unclearField} unclearLabel="Reps" /> : null}

      {exercise.restSeconds?.value != null ? (
        <Text variant="small" tone="rest">
          Rest {formatDuration(exercise.restSeconds.value)}
        </Text>
      ) : null}

      {exercise.weight?.value ? (
        <Text variant="small" tone="muted">
          Load: {exercise.weight.value}
        </Text>
      ) : null}
    </View>
  );
}

const BLOCK_LABELS: Record<WorkoutBlock['kind'], string> = {
  straight_sets: 'Straight sets',
  circuit: 'Circuit',
  superset: 'Superset',
  interval: 'Intervals',
  amrap: 'AMRAP',
  emom: 'EMOM',
  flow: 'Sequence',
};

const styles = StyleSheet.create({
  container: { gap: spacing.xl },
  block: { gap: spacing.md },
  blockHeader: { gap: spacing.sm },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: { flex: 1 },
  prescription: { gap: spacing.xs },
  roundRest: {
    borderLeftWidth: 3,
    borderLeftColor: colors.rest,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
  },
});
