import { afterAll, expect, test } from "bun:test";
import { OPENCV_URL } from "../shared/opencvAsset";
import { vendorRoutes } from "./vendor";

const server = Bun.serve({ port: 0, routes: vendorRoutes() });
afterAll(() => server.stop(true));

test("serves OpenCV.js gzipped and cacheable", async () => {
  const res = await fetch(new URL(OPENCV_URL, server.url), { headers: { "Accept-Encoding": "gzip" } });
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toContain("immutable");
  expect(await res.text()).toContain("onRuntimeInitialized");
});
