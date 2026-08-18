import { buildCompletionCelebration } from '../lib/celebrationUtils';

describe('completion celebration helpers', () => {
  test('keeps task feedback compact and includes the task title', () => {
    expect(buildCompletionCelebration('task', '  Finish   lab notes  ')).toEqual({
      kind: 'task',
      symbol: '✓',
      eyebrow: null,
      title: 'Done',
      detail: 'Finish lab notes',
      durationMs: 1300,
      emphasis: 'compact',
    });
  });

  test('uses stronger feedback for a completed goal', () => {
    expect(buildCompletionCelebration('goal', 'Ship WeekFlow')).toMatchObject({
      kind: 'goal',
      eyebrow: 'GOAL COMPLETE',
      detail: 'Ship WeekFlow',
      emphasis: 'standard',
    });
  });

  test('uses the strongest feedback for a finalized cycle', () => {
    expect(buildCompletionCelebration('cycle', 'Fall Build')).toMatchObject({
      kind: 'cycle',
      eyebrow: '12 WEEKS COMPLETE',
      detail: 'Fall Build is officially in the books.',
      emphasis: 'strong',
    });
  });

  test('drops empty subjects and safely shortens very long labels', () => {
    expect(buildCompletionCelebration('task', '   ').detail).toBeNull();

    const detail = buildCompletionCelebration('goal', 'x'.repeat(120)).detail;
    expect(detail?.endsWith('…')).toBe(true);
    expect(detail?.length).toBe(80);
  });
});
