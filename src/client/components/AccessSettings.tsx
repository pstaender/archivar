import { type FormEvent, useEffect, useId, useState } from "react";
import { MIN_PASSWORD_LENGTH, type Passkey } from "../../shared/auth";
import { api, ApiRequestError } from "../api";
import { formatDateTime } from "../format";
import { useAuth } from "../hooks/auth";
import { useToast } from "../hooks/toast";
import { Fingerprint, Loader, LogOut, Plus, Trash } from "../icons";
import { createPasskey, passkeyCancelled, passkeysSupported } from "../passkeys";
import { Trans, useTranslation } from "react-i18next";
import { i18n } from "../i18n";

const wrongPassword = (error: unknown) => (error instanceof ApiRequestError && error.status === 403 ? new Error(i18n.t("access.wrongCurrent")) : error);

/** Password and passkeys; changes take effect at once, not with the dialog's „Speichern“. */
export function AccessSettings() {
  const toast = useToast();
  const { t } = useTranslation();
  const { status, refresh } = useAuth();
  const currentId = useId();
  const newId = useId();
  const repeatId = useId();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState<"set" | "remove" | "passkey" | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const { passwordSet } = status;

  useEffect(() => {
    if (!passwordSet) {
      setPasskeys([]);
      return;
    }
    api.passkeys().then(setPasskeys, (error) => {
      setPasskeys([]);
      toast.error(error);
    });
  }, [passwordSet]);

  const problem =
    password.length > 0 && password.length < MIN_PASSWORD_LENGTH
      ? t("access.minLength", { count: MIN_PASSWORD_LENGTH })
      : repeat.length > 0 && repeat !== password
        ? t("access.mismatch")
        : null;
  const canSet = password.length >= MIN_PASSWORD_LENGTH && repeat === password && (!passwordSet || current.length > 0);

  const reset = () => {
    setCurrent("");
    setPassword("");
    setRepeat("");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSet || busy) return;
    setBusy("set");
    try {
      await api.setPassword(password, passwordSet ? current : null);
      reset();
      toast.success(passwordSet ? t("access.changed") : t("access.set"));
      await refresh();
    } catch (error) {
      toast.error(wrongPassword(error));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!current || busy) return;
    setBusy("remove");
    try {
      await api.removePassword(current);
      reset();
      toast.success(t("access.removed"));
      await refresh();
    } catch (error) {
      toast.error(wrongPassword(error));
    } finally {
      setBusy(null);
    }
  };

  const addPasskey = async () => {
    setBusy("passkey");
    try {
      const passkey = await createPasskey();
      setPasskeys((list) => [...(list ?? []), passkey]);
      toast.success(t("login.passkeyCreated"));
    } catch (error) {
      if (!passkeyCancelled(error)) toast.error(error);
    } finally {
      setBusy(null);
    }
  };

  const deletePasskey = async (passkey: Passkey) => {
    try {
      await api.deletePasskey(passkey.id);
      setPasskeys((list) => list?.filter((p) => p.id !== passkey.id) ?? null);
      toast.success(t("access.passkeyDeleted", { name: passkey.name }));
    } catch (error) {
      toast.error(error);
    }
  };

  const logout = async () => {
    try {
      await api.logout();
      await refresh();
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <>
      <p className="muted small">
        {passwordSet ? (
          <Trans i18nKey="access.protected" components={{ code: <code /> }} />
        ) : (
          t("access.unprotected")
        )}
      </p>
      <form className="settings__field" onSubmit={submit}>
        {passwordSet && (
          <>
            <label htmlFor={currentId} className="field__label">
              {t("access.current")}
            </label>
            <input id={currentId} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </>
        )}
        <label htmlFor={newId} className="field__label">
          {passwordSet ? t("access.newPassword") : t("login.password")}
        </label>
        <input id={newId} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor={repeatId} className="field__label">
          {t("access.repeat")}
        </label>
        <input id={repeatId} className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {problem && <p className="muted small">{problem}</p>}
        <div className="access__actions">
          <button type="submit" className="btn" disabled={!canSet || busy !== null}>
            {busy === "set" && <Loader size={16} className="spin" />}
            {passwordSet ? t("access.change") : t("access.setPassword")}
          </button>
          {passwordSet && (
            <button type="button" className="btn btn--danger-ghost" onClick={remove} disabled={!current || busy !== null} title={t("access.removeTitle")}>
              {busy === "remove" && <Loader size={16} className="spin" />}
              {t("access.remove")}
            </button>
          )}
        </div>
      </form>
      {passwordSet && (
        <div className="settings__field">
          <span className="field__label">{t("access.passkeys")}</span>
          {passkeys === null ? (
            <p className="muted small">
              <Loader size={16} className="spin" /> {t("access.passkeysLoading")}
            </p>
          ) : passkeys.length === 0 ? (
            <p className="muted small">{t("access.noPasskeys")}</p>
          ) : (
            <ul className="token-list" aria-label={t("access.passkeys")}>
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="token-list__item">
                  <Fingerprint size={18} />
                  <div className="token-list__text">
                    <span>{passkey.name}</span>
                    <span className="muted small">
                      {t("tokens.created", { date: formatDateTime(passkey.createdAt) })} · {passkey.lastUsedAt ? t("tokens.lastUsed", { date: formatDateTime(passkey.lastUsedAt) }) : t("tokens.neverUsed")}
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm btn--icon" onClick={() => deletePasskey(passkey)} aria-label={t("access.deletePasskey", { name: passkey.name })} title={t("common.delete")}>
                    <Trash size={16} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="access__actions">
            {passkeysSupported() && (
              <button type="button" className="btn" onClick={addPasskey} disabled={busy !== null}>
                {busy === "passkey" ? <Loader size={16} className="spin" /> : <Plus size={16} />}
                {t("access.addPasskey")}
              </button>
            )}
            <button type="button" className="btn" onClick={logout}>
              <LogOut size={16} />
              {t("access.logout")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
