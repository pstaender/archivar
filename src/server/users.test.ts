import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { UploadedDocument } from "../shared/types";
import { makeJpeg, startTestServer, type TestServer, uploadForm } from "../../test/server";
import { derivedKeys } from "./storage";
import { createUser, deleteUser, documentCount } from "./services/users";

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(() => server.close());

async function upload(cookie?: string): Promise<UploadedDocument> {
  const res = await server.api("/api/documents", { method: "POST", body: uploadForm([{ name: "scan.jpg", data: await makeJpeg(), type: "image/jpeg" }]), headers: cookie ? { Cookie: cookie } : {} });
  expect(res.status).toBe(201);
  return ((await res.json()) as UploadedDocument[])[0]!;
}

async function login(name: string, password: string): Promise<string> {
  const res = await server.api("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, password }) });
  expect(res.status).toBe(204);
  return res.headers.get("Set-Cookie")!.split(";")[0]!;
}

describe("users", () => {
  test("the first user is the admin", () => {
    expect(server.ctx.users.list()).toEqual([{ id: 1, name: "admin", admin: true }]);
  });

  test("a single user left is admin", async () => {
    const { ctx } = server;
    const anna = await createUser(ctx.users, "anna", "", false);
    expect(ctx.users.passwordHash(anna.id)).toBeNull();
    await deleteUser(ctx.db, ctx.storage, 1);
    expect(ctx.users.list()).toEqual([{ id: anna.id, name: "anna", admin: true }]);
  });

  test("creating checks the name and the password", async () => {
    const { users } = server.ctx;
    await expect(createUser(users, " ", "geheim123", false)).rejects.toThrow("must not be empty");
    await expect(createUser(users, "anna maria", "geheim123", false)).rejects.toThrow("must not contain spaces");
    await expect(createUser(users, "admin", "geheim123", false)).rejects.toThrow("already exists");
    await expect(createUser(users, "anna", "kurz", false)).rejects.toThrow("at least");
    const anna = await createUser(users, " anna ", "geheim123", true);
    expect(anna).toMatchObject({ name: "anna", admin: true });
    expect(await Bun.password.verify("geheim123", users.passwordHash(anna.id)!)).toBe(true);
  });

  test("deleting removes the user's data and files and keeps the others'", async () => {
    const { ctx } = server;
    const own = await upload();
    await server.api(`/api/documents/${own.id}/duplicate`, { method: "POST" });
    const ownKey = ctx.documents.get(1, own.id)!.storageKey;
    const anna = await createUser(ctx.users, "anna", "annas-kennwort", false);
    const kept = await upload(await login("anna", "annas-kennwort"));
    const keptKey = ctx.documents.get(anna.id, kept.id)!.storageKey;

    expect(await ctx.storage.exists(derivedKeys.thumbnail(own.id))).toBe(true);
    expect(await deleteUser(ctx.db, ctx.storage, 1)).toBe(2);
    expect(ctx.users.list().map((u) => u.name)).toEqual(["anna"]);
    expect(documentCount(ctx.db, 1)).toBe(0);
    expect(ctx.db.query("SELECT COUNT(*) AS n FROM folders WHERE user_id = 1").get()).toEqual({ n: 0 });
    expect(await ctx.storage.exists(ownKey)).toBe(false);
    expect((await ctx.storage.list(`${derivedKeys.dir(own.id)}/*`)).length).toBe(0);
    expect(await ctx.storage.exists(keptKey)).toBe(true);
    expect(documentCount(ctx.db, anna.id)).toBe(1);
  });
});
