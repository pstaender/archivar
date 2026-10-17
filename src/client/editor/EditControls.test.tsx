import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { EditSettings } from "../../shared/types";
import { GRAY_MIX_PRESETS, LUMA_GRAY_MIX } from "../../shared/image/grayMix";
import { EditControls } from "./EditControls";
import { rectQuad } from "./geometry";


function setup(overrides: Partial<EditSettings> = {}, mode: "none" | "crop" | "perspective" = "none", dewarpAvailable = false) {
  const onChange = mock();
  const onModeChange = mock();
  const onAutoDewarp = mock();
  const settings = { ...DEFAULT_EDIT_SETTINGS, ...overrides };
  render(
    <EditControls
      settings={settings}
      onChange={onChange}
      mode={mode}
      onModeChange={onModeChange}
      dewarpAvailable={dewarpAvailable}
      onAutoDewarp={onAutoDewarp}
    />,
  );
  return { onChange, onModeChange, onAutoDewarp, settings };
}

const dewarp = { rotation: 0 as const, columns: 31, rows: 45, points: new Array(2790).fill(0) };

describe("EditControls", () => {
  test("grayscale shows a slider per hue, starting at the plain conversion", () => {
    const { onChange } = setup({ colorMode: "grayscale" });
    const reds = screen.getByLabelText("Rottöne") as HTMLInputElement;
    expect(reds.value).toBe(String(LUMA_GRAY_MIX.reds));
    expect((screen.getByLabelText("Kanäle") as HTMLSelectElement).value).toBe("luma");
    expect((screen.getByRole("button", { name: "Alle zurücksetzen" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reds, { target: { value: "150" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayMix: { ...LUMA_GRAY_MIX, reds: 150 } }));
  });

  test("grayscale channels can be picked from filters and reset all at once", () => {
    const red = GRAY_MIX_PRESETS.find((p) => p.id === "red")!.mix;
    const { onChange } = setup({ colorMode: "grayscale", grayMix: { ...red, blues: 0 } });
    const select = screen.getByLabelText("Kanäle") as HTMLSelectElement;
    expect(select.value).toBe("custom");
    expect((screen.getByLabelText("Blautöne") as HTMLInputElement).value).toBe("0");
    fireEvent.change(select, { target: { value: "red" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayMix: red }));
    fireEvent.click(screen.getByRole("button", { name: "Alle zurücksetzen" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayMix: null }));
  });

  test("grayscale can add a threshold that starts at the S/W threshold", () => {
    const { onChange } = setup({ colorMode: "grayscale", bwThreshold: 140 });
    expect(screen.queryByLabelText("Schwelle") === null).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Schwellenwert" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayThreshold: 140 }));
  });

  test("the grayscale threshold slider changes the threshold and can be switched off", () => {
    const { onChange } = setup({ colorMode: "grayscale", grayThreshold: 90 });
    fireEvent.change(screen.getByLabelText("Schwelle"), { target: { value: "110" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayThreshold: 110 }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Schwellenwert" }));
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayThreshold: null }));
  });

  test("moving the channels back to the plain conversion stores no mix", () => {
    const { onChange } = setup({ colorMode: "grayscale", grayMix: { ...LUMA_GRAY_MIX, reds: 31 } });
    fireEvent.change(screen.getByLabelText("Rottöne"), { target: { value: String(LUMA_GRAY_MIX.reds) } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayMix: null }));
  });

  test("rotating also rotates an existing crop", () => {
    const corners = rectQuad(0, 0, 1, 0.5);
    const { onChange } = setup({ corners });
    fireEvent.click(screen.getByLabelText("Nach rechts drehen"));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rotation: 90, corners: rectQuad(0.5, 0, 1, 1) }));
  });

  test("rotating left wraps to 270", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByLabelText("Nach links drehen"));
    expect(onChange.mock.calls[0]![0].rotation).toBe(270);
  });

  test("switching to crop turns a perspective quad into its bounding box", () => {
    const corners = [
      { x: 0.1, y: 0.2 },
      { x: 0.9, y: 0.1 },
      { x: 0.8, y: 0.9 },
      { x: 0.2, y: 0.8 },
    ] as EditSettings["corners"];
    const { onChange, onModeChange } = setup({ corners }, "perspective");
    fireEvent.click(screen.getByRole("button", { name: /Zuschneiden/ }));
    expect(onChange.mock.calls[0]![0].corners).toEqual(rectQuad(0.1, 0.1, 0.9, 0.9));
    expect(onModeChange).toHaveBeenCalledWith("crop");
  });

  test("Enter applies the corners, also when a button has focus", () => {
    const onAutoCrop = mock();
    const onModeChange = mock();
    render(<EditControls settings={DEFAULT_EDIT_SETTINGS} onChange={mock()} mode="perspective" onModeChange={onModeChange} onAutoCrop={onAutoCrop} />);
    const button = screen.getByRole("button", { name: /Auto-Zuschnitt/ });
    button.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    expect(onModeChange).toHaveBeenCalledWith("none");
    expect(event.defaultPrevented).toBe(true);
    expect(onAutoCrop).not.toHaveBeenCalled();
  });

  test("Enter is left alone without geometry editing and in text fields", () => {
    const { onModeChange } = setup({}, "none");
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onModeChange).not.toHaveBeenCalled();

    const input = document.createElement("input");
    document.body.append(input);
    const crop = setup({}, "crop");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(crop.onModeChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Enter" });
    expect(crop.onModeChange).toHaveBeenCalledWith("none");
    input.remove();
  });

  test("clicking the active mode again leaves geometry editing", () => {
    const { onModeChange } = setup({}, "perspective");
    fireEvent.click(screen.getByRole("button", { name: /Entzerren/ }));
    expect(onModeChange).toHaveBeenCalledWith("none");
  });

  test("sliders update their setting", () => {
    const { onChange } = setup();
    fireEvent.change(screen.getByLabelText("Helligkeit"), { target: { value: "0.4" } });
    expect(onChange.mock.calls[0]![0].brightness).toBe(0.4);
  });

  test("color mode controls show the relevant options", () => {
    const { onChange } = setup({ colorMode: "bw" });
    expect(screen.getByLabelText("Schwelle")).toBeTruthy();
    expect(screen.queryByLabelText("Farbton")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Graustufen" }));
    expect(onChange.mock.calls[0]![0].colorMode).toBe("grayscale");
  });

  test("auto dewarp is hidden without the model", () => {
    setup();
    expect(screen.queryByRole("button", { name: /Automatisch entzerren/ })).toBeNull();
  });

  test("auto dewarp requests a grid", () => {
    const { onAutoDewarp } = setup({}, "none", true);
    fireEvent.click(screen.getByRole("button", { name: /Automatisch entzerren/ }));
    expect(onAutoDewarp).toHaveBeenCalled();
  });

  test("clicking active auto dewarp removes it together with the crop", () => {
    const { onChange } = setup({ dewarp, corners: rectQuad(0.1, 0.1, 0.9, 0.9) }, "none", true);
    fireEvent.click(screen.getByRole("button", { name: /Automatisch entzerren/ }));
    expect(onChange.mock.calls[0]![0]).toMatchObject({ dewarp: null, corners: null });
  });

  test("rotating discards the dewarp grid", () => {
    const { onChange } = setup({ dewarp }, "none", true);
    fireEvent.click(screen.getByLabelText("Nach rechts drehen"));
    expect(onChange.mock.calls[0]![0]).toMatchObject({ rotation: 90, dewarp: null });
  });

  test("denoise shows a readable level", () => {
    setup({ denoise: 2 });
    expect(screen.getByText(/Stärke: Mittel/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Entrauschen/ }).getAttribute("aria-pressed")).toBe("true");
  });

  test("the denoise button increases the strength", () => {
    const { onChange } = setup({ denoise: 1 });
    fireEvent.click(screen.getByRole("button", { name: /Entrauschen/ }));
    expect(onChange.mock.calls[0]![0].denoise).toBe(2);
  });

  test("the denoise button turns off after the strongest level", () => {
    const { onChange } = setup({ denoise: 3 });
    fireEvent.click(screen.getByRole("button", { name: /Entrauschen/ }));
    expect(onChange.mock.calls[0]![0].denoise).toBe(0);
  });

  test("auto black and white shows the current variant", () => {
    const onAutoBw = mock();
    render(
      <EditControls
        settings={{ ...DEFAULT_EDIT_SETTINGS, colorMode: "bw" }}
        onChange={mock()}
        mode="none"
        onModeChange={mock()}
        autoBw={{ index: 1, count: 3, shade: "darker" }}
        onAutoBw={onAutoBw}
      />,
    );
    const button = screen.getByRole("button", { name: /Automatisch SW/ });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Variante 2 von 3 · dunkler/)).toBeTruthy();
    fireEvent.click(button);
    expect(onAutoBw).toHaveBeenCalled();
  });

  test("automatic rotation and cropping call their handlers and show progress", () => {
    const onAutoRotate = mock();
    const onAutoCrop = mock();
    const props = { settings: DEFAULT_EDIT_SETTINGS, onChange: mock(), mode: "none" as const, onModeChange: mock(), onAutoRotate, onAutoCrop };
    const { rerender } = render(<EditControls {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /Auto-Drehen/ }));
    fireEvent.click(screen.getByRole("button", { name: /Auto-Zuschnitt/ }));
    expect(onAutoRotate).toHaveBeenCalledTimes(1);
    expect(onAutoCrop).toHaveBeenCalledTimes(1);

    rerender(<EditControls {...props} rotating />);
    expect(screen.getByRole("button", { name: /Auto-Drehen/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Textausrichtung wird erkannt …")).toBeTruthy();
    rerender(<EditControls {...props} cropping />);
    expect(screen.getByRole("button", { name: /Auto-Zuschnitt/ }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Seitenrand wird gesucht …")).toBeTruthy();
  });
});
