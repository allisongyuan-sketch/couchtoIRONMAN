import { useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card, Screen, Text, colors, radius, spacing } from '@/ui';
import { useDraftStore } from '@/state/draftStore';
import {
  addExercise,
  deleteExercise,
  moveExercise,
  setBlockRestBetweenRounds,
  setBlockRounds,
  setDurationSeconds,
  setName,
  setReps,
  setRepsPerSide,
  setRestSeconds,
  setSets,
  setTitle,
} from '@/core/editing/operations';
import type { Workout, WorkoutBlock, WorkoutExercise } from '@/core/schema/workout';

/**
 * The workout editor (PRD §7).
 *
 * AI extraction will never be perfect, so correction is a primary path. Every change
 * here goes through a pure operation in core/editing, which records the edit as the
 * user's and preserves whatever creator value it replaced.
 */
export default function EditWorkoutScreen() {
  const router = useRouter();
  const workout = useDraftStore((state) => state.workout);
  const apply = useDraftStore((state) => state.apply);
  const save = useDraftStore((state) => state.save);

  if (!workout) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Text variant="body" tone="secondary">
            Nothing to edit.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      scroll
      footer={
        <Button
          label="Done"
          size="large"
          onPress={() => {
            void save();
            router.back();
          }}
        />
      }
    >
      <View style={styles.header}>
        <Text variant="label" tone="secondary" uppercase>
          Workout title
        </Text>
        <TextInput
          value={workout.title}
          onChangeText={(value) => apply((current) => setTitle(current, value), 'title')}
          style={styles.titleInput}
          accessibilityLabel="Workout title"
          placeholderTextColor={colors.textMuted}
        />
      </View>

      {[...workout.blocks]
        .sort((a, b) => a.order - b.order)
        .map((block) => (
          <BlockEditor key={block.id} workout={workout} block={block} apply={apply} />
        ))}
    </Screen>
  );
}

function BlockEditor({
  workout,
  block,
  apply,
}: {
  workout: Workout;
  block: WorkoutBlock;
  apply: (operation: (workout: Workout) => Workout, field?: string) => void;
}) {
  const [newExerciseName, setNewExerciseName] = useState('');
  const isCircuitLike = block.kind !== 'straight_sets';

  return (
    <View style={styles.block}>
      {isCircuitLike ? (
        <Card>
          <Text variant="label" tone="accent" uppercase>
            Block settings
          </Text>
          <NumberField
            label="Rounds"
            value={block.rounds?.value ?? null}
            onChange={(value) => apply((current) => setBlockRounds(current, block.id, value), 'rounds')}
          />
          <NumberField
            label="Rest after round (sec)"
            value={block.restBetweenRoundsSeconds?.value ?? null}
            onChange={(value) =>
              apply(
                (current) => setBlockRestBetweenRounds(current, block.id, value),
                'restBetweenRounds',
              )
            }
          />
        </Card>
      ) : null}

      {[...block.exercises]
        .sort((a, b) => a.order - b.order)
        .map((exercise, index) => (
          <ExerciseEditor
            key={exercise.id}
            exercise={exercise}
            index={index}
            total={block.exercises.length}
            showSets={!isCircuitLike}
            apply={apply}
          />
        ))}

      <Card>
        <Text variant="label" tone="secondary" uppercase>
          Add exercise
        </Text>
        <TextInput
          value={newExerciseName}
          onChangeText={setNewExerciseName}
          placeholder="Exercise name"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          accessibilityLabel="New exercise name"
        />
        <Button
          label="Add"
          variant="secondary"
          disabled={newExerciseName.trim().length === 0}
          onPress={() => {
            apply((current) => addExercise(current, block.id, newExerciseName).workout, 'addExercise');
            setNewExerciseName('');
          }}
        />
      </Card>

      <Text variant="small" tone="muted">
        Workout has {block.exercises.length}{' '}
        {block.exercises.length === 1 ? 'exercise' : 'exercises'}.
      </Text>
    </View>
  );
}

type PrescriptionMode = 'reps' | 'repsPerSide' | 'duration';

