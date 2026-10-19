import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { makeJpeg, startTestServer, type TestServer } from "../../test/server";
import type { ExternalListing, ExternalSource } from "../shared/externalSources";
import type { Job } from "../shared/jobs";
import type { ArchiveDocument } from "../shared/types";
import { createUser } from "./services/users";

let server: TestServer;
let dir: string;
let outside: string;

const post = (path: string, body: unknown, token?: string) =>
  server.api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

async function createSource(url = dir): Promise<ExternalSource> {
  const res = await post("/api/sources", { name: "Scans", type: "file_path", url });
  expect(res.status).toBe(201);
  return (await res.json()) as ExternalSource;
}

async function browse(id: number, path = "", all = false): Promise<ExternalListing> {
  const res = await server.api(`/api/sources/${id}/browse?path=${encodeURIComponent(path)}${all ? "&all=true" : ""}`);
  expect(res.status).toBe(200);
  return (await res.json()) as ExternalListing;
}

async function importFiles(id: number, body: unknown): Promise<Job> {
  const res = await post(`/api/sources/${id}/import`, body);
  expect(res.status).toBe(201);
  await server.ctx.jobQueue.idle();
  const { id: jobId } = (await res.json()) as Job;
  return ((await (await server.api("/api/jobs")).json()) as Job[]).find((job) => job.id === jobId)!;
}

const documents = async () => (await (await server.api("/api/documents")).json()) as ArchiveDocument[];

beforeEach(async () => {
  server = await startTestServer();
  dir = await mkdtemp(join(tmpdir(), "archivar-source-"));
  outside = await mkdtemp(join(tmpdir(), "archivar-outside-"));
  const jpeg = await makeJpeg();
  await mkdir(join(dir, "2026", "März"), { recursive: true });
  await writeFile(join(dir, "brief.jpg"), jpeg);
  await writeFile(join(dir, "notes.txt"), "text");
  await writeFile(join(dir, ".hidden.jpg"), jpeg);
  await writeFile(join(dir, "2026", "rechnung.jpg"), await makeJpeg(64, 48, [90, 90, 90]));
  await writeFile(join(dir, "2026", "März", "beleg.jpg"), await makeJpeg(64, 48, [10, 20, 30]));
  await writeFile(join(dir, "2026", "groß.png"), new Uint8Array(10 * 1024 * 1024 + 1));
  await writeFile(join(outside, "secret.jpg"), jpeg);
  await utimes(join(dir, "brief.jpg"), new Date("2024-05-01T10:00:00Z"), new Date("2024-05-01T10:00:00Z"));
});

