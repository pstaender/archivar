import { HardDrive, Loader, Plus, Trash } from "../icons";
import { type FormEvent, useId, useState } from "react";
import { Link } from "react-router";
import type { ExternalSource } from "../../shared/externalSources";
import { api } from "../api";
import { ConfirmDialog } from "../components/Dialog";
import { useAuth } from "../hooks/auth";
import { useToast } from "../hooks/toast";
import { useResource } from "../hooks/useResource";
import { useTranslation } from "react-i18next";

/** The external data sources to import from; only admins add them, as they can read any folder on the server. */
export function SourcesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const admin = useAuth().status.user?.admin === true;
  const sources = useResource(() => api.sources(), []);
  const [deleting, setDeleting] = useState<ExternalSource | null>(null);

  const remove = async (source: ExternalSource) => {
    try {
      await api.deleteSource(source.id);
      await sources.refresh();
      toast.success(t("sources.deleted", { name: source.name }));
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{t("sources.title")}</h1>
          <p className="muted small">{t("sources.intro")}</p>
        </div>
      </header>

      {admin ? <AddSource onAdded={() => sources.refresh()} /> : <p className="muted small">{t("sources.adminOnly")}</p>}

      {sources.loading && !sources.data && <Loader size={20} className="spin" aria-label={t("sources.loading")} />}
      {sources.data?.length === 0 && (
        <div className="empty-state">
          <p className="muted">{t("sources.empty")}</p>
        </div>
      )}

      <ul className="presets" aria-label={t("sources.title")}>
        {sources.data?.map((source) => (
          <li key={source.id} className="preset-card">
            <div className="preset-card__header">
              <h2>
                <HardDrive size={18} aria-hidden />
                <Link to={`/sources/${source.id}`} className="underline">
                  {source.name}
                </Link>
              </h2>
              <Link to={`/sources/${source.id}`} className="btn btn--sm">
                {t("sources.browse")}
              </Link>
              <button
                type="button"
                className="btn btn--ghost btn--icon btn--sm"
                onClick={() => setDeleting(source)}
                aria-label={t("sources.deleteLabel", { name: source.name })}
                title={t("common.delete")}
              >
                <Trash size={16} />
              </button>
            </div>
            <p className="muted small source-card__meta">
              {t(`sources.types.${source.type}`)} · <code>{source.url}</code> · {t("sources.documents", { count: source.documentCount })}
            </p>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={deleting !== null}
        title={t("sources.deleteTitle")}
        message={t("sources.deleteConfirm", { name: deleting?.name })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={() => deleting && remove(deleting)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

/** The last folder of a path, e.g. "Scans" for "~/Documents/Scans/". */
function folderName(path: string): string {
  return path.split(/[/\\]+/).filter((part) => part && part !== "~").at(-1) ?? "";
}

function AddSource({ onAdded }: { onAdded: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const nameId = useId();
  const pathId = useId();
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [path, setPath] = useState("");

  const changePath = (value: string) => {
    setPath(value);
    if (!nameTouched) setName(folderName(value));
  };
  const [saving, setSaving] = useState(false);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !path.trim() || saving) return;
    setSaving(true);
    try {
      await api.createSource({ name: name.trim(), type: "file_path", url: path.trim() });
      setName("");
      setNameTouched(false);
      setPath("");
      onAdded();
      toast.success(t("sources.added", { name: name.trim() }));
    } catch (error) {
      toast.error(error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="source-form" onSubmit={add} aria-label={t("sources.add")}>
      <div>
        <label htmlFor={nameId} className="field__label">
          {t("sources.name")}
        </label>
        <input
          id={nameId}
          className="input"
          placeholder={t("sources.namePlaceholder")}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setNameTouched(true);
          }}
          maxLength={100}
        />
      </div>
      <div>
        <label htmlFor={pathId} className="field__label">
          {t("sources.path")}
        </label>
        <input id={pathId} className="input" placeholder={t("sources.pathPlaceholder")} value={path} onChange={(e) => changePath(e.target.value)} />
      </div>
      <button type="submit" className="btn" disabled={!name.trim() || !path.trim() || saving}>
        {saving ? <Loader size={16} className="spin" /> : <Plus size={16} />}
        {t("sources.add")}
      </button>
    </form>
  );
}
