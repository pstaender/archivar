import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { PreviewBar } from "./PreviewBar";

describe("PreviewBar", () => {
  test("requests a preview", () => {
    const onPreview = mock();
    render(<PreviewBar processing={false} showing={false} onPreview={onPreview} onLive={mock()} />);
    fireEvent.click(screen.getByRole("button", { name: "Vorschau" }));
    expect(onPreview).toHaveBeenCalled();
  });

  test("is disabled while the preview is being processed", () => {
    render(<PreviewBar processing showing={false} onPreview={mock()} onLive={mock()} />);
    const button = screen.getByRole("button", { name: /Vorschau wird berechnet/ });
    expect(button).toHaveProperty("disabled", true);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  test("goes back to the live preview", () => {
    const onLive = mock();
    render(<PreviewBar processing={false} showing onPreview={mock()} onLive={onLive} />);
    expect(screen.getByText(/Endergebnis/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Live-Ansicht" }));
    expect(onLive).toHaveBeenCalled();
  });
});
