import { afterEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { type FetchMock, mockFetch, renderApp } from "../../../test/client";
import { PresetDialog } from "./PresetDialog";

let fetchMock: FetchMock;
afterEach(() => fetchMock.restore());

const setup = (props: Partial<Parameters<typeof PresetDialog>[0]> = {}) => {
  fetchMock = mockFetch({ "GET /api/folders": () => [], "GET /api/settings": () => ({}), "GET /api/config": () => ({}) });
  const onSubmit = mock(async () => {});
  const onClose = mock();
  const rendered = renderApp(
    <PresetDialog
      open
      title="Bildeinstellung speichern"
      initialName="Rechnung März"
      steps={{ autoDewarp: true, autoBw: true, denoise: 2 }}
      submitLabel="Speichern"
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { rendered, onSubmit, onClose };
};

const checkbox = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("PresetDialog", () => {
  test("suggests the name and saves only the chosen steps", async () => {
    const { rendered, onSubmit, onClose } = setup();
    await rendered;
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Rechnung März");
    expect(checkbox("Automatisch entzerren").checked).toBe(true);
    expect(checkbox("Entrauschen: Mittel").checked).toBe(true);
    fireEvent.click(checkbox("Entrauschen: Mittel"));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: " Beleg " } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith("Beleg", { autoDewarp: true, autoBw: true });
  });

  test("needs a name and at least one step", async () => {
    const { rendered } = setup({ steps: { autoBw: true } });
    await rendered;
    const save = screen.getByRole("button", { name: "Speichern" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "  " } });
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "SW" } });
    expect(save.disabled).toBe(false);
    fireEvent.click(checkbox("Automatisch SW"));
    expect(save.disabled).toBe(true);
  });

  test("lets fixed values be changed when editing", async () => {
    const { rendered, onSubmit } = setup({ steps: { brightness: -0.09, colorMode: "grayscale" }, editValues: true });
    await rendered;
    expect(checkbox("Helligkeit -9 %")).toBeTruthy();
    fireEvent.change(screen.getByRole("slider", { name: "Helligkeit" }), { target: { value: "0.2" } });
    expect(checkbox("Helligkeit +20 %")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Farbmodus"), { target: { value: "bw" } });
    fireEvent.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("Rechnung März", { brightness: 0.2, colorMode: "bw" }));
  });
});
