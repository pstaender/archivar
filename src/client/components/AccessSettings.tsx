import { type FormEvent, useEffect, useId, useState } from "react";
import { MIN_PASSWORD_LENGTH, type Passkey } from "../../shared/auth";
import { api, ApiRequestError } from "../api";
import { formatDateTime } from "../format";
import { useAuth } from "../hooks/auth";
import { useToast } from "../hooks/toast";
import { Fingerprint, Loader, LogOut, Plus, Trash } from "../icons";
import { createPasskey, passkeyCancelled, passkeysSupported } from "../passkeys";

const wrongPassword = (error: unknown) => (error instanceof ApiRequestError && error.status === 403 ? new Error("Das aktuelle Kennwort ist falsch.") : error);

/** Password and passkeys; changes take effect at once, not with the dialog's „Speichern“. */
export function AccessSettings() {
  const toast = useToast();
  const { status, refresh } = useAuth();
  const currentId = useId();
  const newId = useId();
  const repeatId = useId();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState<"set" | "remove" | "passkey" | null>(null);
  const [passkeys, setPasskeys] = useState<Passkey[] | null>(null);
  const { passwordSet, usernameRequired } = status;

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
      ? `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`
      : repeat.length > 0 && repeat !== password
        ? "Die Kennwörter stimmen nicht überein."
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
      toast.success(passwordSet ? "Kennwort geändert" : "Kennwort festgelegt");
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
      toast.success("Kennwort entfernt");
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
      toast.success("Passkey angelegt");
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
      toast.success(`Passkey „${passkey.name}“ gelöscht`);
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
          <>
            Archivar ist mit einem Kennwort geschützt. Kennwort vergessen? Auf dem Server setzt <code>bun run password</code> ein neues.
          </>
        ) : (
          "Ohne Kennwort kann jeder Archivar nutzen, der die Adresse erreicht. Mit Kennwort muss sich jeder Browser anmelden; API-Tokens gelten weiter."
        )}
      </p>
      <form className="settings__field" onSubmit={submit}>
        {passwordSet && (
          <>
            <label htmlFor={currentId} className="field__label">
              Aktuelles Kennwort
            </label>
            <input id={currentId} className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </>
        )}
        <label htmlFor={newId} className="field__label">
          {passwordSet ? "Neues Kennwort" : "Kennwort"}
        </label>
        <input id={newId} className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <label htmlFor={repeatId} className="field__label">
          Kennwort wiederholen
        </label>
        <input id={repeatId} className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {problem && <p className="muted small">{problem}</p>}
        <div className="access__actions">
          <button type="submit" className="btn" disabled={!canSet || busy !== null}>
            {busy === "set" && <Loader size={16} className="spin" />}
            {passwordSet ? "Kennwort ändern" : "Kennwort festlegen"}
          </button>
          {passwordSet && !usernameRequired && (
            <button type="button" className="btn btn--danger-ghost" onClick={remove} disabled={!current || busy !== null} title="Löscht auch alle Passkeys">
              {busy === "remove" && <Loader size={16} className="spin" />}
              Kennwort entfernen
            </button>
          )}
        </div>
      </form>
      {passwordSet && (
        <div className="settings__field">
          <span className="field__label">Passkeys</span>
          {passkeys === null ? (
            <p className="muted small">
              <Loader size={16} className="spin" /> Passkeys werden geladen …
            </p>
          ) : passkeys.length === 0 ? (
            <p className="muted small">Noch keine Passkeys. Beim Anmelden lässt sich einer für das Gerät anlegen.</p>
          ) : (
            <ul className="token-list" aria-label="Passkeys">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="token-list__item">
                  <Fingerprint size={18} />
                  <div className="token-list__text">
                    <span>{passkey.name}</span>
                    <span className="muted small">
                      erstellt {formatDateTime(passkey.createdAt)} · {passkey.lastUsedAt ? `zuletzt benutzt ${formatDateTime(passkey.lastUsedAt)}` : "noch nicht benutzt"}
                    </span>
                  </div>
                  <button type="button" className="btn btn--sm btn--icon" onClick={() => deletePasskey(passkey)} aria-label={`Passkey „${passkey.name}“ löschen`} title="Löschen">
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
                Passkey für dieses Gerät
              </button>
            )}
            <button type="button" className="btn" onClick={logout}>
              <LogOut size={16} />
              Abmelden
            </button>
          </div>
        </div>
      )}
    </>
  );
}
