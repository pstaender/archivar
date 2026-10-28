import { afterEach, expect, test } from "bun:test";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { type FetchMock, makeDocument, makeStack, mockFetch, renderApp } from "../../../test/client";
import { StackPage } from "./StackPage";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

test("reorders the pages of a stack by dragging", async () => {
  const documents = [makeDocument({ title: "Eins" }), makeDocument({ title: "Zwei" }), makeDocument({ title: "Drei" })];
  const stack = { ...makeStack({ id: 4, title: "Mappe", documentIds: documents.map((doc) => doc.id) }), documents };
  fetchMock = mockFetch({
    "GET /api/folders": () => [],
    "GET /api/stacks/4": () => stack,
    "PATCH /api/stacks/4": (_url, init) => {
      const ids = JSON.parse(String(init.body)).documentIds as number[];
      return { ...stack, documentIds: ids, documents: ids.map((id) => documents.find((doc) => doc.id === id)) };
    },
  });
  await renderApp(<StackPage />, { path: "/stacks/4", route: "/stacks/:id" });

  const grip = await screen.findByRole("button", { name: "Drei verschieben" });
  grip.focus();
  for (const key of [" ", "ArrowLeft", " "]) {
    await act(async () => {
      fireEvent.keyDown(grip, { code: key === " " ? "Space" : key, key });
    });
  }

  await waitFor(() => expect(fetchMock.calls.some((c) => c.method === "PATCH")).toBe(true));
  const ids = (fetchMock.calls.find((c) => c.method === "PATCH")!.body as { documentIds: number[] }).documentIds;
  expect(ids).toHaveLength(3);
  expect(ids).not.toEqual(documents.map((doc) => doc.id));
});
