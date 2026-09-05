import type { TextStyle } from 'react-native';
import tokens from './design-tokens.json' with { type: 'json' };

const aliases = { normal: 400, medium: 500, semibold: 600, bold: 700 };
const faces: Record<number, string> = {
  400: tokens.fonts.body,
  500: tokens.fonts.medium,
  600: tokens.fonts.semibold,
  700: tokens.fonts.bold,
};

// NativeWind resolves class/inline precedence before this policy runs.
// Explicit families retain native weight behavior; only our bundled faces normalize.
export function resolveFontFace(style: TextStyle, heading: boolean, label = false): TextStyle {
  if (style.fontFamily !== undefined) return {fontFamily: style.fontFamily, fontWeight: style.fontWeight};
  if (heading) return {fontFamily: tokens.fonts.heading, fontWeight: 'normal'};
  const weight = style.fontWeight ?? (label ? 700 : 400);
  const numeric = weight in aliases ? aliases[weight as keyof typeof aliases] : Number(weight);
  return faces[numeric]
    ? {fontFamily: faces[numeric], fontWeight: 'normal'}
    : {fontFamily: tokens.fonts.body, fontWeight: weight};
}
