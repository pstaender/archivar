import { ArrowLeft, ChevronLeft, ChevronRight, ImagePlus, CircleMinus, Trash, Unlink } from "../icons";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { StackWithDocuments } from "../../shared/types";
import { api } from "../api";
import { ConfirmDialog } from "../components/Dialog";
import { EditableTitle } from "../components/EditableTitle";
import { FolderPicker } from "../components/FolderPicker";
import { documentThumbnail, Thumbnail } from "../components/ItemCard";
import { uploadAccept } from "../../shared/uploads";
import { useConfig } from "../hooks/config";
import { useFolders } from "../hooks/folders";
import { useToast } from "../hooks/toast";
import { useRefreshOnJobProgress } from "../hooks/jobs";
import { useRefreshOnEditSave } from "../editSaves";
import { useRefreshOnUpload, useUpload } from "../hooks/upload";
import { usePolling } from "../hooks/usePolling";
import { useResource } from "../hooks/useResource";
import { documentLabel, formatDate, isOcrBusy } from "../format";

const OCR_POLL_INTERVAL = 2500;

export function StackPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const { reload: reloadFolders } = useFolders();
  const { convertibleImageTypes } = useConfig();
  const { upload } = useUpload();
  const stack = useResource(() => api.stack(id), [id]);
  useRefreshOnUpload(stack.refresh);
  useRefreshOnEditSave(stack.refresh);
  useRefreshOnJobProgress(stack.refresh);
  const [confirm, setConfirm] = useState<"dissolve" | "delete" | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const busy = stack.data?.documents.some(isOcrBusy) ?? false;
  usePolling(busy, stack.refresh, OCR_POLL_INTERVAL);

  if (stack.error) {
    return (
      <div className="page">
        <div className="alert alert--error">{stack.error.message}</div>
        <Link to="/" className="btn">
          Zur Übersicht
        </Link>
      </div>
    );
  }
  if (!stack.data) return <div className="page-loading">Lade …</div>;
  const data = stack.data;

  const update = async (change: Parameters<typeof api.updateStack>[1]) => {
    try {
      const updated = await api.updateStack(id, change);
      if (!updated) {
        toast.show("Stapel ist leer und wurde aufgelöst");
        navigate("/");
        return;
      }
      stack.setData(updated);
      if (change.folders) void reloadFolders();
    } catch (error) {
      toast.error(error);
    }
  };

  const move = (index: number, delta: number) => {
    const ids = [...data.documentIds];
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    stack.setData({ ...data, documentIds: ids, documents: ids.map((docId) => data.documents.find((d) => d.id === docId)!) });
    void update({ documentIds: ids });
  };

  const dissolve = async () => {
    try {
      await api.deleteStack(id);
      toast.success("Stapel aufgelöst");
      navigate("/");
    } catch (error) {
      toast.error(error);
    }
  };

  const deleteAll = async () => {
    try {
      for (const doc of data.documents) await api.deleteDocument(doc.id);
      toast.success("Stapel gelöscht");
      void reloadFolders();
      navigate("/");
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="page">
      <header className="page__header page__header--detail">
        <Link to="/" className="btn btn--ghost btn--icon" aria-label="Zurück">
          <ArrowLeft size={18} />
        </Link>
        <div className="page__title">
          <EditableTitle value={data.title} onSave={(title) => update({ title })} />
          <p className="muted small">
            Stapel · {data.documents.length} {data.documents.length === 1 ? "Seite" : "Seiten"} · zuletzt geändert {formatDate(data.updatedAt)}
          </p>
        </div>
        <div className="page__actions">
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={uploadAccept(convertibleImageTypes)}
            hidden
            onChange={(e) => {
              const files = Array.from(e.currentTarget.files ?? []);
              e.currentTarget.value = "";
              void upload(files, { stackId: id });
            }}
          />
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            <ImagePlus size={16} />
            <span className="hide-mobile">Seiten hinzufügen</span>
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => setConfirm("dissolve")} aria-label="Stapel auflösen" title="Stapel auflösen">
            <Unlink size={16} />
          </button>
          <button type="button" className="btn btn--ghost btn--icon btn--danger-ghost" onClick={() => setConfirm("delete")} aria-label="Stapel löschen" title="Stapel löschen">
            <Trash size={16} />
          </button>
        </div>
      </header>

      <section className="stack-meta">
        <FolderPicker value={data.folders} onChange={(folders) => update({ folders })} />
      </section>

      <ol className="pages">
        {data.documents.map((doc, index) => (
          <li key={doc.id} className="page-card">
            <Link to={`/documents/${doc.id}?stack=${id}`} className="page-card__media">
              <Thumbnail {...documentThumbnail(doc)} alt={documentLabel(doc)} />
              <span className="page-card__number">{index + 1}</span>
            </Link>
            <div className="page-card__footer">
              <span className="page-card__title" title={documentLabel(doc)}>
                {documentLabel(doc)}
              </span>
              <div className="page-card__actions">
                <button type="button" className="btn btn--ghost btn--icon btn--xs" onClick={() => move(index, -1)} disabled={index === 0} aria-label="Nach vorne">
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--xs"
                  onClick={() => move(index, 1)}
                  disabled={index === data.documents.length - 1}
                  aria-label="Nach hinten"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="btn btn--ghost btn--icon btn--xs"
                  onClick={() => update({ documentIds: data.documentIds.filter((docId) => docId !== doc.id) })}
                  aria-label="Aus Stapel entfernen"
                  title="Aus Stapel entfernen"
                >
                  <CircleMinus size={14} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ol>

      <ConfirmDialog
        open={confirm === "dissolve"}
        title="Stapel auflösen"
        message="Der Stapel wird entfernt, die Dokumente bleiben einzeln erhalten."
        confirmLabel="Auflösen"
        onConfirm={dissolve}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title="Stapel löschen"
        message={`Den Stapel und alle ${data.documents.length} Dokumente endgültig löschen?`}
        confirmLabel="Löschen"
        danger
        onConfirm={deleteAll}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
