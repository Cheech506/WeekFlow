# WF-031 — First-Cycle Onboarding

**Development Period:** August 10–14, 2026  
**Completed:** August 14, 2026  
**Status:** Complete

## Summary

Added guided onboarding for users creating their first WeekFlow planning cycle.

The onboarding appears only when the database has never contained a planning cycle. It explains the purpose of the 12-week cycle structure and guides the user through creating their first real cycle using the existing cycle workflow.

## Changes

- Added a dedicated first-cycle onboarding component.
- Added onboarding guidance explaining the 12-week cycle structure.
- Added explanation of the Week 13 review and transition process.
- Added guided setup for:
  - Cycle name
  - Primary focus
  - Cycle theme
- Added a preview of the calculated 12-week cycle date range.
- Added dynamic messaging showing how many existing active goals will be included in the first cycle.
- Added handling for zero, one, or multiple existing active goals.
- Reused the existing `startCycle()` workflow rather than creating a separate onboarding-specific cycle system.
- Existing goals remain intact and are not duplicated.
- Onboarding automatically disappears once the first cycle exists.
- Existing users with previous cycles continue directly into the normal Dashboard.
- Added automated tests for first-cycle onboarding helper logic.

## Files Added or Changed

- `app/(tabs)/index.tsx`
- `components/FirstCycleOnboarding.tsx`
- `lib/firstCycleOnboardingUtils.ts`
- `__tests__/firstCycleOnboardingUtils.test.ts`

## Testing

Validated with:

- TypeScript checking using `npx tsc --noEmit`
- Jest test suite using `npm test`
- Manual regression testing in WeekFlow
- Confirmed existing-cycle users continue to see the normal Dashboard
- Confirmed existing goals and cycle management remain intact

## Result

WeekFlow now provides a guided first-use experience for the planning-cycle system while preserving the normal experience for existing users.
