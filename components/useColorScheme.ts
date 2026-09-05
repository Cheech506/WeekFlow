import { useColorScheme as useColorSchemeCore } from 'react-native';

export type WeekFlowColorScheme = 'light' | 'dark';

export const useColorScheme = (): WeekFlowColorScheme => {
  // React Native can now return 'unspecified' in addition to light, dark, or null.
  // WeekFlow only uses light and dark, so anything that is not dark defaults to light.
  const colorScheme = useColorSchemeCore();

  return colorScheme === 'dark' ? 'dark' : 'light';
};