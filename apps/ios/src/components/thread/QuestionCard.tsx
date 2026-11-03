import {
  answerWords,
  choose,
  newDraft,
  OTHER_MAX,
  type Answer,
  type Draft,
  type Question,
  type ThreadQuestion,
} from '@omni/shared/question.ts';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '../../ui/Text';

import {
  advance,
  ASKING,
  ASKING_LABEL,
  elsewhereLabel,
  goBack,
  phaseAfter,
  SENDING,
  STATE_LABEL,
  submitAnswers,
  type Phase,
  type Settled,
} from '../../questions/card-state';
import { fontSize, lineHeight, minTarget, radius, space, useOmniTheme, weight } from '../../theme';
import { Button } from '../../ui/Button';

export type SendAnswers = (questionId: string, answers: Answer[]) => Promise<{ state: ThreadQuestion['state'] }>;

/** A question the agent asked: the choices while it waits on Ben, then what Ben said. */
export function QuestionCard({ q, send }: { q: ThreadQuestion; send: SendAnswers }) {
  const [draft, setDraft] = useState<Draft>(() => newDraft(q.questions));
  const [phase, setPhase] = useState<Phase>(ASKING);

  if (q.state !== 'pending')
    return <Summary questions={q.questions} settled={{ state: q.state, answers: q.answers }} />;
  if (phase.kind === 'sent') return <Summary questions={q.questions} settled={phase.settled} />;
  if (phase.kind === 'elsewhere') return <Elsewhere label={elsewhereLabel(phase.state)} />;

  const { busy, error } = phase;
  const question = q.questions[draft.page];
  const pick = draft.picks[draft.page];
  if (!question || !pick) return null;

  const go = async (skip: boolean) => {
    const step = advance(draft, skip);
    if (step.kind === 'blocked') return;
    if (step.kind === 'page') {
      setDraft(step.draft);
      return;
    }
    setDraft(step.draft);
    setPhase(SENDING);
    setPhase(phaseAfter(await submitAnswers((answers) => send(q.id, answers), step.answers)));
  };

  const last = draft.page === q.questions.length - 1;
  const answered = pick.selected.length > 0 || (pick.otherOn && pick.other.trim().length > 0);

  return (
    <Frame>
      <Pill>{ASKING_LABEL}</Pill>
      {q.questions.length > 1 ? (
        <Text style={styles.step}>{`Question ${draft.page + 1} of ${q.questions.length}`}</Text>
      ) : null}
      <Prompt question={question} />
      <View style={styles.options} accessibilityRole={question.multiSelect ? undefined : 'radiogroup'}>
        {question.options.map((o) => (
          <OptionRow
            key={o.label}
            label={o.label}
            description={o.description}
            multi={question.multiSelect}
            on={pick.selected.includes(o.label)}
            disabled={busy}
            onPress={() => setDraft(withPick(draft, choose(question, pick, o.label)))}
          />
        ))}
        <OptionRow
          label="Other"
          description={null}
          multi={question.multiSelect}
          on={pick.otherOn}
          disabled={busy}
          onPress={() => setDraft(withPick(draft, choose(question, pick, null)))}
        />
        {pick.otherOn ? (
          <OtherInput
            value={pick.other}
            disabled={busy}
            onChange={(other) => setDraft(withPick(draft, { ...pick, other }))}
          />
        ) : null}
      </View>
      {error ? <ErrorNote message={`Not sent. ${error}`} /> : null}
      <View style={styles.actions}>
        {draft.page > 0 ? (
          <Button label="Back" variant="secondary" disabled={busy} onPress={() => setDraft(goBack(draft))} />
        ) : null}
        <Button label="Skip" variant="secondary" disabled={busy} onPress={() => void go(true)} />
        <Button label={last ? 'Send' : 'Next'} busy={busy} disabled={!answered} onPress={() => void go(false)} />
      </View>
    </Frame>
  );
}

const withPick = (draft: Draft, pick: Draft['picks'][number]): Draft => ({
  ...draft,
  picks: draft.picks.map((p, i) => (i === draft.page ? pick : p)),
});

function Frame({ children }: { children: ReactNode }) {
  const { colors } = useOmniTheme();
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>{children}</View>;
}

function Pill({ children }: { children: string }) {
  const { colors } = useOmniTheme();
  return (
    <View style={[styles.pill, { backgroundColor: colors.surface3 }]}>
      <Text style={[styles.pillText, { color: colors.fg2 }]}>{children}</Text>
    </View>
  );
}

