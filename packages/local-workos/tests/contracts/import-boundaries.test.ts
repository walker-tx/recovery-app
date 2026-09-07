import { expect, test } from "vitest";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Static architecture regression inspects source without executing either entry point.
import { readdirSync, readFileSync } from "node:fs";

test("CLI and contracts cannot import server implementation", () => {
  const source = new URL("../../src/", import.meta.url);
  for (const group of ["cli", "contracts"]) {
    const directory = new URL(`${group}/`, source);
    for (const file of readdirSync(directory, { recursive: true })) {
      if (!file.toString().endsWith(".ts")) {
        continue;
      }
      const url = new URL(file.toString(), directory);
      const content = readFileSync(url, "utf8");
      for (const match of content.matchAll(
        /\b(?:from|import)\s*(?:\(\s*)?["'](\.[^"']+)["']/g,
      )) {
        const target = new URL(match[1], url);
        expect(target.href, `${group}/${file.toString()}`).not.toContain(
          new URL("server/", source).href,
        );
        if (group === "contracts") {
          expect(target.href, `${group}/${file.toString()}`).not.toContain(
            new URL("cli/", source).href,
          );
        }
      }
    }
  }
});
