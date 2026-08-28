import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

import ts from "typescript";

const IDENTITY_METHOD = "getUserIdentity";
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

export function sourceUsesGetUserIdentity(source: string): boolean {
  const sourceFile = ts.createSourceFile(
    "source.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found = false;

  function visit(node: ts.Node) {
    if (ts.isIdentifier(node) && node.text === IDENTITY_METHOD) {
      found = true;
      return;
    }

    if (
      ts.isStringLiteralLike(node) &&
      node.text === IDENTITY_METHOD &&
      (ts.isElementAccessExpression(node.parent) ||
        ts.isComputedPropertyName(node.parent))
    ) {
      found = true;
      return;
    }

    if (!found) ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return found;
}

export function findGetUserIdentityUsages({
  rootDirectory,
  allowedFile,
}: {
  rootDirectory: string;
  allowedFile: string;
}): string[] {
  const root = resolve(rootDirectory);
  const allowed = resolve(allowedFile);
  const offenders: string[] = [];

  function visitDirectory(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "_generated") visitDirectory(path);
        continue;
      }

      if (
        !entry.isFile() ||
        !SOURCE_EXTENSIONS.has(extname(entry.name)) ||
        entry.name.endsWith(".test.ts") ||
        entry.name.endsWith(".test.tsx") ||
        entry.name.endsWith(".testHelper.ts") ||
        resolve(path) === allowed
      ) {
        continue;
      }

      if (sourceUsesGetUserIdentity(readFileSync(path, "utf8"))) {
        offenders.push(relative(root, path));
      }
    }
  }

  visitDirectory(root);
  return offenders.sort();
}
