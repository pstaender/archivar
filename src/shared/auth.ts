import type { User } from "./types";

export const MIN_PASSWORD_LENGTH = 8;

export interface AuthStatus {
  /** null: a password is set and this browser is not logged in. */
  user: User | null;
  /** Whether the current user (or, logged out, any user) has a password. */
  passwordSet: boolean;
  /** Only asked for when there is more than one user. */
  usernameRequired: boolean;
  /** Logged out: whether any passkey exists that could log in. */
  passkeyLogin: boolean;
}

export interface Passkey {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
}
