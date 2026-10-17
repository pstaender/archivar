import { type FormEvent, useId, useState } from "react";
import type { AuthStatus } from "../../shared/auth";
import { api, ApiRequestError } from "../api";
import { useToast } from "../hooks/toast";
import { Fingerprint, Loader } from "../icons";
import { createPasskey, loginWithPasskey, passkeyCancelled, passkeysSupported } from "../passkeys";

export function LoginPage({ status, onLogin }: { status: AuthStatus; onLogin: () => Promise<void> }) {
  const toast = useToast();
  const nameId = useId();
  const passwordId = useId();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [addPasskey, setAddPasskey] = useState(false);
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = passkeysSupported();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy("password");
    setError(null);
    try {
      await api.login(status.usernameRequired ? name.trim() : null, password);
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 401
          ? status.usernameRequired
            ? "Benutzername oder Kennwort ist falsch."
            : "Das Kennwort ist falsch."
          : e instanceof Error
            ? e.message
            : String(e),
      );
      setBusy(null);
      return;
    }
    if (addPasskey) {
      try {
        await createPasskey();
        toast.success("Passkey angelegt");
      } catch (e) {
        if (!passkeyCancelled(e)) toast.error(`Der Passkey konnte nicht angelegt werden: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    await onLogin();
  };

  const passkeyLogin = async () => {
    setBusy("passkey");
    setError(null);
    try {
      await loginWithPasskey(status.usernameRequired && name.trim() ? name.trim() : null);
      await onLogin();
    } catch (e) {
      if (!passkeyCancelled(e)) setError("Die Anmeldung mit dem Passkey ist fehlgeschlagen.");
      setBusy(null);
    }
  };

  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="login__brand">
          <span className="logo__mark" aria-hidden />
          <h1>archivar</h1>
        </div>
        {status.usernameRequired && (
          <div className="settings__field">
            <label htmlFor={nameId} className="field__label">
              Benutzername
            </label>
            <input id={nameId} className="input" autoComplete="username webauthn" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
        )}
        <div className="settings__field">
          <label htmlFor={passwordId} className="field__label">
            Kennwort
          </label>
          <input
            id={passwordId}
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!status.usernameRequired}
          />
        </div>
        {supported && (
          <label className="login__check">
            <input type="checkbox" checked={addPasskey} onChange={(e) => setAddPasskey(e.target.checked)} />
            Passkey für dieses Gerät anlegen, um sich künftig ohne Kennwort anzumelden
          </label>
        )}
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={!password || busy !== null}>
          {busy === "password" && <Loader size={16} className="spin" />}
          Anmelden
        </button>
        {supported && status.passkeyLogin && (
          <button type="button" className="btn" onClick={passkeyLogin} disabled={busy !== null}>
            {busy === "passkey" ? <Loader size={16} className="spin" /> : <Fingerprint size={16} />}
            Mit Passkey anmelden
          </button>
        )}
      </form>
    </main>
  );
}
