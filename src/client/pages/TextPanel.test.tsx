import { expect, mock, spyOn, test } from "bun:test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { makeDocument, mockFetch, settle } from "../../../test/client";
import { ToastProvider } from "../hooks/toast";
import { TextPanel } from "./DocumentPage";


function setup(overrides: Parameters<typeof makeDocument>[0]) {
  const onRunOcr = mock();
  const onSave = mock(async () => {});
  render(
    <ToastProvider>
      <TextPanel doc={makeDocument(overrides)} onRunOcr={onRunOcr} onSave={onSave} />
    </ToastProvider>,
  );
  return { onRunOcr, onSave };
}

test("edits and saves recognized text", () => {
  const { onSave } = setup({ ocrStatus: "done", ocrText: "Hallo", ocrConfidence: 88.4 });
  expect(screen.getByText(/88 % Konfidenz/)).toBeTruthy();
  const save = screen.getByRole("button", { name: "Text speichern" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Erkannter Text"), { target: { value: "Hallo Welt" } });
  fireEvent.click(save);
  expect(onSave).toHaveBeenCalledWith("Hallo Welt");
});

test("starts OCR", () => {
  const { onRunOcr } = setup({ ocrStatus: "none" });
  fireEvent.click(screen.getByRole("button", { name: /Text erkennen/ }));
  expect(onRunOcr).toHaveBeenCalled();
});

test("disables editing while OCR runs and shows failures", () => {
  setup({ ocrStatus: "running" });
  expect((screen.getByLabelText("Erkannter Text") as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole("button", { name: /Erneut erkennen/ }) as HTMLButtonElement).disabled).toBe(true);
});

test("shows OCR errors", () => {
  setup({ ocrStatus: "failed", ocrError: "Kaputt" });
  expect(screen.getByText("Kaputt")).toBeTruthy();
});

test("offers to recognize all text parts after noise was removed", () => {
  const { onRunOcr } = setup({ ocrStatus: "done", ocrText: "Hallo", ocrRemoved: 3 });
  expect(screen.getByText(/3 unsichere Textteile wurden/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Alle Textteile erkennen" }));
  expect(onRunOcr).toHaveBeenCalledWith({ allText: true });
});

test("exports the image with the current text as a PDF download", async () => {
  const fetchMock = mockFetch({
    "POST /api/documents/7/pdf": () =>
      new Response(new Blob(["%PDF"]), { headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename*=UTF-8''Brief%20M%C3%A4rz.pdf" } }),
  });
  const createObjectURL = spyOn(URL, "createObjectURL").mockReturnValue("blob:pdf");
  const clicks: { href: string; download: string }[] = [];
  const click = spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.href, download: this.download });
  });
  try {
    setup({ id: 7, kind: "image", ocrStatus: "done", ocrText: "Hallo" });
    fireEvent.change(screen.getByLabelText("Erkannter Text"), { target: { value: "Hallo Welt" } });
    fireEvent.click(screen.getByRole("button", { name: "PDF" }));
    await settle();
    expect(fetchMock.calls).toEqual([{ method: "POST", path: "/api/documents/7/pdf", body: { text: "Hallo Welt" } }]);
    expect(clicks).toEqual([{ href: "blob:pdf", download: "Brief März.pdf" }]);
  } finally {
    fetchMock.restore();
    createObjectURL.mockRestore();
    click.mockRestore();
  }
});

test("offers the PDF export only for images and not while OCR runs", () => {
  setup({ kind: "pdf", ocrStatus: "done" });
  expect(screen.queryByRole("button", { name: "PDF" })).toBeNull();
  cleanup();
  setup({ kind: "image", ocrStatus: "running" });
  expect((screen.getByRole("button", { name: "PDF" }) as HTMLButtonElement).disabled).toBe(true);
});

test("shows the detected language and recognizes the text again in another language", () => {
  const { onRunOcr } = setup({ kind: "image", ocrStatus: "done", ocrText: "Bonjour", ocrLanguage: "fra" });
  expect(screen.getByText("Sprache: Französisch")).toBeTruthy();
  const select = screen.getByLabelText("Sprache für die Texterkennung") as HTMLSelectElement;
  expect(select.value).toBe("");
  expect(screen.getByRole("option", { name: "Automatisch (Deutsch + Englisch)" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /Erneut erkennen/ }));
  expect(onRunOcr).toHaveBeenLastCalledWith({});

  fireEvent.change(select, { target: { value: "ita" } });
  fireEvent.click(screen.getByRole("button", { name: /Auf Italienisch erkennen/ }));
  expect(onRunOcr).toHaveBeenLastCalledWith({ languages: ["ita"] });
});

test("goes back to the default languages and says when no language was detected", () => {
  const { onRunOcr } = setup({ kind: "image", ocrStatus: "done", ocrText: "12 3", ocrLanguage: null, ocrLanguages: ["ita"] });
  expect(screen.getByText("Sprache nicht erkannt")).toBeTruthy();
  const select = screen.getByLabelText("Sprache für die Texterkennung") as HTMLSelectElement;
  expect(select.value).toBe("ita");
  fireEvent.change(select, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /Erneut erkennen/ }));
  expect(onRunOcr).toHaveBeenLastCalledWith({ languages: null });
});

test("offers to hide unsure text parts again after all were kept", () => {
  const { onRunOcr } = setup({ ocrStatus: "done", ocrText: "Hallo ~~", ocrAllText: true });
  expect(screen.getByText(/Alle Textteile wurden übernommen/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Alle Textteile erkennen" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Unsichere Textteile ausblenden" }));
  expect(onRunOcr).toHaveBeenCalledWith({ allText: false });
});
