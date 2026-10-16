import { afterEach, expect, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { folder, mockFetch, renderApp, type FetchMock } from "../../../test/client";
import { FolderTree } from "./FolderTree";

let fetchMock: FetchMock;
afterEach(() => {
  fetchMock.restore();
  localStorage.clear();
});

test("folders start collapsed and remember being opened", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [folder(1, "wichtig", 0), folder(2, "wichtig/2026", 3)] });
  const first = await renderApp(<FolderTree />);
  await screen.findByText("wichtig");
  expect(screen.queryByText("2026")).toBeNull();

  fireEvent.click(screen.getByLabelText("Aufklappen"));
  expect(screen.getByText("2026")).toBeTruthy();
  first.unmount();

  await renderApp(<FolderTree />);
  await screen.findByText("wichtig");
  expect(screen.getByText("2026")).toBeTruthy();
  fireEvent.click(screen.getByLabelText("Zuklappen"));
  expect(JSON.parse(localStorage.getItem("archivar.expandedFolders")!)).toEqual([]);
});

test("renders nested folders with counts and marks the active one", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [folder(1, "wichtig", 0), folder(2, "wichtig/2026", 3)] });
  await renderApp(<FolderTree />, { path: "/folders/wichtig/2026" });

  const link = await screen.findByRole("link", { name: /2026/ });
  expect(link.getAttribute("href")).toBe("/folders/wichtig/2026");
  expect(link.textContent).toContain("3");
  expect(link.closest(".folder-tree__row")?.classList.contains("is-active")).toBe(true);
  expect(screen.getByRole("link", { name: "Alle Dokumente" }).classList.contains("is-active")).toBe(false);
});

test("creates a folder", async () => {
  const folders = [folder(1, "privat")];
  fetchMock = mockFetch({
    "GET /api/folders": () => folders,
    "POST /api/folders": (_url, init) => {
      const created = folder(2, JSON.parse(String(init.body)).path);
      folders.push(created);
      return created;
    },
  });
  await renderApp(<FolderTree />);
  await screen.findByText("privat");

  fireEvent.click(screen.getByLabelText("Neuer Ordner"));
  const input = screen.getByLabelText("Name des neuen Ordners");
  fireEvent.change(input, { target: { value: "steuer" } });
  fireEvent.submit(input.closest("form")!);

  await screen.findByText("steuer");
  expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ path: "steuer" });
});

test("shows a hint without folders", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [] });
  await renderApp(<FolderTree />);
  await waitFor(() => expect(screen.getByText("Noch keine Ordner")).toBeTruthy());
});
