import { afterAll, expect, test } from "bun:test";
import { OPENCV_URL } from "../shared/opencvAsset";
import { PREVIEW_WORKER_URL } from "../shared/preview";
import { VECTORIZER_WORKER_URL } from "../vectorizer";
import { vendorRoutes } from "./vendor";

const server = Bun.serve({ port: 0, routes: vendorRoutes() });
afterAll(() => server.stop(true));

test("serves OpenCV.js gzipped and cacheable", async () => {
  const res = await fetch(new URL(OPENCV_URL, server.url), { headers: { "Accept-Encoding": "gzip" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("immutable");
  expect(await res.text()).toContain("onRuntimeInitialized");
});

test("bundles the preview worker as a classic script and revalidates it by ETag", async () => {
  const url = new URL(PREVIEW_WORKER_URL, server.url);
  const res = await fetch(url, { headers: { "Accept-Encoding": "gzip" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toStartWith("text/javascript");
  expect(res.headers.get("cache-control")).toBe("no-cache");
  const js = await res.text();
  expect(js).not.toMatch(/^\s*(import|export)\b/m);
  expect(js).toContain("importScripts");

  const etag = res.headers.get("etag")!;
  const cached = await fetch(url, { headers: { "If-None-Match": etag } });
  expect(cached.status).toBe(304);
});

test("bundles the vectorizer worker as a classic script", async () => {
  const res = await fetch(new URL(VECTORIZER_WORKER_URL, server.url));
  expect(res.status).toBe(200);
  const js = await res.text();
  expect(js).not.toMatch(/^\s*(import|export)\b/m);
  expect(js).toContain("createImageBitmap");
});
