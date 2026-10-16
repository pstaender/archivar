import { expect, test } from "bun:test";
import { buildFolderTree, isWithinFolder, moveToFolders, normalizeFolderPath, parentPaths } from "./folders";

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

test("moving leaves the folder it was moved out of, including its sub-folders", () => {
  const current = ["privat", "wichtig", "wichtig/2026"];
  expect(moveToFolders(current, "wichtig", ["steuer/2025"])).toEqual(["privat", "steuer/2025"]);
  expect(moveToFolders(current, "wichtig/2026", ["wichtig/2025"])).toEqual(["privat", "wichtig", "wichtig/2025"]);
  expect(moveToFolders(current, "wichtig", ["wichtig/archiv"])).toEqual(["privat", "wichtig/archiv"]);
});

test("moving from the overview replaces all folders", () => {
  expect(moveToFolders(["privat", "wichtig"], null, ["steuer", "privat"])).toEqual(["privat", "steuer"]);
  expect(moveToFolders(["privat"], null, [])).toEqual([]);
});
