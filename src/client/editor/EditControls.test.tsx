import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_EDIT_SETTINGS } from "../../shared/editSettings";
import type { EditSettings } from "../../shared/types";
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
    expect(screen.getByText("Mittel")).toBeTruthy();
  });
});
