import { getFirstCycleGoalTransferSummary } from '../lib/firstCycleOnboardingUtils';

describe('first cycle onboarding helpers', () => {
  test('explains that a cycle can start before goals exist', () => {
    expect(getFirstCycleGoalTransferSummary(0)).toEqual({
      goalCount: 0,
      title: 'No active goals are waiting yet',
      description:
        'You can start the cycle now and add goals afterward. New goals will be stored inside this cycle automatically.',
    });
  });

  test('uses singular copy for one waiting goal', () => {
    expect(getFirstCycleGoalTransferSummary(1)).toEqual({
      goalCount: 1,
      title: '1 active goal is ready to come with you',
      description:
        'Starting your first cycle will move this existing active goal into the new cycle folder automatically.',
    });
  });

  test('uses plural copy for multiple waiting goals', () => {
    expect(getFirstCycleGoalTransferSummary(4)).toEqual({
      goalCount: 4,
      title: '4 active goals are ready to come with you',
      description:
        'Starting your first cycle will move these existing active goals into the new cycle folder automatically.',
    });
  });

  test('normalizes invalid counts instead of showing impossible values', () => {
    expect(getFirstCycleGoalTransferSummary(-3).goalCount).toBe(0);
    expect(getFirstCycleGoalTransferSummary(Number.NaN).goalCount).toBe(0);
    expect(getFirstCycleGoalTransferSummary(2.9).goalCount).toBe(2);
  });
});
