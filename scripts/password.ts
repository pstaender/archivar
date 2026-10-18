// Sets or removes a user's password, e.g. when it is forgotten. Ends the user's sessions; removing it also deletes the
// user's passkeys. Usage:
//   bun run password [user]            asks for the new password (or reads it from stdin when piped)
//   bun run password [user] --remove   turns the login off again (with several users: logs in with an empty password)
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
if (!user) fail(name ? `User "${name}" not found. Existing users: ${all.map((u) => u.name).join(", ")}` : `Please give a user: ${all.map((u) => u.name).join(", ")}`);

const auth = new AuthService(users, new AuthRepository(db));
if (remove) {
  auth.setPassword(user.id, null);
  console.log(all.length > 1 ? `Removed the password of "${user.name}", who now logs in with an empty password.` : `Removed the password of "${user.name}", the login is turned off.`);
} else {
  const password = await readNewPassword();
  if (password.length < MIN_PASSWORD_LENGTH) fail(`The password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
  auth.setPassword(user.id, await Bun.password.hash(password));
  console.log(`Set the password of "${user.name}". All sessions were ended.`);
}
db.close();
