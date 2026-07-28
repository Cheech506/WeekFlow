import { describe, expect, test } from '@jest/globals';

import {
  normalizeGoalNotes,
  normalizeGoalPurpose,
  normalizeGoalSuccessDefinition,
  normalizeMilestoneNotes,
  normalizeMilestoneTargetDate,
  normalizeMilestoneTitle,
} from '../lib/goalPlanningUtils';

describe('goal planning utilities', () => {
  test('trims optional goal planning fields and stores blanks as null', () => {
    expect(normalizeGoalPurpose('  Build confidence  ')).toBe(
      'Build confidence'
    );
    expect(
      normalizeGoalSuccessDefinition('  Publish the portfolio  ')
    ).toBe('Publish the portfolio');
    expect(normalizeGoalNotes('   ')).toBeNull();
  });

  test('rejects goal planning fields that exceed their limits', () => {
    expect(() => normalizeGoalPurpose('x'.repeat(501))).toThrow(
      '500 characters or fewer'
    );
    expect(() => normalizeGoalNotes('x'.repeat(2001))).toThrow(
      '2000 characters or fewer'
    );
  });

  test('normalizes milestone fields', () => {
    expect(normalizeMilestoneTitle('  Finish lab  ')).toBe(
      'Finish lab'
    );
    expect(normalizeMilestoneNotes('  Add screenshots  ')).toBe(
      'Add screenshots'
    );
    expect(normalizeMilestoneTargetDate('2026-08-01')).toBe(
      '2026-08-01'
    );
    expect(normalizeMilestoneTargetDate('   ')).toBeNull();
  });

  test('rejects empty titles and invalid milestone dates', () => {
    expect(() => normalizeMilestoneTitle('   ')).toThrow(
      'Enter a milestone title first'
    );
    expect(() => normalizeMilestoneTargetDate('08/01/2026')).toThrow(
      'YYYY-MM-DD'
    );
  });
});
