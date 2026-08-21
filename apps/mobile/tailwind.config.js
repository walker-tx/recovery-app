const tokens = require("./src/theme/design-tokens.json");

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        canvas: tokens.colors.canvas,
        surface: tokens.colors.surface,
        "surface-strong": tokens.colors.surfaceStrong,
        ink: tokens.colors.ink,
        "ink-muted": tokens.colors.inkMuted,
        blueprint: tokens.colors.blueprint,
        "blueprint-tint": tokens.colors.blueprintTint,
        "blueprint-pressed": tokens.colors.blueprintPressed,
        line: tokens.colors.line,
        "line-strong": tokens.colors.lineStrong,
        inverse: tokens.colors.inverse,
        danger: tokens.colors.danger,
        "danger-surface": tokens.colors.dangerSurface,
        overlay: tokens.colors.overlay,
      },
      spacing: Object.fromEntries(Object.entries(tokens.spacing).map(([name, value]) => [name, `${value}px`])),
      borderRadius: { square: "0px", subtle: "0px" },
      minHeight: { touch: `${tokens.touchTarget}px` },
      width: { touch: `${tokens.touchTarget}px` },
      boxShadow: tokens.shadows,
      fontSize: {
        display: ["38px", { lineHeight: "44px", letterSpacing: "-1px", fontWeight: "700" }],
        title: ["24px", { lineHeight: "30px", fontWeight: "700" }],
        heading: ["18px", { lineHeight: "24px", fontWeight: "700" }],
        body: ["16px", { lineHeight: "24px", fontWeight: "400" }],
        label: ["14px", { lineHeight: "20px", fontWeight: "700" }],
        caption: ["13px", { lineHeight: "18px", fontWeight: "400" }],
        overline: ["12px", { lineHeight: "16px", letterSpacing: "1.8px", fontWeight: "800" }],
      },
    },
  },
  plugins: [],
};
