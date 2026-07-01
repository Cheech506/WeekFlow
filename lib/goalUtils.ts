export const RECOMMENDED_GOAL_MIN_DAYS = 84;
export const RECOMMENDED_GOAL_MAX_DAYS = 91;

export type GoalDateRangeResult = {
  startDateKey: string;
  endDateKey: string;
  startDateIso: string;
  endDateIso: string;
  durationDays: number;
  recommendation: string | null;
};

function padDatePart(value: number) {
  return String(value).padStart(2, '0');
}

export function getGoalDateKey(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return [
    date.getFullYear(),
    padDatePart(date.getMonth() + 1),
    padDatePart(date.getDate()),
  ].join('-');
}

export function parseGoalDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function getRecommendation(durationDays: number) {
  if (
    durationDays >= RECOMMENDED_GOAL_MIN_DAYS &&
    durationDays <= RECOMMENDED_GOAL_MAX_DAYS
  ) {
    return null;
  }

  return 'WeekFlow recommends a goal length of about 12–13 weeks, but this date range is still allowed.';
}

export function validateGoalDateRange(
  startDateKey: string,
  endDateKey: string
): GoalDateRangeResult {
  const startDate = parseGoalDateKey(startDateKey);
  const endDate = parseGoalDateKey(endDateKey);

  if (!startDate || !endDate) {
    throw new Error('Enter both goal dates in YYYY-MM-DD format.');
  }

  const durationDays = Math.round(
    (endDate.getTime() - startDate.getTime()) /
      (24 * 60 * 60 * 1000)
  );

  if (durationDays < 0) {
    throw new Error('The goal end date cannot be before the start date.');
  }

  return {
    startDateKey: getGoalDateKey(startDate),
    endDateKey: getGoalDateKey(endDate),
    startDateIso: startDate.toISOString(),
    endDateIso: endDate.toISOString(),
    durationDays,
    recommendation: getRecommendation(durationDays),
  };
}

export function createDefaultGoalDateRange(currentDate = new Date()) {
  const startDate = new Date(
    currentDate.getFullYear(),
    currentDate.getMonth(),
    currentDate.getDate(),
    12,
    0,
    0,
    0
  );
  const endDate = new Date(startDate);

  endDate.setDate(endDate.getDate() + RECOMMENDED_GOAL_MIN_DAYS);

  return {
    startDateKey: getGoalDateKey(startDate),
    endDateKey: getGoalDateKey(endDate),
  };
}
