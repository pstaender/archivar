import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AuthStatus } from "../shared/auth";
import { startTestServer, type TestServer } from "../../test/server";
import { createUser, deleteUser } from "./services/users";

let server: TestServer;
beforeEach(async () => {
  server = await startTestServer();
});
afterEach(() => server.close());

const jsonInit = (method: string, body: unknown, cookie?: string): RequestInit => ({
  method,
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
});

/** The `name=value` part of the response's session cookie. */
function sessionCookie(res: Response): string {
  const cookie = res.headers.get("Set-Cookie");
  expect(cookie).toContain("HttpOnly");
  return cookie!.split(";")[0]!;
}

async function status(cookie?: string): Promise<AuthStatus> {
  return (await server.api("/api/auth/status", { headers: cookie ? { Cookie: cookie } : {} })).json();
}

async function setPassword(password: string, cookie?: string, currentPassword?: string): Promise<string> {
  const res = await server.api("/api/auth/password", jsonInit("PUT", { password, currentPassword }, cookie));
  expect(res.status).toBe(204);
  return sessionCookie(res);
}

describe("access", () => {
  test("without a password everything is open and no user name is asked for", async () => {
    expect(await status()).toEqual({ user: { id: 1, name: "admin", admin: true }, passwordSet: false, usernameRequired: false, passkeyLogin: false });
    expect((await server.api("/api/library")).status).toBe(200);
  });

  test("a password protects the API; the browser that set it stays logged in", async () => {
    const cookie = await setPassword("geheim123");
    expect((await server.api("/api/library")).status).toBe(401);
    expect(await status()).toEqual({ user: null, passwordSet: true, usernameRequired: false, passkeyLogin: false });
    expect((await server.api("/api/library", { headers: { Cookie: cookie } })).status).toBe(200);
    expect((await status(cookie)).user?.name).toBe("admin");

    const login = await server.api("/api/auth/login", jsonInit("POST", { password: "falsch123" }));
    expect(login.status).toBe(401);
    const loggedIn = sessionCookie(await server.api("/api/auth/login", jsonInit("POST", { password: "geheim123" })));
    expect((await server.api("/api/library", { headers: { Cookie: loggedIn } })).status).toBe(200);

    const logout = await server.api("/api/auth/logout", jsonInit("POST", {}, loggedIn));
    expect(logout.headers.get("Set-Cookie")).toContain("Max-Age=0");
    expect((await server.api("/api/library", { headers: { Cookie: loggedIn } })).status).toBe(401);
    expect((await server.api("/api/library", { headers: { Cookie: cookie } })).status).toBe(200);
  });

  test("passwords need a minimum length", async () => {
    const res = await server.api("/api/auth/password", jsonInit("PUT", { password: "kurz" }));
    expect(res.status).toBe(400);
  });

  test("changing or removing the password needs the current one and ends the other sessions", async () => {
    const first = await setPassword("geheim123");
    const other = sessionCookie(await server.api("/api/auth/login", jsonInit("POST", { password: "geheim123" })));

    expect((await server.api("/api/auth/password", jsonInit("PUT", { password: "neuesKennwort", currentPassword: "falsch" }, first))).status).toBe(403);
    const changed = await setPassword("neuesKennwort", first, "geheim123");
    expect((await server.api("/api/library", { headers: { Cookie: other } })).status).toBe(401);
    expect((await server.api("/api/library", { headers: { Cookie: changed } })).status).toBe(200);

    expect((await server.api("/api/auth/password", jsonInit("DELETE", { currentPassword: "geheim123" }, changed))).status).toBe(403);
    const removed = await server.api("/api/auth/password", jsonInit("DELETE", { currentPassword: "neuesKennwort" }, changed));
    expect(removed.status).toBe(204);
    expect((await server.api("/api/library")).status).toBe(200);
    expect((await status()).passwordSet).toBe(false);
  });

  test("API tokens keep working with a password", async () => {
    const cookie = await setPassword("geheim123");
    const { token } = await (await server.api("/api/tokens", jsonInit("POST", { name: "Scanner" }, cookie))).json();
    expect((await server.api("/api/library", { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  });

  test("with several users everyone logs in with user name and password", async () => {
    const anna = await createUser(server.ctx.users, "anna", "annas-kennwort", false);
    expect(anna).toEqual({ id: anna.id, name: "anna", admin: false });

    expect(await status()).toEqual({ user: null, passwordSet: true, usernameRequired: true, passkeyLogin: false });
    expect((await server.api("/api/library")).status).toBe(401);
    expect((await server.api("/api/auth/login", jsonInit("POST", { password: "annas-kennwort" }))).status).toBe(401);
    const cookie = sessionCookie(await server.api("/api/auth/login", jsonInit("POST", { name: "anna", password: "annas-kennwort" })));
    expect((await status(cookie)).user).toEqual({ id: anna.id, name: "anna", admin: false });
  });

  test("with several users a user without a password logs in with the name and an empty password", async () => {
    await createUser(server.ctx.users, "anna", "", false);
    expect(await status()).toEqual({ user: null, passwordSet: false, usernameRequired: true, passkeyLogin: false });
    expect((await server.api("/api/library")).status).toBe(401);
    expect((await server.api("/api/auth/login", jsonInit("POST", { name: "anna", password: "irgendwas" }))).status).toBe(401);
    expect((await server.api("/api/auth/login", jsonInit("POST", { name: "nobody", password: "" }))).status).toBe(401);
    const cookie = sessionCookie(await server.api("/api/auth/login", jsonInit("POST", { name: "anna", password: "" })));
    expect((await status(cookie)).user?.name).toBe("anna");
    const admin = sessionCookie(await server.api("/api/auth/login", jsonInit("POST", { name: "admin" })));
    expect((await status(admin)).user?.name).toBe("admin");
  });

  test("a single user with a password is asked only for it", async () => {
    await createUser(server.ctx.users, "anna", "annas-kennwort", false);
    await deleteUser(server.ctx.db, server.ctx.storage, 1);
    expect(await status()).toEqual({ user: null, passwordSet: true, usernameRequired: false, passkeyLogin: false });
    const cookie = sessionCookie(await server.api("/api/auth/login", jsonInit("POST", { password: "annas-kennwort" })));
    expect((await status(cookie)).user?.name).toBe("anna");
  });

  test("lists and deletes passkeys; removing the password removes them", async () => {
    const cookie = await setPassword("geheim123");
    const repo = server.ctx.authStore;
    const passkey = repo.addPasskey(1, { credentialId: "abc", publicKey: new Uint8Array([1, 2]), counter: 0, transports: ["internal"], name: "Safari auf Mac" });
    repo.addPasskey(1, { credentialId: "def", publicKey: new Uint8Array([3]), counter: 0, transports: [], name: "Firefox auf Linux" });

    expect((await status()).passkeyLogin).toBe(true);
    const list = await (await server.api("/api/auth/passkeys", { headers: { Cookie: cookie } })).json();
    expect(list.map((p: { name: string }) => p.name)).toEqual(["Safari auf Mac", "Firefox auf Linux"]);
    expect((await server.api(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE", headers: { Cookie: cookie } })).status).toBe(204);
    expect((await server.api(`/api/auth/passkeys/${passkey.id}`, { method: "DELETE", headers: { Cookie: cookie } })).status).toBe(404);
    expect((await server.api("/api/auth/passkeys")).status).toBe(401);

    await server.api("/api/auth/password", jsonInit("DELETE", { currentPassword: "geheim123" }, cookie));
    expect(repo.credentials(1)).toEqual([]);
  });

  test("passkey options: registration needs a password, logins get the user's credentials and a one-time challenge", async () => {
    expect((await server.api("/api/auth/passkeys/options", jsonInit("POST", {}))).status).toBe(400);
    const cookie = await setPassword("geheim123");
    const registration = await (await server.api("/api/auth/passkeys/options", jsonInit("POST", {}, cookie))).json();
    expect(registration.options.rp).toEqual({ name: "Archivar", id: "localhost" });
    expect(registration.options.user.name).toBe("admin");

    const repo = server.ctx.authStore;
    repo.addPasskey(1, { credentialId: "abc", publicKey: new Uint8Array([1]), counter: 0, transports: ["internal"], name: "Passkey" });
    const login = await (await server.api("/api/auth/passkey/options", jsonInit("POST", {}))).json();
    expect(login.options.allowCredentials).toEqual([{ id: "abc", type: "public-key", transports: ["internal"] }]);

    const response = { id: "abc", rawId: "abc", type: "public-key", response: {}, clientExtensionResults: {} };
    const attempt = await server.api("/api/auth/passkey", jsonInit("POST", { challengeId: login.challengeId, response }));
    expect(attempt.status).toBe(401);
    const again = await server.api("/api/auth/passkey", jsonInit("POST", { challengeId: login.challengeId, response }));
    expect(again.status).toBe(400);
  });
});
