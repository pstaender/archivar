import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { type AuthStatus, MIN_PASSWORD_LENGTH, type Passkey } from "../../shared/auth";
import type { User } from "../../shared/types";
import type { AuthRepository } from "../db/auth";
import { DEFAULT_USER_NAME } from "../db/database";
import type { UserRepository } from "../db/users";
import { HttpError } from "../http";

export const SESSION_COOKIE = "archivar_session";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

// Logins with an unknown user name still verify a hash, so they take as long as a wrong password.
const DUMMY_HASH = Bun.password.hash("archivar-dummy-password");

export interface Challenge<T> {
  challengeId: string;
  options: T;
}

function cookieValue(req: Request, name: string): string | null {
  for (const part of req.headers.get("Cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function checkPassword(password: unknown): string {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) throw new HttpError(400, `The password needs at least ${MIN_PASSWORD_LENGTH} characters`);
  return password;
}

/**
 * Without a password a user needs no login. With one, the browser needs a session (cookie `archivar_session`), from a
 * login with the password or one of the user's passkeys.
 */
export class AuthService {
  private challenges = new Map<string, { challenge: string; userId: number | null; expires: number }>();

  /** `origin`: the public origin (`ARCHIVAR_ORIGIN`); otherwise it is taken from the request (and proxy headers). */
  constructor(
    private users: UserRepository,
    private auth: AuthRepository,
    private origin: string | null = null,
  ) {}

  /** The user of the request's session, else the default user while it has no password; null: a login is needed. */
  requestUser(req: Request): User | null {
    const token = cookieValue(req, SESSION_COOKIE);
    const sessionUserId = token ? this.auth.sessionUser(token) : null;
    if (sessionUserId !== null) return this.users.find(sessionUserId);
    const user = this.users.findByName(DEFAULT_USER_NAME);
    return user && this.users.passwordHash(user.id) === null ? user : null;
  }

  status(req: Request): AuthStatus {
    const user = this.requestUser(req);
    return {
      user,
      passwordSet: user ? this.users.passwordHash(user.id) !== null : this.users.anyPassword(),
      usernameRequired: this.users.count() > 1,
      passkeyLogin: !user && this.auth.anyPasskey(),
    };
  }

  /** Returns the session token. */
  async login(name: unknown, password: unknown): Promise<string> {
    const user = this.loginUser(name);
    const hash = user ? this.users.passwordHash(user.id) : null;
    const valid = await Bun.password.verify(typeof password === "string" ? password : "", hash ?? (await DUMMY_HASH));
    if (!user || !hash || !valid) throw new HttpError(401, "Wrong user name or password");
    return this.auth.createSession(user.id);
  }

  logout(req: Request): void {
    const token = cookieValue(req, SESSION_COOKIE);
    if (token) this.auth.deleteSession(token);
  }

  /** Ends all sessions of the user; returns a new one for the browser that changed it. */
  async changePassword(user: User, password: unknown, currentPassword: unknown): Promise<string> {
    await this.checkCurrentPassword(user, currentPassword);
    this.setPassword(user.id, await Bun.password.hash(checkPassword(password)));
    return this.auth.createSession(user.id);
  }

  /** Passkeys are an alternative to the password, so they go with it. */
  async removePassword(user: User, currentPassword: unknown): Promise<void> {
    await this.checkCurrentPassword(user, currentPassword);
    this.setPassword(user.id, null);
  }

  /** Also used by `scripts/password.ts`. */
  setPassword(userId: number, hash: string | null): void {
    this.users.setPasswordHash(userId, hash);
    this.auth.deleteSessions(userId);
    if (hash === null) this.auth.deletePasskeys(userId);
  }

  passkeys(user: User): Passkey[] {
    return this.auth.passkeys(user.id);
  }

  deletePasskey(user: User, id: number): boolean {
    return this.auth.deletePasskey(user.id, id);
  }

  async registrationOptions(req: Request, user: User): Promise<Challenge<PublicKeyCredentialCreationOptionsJSON>> {
    if (this.users.passwordHash(user.id) === null) throw new HttpError(400, "Passkeys need a password");
    const options = await generateRegistrationOptions({
      rpName: "Archivar",
      rpID: this.rpId(req),
      userName: user.name,
      userID: new TextEncoder().encode(String(user.id)),
      excludeCredentials: this.auth.credentials(user.id).map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransport[] })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    });
    return { challengeId: this.storeChallenge(options.challenge, user.id), options };
  }

  async register(req: Request, user: User, challengeId: unknown, response: unknown, name: unknown): Promise<Passkey> {
    const challenge = this.takeChallenge(challengeId, user.id);
    const verification = await verifyRegistrationResponse({
      response: response as RegistrationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: this.webOrigin(req),
      expectedRPID: this.rpId(req),
      requireUserVerification: false,
    }).catch(() => null);
    if (!verification?.verified) throw new HttpError(400, "Passkey could not be verified");
    const { credential } = verification.registrationInfo;
    return this.auth.addPasskey(user.id, {
      credentialId: credential.id,
      publicKey: credential.publicKey,
      counter: credential.counter,
      transports: credential.transports ?? [],
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : "Passkey",
    });
  }

  /** With one user its passkeys are offered; otherwise the browser lets the user pick one (discoverable credentials). */
  async loginOptions(req: Request, name: unknown): Promise<Challenge<PublicKeyCredentialRequestOptionsJSON>> {
    const user = typeof name === "string" && name.trim() ? this.users.findByName(name.trim()) : this.users.count() === 1 ? this.users.list()[0]! : null;
    const options = await generateAuthenticationOptions({
      rpID: this.rpId(req),
      allowCredentials: user ? this.auth.credentials(user.id).map((c) => ({ id: c.credentialId, transports: c.transports as AuthenticatorTransport[] })) : undefined,
      userVerification: "preferred",
    });
    return { challengeId: this.storeChallenge(options.challenge, null), options };
  }

  /** Returns the session token. */
  async loginWithPasskey(req: Request, challengeId: unknown, response: unknown): Promise<string> {
    const challenge = this.takeChallenge(challengeId, null);
    const id = (response as AuthenticationResponseJSON | null)?.id;
    const passkey = typeof id === "string" ? this.auth.credential(id) : null;
    if (!passkey || this.users.passwordHash(passkey.userId) === null) throw new HttpError(401, "Unknown passkey");
    const verification = await verifyAuthenticationResponse({
      response: response as AuthenticationResponseJSON,
      expectedChallenge: challenge,
      expectedOrigin: this.webOrigin(req),
      expectedRPID: this.rpId(req),
      credential: { id: passkey.credentialId, publicKey: passkey.publicKey, counter: passkey.counter, transports: passkey.transports as AuthenticatorTransport[] },
      requireUserVerification: false,
    }).catch(() => null);
    if (!verification?.verified) throw new HttpError(401, "Passkey could not be verified");
    this.auth.usedPasskey(passkey.id, verification.authenticationInfo.newCounter);
    return this.auth.createSession(passkey.userId);
  }

  /** `Set-Cookie` value for a session token, or one that clears the cookie. */
  sessionCookie(req: Request, token: string | null): string {
    const secure = this.webOrigin(req).startsWith("https:") ? "; Secure" : "";
    const lifetime = token ? `; Max-Age=${60 * 60 * 24 * 400}` : "; Max-Age=0";
    return `${SESSION_COOKIE}=${token ?? ""}; Path=/; HttpOnly; SameSite=Lax${lifetime}${secure}`;
  }

  private loginUser(name: unknown): User | null {
    if (typeof name === "string" && name.trim()) return this.users.findByName(name.trim());
    return this.users.count() === 1 ? this.users.list()[0]! : null;
  }

  private async checkCurrentPassword(user: User, currentPassword: unknown): Promise<void> {
    const hash = this.users.passwordHash(user.id);
    if (hash === null) return;
    if (typeof currentPassword !== "string" || !(await Bun.password.verify(currentPassword, hash))) throw new HttpError(403, "Wrong current password");
  }

  private storeChallenge(challenge: string, userId: number | null): string {
    const now = Date.now();
    for (const [id, stored] of this.challenges) if (stored.expires < now) this.challenges.delete(id);
    const challengeId = crypto.randomUUID();
    this.challenges.set(challengeId, { challenge, userId, expires: now + CHALLENGE_TTL_MS });
    return challengeId;
  }

  private takeChallenge(challengeId: unknown, userId: number | null): string {
    const stored = typeof challengeId === "string" ? this.challenges.get(challengeId) : undefined;
    if (typeof challengeId === "string") this.challenges.delete(challengeId);
    if (!stored || stored.expires < Date.now() || stored.userId !== userId) throw new HttpError(400, "Passkey request expired");
    return stored.challenge;
  }

  private webOrigin(req: Request): string {
    if (this.origin) return this.origin;
    const url = new URL(req.url);
    const forwarded = (name: string) => req.headers.get(name)?.split(",")[0]?.trim() || null;
    const protocol = forwarded("X-Forwarded-Proto") ?? url.protocol.slice(0, -1);
    const host = forwarded("X-Forwarded-Host") ?? req.headers.get("Host") ?? url.host;
    return `${protocol}://${host}`;
  }

  private rpId(req: Request): string {
    return new URL(this.webOrigin(req)).hostname;
  }
}
