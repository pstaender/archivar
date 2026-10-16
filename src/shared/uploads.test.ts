import { describe, expect, test } from "bun:test";
import { isSupportedUpload, UPLOAD_ACCEPT } from "./uploads";

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

  test("the accept attribute lists types and extensions", () => {
    expect(UPLOAD_ACCEPT).toContain("application/pdf");
    expect(UPLOAD_ACCEPT).toContain(".tiff");
    expect(UPLOAD_ACCEPT).not.toContain("image/*");
  });
});
