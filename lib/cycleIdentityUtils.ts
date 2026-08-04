export const MAX_CYCLE_NAME_LENGTH = 80;
export const MAX_CYCLE_PRIMARY_FOCUS_LENGTH = 300;
export const MAX_CYCLE_THEME_LENGTH = 120;

export type PlanningCycleDetails = {
  name?: string | null;
  primaryFocus?: string | null;
  theme?: string | null;
};

function normalizeOptionalCycleText(
  value: string | null | undefined,
  maxLength: number,
  label: string
) {
  const normalized = value?.trim() ?? '';

  if (!normalized) return null;

  if (normalized.length > maxLength) {
    throw new Error(`${label} must be ${maxLength} characters or fewer.`);
  }

  return normalized;
}

export function normalizeCycleName(value?: string | null) {
  return normalizeOptionalCycleText(
    value,
    MAX_CYCLE_NAME_LENGTH,
    'Cycle name'
  );
}

export function normalizeCyclePrimaryFocus(value?: string | null) {
  return normalizeOptionalCycleText(
    value,
    MAX_CYCLE_PRIMARY_FOCUS_LENGTH,
    'Primary focus'
  );
}

export function normalizeCycleTheme(value?: string | null) {
  return normalizeOptionalCycleText(
    value,
    MAX_CYCLE_THEME_LENGTH,
    'Cycle theme'
  );
}

export function normalizePlanningCycleDetails(
  details: PlanningCycleDetails = {}
) {
  return {
    name: normalizeCycleName(details.name),
    primaryFocus: normalizeCyclePrimaryFocus(details.primaryFocus),
    theme: normalizeCycleTheme(details.theme),
  };
}

export function getPlanningCycleDisplayName(
  name: string | null,
  fallbackNumber: number
) {
  return name?.trim() || `Cycle ${fallbackNumber}`;
}
