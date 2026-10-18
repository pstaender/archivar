// Manages the users. Usage:
//   bun run users                                   lists them
//   bun run users add [name] [--admin|--no-admin]   asks for what is missing and the password (or reads it from stdin
//                                                   when piped; may be empty); without a flag: admin if there is none yet
//   bun run users delete <name> [--yes]             deletes the user with all documents, stacks, folders and files
// Admins may export the whole archive; a single user is always admin. With several users everyone has to log in with
// user name and password (empty for users without one). The server does not need to be stopped.
import { loadConfig } from "../src/server/config";
import { openDatabase } from "../src/server/db/database";
import { UserRepository } from "../src/server/db/users";
import { createUser, deleteUser, documentCount } from "../src/server/services/users";
import { FileStorage } from "../src/server/storage";
import { ask, askYesNo, fail, readNewPassword } from "./cli";

const [command = "list", ...rest] = process.argv.slice(2);
const flags = rest.filter((arg) => arg.startsWith("--"));
const name = rest.find((arg) => !arg.startsWith("--"));

const config = loadConfig();
const db = openDatabase(config.databasePath);
const users = new UserRepository(db);

function list(): void {
  for (const user of users.list()) {
    const notes = [user.admin && "Admin", users.passwordHash(user.id) === null && "ohne Kennwort", `${documentCount(db, user.id)} Dokumente`].filter(Boolean);
    console.log(`${user.name} (${notes.join(", ")})`);
  }
}

async function add(): Promise<void> {
  const interactive = process.stdin.isTTY;
  const userName = name ?? (interactive ? ask("Benutzername:") : null);
  if (!userName) fail("Bitte einen Benutzernamen angeben: bun run users add <name>");
  if (users.findByName(userName.trim())) fail(`Den Benutzer „${userName.trim()}“ gibt es schon.`);
  const firstAdmin = !users.list().some((user) => user.admin);
  const admin = flags.includes("--admin") ? true : flags.includes("--no-admin") ? false : interactive ? askYesNo("Admin (darf das ganze Archiv exportieren)?", firstAdmin) : firstAdmin;
  const password = await readNewPassword(true);
  const user = await createUser(users, userName, password, admin).catch((error: Error) => fail(error.message));
  console.log(`Benutzer „${user.name}“${user.admin ? " (Admin)" : ""}${password ? "" : " ohne Kennwort"} angelegt. Die Anmeldung fragt jetzt nach Benutzername und Kennwort.`);
}

async function remove(): Promise<void> {
  if (!name) fail("Bitte den Benutzer angeben: bun run users delete <name>");
  const user = users.findByName(name);
  if (!user) fail(`Benutzer „${name}“ nicht gefunden. Vorhanden: ${users.list().map((u) => u.name).join(", ")}`);
  const all = users.list();
  if (all.length === 1) fail("Der einzige Benutzer kann nicht gelöscht werden.");
  if (all.length > 2 && user.admin && !all.some((other) => other.admin && other.id !== user.id)) console.log("Achtung: Danach gibt es keinen Admin mehr, der das Archiv exportieren kann.");
  if (!flags.includes("--yes")) {
    if (!process.stdin.isTTY) fail("Zum Löschen ohne Rückfrage --yes angeben.");
    const answer = ask(`„${user.name}“ mit ${documentCount(db, user.id)} Dokumenten und allen Dateien endgültig löschen? Zum Bestätigen den Namen eingeben:`);
    if (answer !== user.name) fail("Abgebrochen.");
  }
  const deleted = await deleteUser(db, new FileStorage(config.storageDir), user.id);
  console.log(`Benutzer „${user.name}“ und ${deleted} Dokumente gelöscht.`);
}

if (command === "list") list();
else if (command === "add") await add();
else if (command === "delete") await remove();
else fail(`Unbekannter Befehl „${command}“. Möglich: list, add [name] [--admin|--no-admin], delete <name> [--yes]`);
db.close();