afterEach(async () => {
  await server.close();
  await rm(dir, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe("external data sources", () => {
  test("admins create sources; credentials are never returned", async () => {
    const res = await post("/api/sources", { name: " Scans ", type: "file_path", url: dir, credentials: { user: "x" } });
    expect(res.status).toBe(201);
    const source = (await res.json()) as ExternalSource & { credentials?: unknown };
    expect(source).toMatchObject({ name: "Scans", type: "file_path", hasCredentials: true, documentCount: 0 });
    expect(source.credentials).toBeUndefined();
    expect(((await (await server.api("/api/sources")).json()) as ExternalSource[]).map((s) => s.name)).toEqual(["Scans"]);

    expect((await post("/api/sources", { name: "X", type: "file_path", url: "relative/path" })).status).toBe(400);
    expect((await post("/api/sources", { name: "X", type: "file_path", url: join(dir, "missing") })).status).toBe(404);
    expect((await post("/api/sources", { name: "X", type: "s3", url: dir })).status).toBe(400);
  });

  test("only admins may set up sources", async () => {
    const anna = await createUser(server.ctx.users, "anna", "annas-kennwort", false);
    const token = server.ctx.tokens.create(anna.id, "test").token;
    const res = await post("/api/sources", { name: "Root", type: "file_path", url: "/" }, token);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("Only admins can set up data sources");
  });

  test("lists folders and images and PDFs up to 10 MB, without hidden files", async () => {
    const source = await createSource();
    const root = await browse(source.id);
    expect(root.entries.map((e) => [e.name, e.kind])).toEqual([
      ["2026", "folder"],
      ["brief.jpg", "file"],
    ]);
    expect(root.hidden).toBe(1);
    expect((await browse(source.id, "", true)).entries.map((e) => e.name)).toEqual(["2026", "brief.jpg", "notes.txt"]);
    const year = await browse(source.id, "2026");
    expect(year.entries.map((e) => e.path)).toEqual(["2026/März", "2026/rechnung.jpg"]);
    expect(year.hidden).toBe(1);
  });

  test("paths cannot leave the source", async () => {
    await symlink(outside, join(dir, "escape"));
    const source = await createSource();
    expect((await browse(source.id)).entries.map((e) => e.name)).not.toContain("escape");
    expect((await server.api(`/api/sources/${source.id}/browse?path=../`)).status).toBe(400);
    expect((await server.api(`/api/sources/${source.id}/browse?path=escape`)).status).toBe(400);
    expect((await post(`/api/sources/${source.id}/import`, { files: ["escape/secret.jpg"] })).status).toBe(400);
  });

  test("imports chosen files as copies linked to the source", async () => {
    const source = await createSource();
    const job = await importFiles(source.id, { files: ["brief.jpg"] });
    expect(job).toMatchObject({ kind: "external", source: { id: source.id, name: "Scans" }, active: false });
    expect(job.items.map((item) => [item.name, item.state])).toEqual([["brief.jpg", "done"]]);
    const [doc] = await documents();
    expect(doc).toMatchObject({ title: "brief", originalName: "brief.jpg", kind: "image", source: { id: source.id, name: "Scans", path: "brief.jpg" } });
    expect(doc!.createdAt).toBe("2024-05-01T10:00:00.000Z");
    expect((await browse(source.id)).entries.find((e) => e.name === "brief.jpg")?.documentId).toBe(doc!.id);

    // The source is never written to; deleting the document leaves the file alone.
    expect((await server.api(`/api/documents/${doc!.id}`, { method: "DELETE" })).status).toBe(204);
    expect(await Bun.file(join(dir, "brief.jpg")).exists()).toBe(true);
    expect((await browse(source.id)).entries.find((e) => e.name === "brief.jpg")?.documentId).toBeNull();
  });

  test("imports folders only recursively when asked and skips files imported before", async () => {
    const source = await createSource();
    let job = await importFiles(source.id, { folders: ["2026"] });
    expect(job.items.map((item) => item.name)).toEqual(["2026/rechnung.jpg"]);

    job = await importFiles(source.id, { folders: ["2026"], recursive: true });
    expect(job.items.map((item) => [item.name, item.state, item.note])).toEqual([
      ["2026/rechnung.jpg", "skipped", "Already imported"],
      ["2026/März/beleg.jpg", "done", null],
    ]);
    expect(job.items[0]!.document).not.toBeNull();

    // A file chosen on its own is imported again.
    job = await importFiles(source.id, { files: ["2026/rechnung.jpg"] });
    expect(job.items[0]).toMatchObject({ state: "done", note: 'Already stored as "rechnung"' });
    expect((await documents()).length).toBe(3);
  });

  test("puts the files into target folders and optionally mirrors the folder structure", async () => {
    const source = await createSource();
    server.ctx.users.updateSettings(server.ctx.users.findByName("admin")!.id, { importFolders: ["eingang"] });
    await importFiles(source.id, { folders: ["2026"], recursive: true, keepStructure: true, base: "", targetFolders: ["archiv/scans"] });
    await importFiles(source.id, { files: ["brief.jpg"], keepStructure: true, base: "" });
    const byName = Object.fromEntries((await documents()).map((doc) => [doc.originalName, doc.folders.toSorted()]));
    expect(byName).toEqual({
      "rechnung.jpg": ["archiv/scans/2026", "eingang"],
      "beleg.jpg": ["archiv/scans/2026/März", "eingang"],
      "brief.jpg": ["eingang"],
    });
  });

  test("a selection without files to import is refused", async () => {
    await mkdir(join(dir, "leer"));
    const source = await createSource();
    const res = await post(`/api/sources/${source.id}/import`, { folders: ["leer"] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("No files to import");
  });

  test("deleting a source keeps the imported documents", async () => {
    const source = await createSource();
    await importFiles(source.id, { files: ["brief.jpg"] });
    expect(((await (await server.api("/api/sources")).json()) as ExternalSource[])[0]!.documentCount).toBe(1);
    expect((await server.api(`/api/sources/${source.id}`, { method: "DELETE" })).status).toBe(204);
    const [doc] = await documents();
    expect(doc!.source).toBeNull();
    expect((await server.api(`/api/sources/${source.id}/browse`)).status).toBe(404);
  });

  test("a file that disappeared fails its item", async () => {
    const source = await createSource();
    const userId = server.ctx.users.findByName("admin")!.id;
    const jobId = await server.ctx.externalSources.startImport(userId, source.id, { files: ["brief.jpg"] });
    await rm(join(dir, "brief.jpg"));
    server.ctx.jobQueue.start();
    await server.ctx.jobQueue.idle();
    expect(server.ctx.jobs.get(userId, jobId)!.items[0]).toMatchObject({ state: "failed", error: "File not found" });
  });

  test("~ stands for the home directory of the server's user", async () => {
    const res = await post("/api/sources", { name: "Home", type: "file_path", url: "~" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as ExternalSource).url).toBe(homedir());
  });

  test("re-imports a changed file and keeps the document's edits, folders and title", async () => {
    const source = await createSource();
    await importFiles(source.id, { files: ["brief.jpg"], targetFolders: ["post"] });
    const [doc] = await documents();
    const patch = await server.api(`/api/documents/${doc!.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Brief an Anna", editSettings: { brightness: 0.2 } }),
    });
    expect(patch.status).toBe(200);
    const copy = (await (await post(`/api/documents/${doc!.id}/duplicate`, {})).json()) as ArchiveDocument;
    expect((await browse(source.id)).entries.find((e) => e.name === "brief.jpg")?.changed).toBe(false);

    await writeFile(join(dir, "brief.jpg"), await makeJpeg(120, 90, [0, 0, 255]));
    expect((await browse(source.id)).entries.find((e) => e.name === "brief.jpg")?.changed).toBe(true);

    const res = await post(`/api/documents/${doc!.id}/reimport`, {});
    expect(res.status).toBe(200);
    const updated = (await res.json()) as ArchiveDocument;
    expect(updated).toMatchObject({ title: "Brief an Anna", folders: ["post"], width: 120, height: 90, copies: [] });
    expect(updated.editSettings.brightness).toBe(0.2);
    expect((await browse(source.id)).entries.find((e) => e.name === "brief.jpg")?.changed).toBe(false);

    // The duplicate keeps the old file.
    const kept = (await (await server.api(`/api/documents/${copy.id}`)).json()) as ArchiveDocument;
    expect(kept).toMatchObject({ copyOf: null, width: 64, height: 48 });
    expect((await server.api(`/api/documents/${copy.id}/file`)).status).toBe(200);

    const other = (await (await post(`/api/documents/${copy.id}/reimport`, {})).json()) as { error: string };
    expect(other.error).toBe("The document was not imported from a data source");
  });
});
