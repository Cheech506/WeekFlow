export type FirstCycleGoalTransferSummary = {
  goalCount: number;
  title: string;
  description: string;
};

/**
 * Builds the first-cycle goal-transfer message shown before a cycle exists.
 * The count is normalized so partially loaded or invalid UI values can never
 * produce negative goal counts in the onboarding copy.
 */
export function getFirstCycleGoalTransferSummary(
  activeGoalCount: number
): FirstCycleGoalTransferSummary {
  const normalizedCount = Number.isFinite(activeGoalCount)
    ? Math.max(0, Math.floor(activeGoalCount))
    : 0;

  if (normalizedCount === 0) {
    return {
      goalCount: 0,
      title: 'No active goals are waiting yet',
      description:
        'You can start the cycle now and add goals afterward. New goals will be stored inside this cycle automatically.',
    };
  }

  if (normalizedCount === 1) {
    return {
      goalCount: 1,
      title: '1 active goal is ready to come with you',
      description:
        'Starting your first cycle will move this existing active goal into the new cycle folder automatically.',
    };
  }

  return {
    goalCount: normalizedCount,
    title: `${normalizedCount} active goals are ready to come with you`,
    description:
      'Starting your first cycle will move these existing active goals into the new cycle folder automatically.',
  };
}
