import type { FunctionReturnType } from "convex/server";
import { convexTest } from "convex-test";
import { afterAll, beforeAll, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const clientId = "client_01ABC123";
let previous: string | undefined;
beforeAll(() => {
  previous = process.env.WORKOS_CLIENT_ID;
  process.env.WORKOS_CLIENT_ID = clientId;
});
afterAll(() => {
  if (previous === undefined) delete process.env.WORKOS_CLIENT_ID;
  else process.env.WORKOS_CLIENT_ID = previous;
});
function setup() {
  const t = convexTest(schema, modules);
  const user = (subject: string) =>
    t.withIdentity({
      subject,
      issuer: `https://api.workos.com/user_management/${clientId}`,
      client_id: clientId,
    });
  return { t, a: user("a"), b: user("b") };
}
const paginationOpts = { numItems: 2, cursor: null };
const draft = { name: "Recovery", startAt: 1000 };
test("requires authentication for every operation and isolates owners atomically", async () => {
  const { t, a, b } = setup();
  const id = await a.mutation(api.counts.create, draft);
  const foreign = await b.mutation(api.counts.create, draft);
  for (const client of [t, b]) {
    await expect(client.query(api.counts.get, { id })).rejects.toThrow();
    await expect(
      client.mutation(api.counts.edit, { id, ...draft }),
    ).rejects.toThrow();
    await expect(
      client.mutation(api.counts.setUnit, { id, unit: "hours" }),
    ).rejects.toThrow();
    await expect(client.mutation(api.counts.remove, { id })).rejects.toThrow();
    await expect(
      client.mutation(api.counts.reorder, { ids: [foreign, id] }),
    ).rejects.toThrow();
  }
  await expect(t.mutation(api.counts.create, draft)).rejects.toThrow();
  await expect(t.query(api.counts.list, { paginationOpts })).rejects.toThrow();
  await expect(
    t.query(api.counts.findDuplicate, { name: draft.name }),
  ).rejects.toThrow();
  expect(
    (await a.query(api.counts.list, { paginationOpts })).page.map((x) => x._id),
  ).toEqual([id]);
  expect(
    (await b.query(api.counts.list, { paginationOpts })).page.map((x) => x._id),
  ).toEqual([foreign]);
  expect(await b.query(api.counts.get, { id: foreign })).toMatchObject({
    unit: "days",
    name: draft.name,
  });
});
test("new-first pagination, scoped writes, last successful writes and stale reorder membership", async () => {
  const { a } = setup();
  const first = await a.mutation(api.counts.create, draft);
  const second = await a.mutation(api.counts.create, {
    ...draft,
    name: "Second",
  });
  const third = await a.mutation(api.counts.create, {
    ...draft,
    name: "Third",
  });
  const page = await a.query(api.counts.list, { paginationOpts });
  expect(page.page.map((x) => x._id)).toEqual([third, second]);
  expect(page.isDone).toBe(false);
  expect(
    (
      await a.query(api.counts.list, {
        paginationOpts: { numItems: 2, cursor: page.continueCursor },
      })
    ).page.map((x) => x._id),
  ).toEqual([first]);
  const before = await a.query(api.counts.get, { id: first });
  await a.mutation(api.counts.setUnit, { id: first, unit: "years" });
  await a.mutation(api.counts.edit, {
    id: first,
    name: "  Edited  ",
    startAt: 2000,
  });
  await a.mutation(api.counts.edit, {
    id: first,
    name: "Latest",
    startAt: 3000,
  });
  expect(await a.query(api.counts.get, { id: first })).toMatchObject({
    name: "Latest",
    startAt: 3000,
    unit: "years",
    order: before.order,
  });
  await a.mutation(api.counts.setUnit, { id: first, unit: "months" });
  expect(await a.query(api.counts.get, { id: first })).toMatchObject({
    name: "Latest",
    startAt: 3000,
    unit: "months",
    order: before.order,
  });
  await a.mutation(api.counts.reorder, { ids: [first, second, third] });
  await a.mutation(api.counts.reorder, { ids: [second, third, first] });
  expect(
    (await a.query(api.counts.list, { paginationOpts })).page.map((x) => x._id),
  ).toEqual([second, third]);
  const newest = await a.mutation(api.counts.create, draft);
  await a.mutation(api.counts.remove, { id: third });
  await a.mutation(api.counts.reorder, { ids: [first, third, second] });
  expect(
    (
      await a.query(api.counts.list, {
        paginationOpts: { numItems: 100, cursor: null },
      })
    ).page.map((x) => x._id),
  ).toEqual([newest, first, second]);
  await expect(a.query(api.counts.get, { id: third })).rejects.toThrow();
  expect(await a.query(api.counts.get, { id: first })).toMatchObject({
    name: "Latest",
    startAt: 3000,
    unit: "months",
  });
  await expect(
    a.mutation(api.counts.reorder, { ids: [first, first] }),
  ).rejects.toThrow();
});
test("Unicode grapheme boundaries and canonical duplicate lookup preserve spelling", async () => {
  const { a, b } = setup();
  const id = await a.mutation(api.counts.create, {
    ...draft,
    name: "  Cafe\u0301  ",
  });
  expect(
    await a.query(api.counts.findDuplicate, { name: " CAFÉ " }),
  ).toMatchObject({ _id: id, name: "Cafe\u0301" });
  expect(await a.query(api.counts.findDuplicate, { name: "Cafe" })).toBeNull();
  expect(await b.query(api.counts.findDuplicate, { name: "CAFÉ" })).toBeNull();
  expect(
    await a.query(api.counts.findDuplicate, { name: "CAFÉ", excludeId: id }),
  ).toBeNull();
  await a.mutation(api.counts.create, { ...draft, name: "CAFÉ" });
  for (const grapheme of ["👨‍👩‍👧‍👦", "e\u0301", "🇺🇸", "क्‍ष"]) {
    await a.mutation(api.counts.create, {
      ...draft,
      name: grapheme.repeat(100),
    });
    await expect(
      a.mutation(api.counts.create, { ...draft, name: grapheme.repeat(101) }),
    ).rejects.toThrow();
  }
  await a.mutation(api.counts.create, { ...draft, name: "日本語  العربية" });
  expect(
    await a.query(api.counts.findDuplicate, { name: "日本語 العربية" }),
  ).toBeNull();
  for (const name of ["", " \n ", "a".repeat(101)]) {
    await expect(
      a.mutation(api.counts.create, { ...draft, name }),
    ).rejects.toThrow();
    await expect(
      a.mutation(api.counts.edit, { id, ...draft, name }),
    ).rejects.toThrow();
  }
});
test("rejects invalid instants and units without modifying stored data", async () => {
  const { a } = setup();
  const id = await a.mutation(api.counts.create, draft);
  for (const startAt of [
    NaN,
    Infinity,
    -Infinity,
    Date.now() + 86400000,
    -8640000000000001,
  ]) {
    await expect(
      a.mutation(api.counts.create, { ...draft, startAt }),
    ).rejects.toThrow();
    await expect(
      a.mutation(api.counts.edit, { id, ...draft, startAt }),
    ).rejects.toThrow();
  }
  await expect(
    // @ts-expect-error deliberately exercise the server unit validator
    a.mutation(api.counts.setUnit, { id, unit: "seconds" }),
  ).rejects.toThrow();
  expect(await a.query(api.counts.get, { id })).toMatchObject({
    ...draft,
    unit: "days",
  });
});

test("case-insensitive matching includes Unicode case-fold expansions and final sigma", async () => {
  const { a } = setup();
  for (const [name, match] of [
    ["Straße", "STRASSE"],
    ["ΟΣ", "οσ"],
  ]) {
    const id = await a.mutation(api.counts.create, { ...draft, name });
    expect(
      await a.query(api.counts.findDuplicate, { name: match }),
    ).toMatchObject({ _id: id });
  }
});

test("collection exceeds a page; request bounds do not impose a collection limit", async () => {
  const { a, b } = setup();
  const ids = [];
  for (let i = 0; i < 257; i++)
    ids.push(
      await a.mutation(api.counts.create, { ...draft, name: `Count ${i}` }),
    );
  let cursor: string | null = null;
  const all = [];
  for (;;) {
    const page: FunctionReturnType<typeof api.counts.list> = await a.query(
      api.counts.list,
      { paginationOpts: { numItems: 100, cursor } },
    );
    all.push(...page.page);
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  expect(all.map((x) => x._id)).toEqual([...ids].reverse());
  await a.mutation(api.counts.reorder, { ids: [ids[0], ids[256]] });
  expect((await a.query(api.counts.list, { paginationOpts })).page[0]._id).toBe(
    ids[0],
  );
  const foreign = await b.mutation(api.counts.create, draft);
  const before = await a.query(api.counts.get, { id: ids[0] });
  await expect(
    a.mutation(api.counts.reorder, { ids: [ids[256], ids[0], foreign] }),
  ).rejects.toThrow();
  expect(await a.query(api.counts.get, { id: ids[0] })).toEqual(before);
  await expect(
    b.query(api.counts.findDuplicate, { name: draft.name, excludeId: ids[0] }),
  ).rejects.toThrow();
  await expect(a.mutation(api.counts.reorder, { ids })).rejects.toThrow();
  for (const numItems of [0, -1, 101, 1.5])
    await expect(
      a.query(api.counts.list, { paginationOpts: { numItems, cursor: null } }),
    ).rejects.toThrow();
});

test("endCursor cannot bypass server read budgets, even with client overrides", async () => {
  const { a } = setup();
  for (let i = 0; i < 205; i++)
    await a.mutation(api.counts.create, { ...draft, name: `Count ${i}` });
  const first = await a.query(api.counts.list, {
    paginationOpts: { numItems: 100, cursor: null },
  });
  const second = await a.query(api.counts.list, {
    paginationOpts: { numItems: 100, cursor: first.continueCursor },
  });
  for (const overrides of [
    {},
    { maximumRowsRead: 10000, maximumBytesRead: 100000000 },
  ]) {
    const page = await a.query(api.counts.list, {
      paginationOpts: {
        numItems: 1,
        cursor: null,
        endCursor: second.continueCursor,
        ...overrides,
      },
    });
    expect(page.page).toHaveLength(100);
    expect(page.pageStatus).toBe("SplitRequired");
    expect(page.splitCursor).toEqual(expect.any(String));
    expect(page.continueCursor).toBe(first.continueCursor);
    const rest = await a.query(api.counts.list, {
      paginationOpts: {
        numItems: 1,
        cursor: page.continueCursor,
        endCursor: second.continueCursor,
      },
    });
    expect(rest.page.map((count) => count._id)).toEqual(
      second.page.map((count) => count._id),
    );
  }
});

test("large valid names hit the server byte budget despite client overrides", async () => {
  const { a } = setup();
  // One grapheme can contain many combining marks; no product byte cap is needed.
  const name = "a" + "\u0301".repeat(40000);
  for (let i = 0; i < 20; i++)
    await a.mutation(api.counts.create, { ...draft, name });
  const page = await a.query(api.counts.list, {
    paginationOpts: {
      numItems: 100,
      cursor: null,
      maximumRowsRead: 10000,
      maximumBytesRead: 100000000,
    },
  });
  expect(page.page.length).toBeGreaterThan(0);
  expect(page.page.length).toBeLessThan(20);
  expect(page.pageStatus).toBe("SplitRequired");
  expect(page.splitCursor).toEqual(expect.any(String));
});
