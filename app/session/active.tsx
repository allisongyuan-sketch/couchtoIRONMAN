import { useEffect, useRef } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, ProgressBar, Screen, Text, colors, spacing } from '@/ui';
import { openOriginal, findDemonstration } from '@/ui/openOriginal';
import { useTicker } from '@/ui/useTicker';
import { useKeepScreenAwake } from '@/ui/useKeepScreenAwake';
import { stepCompleteFeedback, timerFinishedFeedback } from '@/ui/haptics';
import { useSessionStore } from '@/state/sessionStore';
import { remainingSeconds, roundLabel, setLabel } from '@/core/engine/selectors';
import { formatClock, formatDuration } from '@/core/schema/workout';
import type { ExerciseSetStep, RestStep } from '@/core/schema/session';

/**
 * The interactive workout player (PRD §12, §13, §14) and the rest timer (PRD §12).
 *
 * Both live on one screen because the engine models them as two kinds of step. The
 * screen renders whatever the current step is; it contains no logic about what comes
 * next, how many rounds remain, or when the workout is over. That all lives in the
 * pure engine, which is why it is testable.
 *
 * Layout priorities are the PRD's: timer-forward, large controls, usable with sweaty
 * hands and limited attention.
 */
export default function ActiveWorkoutScreen() {
  const router = useRouter();
  useKeepScreenAwake();

  const workout = useSessionStore((state) => state.workout);
  const plan = useSessionStore((state) => state.plan);
  const session = useSessionStore((state) => state.session);
  const dispatch = useSessionStore((state) => state.dispatch);
  const tick = useSessionStore((state) => state.tick);
  const progress = useSessionStore((state) => state.progress());
  const step = useSessionStore((state) => state.currentStep());

  const timerRunning = session?.timer?.mode === 'running';
  const now = useTicker(timerRunning);
  const lastStepId = useRef<string | null>(null);

  // Rest begins the moment you arrive; timed work waits for START (PRD §12 vs §13).
  useEffect(() => {
    if (step?.kind === 'rest' && session?.timer?.mode === 'idle') {
      dispatch({ type: 'START_TIMER', now: Date.now() });
    }
    if (step && step.id !== lastStepId.current) {
      lastStepId.current = step.id;
    }
  }, [step, session?.timer?.mode, dispatch]);

  useEffect(() => {
    if (!timerRunning) return;
    tick(now);
  }, [now, timerRunning, tick]);

  useEffect(() => {
    if (session?.status === 'completed') {
      router.replace('/session/complete');
    }
  }, [session?.status, router]);

  if (!workout || !plan || !session || !step) {
    return (
      <Screen>
        <View style={styles.empty}>
          <Text variant="body" tone="secondary">
            No workout in progress.
          </Text>
          <Button label="Back to Home" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  function quit() {
    Alert.alert('End this workout?', 'Your progress so far will be saved to history.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'End workout',
        style: 'destructive',
        onPress: () => {
          useSessionStore.getState().abandon();
          router.replace('/');
        },
      },
    ]);
  }

  const secondsLeft = remainingSeconds(session, now);

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <Button label="End" variant="ghost" onPress={quit} />
        <Text variant="small" tone="muted">
          {workout.title}
        </Text>
      </View>
      <ProgressBar value={progress} tone={step.kind === 'rest' ? 'rest' : 'accent'} />

      {step.kind === 'rest' ? (
        <RestView
          step={step}
          secondsLeft={secondsLeft}
          paused={session.timer?.mode === 'paused'}
          onSkip={() => {
            stepCompleteFeedback();
            dispatch({ type: 'SKIP_STEP', now: Date.now() });
          }}
          onAddTime={() => dispatch({ type: 'ADD_TIME', seconds: 30, now: Date.now() })}
          onTogglePause={() =>
            dispatch({
              type: session.timer?.mode === 'paused' ? 'RESUME' : 'PAUSE',
              now: Date.now(),
            })
          }
        />
      ) : (
        <ExerciseView
          step={step}
          secondsLeft={secondsLeft}
          timerMode={session.timer?.mode ?? null}
          sourceUrl={workout.source.url}
          onComplete={() => {
            stepCompleteFeedback();
            dispatch({ type: 'COMPLETE_STEP', now: Date.now() });
          }}
          onStartTimer={() => dispatch({ type: 'START_TIMER', now: Date.now() })}
          onTogglePause={() =>
            dispatch({
              type: session.timer?.mode === 'paused' ? 'RESUME' : 'PAUSE',
              now: Date.now(),
            })
          }
          onAddTime={() => dispatch({ type: 'ADD_TIME', seconds: 15, now: Date.now() })}
          onSkip={() => dispatch({ type: 'SKIP_STEP', now: Date.now() })}
          onPrevious={
            session.currentStepIndex > 0
              ? () => dispatch({ type: 'PREVIOUS', now: Date.now() })
              : undefined
          }
        />
      )}
    </Screen>
  );
}

