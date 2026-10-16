import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { createMemoryRouter, Link, RouterProvider, useNavigate } from "react-router";
import { settle } from "../../../test/client";
import { UnsavedChangesDialog } from "../components/UnsavedChangesDialog";
import { useLeaveGuard } from "./leaveGuard";

function Editor({ initiallyDirty }: { initiallyDirty: boolean }) {
  const [dirty, setDirty] = useState(initiallyDirty);
  const [tab, setTab] = useState("edit");
  const leave = useLeaveGuard(dirty);
  const navigate = useNavigate();
  return (
    <>
      <Link to="/other">Weg</Link>
      <button type="button" onClick={() => leave.guard(() => setTab("text"))}>
        Text-Tab
      </button>
      <button type="button" onClick={() => setDirty(false)}>
        Speichern
      </button>
      <button
        type="button"
        onClick={() => {
          leave.skipNext();
          navigate("/other");
        }}
      >
        Löschen
      </button>
      <p>Tab: {tab}</p>
      {leave.asking && (
        <>
          <button type="button" onClick={leave.proceed}>
            Weiter
          </button>
          <button type="button" onClick={leave.stay}>
            Bleiben
          </button>
        </>
      )}
    </>
  );
}

async function setup(dirty = true) {
  const router = createMemoryRouter(
    [
      { path: "/doc", element: <Editor initiallyDirty={dirty} /> },
      { path: "/other", element: <p>Andere Seite</p> },
    ],
    { initialEntries: ["/doc"] },
  );
  render(<RouterProvider router={router} />);
  await settle();
  return router;
}

const click = async (name: string) => {
  fireEvent.click(screen.getByText(name));
  await settle();
};

describe("useLeaveGuard", () => {
  test("holds back navigation with unsaved changes until the user decides", async () => {
    const router = await setup();
    await click("Weg");
    expect(screen.getByText("Weiter")).toBeTruthy();
    expect(router.state.location.pathname).toBe("/doc");

    await click("Bleiben");
    expect(screen.queryByText("Weiter")).toBeNull();
    expect(router.state.location.pathname).toBe("/doc");

    await click("Weg");
    await click("Weiter");
    expect(router.state.location.pathname).toBe("/other");
    expect(screen.getByText("Andere Seite")).toBeTruthy();
  });

  test("holds back guarded in-page actions", async () => {
    await setup();
    await click("Text-Tab");
    expect(screen.getByText("Tab: edit")).toBeTruthy();
    await click("Weiter");
    expect(screen.getByText("Tab: text")).toBeTruthy();
  });

  test("lets everything through without unsaved changes", async () => {
    const router = await setup(false);
    await click("Text-Tab");
    expect(screen.getByText("Tab: text")).toBeTruthy();
    await click("Weg");
    expect(router.state.location.pathname).toBe("/other");
  });

  test("stops asking once the changes are saved", async () => {
    const router = await setup();
    await click("Speichern");
    await click("Weg");
    expect(router.state.location.pathname).toBe("/other");
  });

  test("skips the question for a navigation it was told about", async () => {
    const router = await setup();
    await click("Löschen");
    expect(router.state.location.pathname).toBe("/other");
  });

  test("asks the browser to confirm closing the tab", async () => {
    await setup();
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    await click("Speichern");
    const after = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

describe("UnsavedChangesDialog", () => {
  test("offers saving, discarding and staying", () => {
    const handlers = { onSave: mock(), onDiscard: mock(), onStay: mock() };
    render(<UnsavedChangesDialog open saving={false} {...handlers} />);
    expect(screen.getByText("Die Änderungen an diesem Bild sind noch nicht gespeichert.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(handlers.onSave).toHaveBeenCalledTimes(1);
    expect(handlers.onDiscard).toHaveBeenCalledTimes(1);
    expect(handlers.onStay).toHaveBeenCalledTimes(1);
  });

  test("disables the choices while saving", () => {
    render(<UnsavedChangesDialog open saving onSave={mock()} onDiscard={mock()} onStay={mock()} />);
    expect(screen.getByRole("button", { name: /Speichern/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Verwerfen" }).hasAttribute("disabled")).toBe(true);
  });
});
