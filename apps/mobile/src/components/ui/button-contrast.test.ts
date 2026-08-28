import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

type RGB = readonly [number, number, number];

function rgb(hex: string): RGB {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16)) as unknown as RGB;
}

function luminance(color: RGB) {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string) {
  const values = [luminance(rgb(first)), luminance(rgb(second))].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("primary button normal text meets WCAG AA in enabled and pressed states", async () => {
  const tokens = JSON.parse(await readFile(new URL("../../theme/design-tokens.json", import.meta.url), "utf8")) as { colors: Record<string, string> };

  assert.ok(contrast(tokens.colors.inverse, tokens.colors.blueprint) >= 4.5);
  assert.ok(contrast(tokens.colors.inverse, tokens.colors.blueprintPressed) >= 4.5);
});

test("disabled primary buttons use the inactive-control exception with explicit semantics", async () => {
  const source = await readFile(new URL("./button.tsx", import.meta.url), "utf8");

  assert.match(source, /accessibilityState=\{\{ busy: loading, disabled: unavailable \}\}/);
  assert.match(source, /disabled=\{unavailable\}/);
  assert.match(source, /unavailable \? "opacity-\[0\.45\]"/);
});
