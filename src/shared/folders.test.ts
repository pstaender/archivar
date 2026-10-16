import { expect, test } from "bun:test";
import { buildFolderTree, isWithinFolder, normalizeFolderPath, parentPaths } from "./folders";

test("normalizeFolderPath trims segments and slashes", () => {
  expect(normalizeFolderPath(" wichtig /  2026/ ")).toBe("wichtig/2026");
  expect(normalizeFolderPath("//a//b  c//")).toBe("a/b c");
  expect(normalizeFolderPath("  ")).toBe("");
});

test("isWithinFolder matches the folder and its descendants only", () => {
  expect(isWithinFolder("wichtig", "wichtig")).toBe(true);
  expect(isWithinFolder("wichtig/2026", "wichtig")).toBe(true);
  expect(isWithinFolder("wichtiger", "wichtig")).toBe(false);
});

test("parentPaths lists ancestors", () => {
  expect(parentPaths("a/b/c")).toEqual(["a", "a/b"]);
  expect(parentPaths("a")).toEqual([]);
});

test("buildFolderTree creates implicit parents", () => {
  const tree = buildFolderTree([
    { id: 2, path: "wichtig/2026", count: 3 },
    { id: 1, path: "privat", count: 1 },
  ]);
  expect(tree.map((n) => n.name)).toEqual(["privat", "wichtig"]);
  const wichtig = tree[1]!;
  expect(wichtig.id).toBeNull();
  expect(wichtig.children[0]).toMatchObject({ name: "2026", path: "wichtig/2026", id: 2, count: 3 });
});
