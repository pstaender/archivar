import { Copy, Loader, Plus, Trash } from "../icons";
import { type FormEvent, useEffect, useId, useState } from "react";
import type { ApiToken, CreatedApiToken } from "../../shared/tokens";
import { api } from "../api";
import { formatDateTime } from "../format";
import { useToast } from "../hooks/toast";
import { Trans, useTranslation } from "react-i18next";

/** Personal access tokens for scripts; changes take effect at once, not with the dialog's „Speichern“. */
export function ApiTokens() {
  const toast = useToast();
  const { t } = useTranslation();
  const nameId = useId();
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiToken | null>(null);

  useEffect(() => {
    api.tokens().then(setTokens, (error) => {
      setTokens([]);
      toast.error(error);
    });
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const token = await api.createToken(name.trim());
      setCreated(token);
      setTokens((current) => [...(current ?? []), token]);
      setName("");
    } catch (error) {
      toast.error(error);
    } finally {
      setCreating(false);
    }
  };

  const remove = async (token: ApiToken) => {
    try {
      await api.deleteToken(token.id);
      setTokens((current) => current?.filter((other) => other.id !== token.id) ?? null);
      if (created?.id === token.id) setCreated(null);
      toast.success(t("tokens.deleted", { name: token.name }));
    } catch (error) {
      toast.error(error);
    }
  };

  const copy = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
      toast.success(t("tokens.copied"));
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <>
      <p className="muted small">
        <Trans i18nKey="tokens.description" components={{ code: <code /> }} />
      </p>
      <form className="settings__field" onSubmit={create}>
        <label htmlFor={nameId} className="field__label">
          {t("tokens.new")}
        </label>
        <div className="token-form">
          <input id={nameId} className="input" placeholder={t("tokens.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
          <button type="submit" className="btn" disabled={!name.trim() || creating}>
            {creating ? <Loader size={16} className="spin" /> : <Plus size={16} />}
            {t("tokens.create")}
          </button>
        </div>
      </form>
      {created && (
        <div className="settings__field" role="status">
          <span className="field__label">{t("tokens.token", { name: created.name })}</span>
          <div className="token-form">
            <input className="input token-value" readOnly value={created.token} aria-label={t("tokens.new")} onFocus={(e) => e.target.select()} />
            <button type="button" className="btn" onClick={() => copy(created.token)}>
              <Copy size={16} />
              {t("tokens.copy")}
            </button>
          </div>
          <p className="muted small">{t("tokens.shownOnce")}</p>
        </div>
      )}
      {tokens === null ? (
        <p className="muted small">
          <Loader size={16} className="spin" /> {t("tokens.loading")}
        </p>
      ) : tokens.length === 0 ? (
        <p className="muted small">{t("tokens.none")}</p>
      ) : (
        <ul className="token-list" aria-label={t("tokens.list")}>
          {tokens.map((token) => (
            <li key={token.id} className="token-list__item">
              <div className="token-list__text">
                <span>{token.name}</span>
                <span className="muted small">
                  <code>{token.prefix}…</code> · {t("tokens.created", { date: formatDateTime(token.createdAt) })} ·{" "}
                  {token.lastUsedAt ? t("tokens.lastUsed", { date: formatDateTime(token.lastUsedAt) }) : t("tokens.neverUsed")}
                </span>
              </div>
              <button type="button" className="btn btn--sm btn--icon" onClick={() => remove(token)} aria-label={t("tokens.delete", { name: token.name })} title={t("common.delete")}>
                <Trash size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
