import {
  MAX_GOAL_REWARD_LENGTH,
  normalizeGoalReward,
} from '../lib/goalRewardUtils';

describe('goal reward utilities', () => {
  test('normalizes optional rewards', () => {
    expect(normalizeGoalReward(undefined)).toBeNull();
    expect(normalizeGoalReward('   ')).toBeNull();
    expect(normalizeGoalReward('  Buy a new game  ')).toBe(
      'Buy a new game'
    );
  });

  test('allows rewards up to the maximum length', () => {
    const reward = 'x'.repeat(MAX_GOAL_REWARD_LENGTH);

    expect(normalizeGoalReward(reward)).toBe(reward);
  });

  test('rejects rewards longer than the maximum length', () => {
    expect(() =>
      normalizeGoalReward('x'.repeat(MAX_GOAL_REWARD_LENGTH + 1))
    ).toThrow('under 200 characters');
  });
});
