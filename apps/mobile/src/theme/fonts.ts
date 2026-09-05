import { fonts } from './tokens';

// Bundled, unmodified official Expo Google Fonts assets (SIL OFL 1.1).
// Individual asset imports keep unused weights and italics out of the bundle.
export const fontAssets = {
  [fonts.body]: require('@expo-google-fonts/barlow/400Regular/Barlow_400Regular.ttf'),
  [fonts.medium]: require('@expo-google-fonts/barlow/500Medium/Barlow_500Medium.ttf'),
  [fonts.semibold]: require('@expo-google-fonts/barlow/600SemiBold/Barlow_600SemiBold.ttf'),
  [fonts.bold]: require('@expo-google-fonts/barlow/700Bold/Barlow_700Bold.ttf'),
  [fonts.heading]: require('@expo-google-fonts/barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf'),
};
