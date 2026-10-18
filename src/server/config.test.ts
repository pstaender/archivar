import { describe, expect, test } from "bun:test";
import { defaultDataDir, loadConfig } from "./config";

describe("config", () => {
  test("keeps the data in the OS application data directory", () => {
    expect(defaultDataDir({}, "darwin", "/Users/anna")).toBe("/Users/anna/Library/Application Support/archivar/data");
    expect(defaultDataDir({}, "linux", "/home/anna")).toBe("/home/anna/.config/archivar/data");
    expect(defaultDataDir({ XDG_CONFIG_HOME: "/etc/xdg" }, "linux", "/home/anna")).toBe("/etc/xdg/archivar/data");
    expect(defaultDataDir({ APPDATA: "C:\\Users\\anna\\AppData\\Roaming" }, "win32", "C:\\Users\\anna")).toContain("archivar");
  });

  test("ARCHIVAR_DATA_DIR overrides it", () => {
    const config = loadConfig({ ARCHIVAR_DATA_DIR: "/srv/archivar" });
    expect(config.dataDir).toBe("/srv/archivar");
    expect(config.databasePath).toBe("/srv/archivar/archivar.sqlite");
    expect(config.storageDir).toBe("/srv/archivar/files");
    expect(config.ocrCacheDir).toBe("/srv/archivar/tessdata");
  });
});
