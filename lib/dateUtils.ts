export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type CalendarDay = {
  dateKey: string;
  dayName: string;
  shortDayName: string;
  monthDayLabel: string;
  fullLabel: string;
  isToday: boolean;
};

/**
 * Removes the time portion of a Date while keeping the user's local timezone.
 */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Stores due dates as YYYY-MM-DD without a timezone.
 * This prevents a date from moving backward or forward when viewed in another timezone.
 */
export function getLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Parses a YYYY-MM-DD value as a local calendar date instead of UTC.
 */
export function parseLocalDateKey(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsedDate = new Date(year, month - 1, day);

  const isValid =
    parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 &&
    parsedDate.getDate() === day;

  return isValid ? parsedDate : null;
}

export function addDays(date: Date, amount: number): Date {
  const updatedDate = startOfLocalDay(date);
  updatedDate.setDate(updatedDate.getDate() + amount);
  return updatedDate;
}

/**
 * WeekFlow treats Monday as the first day of each week.
 */
export function getStartOfWeek(date: Date = new Date()): Date {
  const start = startOfLocalDay(date);
  const daysSinceMonday = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - daysSinceMonday);
  return startOfLocalDay(start);
}

export function getDayNameFromDateKey(dateKey: string): string | null {
  const date = parseLocalDateKey(dateKey);
  return date ? DAY_NAMES[date.getDay()] : null;
}

export function formatDateKey(
  dateKey: string,
  options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }
): string {
  const date = parseLocalDateKey(dateKey);

  if (!date) {
    return dateKey;
  }

  return date.toLocaleDateString([], options);
}

/**
 * Returns the next occurrence of a weekday, including today when it matches.
 * This is used to safely migrate old weekday-only tasks into real dates.
 */
export function getNextOccurrenceDateKey(
  dayName: string,
  currentDate: Date = new Date()
): string | null {
  const targetIndex = DAY_NAMES.findIndex((day) => day === dayName);

  if (targetIndex === -1) {
    return null;
  }

  const today = startOfLocalDay(currentDate);
  const daysAhead = (targetIndex - today.getDay() + 7) % 7;

  return getLocalDateKey(addDays(today, daysAhead));
}

/**
 * Builds a list of upcoming calendar dates for the Inbox scheduling controls.
 */
export function getUpcomingDays(
  count: number = 14,
  startDate: Date = new Date()
): CalendarDay[] {
  const today = startOfLocalDay(startDate);
  const todayKey = getLocalDateKey(today);

  return Array.from({ length: count }, (_, index) => {
    const date = addDays(today, index);
    const dateKey = getLocalDateKey(date);
    const dayName = DAY_NAMES[date.getDay()];

    return {
      dateKey,
      dayName,
      shortDayName: dayName.slice(0, 3),
      monthDayLabel: date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      }),
      fullLabel: date.toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      isToday: dateKey === todayKey,
    };
  });
}

/**
 * Builds Monday through Sunday for a selected week offset.
 * offset 0 = current week, 1 = next week, -1 = previous week.
 */
export function getWeekDays(
  currentDate: Date = new Date(),
  weekOffset: number = 0
): CalendarDay[] {
  const todayKey = getLocalDateKey(startOfLocalDay(currentDate));
  const weekStart = addDays(getStartOfWeek(currentDate), weekOffset * 7);

  return Array.from({ length: 7 }, (_, index) => {
    const date = addDays(weekStart, index);
    const dateKey = getLocalDateKey(date);
    const dayName = DAY_NAMES[date.getDay()];

    return {
      dateKey,
      dayName,
      shortDayName: dayName.slice(0, 3),
      monthDayLabel: date.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
      }),
      fullLabel: date.toLocaleDateString([], {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }),
      isToday: dateKey === todayKey,
    };
  });
}
