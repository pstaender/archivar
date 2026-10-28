import { afterEach, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import { folder, mockFetch, renderApp, type FetchMock } from "../../../test/client";
import { FolderTargetDialog } from "./FolderTargetDialog";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

test("filters the folders while a name is typed, keeping parents and chosen folders", async () => {
  fetchMock = mockFetch({
    "GET /api/folders": () => [folder(1, "privat"), folder(2, "steuer"), folder(3, "steuer/2026"), folder(4, "wichtig")],
  });
  const onAdd = mock();
  await renderApp(<FolderTargetDialog open from={null} working={false} onMove={() => {}} onAdd={onAdd} onClose={() => {}} />);
  await screen.findByLabelText("wichtig");

  fireEvent.click(screen.getByLabelText("privat"));
  const input = screen.getByLabelText("Ordner suchen oder anlegen");
  fireEvent.change(input, { target: { value: "2026" } });
  expect(screen.getByLabelText("steuer/2026")).toBeTruthy();
  expect(screen.getByLabelText("steuer")).toBeTruthy();
  expect(screen.getByLabelText("privat")).toBeTruthy();
  expect(screen.queryByLabelText("wichtig")).toBeNull();

  fireEvent.click(screen.getByLabelText("steuer/2026"));
  fireEvent.change(input, { target: { value: "archiv" } });
  fireEvent.change(input, { target: { value: "" } });
  expect(screen.getByLabelText("wichtig")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Hinzufügen" }));
  expect(onAdd).toHaveBeenCalledWith(["privat", "steuer/2026"]);
});

test("says when no folder matches", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [folder(1, "privat")] });
  await renderApp(<FolderTargetDialog open from={null} working={false} onMove={() => {}} onAdd={() => {}} onClose={() => {}} />);
  await screen.findByLabelText("privat");
  fireEvent.change(screen.getByLabelText("Ordner suchen oder anlegen"), { target: { value: "archiv" } });
  expect(screen.getByText(/Kein passender Ordner/)).toBeTruthy();
});
