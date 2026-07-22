import {
  addDays,
  getLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from './dateUtils';

export const PLANNING_CYCLE_WEEKS = 12;
export const PLANNING_CYCLE_DAYS = PLANNING_CYCLE_WEEKS * 7;

export type PlanningCycleState =
  | 'upcoming'
  | 'active'
  | 'complete';

export type PlanningCycleProgress = {
  state: PlanningCycleState;
  weekNumber: number | null;
  progressPercentage: number;
  daysElapsed: number;
  daysRemaining: number;
  daysUntilStart: number;
};

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function differenceInCalendarDays(
  laterDate: Date,
  earlierDate: Date
) {
  const laterUtc = Date.UTC(
    laterDate.getFullYear(),
    laterDate.getMonth(),
    laterDate.getDate()
  );

  const earlierUtc = Date.UTC(
    earlierDate.getFullYear(),
    earlierDate.getMonth(),
    earlierDate.getDate()
  );

  return Math.round(
    (laterUtc - earlierUtc) / MILLISECONDS_PER_DAY
  );
}

export function createPlanningCycleRange(
  startDateKey: string
) {
  const startDate = parseLocalDateKey(startDateKey.trim());

  if (!startDate) {
    throw new Error(
      'Enter the cycle start date in YYYY-MM-DD format.'
    );
  }

  /*
   * The end date is inclusive. Adding 83 days gives the cycle exactly
   * 84 calendar days, or twelve complete seven-day weeks.
   */
  const endDate = addDays(
    startDate,
    PLANNING_CYCLE_DAYS - 1
  );

  return {
    startDate: getLocalDateKey(startDate),
    endDate: getLocalDateKey(endDate),
  };
}

export function getNextPlanningCycleStartDate(
  endDateKey: string
) {
  const endDate = parseLocalDateKey(endDateKey);

  if (!endDate) {
    throw new Error('The current cycle end date is invalid.');
  }

  return getLocalDateKey(addDays(endDate, 1));
}

export function getPlanningCycleProgress(
  startDateKey: string,
  endDateKey: string,
  currentDate: Date = new Date()
): PlanningCycleProgress {
  const startDate = parseLocalDateKey(startDateKey);
  const endDate = parseLocalDateKey(endDateKey);

  if (!startDate || !endDate) {
    throw new Error('The planning cycle dates are invalid.');
  }

  const today = startOfLocalDay(currentDate);

  if (today.getTime() < startDate.getTime()) {
    return {
      state: 'upcoming',
      weekNumber: null,
      progressPercentage: 0,
      daysElapsed: 0,
      daysRemaining: PLANNING_CYCLE_DAYS,
      daysUntilStart: differenceInCalendarDays(
        startDate,
        today
      ),
    };
  }

  if (today.getTime() > endDate.getTime()) {
    return {
      state: 'complete',
      weekNumber: PLANNING_CYCLE_WEEKS,
      progressPercentage: 100,
      daysElapsed: PLANNING_CYCLE_DAYS,
      daysRemaining: 0,
      daysUntilStart: 0,
    };
  }

  const elapsedBeforeToday = differenceInCalendarDays(
    today,
    startDate
  );
  const daysElapsed = elapsedBeforeToday + 1;
  const weekNumber = Math.min(
    PLANNING_CYCLE_WEEKS,
    Math.floor(elapsedBeforeToday / 7) + 1
  );

  return {
    state: 'active',
    weekNumber,
    progressPercentage: Math.min(
      100,
      Math.round(
        (daysElapsed / PLANNING_CYCLE_DAYS) * 100
      )
    ),
    daysElapsed,
    daysRemaining: Math.max(
      0,
      differenceInCalendarDays(endDate, today)
    ),
    daysUntilStart: 0,
  };
}

export function isDateKeyWithinCycle(
  dateKey: string | null,
  startDateKey: string,
  endDateKey: string
) {
  return Boolean(
    dateKey &&
      dateKey >= startDateKey &&
      dateKey <= endDateKey
  );
}

export function getTimestampDateKey(
  timestamp: string | null
) {
  if (!timestamp) return null;

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return getLocalDateKey(date);
}