function Prompt({ question }: { question: Question }) {
  const { colors } = useOmniTheme();
  return (
    <View style={styles.prompt}>
      {question.header ? <Text style={[styles.header, { color: colors.fg3 }]}>{question.header}</Text> : null}
      <Text selectable style={[styles.question, { color: colors.fg }]}>
        {question.question}
      </Text>
      {question.multiSelect ? <Text style={[styles.header, { color: colors.fg3 }]}>Pick any that apply</Text> : null}
    </View>
  );
}

function OptionRow({
  label,
  description,
  multi,
  on,
  disabled,
  onPress,
}: {
  label: string;
  description: string | null;
  multi: boolean;
  on: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useOmniTheme();
  return (
    <Pressable
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: on, disabled }}
      accessibilityLabel={description ? `${label}. ${description}` : label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.option,
        {
          borderColor: on ? colors.fg : colors.line,
          backgroundColor: on ? colors.surface2 : 'transparent',
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <View
        style={[
          styles.mark,
          multi ? styles.square : styles.round,
          {
            borderColor: on ? colors.fg : colors.lineStrong,
            backgroundColor: on ? colors.fg : 'transparent',
          },
        ]}
      >
        {on ? <Text style={[styles.tick, { color: colors.onInk }]}>{multi ? '✓' : '•'}</Text> : null}
      </View>
      <View style={styles.optionText}>
        <Text style={[styles.optionLabel, { color: colors.fg }]}>{label}</Text>
        {description ? <Text style={[styles.optionDescription, { color: colors.fg3 }]}>{description}</Text> : null}
      </View>
    </Pressable>
  );
}

function OtherInput({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const { colors } = useOmniTheme();
  return (
    <TextInput
      accessibilityLabel="Your answer"
      value={value}
      onChangeText={onChange}
      editable={!disabled}
      multiline
      autoFocus
      maxLength={OTHER_MAX}
      placeholder="Type your answer"
      placeholderTextColor={colors.fg4}
      style={[
        styles.input,
        {
          color: colors.fg,
          borderColor: colors.lineStrong,
          backgroundColor: colors.surface2,
        },
      ]}
    />
  );
}

export function ErrorNote({ message }: { message: string }) {
  const { colors } = useOmniTheme();
  return (
    <Text accessibilityRole="alert" style={[styles.error, { color: colors.fg }]}>
      {message}
    </Text>
  );
}

function Elsewhere({ label }: { label: string }) {
  const { colors } = useOmniTheme();
  return (
    <Frame>
      <Pill>{label}</Pill>
      <Text style={[styles.optionDescription, { color: colors.fg3 }]}>
        This was settled before your answer arrived. Nothing more to do here.
      </Text>
    </Frame>
  );
}

function Summary({ questions, settled }: { questions: Question[]; settled: Settled }) {
  const { colors } = useOmniTheme();
  return (
    <Frame>
      <Pill>{STATE_LABEL[settled.state]}</Pill>
      {questions.map((question, i) => (
        <View key={question.question} style={styles.prompt}>
          <Text style={[styles.header, { color: colors.fg3 }]}>{question.header ?? question.question}</Text>
          {question.header ? (
            <Text selectable style={[styles.optionDescription, { color: colors.fg3 }]}>
              {question.question}
            </Text>
          ) : null}
          <Text selectable style={[styles.optionLabel, { color: colors.fg }]}>
            {settled.state === 'answered' ? answerWords(settled.answers?.[i] ?? null) : '—'}
          </Text>
        </View>
      ))}
    </Frame>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: space.s8,
    gap: space.s6,
  },
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: space.s6,
    paddingVertical: space.s2,
  },
  pillText: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
  },
  step: {
    fontSize: fontSize.meta,
  },
  prompt: {
    gap: space.s2,
  },
  header: {
    fontSize: fontSize.meta,
  },
  question: {
    fontSize: fontSize.input,
    fontWeight: weight.semibold,
    lineHeight: Math.round(fontSize.input * lineHeight.body),
  },
  options: {
    gap: space.s4,
  },
  option: {
    minHeight: minTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.s6,
    paddingVertical: space.s4,
  },
  mark: {
    width: 22,
    height: 22,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  round: {
    borderRadius: 11,
  },
  square: {
    borderRadius: 6,
  },
  tick: {
    fontSize: fontSize.meta,
    fontWeight: weight.bold,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    fontSize: fontSize.body,
    fontWeight: weight.semibold,
  },
  optionDescription: {
    fontSize: fontSize.meta,
    lineHeight: Math.round(fontSize.meta * lineHeight.body),
  },
  input: {
    minHeight: minTarget * 1.5,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.s6,
    fontSize: fontSize.input,
    textAlignVertical: 'top',
  },
  error: {
    fontSize: fontSize.meta,
    fontWeight: weight.semibold,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: space.s4,
  },
});
