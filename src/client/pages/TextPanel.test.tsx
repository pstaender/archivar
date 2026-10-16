import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { makeDocument } from "../../../test/client";
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
