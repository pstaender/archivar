import { afterEach, describe, expect, test } from "bun:test";
import { mockFetch, type FetchMock } from "../../test/client";
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

  test("uploads files as multipart form data", async () => {
    let form: FormData | null = null;
    fetchMock = mockFetch({
      "POST /api/documents": (_url, init) => {
        form = init.body as FormData;
        return [];
      },
    });
    await api.upload([new File(["a"], "a.jpg"), new File(["b"], "b.pdf")], { folders: ["x"], stackId: 4, ocr: true });
    expect(form!.getAll("files")).toHaveLength(2);
    expect(form!.get("folders")).toBe('["x"]');
    expect(form!.get("stackId")).toBe("4");
    expect(form!.get("ocr")).toBe("true");
  });

  test("requests a dewarp grid for the current rotation", async () => {
    fetchMock = mockFetch({ "POST /api/documents/2/dewarp": () => ({ rotation: 90 }) });
    await api.detectDewarp(2, 90);
    expect(fetchMock.calls[0]!.body).toEqual({ rotation: 90 });
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
});
