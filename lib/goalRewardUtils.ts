export const MAX_GOAL_REWARD_LENGTH = 200;

/**
 * Goal rewards are optional. Empty or whitespace-only values are stored as
 * null so the rest of the app never has to distinguish between several forms
 * of "no reward".
 */
export function normalizeGoalReward(
  reward: string | null | undefined
): string | null {
  const trimmedReward = reward?.trim() ?? '';

  if (!trimmedReward) {
    return null;
  }

  if (trimmedReward.length > MAX_GOAL_REWARD_LENGTH) {
    throw new Error(
      `Keep the goal reward under ${MAX_GOAL_REWARD_LENGTH} characters.`
    );
  }

  return trimmedReward;
}
