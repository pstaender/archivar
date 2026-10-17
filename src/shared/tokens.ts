/** A personal access token for scripts and other external clients; sent as `Authorization: Bearer <token>`. */
export interface ApiToken {
  id: number;
  name: string;
  /** The first characters, so tokens can be told apart; the full token is only shown once. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedApiToken extends ApiToken {
  token: string;
}
