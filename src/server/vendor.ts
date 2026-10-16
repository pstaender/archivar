import { OPENCV_URL } from "../shared/opencvAsset";

const IMMUTABLE = "public, max-age=31536000, immutable";

export function vendorRoutes() {
  const openCvPath = require.resolve("@techstark/opencv-js");
  let gzipped: Promise<Uint8Array<ArrayBuffer>> | null = null;

  return {
    [OPENCV_URL]: async (req: Request) => {
      const headers = { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": IMMUTABLE, Vary: "Accept-Encoding" };
      if (!req.headers.get("accept-encoding")?.includes("gzip")) return new Response(Bun.file(openCvPath), { headers });
      gzipped ??= Bun.file(openCvPath)
        .bytes()
        .then((bytes) => Bun.gzipSync(bytes));
      return new Response(await gzipped, { headers: { ...headers, "Content-Encoding": "gzip" } });
    },
  };
}
