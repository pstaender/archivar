import { describe, expect, test } from "bun:test";
import { Jimp } from "../../shared/image/jimp";
import { MagickConverter, readableFormats } from "./magick";

const listing = `
   Format  Module    Mode  Description
-------------------------------------------------------------------------------
     AVIF  HEIC      rw+   AV1 Image File Format (1.20.2)
     HEIC  HEIC      rw+   High Efficiency Image Format (1.20.2)
      JXL* JXL       rw+   JPEG XL (ISO/IEC 18181) (libjxl 0.11.1)
             Compression options: None, Fax/Group3, Group4, JBIG, JPEG
      PDF  PDF       -w+   Portable Document Format
`;

describe("readableFormats", () => {
  test("lists formats ImageMagick can read", () => {
    expect([...readableFormats(listing)]).toEqual(["AVIF", "HEIC", "JXL"]);
  });
});

const converter = await MagickConverter.detect();

describe.if(converter !== null)("MagickConverter (needs ImageMagick)", () => {
  test("converts WebP to PNG", async () => {
    if (!converter?.types().includes("image/webp") || !Bun.which("magick")) return;
    const source = new Jimp({ width: 12, height: 8, color: 0x336699ff });
    const webp = await Bun.spawn(["magick", "png:-", "webp:-"], { stdin: new Uint8Array(await source.getBuffer("image/png")), stdout: "pipe" }).stdout;
    const png = await converter.toPng(new Uint8Array(await new Response(webp).arrayBuffer()), "image/webp");
    const image = await Jimp.read(Buffer.from(png));
    expect(image.bitmap).toMatchObject({ width: 12, height: 8 });
  });

  test("fails on broken input", async () => {
    const [type] = converter!.types();
    await expect(converter!.toPng(new Uint8Array([1, 2, 3]), type!)).rejects.toThrow();
  });
});
