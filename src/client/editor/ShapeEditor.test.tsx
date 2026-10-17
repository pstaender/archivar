import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import type { Shape } from "../../shared/shapes";
import { ShapeCanvas, ShapeControls } from "./ShapeEditor";

const rect = (overrides: Partial<Shape> = {}): Shape => ({ id: "a", type: "rect", x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: "#000000", ...overrides });

function Harness({ initial = [], onChange }: { initial?: Shape[]; onChange?: (shapes: Shape[]) => void }) {
  const [shapes, setShapes] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [color, setColor] = useState("#000000");
  const change = (next: Shape[]) => {
    setShapes(next);
    onChange?.(next);
  };
  return (
    <>
      <ShapeCanvas src="/img" alt="Bild" shapes={shapes} selected={selected} color={color} onChange={change} onSelect={setSelected} />
      <ShapeControls
        shapes={shapes}
        selected={selected}
        color={color}
        outdated={false}
        hasText={false}
        dirty
        saving={false}
        onColorChange={setColor}
        onChange={change}
        onSelect={setSelected}
        onSave={() => {}}
        onDiscard={() => {}}
      />
    </>
  );
}

/** A 200 × 100 px overlay at the origin. */
function setup(initial: Shape[] = []) {
  const onChange = mock();
  const view = render(<Harness initial={initial} onChange={onChange} />);
  const overlay = view.container.querySelector(".shape-overlay") as HTMLElement;
  overlay.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  const last = (): Shape[] => onChange.mock.calls.at(-1)?.[0] ?? initial;
  return { overlay, last };
}

// Compared one by one: toMatchObject with expect.closeTo replaces the values in the received object.
const expectBox = (shape: Shape | undefined, box: Pick<Shape, "x" | "y" | "width" | "height">) => {
  for (const key of ["x", "y", "width", "height"] as const) expect(shape?.[key]).toBeCloseTo(box[key]);
};

const drag = (target: Element, from: [number, number], to: [number, number]) => {
  fireEvent.pointerDown(target, { button: 0, clientX: from[0], clientY: from[1], pointerId: 1 });
  fireEvent.pointerMove(target, { clientX: to[0], clientY: to[1], pointerId: 1 });
  fireEvent.pointerUp(target, { clientX: to[0], clientY: to[1], pointerId: 1 });
};

describe("ShapeCanvas", () => {
  test("draws a rectangle in the colour for new ones, in any direction", () => {
    const { overlay, last } = setup();
    fireEvent.click(screen.getByRole("radio", { name: "Weiß" }));
    drag(overlay, [150, 80], [50, 20]);
    expect(last()).toHaveLength(1);
    expectBox(last()[0], { x: 0.25, y: 0.2, width: 0.5, height: 0.6 });
    expect(last()[0]!.color).toBe("#ffffff");
    expect(screen.getByRole("button", { name: "Rechteck 1" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("1 Rechteck")).toBeTruthy();
  });

  test("a click without dragging draws nothing", () => {
    const { overlay, last } = setup();
    drag(overlay, [50, 50], [50, 50]);
    expect(last()).toEqual([]);
  });

  test("moves a rectangle inside the image and resizes it at its handles", () => {
    const { last } = setup([rect()]);
    const shape = screen.getByRole("button", { name: "Rechteck 1" });
    drag(shape, [40, 20], [400, 40]);
    expectBox(last()[0], { x: 0.8, y: 0.3, width: 0.2, height: 0.2 });

    const handle = shape.querySelector(".shape__handle--se")!;
    drag(handle, [200, 50], [100, 90]);
    expectBox(last()[0], { x: 0.5, y: 0.3, width: 0.3, height: 0.6 });
  });

  test("moves with the arrow keys and deletes with Entf", () => {
    const { last } = setup([rect(), rect({ id: "b", x: 0.5 })]);
    const shape = screen.getByRole("button", { name: "Rechteck 1" });
    fireEvent.keyDown(shape, { key: "ArrowRight", shiftKey: true });
    expect(last()[0]!.x).toBeCloseTo(0.15);
    fireEvent.keyDown(shape, { key: "ArrowDown", altKey: true });
    expect(last()[0]!.height).toBeCloseTo(0.205);
    fireEvent.keyDown(screen.getByRole("button", { name: "Rechteck 1" }), { key: "Delete" });
    expect(last().map((s) => s.id)).toEqual(["b"]);
  });

  test("changes the colour of the selected rectangle and removes all", () => {
    const { last } = setup([rect(), rect({ id: "b", x: 0.5 })]);
    fireEvent.focus(screen.getByRole("button", { name: "Rechteck 2" }));
    expect(screen.getByText("Farbe des Rechtecks")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Eigene Farbe"), { target: { value: "#336699" } });
    expect(last().map((s) => s.color)).toEqual(["#000000", "#336699"]);
    fireEvent.click(screen.getByRole("button", { name: "Rechteck löschen" }));
    expect(last().map((s) => s.id)).toEqual(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Alle entfernen" }));
    expect(last()).toEqual([]);
    expect(screen.getByText("Noch keine Rechtecke.")).toBeTruthy();
  });
});
