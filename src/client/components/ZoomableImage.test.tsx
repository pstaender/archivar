import { describe, expect, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { ZoomableImage } from "./ZoomableImage";

function setup() {
  render(<ZoomableImage src="/bild.jpg" alt="Rechnung" />);
  const image = screen.getByRole("img", { name: "Rechnung" }) as HTMLImageElement;
  Object.defineProperty(image, "naturalWidth", { value: 2000 });
  Object.defineProperty(image, "naturalHeight", { value: 1000 });
  fireEvent.load(image);
  return image;
}

const value = () => screen.getByLabelText("Zoomstufe").textContent;

describe("ZoomableImage", () => {
  test("fits the image by default", () => {
    setup();
    expect(screen.getByRole("button", { name: /Einpassen/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Verkleinern" })).toHaveProperty("disabled", true);
  });

  test("100 % shows the image at its natural size", () => {
    const image = setup();
    fireEvent.click(screen.getByRole("button", { name: "100 %" }));
    expect(value()).toBe("100 %");
    expect(image.style.width).toBe("2000px");
  });

  test("zoom buttons step through the zoom levels and fit resets", () => {
    const image = setup();
    fireEvent.click(screen.getByRole("button", { name: "100 %" }));
    fireEvent.click(screen.getByRole("button", { name: "Vergrößern" }));
    expect(value()).toBe("150 %");
    expect(image.className).toContain("is-magnified");
    fireEvent.click(screen.getByRole("button", { name: "Verkleinern" }));
    expect(value()).toBe("100 %");
    fireEvent.click(screen.getByRole("button", { name: /Einpassen/ }));
    expect(image.style.width).toBe("");
  });

  test("links to the full image", () => {
    setup();
    expect(screen.getByRole("link", { name: "In neuem Tab öffnen" }).getAttribute("href")).toBe("/bild.jpg");
  });
});
