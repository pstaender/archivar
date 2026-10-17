import { afterEach, describe, expect, test } from "bun:test";
import { mockFetch, mockXhr, type FetchMock } from "../../test/client";
import { PREVIEW_SIZE } from "../shared/preview";
import { api, ApiRequestError, assetUrl } from "./api";

let fetchMock: FetchMock;

afterEach(() => fetchMock?.restore());

describe("api client", () => {
  test("builds library queries without empty params", async () => {
    fetchMock = mockFetch({ "GET /api/library": () => [] });
    await api.library({ folder: "wichtig/2026", q: "" });
    expect(fetchMock.calls[0]!.path).toBe("/api/library?folder=wichtig%2F2026");
  });

  test("sends JSON bodies", async () => {
    fetchMock = mockFetch({ "PATCH /api/documents/3": (_url, init) => JSON.parse(String(init.body)) });
    const result = await api.updateDocument(3, { title: "Neu" });
    expect(result).toEqual({ title: "Neu" } as never);
    expect(fetchMock.calls[0]).toMatchObject({ method: "PATCH", body: { title: "Neu" } });
  });

  test("uploads files as multipart form data and reports progress", async () => {
    const xhr = mockXhr();
    const progress: number[] = [];
    const result = api.upload([new File(["a"], "a.jpg"), new File(["b"], "b.pdf")], { folders: ["x"], stackId: 4, ocr: true }, (loaded, total) =>
      progress.push(loaded / total),
    );
    const [upload] = xhr.uploads;
    expect(upload!.path).toBe("/api/documents");
    expect(upload!.body.getAll("files")).toHaveLength(2);
    expect(upload!.body.get("folders")).toBe('["x"]');
    expect(upload!.body.get("stackId")).toBe("4");
    expect(upload!.body.get("ocr")).toBe("true");
    expect(upload!.body.get("dewarp")).toBeNull();
    upload!.progress(50, 100);
    upload!.respond(201, []);
    expect(await result).toEqual([]);
    expect(progress).toEqual([0.5]);
    xhr.restore();
  });

  test("rejects failed uploads with the server message", async () => {
    const xhr = mockXhr();
    const result = api.upload([new File(["a"], "a.jpg")]).catch((e) => e);
    xhr.uploads[0]!.respond(413, { error: "Datei zu groß" });
    expect(await result).toMatchObject({ status: 413, message: "Datei zu groß" });
    xhr.restore();
  });

  test("requests a dewarp grid for the current rotation", async () => {
    fetchMock = mockFetch({ "POST /api/documents/2/dewarp": () => ({ rotation: 90 }) });
    await api.detectDewarp(2, 90);
    expect(fetchMock.calls[0]!.body).toEqual({ rotation: 90 });
  });

  test("renders a preview of unsaved settings as an image", async () => {
    fetchMock = mockFetch({ "POST /api/documents/4/render": () => new Response("jpeg", { headers: { "Content-Type": "image/jpeg" } }) });
    const blob = await api.renderPreview(4, { colorMode: "bw" } as never);
    expect(await blob.text()).toBe("jpeg");
    expect(fetchMock.calls[0]!.body).toEqual({ editSettings: { colorMode: "bw" } });
  });

  test("asks for the orientation and the page outline", async () => {
    fetchMock = mockFetch({
      "POST /api/documents/4/orientation": () => ({ rotation: 90 }),
      "POST /api/documents/4/auto-crop": () => ({ corners: null }),
    });
    expect(await api.detectOrientation(4)).toEqual({ rotation: 90 });
    expect(await api.autoCrop(4, { rotation: 90 } as never)).toEqual({ corners: null });
    expect(fetchMock.calls[1]!.body).toEqual({ editSettings: { rotation: 90 } });
  });

  test("returns undefined for 204 responses", async () => {
    fetchMock = mockFetch({ "DELETE /api/documents/1": () => undefined });
    expect(await api.deleteDocument(1)).toBeUndefined();
  });

  test("throws ApiRequestError with the server message", async () => {
    fetchMock = mockFetch({ "GET /api/documents/9": () => Response.json({ error: "Document not found" }, { status: 404 }) });
    const error = await api.document(9).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 404, message: "Document not found" });
  });
});

test("assetUrl adds a cache-busting version", () => {
  expect(assetUrl({ id: 5, updatedAt: "2026-01-01T00:00:00Z" }, "thumbnail")).toBe(
    "/api/documents/5/thumbnail?v=2026-01-01T00%3A00%3A00Z",
  );
  expect(assetUrl({ id: 5, updatedAt: "2026-01-01T00:00:00Z" }, "preview")).toBe(
    `/api/documents/5/preview?v=2026-01-01T00%3A00%3A00Z-${PREVIEW_SIZE}`,
  );
});
