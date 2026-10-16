import { afterEach, expect, mock, test } from "bun:test";
import { fireEvent, screen } from "@testing-library/react";
import { folder, mockFetch, renderApp, type FetchMock } from "../../../test/client";
import { FolderPicker } from "./FolderPicker";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

test("adds normalized folders on Enter and removes them", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [folder(1, "wichtig")] });
  const onChange = mock();
  await renderApp(<FolderPicker value={["privat"]} onChange={onChange} />);

  const input = screen.getByLabelText("Ordner");
  fireEvent.change(input, { target: { value: " wichtig / 2026 " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).toHaveBeenLastCalledWith(["privat", "wichtig/2026"]);

  fireEvent.click(screen.getByLabelText("privat entfernen"));
  expect(onChange).toHaveBeenLastCalledWith([]);
});

test("ignores duplicates and empty input", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [] });
  const onChange = mock();
  await renderApp(<FolderPicker value={["a"]} onChange={onChange} />);
  const input = screen.getByLabelText("Ordner");
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.change(input, { target: { value: " / " } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onChange).not.toHaveBeenCalled();
});

test("backspace on empty input removes the last folder", async () => {
  fetchMock = mockFetch({ "GET /api/folders": () => [] });
  const onChange = mock();
  await renderApp(<FolderPicker value={["a", "b"]} onChange={onChange} />);
  fireEvent.keyDown(screen.getByLabelText("Ordner"), { key: "Backspace" });
  expect(onChange).toHaveBeenCalledWith(["a"]);
});
