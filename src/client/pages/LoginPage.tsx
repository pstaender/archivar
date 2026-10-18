import { type FormEvent, useId, useState } from "react";
import type { AuthStatus } from "../../shared/auth";
import { api, ApiRequestError } from "../api";
import { useToast } from "../hooks/toast";
import { Fingerprint, Loader } from "../icons";
import { createPasskey, loginWithPasskey, passkeyCancelled, passkeysSupported } from "../passkeys";
import { useTranslation } from "react-i18next";

export function LoginPage({ status, onLogin }: { status: AuthStatus; onLogin: () => Promise<void> }) {
  const toast = useToast();
  const { t } = useTranslation();
  const nameId = useId();
  const passwordId = useId();
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [addPasskey, setAddPasskey] = useState(false);
  const [busy, setBusy] = useState<"password" | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const supported = passkeysSupported();
  // With several users, users without a password log in with an empty one.
  const canSubmit = busy === null && (status.usernameRequired ? name.trim() !== "" : password !== "");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setBusy("password");
    setError(null);
    try {
      await api.login(status.usernameRequired ? name.trim() : null, password);
    } catch (e) {
      setError(
        e instanceof ApiRequestError && e.status === 401
          ? status.usernameRequired
            ? t("login.wrongCredentials")
            : t("login.wrongPassword")
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
        toast.success(t("login.passkeyCreated"));
      } catch (e) {
        if (!passkeyCancelled(e)) toast.error(t("login.passkeyFailed", { message: e instanceof Error ? e.message : String(e) }));
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
      if (!passkeyCancelled(e)) setError(t("login.passkeyLoginFailed"));
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
              {t("login.username")}
            </label>
            <input id={nameId} className="input" autoComplete="username webauthn" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
        )}
        <div className="settings__field">
          <label htmlFor={passwordId} className="field__label">
            {t("login.password")}
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
            {t("login.addPasskey")}
          </label>
        )}
        {error && (
          <p className="login__error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={!canSubmit}>
          {busy === "password" && <Loader size={16} className="spin" />}
          {t("login.submit")}
        </button>
        {supported && status.passkeyLogin && (
          <button type="button" className="btn" onClick={passkeyLogin} disabled={busy !== null}>
            {busy === "passkey" ? <Loader size={16} className="spin" /> : <Fingerprint size={16} />}
            {t("login.withPasskey")}
          </button>
        )}
      </form>
    </main>
  );
}
