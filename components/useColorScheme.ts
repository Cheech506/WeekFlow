import { useColorScheme as useColorSchemeCore } from 'react-native';

export type WeekFlowColorScheme = 'light' | 'dark';

export const useColorScheme = (): WeekFlowColorScheme => {
  // React Native can return null before the system appearance is available.
  // WeekFlow defaults to light mode so every caller receives a usable theme key.
  return useColorSchemeCore() ?? 'light';
};