function ExerciseView({
  step,
  secondsLeft,
  timerMode,
  sourceUrl,
  onComplete,
  onStartTimer,
  onTogglePause,
  onAddTime,
  onSkip,
  onPrevious,
}: {
  step: ExerciseSetStep;
  secondsLeft: number;
  timerMode: 'idle' | 'running' | 'paused' | null;
  sourceUrl?: string;
  onComplete: () => void;
  onStartTimer: () => void;
  onTogglePause: () => void;
  onAddTime: () => void;
  onSkip: () => void;
  onPrevious?: () => void;
}) {
  const isTimed = step.durationSeconds !== null;
  const round = roundLabel(step);
  const set = setLabel(step);

  useEffect(() => {
    if (isTimed && timerMode === 'running' && secondsLeft === 0) timerFinishedFeedback();
  }, [isTimed, timerMode, secondsLeft]);

  return (
    <View style={styles.body}>
      <View style={styles.main}>
        <View style={styles.labels}>
          {round ? (
            <Text variant="label" tone="accent" uppercase>
              {round}
            </Text>
          ) : null}
          {set ? (
            <Text variant="label" tone="secondary" uppercase>
              {set}
            </Text>
          ) : null}
        </View>

        <Text variant="display" style={styles.exerciseName}>
          {step.exerciseName}
        </Text>

        {isTimed ? (
          <Text variant="timer" tone={timerMode === 'paused' ? 'muted' : 'default'}>
            {formatClock(secondsLeft)}
          </Text>
        ) : (
          <Text variant="title" tone="secondary">
            {prescriptionLine(step)}
          </Text>
        )}

        {step.formCues.map((cue, index) => (
          <View key={index} style={styles.cue}>
            <Text variant="label" tone="accent" uppercase>
              Creator cue
            </Text>
            <Text variant="body" tone="secondary" style={styles.cueText}>
              “{cue}”
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.controls}>
        {isTimed ? (
          <>
            {timerMode === 'idle' ? (
              <Button testID="player-start-timer" label="Start" size="large" onPress={onStartTimer} />
            ) : (
              <Button
                label={timerMode === 'paused' ? 'Resume' : 'Pause'}
                size="large"
                variant={timerMode === 'paused' ? 'primary' : 'secondary'}
                onPress={onTogglePause}
              />
            )}
            <View style={styles.row}>
              <Button label="+15 sec" variant="secondary" style={styles.flex} onPress={onAddTime} />
              <Button
                testID="player-skip"
                label="Skip"
                variant="secondary"
                style={styles.flex}
                onPress={onSkip}
              />
            </View>
          </>
        ) : (
          <Button
            testID="player-complete-set"
            label="Complete set"
            size="large"
            onPress={onComplete}
            accessibilityHint="Marks this set done and moves to the next step"
          />
        )}

        <View style={styles.row}>
          {onPrevious ? (
            <Button label="Previous" variant="ghost" style={styles.flex} onPress={onPrevious} />
          ) : null}
          <Button
            label="View Demo"
            variant="ghost"
            style={styles.flex}
            onPress={() => void findDemonstration(step.exerciseName)}
            accessibilityHint="Opens an external search. Not from the original creator."
          />
          {sourceUrl ? (
            <Button
              label="View Original"
              variant="ghost"
              style={styles.flex}
              onPress={() => void openOriginal(sourceUrl)}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function RestView({
  step,
  secondsLeft,
  paused,
  onSkip,
  onAddTime,
  onTogglePause,
}: {
  step: RestStep;
  secondsLeft: number;
  paused: boolean;
  onSkip: () => void;
  onAddTime: () => void;
  onTogglePause: () => void;
}) {
  useEffect(() => {
    if (secondsLeft === 0 && !paused) timerFinishedFeedback();
  }, [secondsLeft, paused]);

  return (
    <View style={[styles.body, styles.restBody]}>
      <View style={styles.main}>
        <Text variant="label" tone="rest" uppercase>
          Rest
        </Text>
        <Text variant="timer" tone={paused ? 'muted' : 'rest'}>
          {formatClock(secondsLeft)}
        </Text>
        <Text variant="body" tone="secondary">
          {step.reason === 'between_rounds'
            ? `After round ${step.roundNumber} of ${step.totalRounds}`
            : `Prescribed rest: ${formatDuration(step.durationSeconds)}`}
        </Text>
      </View>

      <View style={styles.controls}>
        <Button testID="player-skip-rest" label="Skip rest" size="large" onPress={onSkip} />
        <View style={styles.row}>
          <Button label="+30 sec" variant="secondary" style={styles.flex} onPress={onAddTime} />
          <Button
            label={paused ? 'Resume' : 'Pause'}
            variant="secondary"
            style={styles.flex}
            onPress={onTogglePause}
          />
        </View>
      </View>
    </View>
  );
}

/** "10 reps / side", "12 reps", or an honest "Reps: Not specified". */
function prescriptionLine(step: ExerciseSetStep): string {
  if (step.repsPerSide !== null) return `${step.repsPerSide} reps / side`;
  if (step.reps !== null) return `${step.reps} reps`;
  return 'Reps: Not specified';
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: spacing.sm,
  },
  body: { flex: 1, justifyContent: 'space-between', paddingTop: spacing.xl },
  restBody: { backgroundColor: 'transparent' },
  main: { flex: 1, justifyContent: 'center', gap: spacing.md },
  labels: { flexDirection: 'row', gap: spacing.md },
  exerciseName: { lineHeight: 46 },
  cue: {
    borderLeftWidth: 3,
    borderLeftColor: colors.accent,
    paddingLeft: spacing.md,
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  cueText: { fontStyle: 'italic' },
  controls: { gap: spacing.sm, paddingBottom: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  empty: { flex: 1, justifyContent: 'center', gap: spacing.lg },
});
