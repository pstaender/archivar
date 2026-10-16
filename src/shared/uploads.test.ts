import { describe, expect, test } from "bun:test";
import { convertibleTypeForExtension, isSupportedUpload, uploadAccept } from "./uploads";

describe("isSupportedUpload", () => {
  test("accepts editable images and PDFs", () => {
    expect(isSupportedUpload({ name: "a.jpg", type: "image/jpeg" })).toBe(true);
    expect(isSupportedUpload({ name: "scan.tif", type: "image/tiff" })).toBe(true);
    expect(isSupportedUpload({ name: "brief.pdf", type: "application/pdf" })).toBe(true);
  });

  test("rejects other types", () => {
    expect(isSupportedUpload({ name: "notes.txt", type: "text/plain" })).toBe(false);
    expect(isSupportedUpload({ name: "foto.heic", type: "image/heic" })).toBe(false);
    expect(isSupportedUpload({ name: "brief.docx", type: "" })).toBe(false);
  });

  test("falls back to the extension without a declared type", () => {
    expect(isSupportedUpload({ name: "SCAN.PDF", type: "" })).toBe(true);
    expect(isSupportedUpload({ name: "foto.png", type: "application/octet-stream" })).toBe(true);
    expect(isSupportedUpload({ name: "ohne-endung", type: "" })).toBe(false);
  });

  test("accepts convertible formats only when the server can convert them", () => {
    const heic = { name: "foto.heic", type: "image/heic" };
    expect(isSupportedUpload(heic, ["image/heic"])).toBe(true);
    expect(isSupportedUpload({ name: "foto.HEIC", type: "" }, ["image/heic"])).toBe(true);
    expect(isSupportedUpload({ name: "bild.webp", type: "image/webp" }, ["image/heic"])).toBe(false);
  });

  test("the accept attribute lists types and extensions", () => {
    const accept = uploadAccept();
    expect(accept).toContain("application/pdf");
    expect(accept).toContain(".tiff");
    expect(accept).not.toContain("image/*");
    expect(accept).not.toContain("heic");
    expect(uploadAccept(["image/heic", "image/jxl"])).toContain("image/heic,image/jxl");
    expect(uploadAccept(["image/heic"])).toContain(".heic");
  });

  test("maps convertible extensions to their type", () => {
    expect(convertibleTypeForExtension("bild.JXL")).toBe("image/jxl");
    expect(convertibleTypeForExtension("bild.jpg")).toBeNull();
  });
});
