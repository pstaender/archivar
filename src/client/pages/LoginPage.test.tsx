import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { LOGGED_OUT_EVENT } from "../api";
import { deviceName } from "../passkeys";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const loggedOut = { user: null, passwordSet: true, usernameRequired: false, passkeyLogin: false };
const loggedIn = { user: { id: 1, name: "default", admin: true }, passwordSet: true, usernameRequired: false, passkeyLogin: false };

describe("login", () => {
  test("asks only for the password when there is one user, then shows the app", async () => {
    let session = false;
    fetchMock = mockFetch({
      "GET /api/auth/status": () => (session ? loggedIn : loggedOut),
      "POST /api/auth/login": (_url, init) => {
        if (JSON.parse(String(init.body)).password !== "geheim123") return Response.json({ error: "Wrong user name or password" }, { status: 401 });
        session = true;
      },
    });
    await renderApp(<p>Bibliothek</p>);
    expect(screen.queryByText("Bibliothek")).toBeNull();
    expect(screen.queryByLabelText("Benutzername")).toBeNull();

    fireEvent.change(screen.getByLabelText("Kennwort"), { target: { value: "falsch" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await screen.findByText("Das Kennwort ist falsch.");

    fireEvent.change(screen.getByLabelText("Kennwort"), { target: { value: "geheim123" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await screen.findByText("Bibliothek");
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ name: null, password: "falsch" });
  });

  test("asks for the user name when there are several users", async () => {
    fetchMock = mockFetch({
      "GET /api/auth/status": () => ({ ...loggedOut, usernameRequired: true }),
      "POST /api/auth/login": () => Response.json({ error: "Wrong user name or password" }, { status: 401 }),
    });
    await renderApp(<p>Bibliothek</p>);
    fireEvent.change(screen.getByLabelText("Benutzername"), { target: { value: "anna" } });
    fireEvent.change(screen.getByLabelText("Kennwort"), { target: { value: "geheim123" } });
    fireEvent.click(screen.getByRole("button", { name: "Anmelden" }));
    await screen.findByText("Benutzername oder Kennwort ist falsch.");
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ name: "anna", password: "geheim123" });
  });

  test("shows the login again when the session ends", async () => {
    let session = true;
    fetchMock = mockFetch({ "GET /api/auth/status": () => (session ? loggedIn : loggedOut) });
    await renderApp(<p>Bibliothek</p>);
    expect(screen.getByText("Bibliothek")).toBeTruthy();
    session = false;
    window.dispatchEvent(new Event(LOGGED_OUT_EVENT));
    await screen.findByRole("button", { name: "Anmelden" });
    expect(screen.queryByText("Bibliothek")).toBeNull();
  });

  test("names passkeys after browser and system", () => {
    expect(deviceName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe("Safari auf Mac");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge auf Windows");
    expect(deviceName("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36")).toBe("Chrome auf Android");
    expect(deviceName("curl/8.0")).toBe("Passkey");
  });
});
