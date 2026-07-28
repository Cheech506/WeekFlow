import { parseLocalDateKey } from './dateUtils';

export const MAX_GOAL_PURPOSE_LENGTH = 500;
export const MAX_GOAL_SUCCESS_DEFINITION_LENGTH = 500;
export const MAX_GOAL_NOTES_LENGTH = 2000;
export const MAX_MILESTONE_TITLE_LENGTH = 160;
export const MAX_MILESTONE_NOTES_LENGTH = 500;

function normalizeOptionalText(
  value: string | null | undefined,
  maxLength: number,
  label: string
) {
  const normalized = value?.trim() ?? '';

  if (!normalized) {
    return null;
  }

  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

export function normalizeGoalPurpose(value?: string | null) {
  return normalizeOptionalText(
    value,
    MAX_GOAL_PURPOSE_LENGTH,
    'Goal purpose'
  );
}

export function normalizeGoalSuccessDefinition(value?: string | null) {
  return normalizeOptionalText(
    value,
    MAX_GOAL_SUCCESS_DEFINITION_LENGTH,
    'Success definition'
  );
}

export function normalizeGoalNotes(value?: string | null) {
  return normalizeOptionalText(
    value,
    MAX_GOAL_NOTES_LENGTH,
    'Goal notes'
  );
}

export function normalizeMilestoneTitle(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error('Enter a milestone title first.');
  }

  if (normalized.length > MAX_MILESTONE_TITLE_LENGTH) {
    throw new Error(
      `Milestone title must be ${MAX_MILESTONE_TITLE_LENGTH} characters or fewer.`
    );
  }

  return normalized;
}

export function normalizeMilestoneNotes(value?: string | null) {
  return normalizeOptionalText(
    value,
    MAX_MILESTONE_NOTES_LENGTH,
    'Milestone notes'
  );
}

export function normalizeMilestoneTargetDate(value?: string | null) {
  const normalized = value?.trim() ?? '';

  if (!normalized) {
    return null;
  }

  if (!parseLocalDateKey(normalized)) {
    throw new Error('Milestone target date must use YYYY-MM-DD.');
  }

  return normalized;
}
