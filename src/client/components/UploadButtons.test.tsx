import { afterEach, describe, expect, test } from "bun:test";
import { act, fireEvent, screen } from "@testing-library/react";
import { makeDocument, mockFetch, mockXhr, renderApp, type FetchMock } from "../../../test/client";
import { uploadAccept } from "../../shared/uploads";
import { UploadButtons } from "./UploadButtons";
import { UploadProgress } from "./UploadProgress";

let fetchMock: FetchMock;
let xhr: ReturnType<typeof mockXhr>;
afterEach(() => {
  fetchMock.restore();
  xhr.restore();
});

async function setup(convertibleImageTypes: string[] = [], routes: Parameters<typeof mockFetch>[0] = {}) {
  fetchMock = mockFetch({
    "GET /api/folders": () => [],
    "GET /api/config": () => ({ dewarpAvailable: false, convertibleImageTypes }),
    ...routes,
  });
  xhr = mockXhr();
  await renderApp(
    <>
      <UploadButtons />
      <UploadProgress />
    </>,
  );
  return screen.getByTestId("file-input") as HTMLInputElement;
}

const file = (name: string, type: string) => new File(["1234"], name, { type });

describe("UploadButtons", () => {
  test("only offers supported file types", async () => {
    const input = await setup();
    expect(input.accept).toBe(uploadAccept());
    expect(input.accept).not.toContain("heic");
  });

  test("also offers formats the server can convert", async () => {
    const input = await setup(["image/heic"]);
    expect(input.accept).toBe(uploadAccept(["image/heic"]));
    await act(async () => {
      fireEvent.change(input, { target: { files: [file("foto.heic", "image/heic"), file("bild.webp", "image/webp")] } });
    });
    expect(xhr.uploads).toHaveLength(1);
    expect((xhr.uploads[0]!.body.get("files") as File).name).toBe("foto.heic");
    await act(async () => xhr.uploads[0]!.respond(201, [makeDocument()]));
  });

  test("skips unsupported files and shows the progress per file", async () => {
    const input = await setup();
    await act(async () => {
      fireEvent.change(input, {
        target: { files: [file("a.jpg", "image/jpeg"), file("notes.txt", "text/plain"), file("b.pdf", "application/pdf")] },
      });
    });

    expect(screen.getByText("1 Datei wird nicht unterstützt und wurde übersprungen")).toBeTruthy();
    expect(xhr.uploads).toHaveLength(1);
    expect((xhr.uploads[0]!.body.get("files") as File).name).toBe("a.jpg");
    expect(screen.getByText("Lade Datei 1 von 2 hoch …")).toBeTruthy();

    await act(async () => xhr.uploads[0]!.progress(50, 100));
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");

    await act(async () => xhr.uploads[0]!.progress(100, 100));
    expect(screen.getByText("Verarbeite Datei 1 von 2 …")).toBeTruthy();

    await act(async () => xhr.uploads[0]!.respond(201, [makeDocument()]));
    expect(screen.getByText("Lade Datei 2 von 2 hoch …")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");

    await act(async () => xhr.uploads[1]!.respond(201, [makeDocument()]));
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(screen.getByText("2 Dateien hochgeladen")).toBeTruthy();
  });

  test("keeps uploading after a failed file", async () => {
    const input = await setup();
    await act(async () => {
      fireEvent.change(input, { target: { files: [file("a.jpg", "image/jpeg"), file("b.jpg", "image/jpeg")] } });
    });
    await act(async () => xhr.uploads[0]!.respond(500, { error: "Kaputt" }));
    await act(async () => xhr.uploads[1]!.respond(201, [makeDocument()]));
    expect(screen.getByText("a.jpg: Kaputt")).toBeTruthy();
    expect(screen.getByText("1 Datei hochgeladen")).toBeTruthy();
  });

  test("follows the uploads in an import job and reports files that did not arrive", async () => {
    const items = [
      { id: 11, name: "a.jpg", state: "pending", error: null, document: null },
      { id: 12, name: "b.jpg", state: "pending", error: null, document: null },
    ];
    const input = await setup([], {
      "POST /api/jobs": () => ({ id: 5, kind: "import", options: null, createdAt: "", active: true, items }),
      "PATCH /api/jobs/5/items/12": () => undefined,
    });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file("a.jpg", "image/jpeg"), file("b.jpg", "image/jpeg")] } });
    });
    expect(fetchMock.calls.find((c) => c.method === "POST")?.body).toEqual({ kind: "import", files: ["a.jpg", "b.jpg"] });
    expect(xhr.uploads[0]!.body.get("jobItemId")).toBe("11");
    await act(async () => xhr.uploads[0]!.respond(201, [makeDocument()]));
    expect(xhr.uploads[1]!.body.get("jobItemId")).toBe("12");
    await act(async () => xhr.uploads[1]!.respond(500, { error: "Speicher voll" }));
    expect(fetchMock.calls.find((c) => c.method === "PATCH")).toMatchObject({ path: "/api/jobs/5/items/12", body: { error: "Speicher voll" } });
  });
});
