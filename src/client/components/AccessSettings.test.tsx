import { afterEach, describe, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { AccessSettings } from "./AccessSettings";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const statusWith = (passwordSet: boolean) => ({ user: { id: 1, name: "admin", admin: true }, passwordSet, usernameRequired: false, passkeyLogin: false });
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("AccessSettings", () => {
  test("sets a password once both entries match", async () => {
    let passwordSet = false;
    fetchMock = mockFetch({
      "GET /api/auth/status": () => statusWith(passwordSet),
      "PUT /api/auth/password": () => {
        passwordSet = true;
      },
      "GET /api/auth/passkeys": () => [],
    });
    await renderApp(<AccessSettings />);
    const submit = () => screen.getByRole("button", { name: "Kennwort festlegen" }) as HTMLButtonElement;

    type("Kennwort", "kurz");
    expect(screen.getByText("Mindestens 8 Zeichen.")).toBeTruthy();
    type("Kennwort", "geheim123");
    type("Kennwort wiederholen", "geheim12");
    expect(screen.getByText("Die Kennwörter stimmen nicht überein.")).toBeTruthy();
    expect(submit().disabled).toBe(true);
    type("Kennwort wiederholen", "geheim123");
    fireEvent.click(submit());

    await screen.findByText("Kennwort festgelegt");
    expect(fetchMock.calls.find((c) => c.method === "PUT")?.body).toEqual({ password: "geheim123", currentPassword: null });
    await screen.findByRole("button", { name: "Kennwort ändern" });
    expect(screen.getByText(/Noch keine Passkeys/)).toBeTruthy();
  });

  test("removes the password with the current one and deletes passkeys", async () => {
    let passwordSet = true;
    fetchMock = mockFetch({
      "GET /api/auth/status": () => statusWith(passwordSet),
      "GET /api/auth/passkeys": () => [
        { id: 4, name: "Safari auf Mac", createdAt: "2026-10-01T10:00:00.000Z", lastUsedAt: "2026-10-16T08:00:00.000Z" },
        { id: 5, name: "Firefox auf Linux", createdAt: "2026-10-02T10:00:00.000Z", lastUsedAt: null },
      ],
      "DELETE /api/auth/passkeys/4": () => undefined,
      "DELETE /api/auth/password": (_url, init) =>
        JSON.parse(String(init.body)).currentPassword === "geheim123" ? (passwordSet = false, undefined) : Response.json({ error: "Wrong current password" }, { status: 403 }),
    });
    await renderApp(<AccessSettings />);
    await screen.findByText("Safari auf Mac");

    fireEvent.click(screen.getByRole("button", { name: "Passkey „Safari auf Mac“ löschen" }));
    await waitFor(() => expect(screen.queryByText("Safari auf Mac") === null).toBe(true));
    expect(screen.getByText("Firefox auf Linux")).toBeTruthy();

    const remove = screen.getByRole("button", { name: "Kennwort entfernen" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    type("Aktuelles Kennwort", "falsch");
    fireEvent.click(remove);
    await screen.findByText("Das aktuelle Kennwort ist falsch.");
    type("Aktuelles Kennwort", "geheim123");
    fireEvent.click(remove);
    await screen.findByText("Kennwort entfernt");
    await screen.findByRole("button", { name: "Kennwort festlegen" });
    expect(screen.queryByText("Firefox auf Linux")).toBeNull();
  });
});
