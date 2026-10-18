// Sets or removes a user's password, e.g. when it is forgotten. Ends the user's sessions; removing it also deletes the
// user's passkeys. Usage:
//   bun run password [user]            asks for the new password (or reads it from stdin when piped)
//   bun run password [user] --remove   turns the login off again (only for the only user)
// The user can be left out when there is only one. The server does not need to be stopped.
import { loadConfig } from "../src/server/config";
import { AuthRepository } from "../src/server/db/auth";
import { openDatabase } from "../src/server/db/database";
import { UserRepository } from "../src/server/db/users";
import { AuthService } from "../src/server/services/auth";
import { MIN_PASSWORD_LENGTH } from "../src/shared/auth";
import { fail, readNewPassword } from "./cli";

const args = process.argv.slice(2);
const remove = args.includes("--remove");
const name = args.find((arg) => !arg.startsWith("--"));

const db = openDatabase(loadConfig().databasePath);
const users = new UserRepository(db);
const all = users.list();
const user = name ? users.findByName(name) : all.length === 1 ? all[0] : null;
if (!user) fail(name ? `Benutzer „${name}“ nicht gefunden. Vorhanden: ${all.map((u) => u.name).join(", ")}` : `Bitte einen Benutzer angeben: ${all.map((u) => u.name).join(", ")}`);

const auth = new AuthService(users, new AuthRepository(db));
if (remove) {
  if (all.length > 1) fail("Mit mehreren Benutzern braucht jeder ein Kennwort.");
  auth.setPassword(user.id, null);
  console.log(`Kennwort von „${user.name}“ entfernt, die Anmeldung ist ausgeschaltet.`);
} else {
  const password = await readNewPassword();
  if (password.length < MIN_PASSWORD_LENGTH) fail(`Das Kennwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
  auth.setPassword(user.id, await Bun.password.hash(password));
  console.log(`Kennwort von „${user.name}“ gesetzt. Alle Sitzungen wurden beendet.`);
}
db.close();
