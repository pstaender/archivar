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

const documents = (count: number) => `${count} ${count === 1 ? "document" : "documents"}`;

function list(): void {
  for (const user of users.list()) {
    const notes = [user.admin && "admin", users.passwordHash(user.id) === null && "no password", documents(documentCount(db, user.id))].filter(Boolean);
    console.log(`${user.name} (${notes.join(", ")})`);
  }
}

async function add(): Promise<void> {
  const interactive = process.stdin.isTTY;
  const userName = name ?? (interactive ? ask("User name:") : null);
  if (!userName) fail("Please give a user name: bun run users add <name>");
  if (users.findByName(userName.trim())) fail(`The user "${userName.trim()}" already exists.`);
  const firstAdmin = !users.list().some((user) => user.admin);
  const admin = flags.includes("--admin") ? true : flags.includes("--no-admin") ? false : interactive ? askYesNo("Admin (may export the whole archive)?", firstAdmin) : firstAdmin;
  const password = await readNewPassword(true);
  const user = await createUser(users, userName, password, admin).catch((error: Error) => fail(error.message));
  console.log(`Created the user "${user.name}"${user.admin ? " (admin)" : ""}${password ? "" : " without a password"}. The login now asks for user name and password.`);
}

async function remove(): Promise<void> {
  if (!name) fail("Please give the user: bun run users delete <name>");
  const user = users.findByName(name);
  if (!user) fail(`User "${name}" not found. Existing users: ${users.list().map((u) => u.name).join(", ")}`);
  const all = users.list();
  if (all.length === 1) fail("The only user cannot be deleted.");
  if (all.length > 2 && user.admin && !all.some((other) => other.admin && other.id !== user.id)) console.log("Warning: afterwards there is no admin left who can export the archive.");
  if (!flags.includes("--yes")) {
    if (!process.stdin.isTTY) fail("Pass --yes to delete without confirmation.");
    const answer = ask(`Permanently delete "${user.name}" with ${documents(documentCount(db, user.id))} and all files? Type the name to confirm:`);
    if (answer !== user.name) fail("Cancelled.");
  }
  const deleted = await deleteUser(db, new FileStorage(config.storageDir), user.id);
  console.log(`Deleted the user "${user.name}" and ${documents(deleted)}.`);
}

if (command === "list") list();
else if (command === "add") await add();
else if (command === "delete") await remove();
else fail(`Unknown command "${command}". Possible: list, add [name] [--admin|--no-admin], delete <name> [--yes]`);
db.close();
