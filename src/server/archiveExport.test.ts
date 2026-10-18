import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { unzipSync } from "fflate";
import type { UploadedDocument } from "../shared/types";
import { makeJpeg, startTestServer, type TestServer, uploadForm } from "../../test/server";
import { createUser } from "./services/users";

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(() => server.close());

async function setPassword(): Promise<string> {
  const res = await server.api("/api/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "geheim123" }),
  });
  expect(res.status).toBe(204);
  return res.headers.get("Set-Cookie")!.split(";")[0]!;
}

describe("archive export", () => {
  test("needs a password", async () => {
    expect((await server.api("/api/export/archive/size")).status).toBe(403);
    expect((await server.api("/api/export/archive")).status).toBe(403);
  });

  test("needs an admin", async () => {
    await createUser(server.ctx.users, "anna", "annas-kennwort", false);
    const login = await server.api("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "anna", password: "annas-kennwort" }),
    });
    const cookie = login.headers.get("Set-Cookie")!.split(";")[0]!;
    expect((await server.api("/api/export/archive/size", { headers: { Cookie: cookie } })).status).toBe(403);
    expect((await server.api("/api/export/archive", { headers: { Cookie: cookie } })).status).toBe(403);
  });

  test("streams the database and all stored files as a zip", async () => {
    const jpeg = await makeJpeg();
    const res = await server.api("/api/documents", { method: "POST", body: uploadForm([{ name: "scan.jpg", data: jpeg, type: "image/jpeg" }]) });
    const [doc] = (await res.json()) as UploadedDocument[];
    const cookie = await setPassword();

    const size = await server.api("/api/export/archive/size", { headers: { Cookie: cookie } });
    const { bytes } = (await size.json()) as { bytes: number };
    expect(bytes).toBeGreaterThan(jpeg.length);

    const exported = await server.api("/api/export/archive", { headers: { Cookie: cookie } });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("Content-Type")).toBe("application/zip");
    expect(exported.headers.get("Content-Disposition")).toMatch(/^attachment; filename="archivar-\d{4}-\d{2}-\d{2}\.zip"$/);

    const entries = unzipSync(new Uint8Array(await exported.arrayBuffer()));
    const stored = server.ctx.documents.get(1, doc!.id)!.storageKey;
    expect(entries[`files/${stored}`]).toEqual(new Uint8Array(jpeg));

    const db = Database.deserialize(entries["archivar.sqlite"] as Uint8Array<ArrayBuffer>);
    expect(db.query("SELECT original_name FROM documents").all()).toEqual([{ original_name: "scan.jpg" }]);
    db.close();
  });
});
