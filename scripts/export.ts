// Exports the whole archive (database of all users and every stored file) as a zip. Usage:
//   bun run export [file.zip]   default: archivar-<date>.zip in the current directory
//   bun run export -            writes the zip to stdout
// Unzipped into the data directory it restores the archive. The server does not need to be stopped.
import { loadConfig } from "../src/server/config";
import { openDatabase } from "../src/server/db/database";
import { archiveExportSize, exportArchive, exportFilename } from "../src/server/services/archiveExport";

const formatBytes = (bytes: number) => `${(bytes / 1024 ** 2).toLocaleString("en", { maximumFractionDigits: 1 })} MB`;

const target = process.argv[2] ?? exportFilename();
const config = loadConfig();
const db = openDatabase(config.databasePath);
const toStdout = target === "-";
if (!toStdout) console.log(`Exporting about ${formatBytes(await archiveExportSize(db, config.storageDir))} to ${target} …`);
// Bun.write() with a streamed Response hangs, so the chunks go through a FileSink.
const sink = (toStdout ? Bun.stdout : Bun.file(target)).writer();
let written = 0;
for await (const chunk of exportArchive(db, config.storageDir)) {
  sink.write(chunk);
  written += chunk.length;
}
await sink.end();
db.close();
if (!toStdout) console.log(`Done: wrote ${formatBytes(written)}.`);
