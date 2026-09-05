# WeekFlow Expo SDK 57 Migration

Date: September 5, 2026

## Summary

Upgraded WeekFlow from Expo SDK 54 to Expo SDK 57 so the application remains compatible with the current version of Expo Go on iOS.

## Changes

- Upgraded Expo incrementally from SDK 54 to SDK 55, SDK 56, and finally SDK 57.
- Updated React Native and Expo dependencies for SDK 57 compatibility.
- Migrated splash screen configuration to the expo-splash-screen config plugin.
- Removed the obsolete newArchEnabled setting.
- Migrated React Navigation imports to Expo Router equivalents.
- Updated useColorScheme handling for newer React Native color scheme values.
- Replaced deprecated StyleSheet.absoluteFillObject usage with StyleSheet.absoluteFill.
- Updated Jest and TypeScript test configuration.
- Rebuilt node_modules and package-lock.json to resolve mixed SDK 56/57 dependencies.
- Verified Expo Doctor passes successfully.
- Verified TypeScript compilation passes with no errors.
- Verified WeekFlow launches successfully using Expo SDK 57 on an iPhone.
