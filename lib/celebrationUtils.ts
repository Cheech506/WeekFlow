export type CompletionCelebrationKind = 'task' | 'goal' | 'cycle';

export type CompletionCelebrationEmphasis =
  | 'compact'
  | 'standard'
  | 'strong';

export type CompletionCelebrationDescriptor = {
  kind: CompletionCelebrationKind;
  symbol: string;
  eyebrow: string | null;
  title: string;
  detail: string | null;
  durationMs: number;
  emphasis: CompletionCelebrationEmphasis;
};

const MAX_SUBJECT_LENGTH = 80;

function normalizeSubject(subject?: string | null) {
  const normalized = subject?.replace(/\s+/g, ' ').trim() ?? '';

  if (!normalized) return null;
  if (normalized.length <= MAX_SUBJECT_LENGTH) return normalized;

  return `${normalized.slice(0, MAX_SUBJECT_LENGTH - 1).trimEnd()}…`;
}

/**
 * Keeps completion feedback intentionally small and predictable. The UI layer
 * can animate these descriptors, but the meaning and duration of each success
 * state live here so task, goal, and cycle completions cannot drift apart.
 */
export function buildCompletionCelebration(
  kind: CompletionCelebrationKind,
  subject?: string | null
): CompletionCelebrationDescriptor {
  const normalizedSubject = normalizeSubject(subject);

  if (kind === 'task') {
    return {
      kind,
      symbol: '✓',
      eyebrow: null,
      title: 'Done',
      detail: normalizedSubject,
      durationMs: 1300,
      emphasis: 'compact',
    };
  }

  if (kind === 'goal') {
    return {
      kind,
      symbol: '★',
      eyebrow: 'GOAL COMPLETE',
      title: 'Nice work — you finished it.',
      detail: normalizedSubject,
      durationMs: 2300,
      emphasis: 'standard',
    };
  }

  return {
    kind,
    symbol: '✦',
    eyebrow: '12 WEEKS COMPLETE',
    title: 'Cycle finished.',
    detail: normalizedSubject
      ? `${normalizedSubject} is officially in the books.`
      : 'Your completed cycle is officially in the books.',
    durationMs: 3200,
    emphasis: 'strong',
  };
}