function ExerciseEditor({
  exercise,
  index,
  total,
  showSets,
  apply,
}: {
  exercise: WorkoutExercise;
  index: number;
  total: number;
  showSets: boolean;
  apply: (operation: (workout: Workout) => Workout, field?: string) => void;
}) {
  const initialMode: PrescriptionMode =
    exercise.repsPerSide?.value != null
      ? 'repsPerSide'
      : exercise.durationSeconds?.value != null
        ? 'duration'
        : 'reps';
  const [mode, setMode] = useState<PrescriptionMode>(initialMode);

  function confirmDelete() {
    Alert.alert('Remove exercise?', exercise.name.value ?? 'This exercise', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => apply((current) => deleteExercise(current, exercise.id), 'deleteExercise'),
      },
    ]);
  }

  return (
    <Card>
      <View style={styles.exerciseHeader}>
        <Text variant="label" tone="muted" uppercase>
          Exercise {index + 1}
        </Text>
        <View style={styles.reorder}>
          <IconButton
            name="arrow-up"
            label="Move up"
            disabled={index === 0}
            onPress={() => apply((current) => moveExercise(current, exercise.id, 'up'), 'reorder')}
          />
          <IconButton
            name="arrow-down"
            label="Move down"
            disabled={index === total - 1}
            onPress={() => apply((current) => moveExercise(current, exercise.id, 'down'), 'reorder')}
          />
          <IconButton name="trash-outline" label="Remove exercise" onPress={confirmDelete} danger />
        </View>
      </View>

      <TextInput
        value={exercise.name.value ?? ''}
        onChangeText={(value) => apply((current) => setName(current, exercise.id, value), 'name')}
        style={styles.input}
        accessibilityLabel="Exercise name"
        placeholder="Exercise name"
        placeholderTextColor={colors.textMuted}
      />

      {showSets ? (
        <NumberField
          label="Sets"
          value={exercise.sets?.value ?? null}
          onChange={(value) => apply((current) => setSets(current, exercise.id, value), 'sets')}
        />
      ) : null}

      <View style={styles.modeRow}>
        {(['reps', 'repsPerSide', 'duration'] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: mode === option }}
            onPress={() => setMode(option)}
            style={[styles.modeChip, mode === option ? styles.modeChipActive : null]}
          >
            <Text variant="label" tone={mode === option ? 'accent' : 'muted'} uppercase>
              {MODE_LABELS[option]}
            </Text>
          </Pressable>
        ))}
      </View>

      {mode === 'reps' ? (
        <NumberField
          label="Reps"
          value={exercise.reps?.value ?? null}
          onChange={(value) => apply((current) => setReps(current, exercise.id, value), 'reps')}
        />
      ) : null}
      {mode === 'repsPerSide' ? (
        <NumberField
          label="Reps per side"
          value={exercise.repsPerSide?.value ?? null}
          onChange={(value) =>
            apply((current) => setRepsPerSide(current, exercise.id, value), 'repsPerSide')
          }
        />
      ) : null}
      {mode === 'duration' ? (
        <NumberField
          label="Duration (sec)"
          value={exercise.durationSeconds?.value ?? null}
          onChange={(value) =>
            apply((current) => setDurationSeconds(current, exercise.id, value), 'durationSeconds')
          }
        />
      ) : null}

      <NumberField
        label="Rest after (sec)"
        value={exercise.restSeconds?.value ?? null}
        onChange={(value) =>
          apply((current) => setRestSeconds(current, exercise.id, value), 'restSeconds')
        }
      />

      {exercise.formCues.length > 0 ? (
        <Text variant="small" tone="muted">
          Creator cues are kept as the creator gave them and can’t be edited here.
        </Text>
      ) : null}
    </Card>
  );
}

const MODE_LABELS: Record<PrescriptionMode, string> = {
  reps: 'Reps',
  repsPerSide: 'Per side',
  duration: 'Time',
};

/**
 * An empty input clears the field back to "Not specified" rather than writing zero —
 * blank means the value is unknown, and zero would be a claim.
 */
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));

  return (
    <View style={styles.field}>
      <Text variant="small" tone="secondary" style={styles.fieldLabel}>
        {label}
      </Text>
      <TextInput
        value={text}
        onChangeText={(next) => {
          const digits = next.replace(/[^0-9]/g, '');
          setText(digits);
          onChange(digits === '' ? null : Number(digits));
        }}
        keyboardType="number-pad"
        placeholder="Not specified"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={label}
        style={[styles.input, styles.numberInput]}
      />
    </View>
  );
}

function IconButton({
  name,
  label,
  onPress,
  disabled,
  danger,
}: {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={disabled ? undefined : onPress}
      style={[styles.iconButton, disabled ? styles.iconDisabled : null]}
      hitSlop={8}
    >
      <Ionicons name={name} size={18} color={danger ? colors.danger : colors.textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: spacing.xl, paddingBottom: spacing.lg, gap: spacing.sm },
  titleInput: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
    minHeight: 56,
  },
  block: { gap: spacing.md, marginBottom: spacing.xl },
  exerciseHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  reorder: { flexDirection: 'row', gap: spacing.xs },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
  },
  iconDisabled: { opacity: 0.3 },
  input: {
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
  numberInput: { flex: 1, textAlign: 'right' },
  field: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  fieldLabel: { flex: 1 },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  modeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 36,
    justifyContent: 'center',
  },
  modeChipActive: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
  empty: { flex: 1, justifyContent: 'center' },
});
