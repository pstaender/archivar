import { ArrowLeft, ChevronLeft, ChevronRight, ImagePlus, CircleMinus, Trash, Unlink } from "../icons";
import { arrayMove } from "@dnd-kit/sortable";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ArchiveDocument } from "../../shared/types";
import { api } from "../api";
import { ConfirmDialog } from "../components/Dialog";
import { EditableTitle } from "../components/EditableTitle";
import { FolderPicker } from "../components/FolderPicker";
import { SortableGrid } from "../components/SortableGrid";
import { documentThumbnail, Thumbnail } from "../components/ItemCard";
import { uploadAccept } from "../../shared/uploads";
import { useConfig } from "../hooks/config";
import { useFolders } from "../hooks/folders";
import { useToast } from "../hooks/toast";
import { useRefreshOnJobProgress } from "../hooks/jobs";
import { useRefreshOnEditSave } from "../editSaves";
import { useRefreshOnUpload, useUpload } from "../hooks/upload";
import { usePolling } from "../hooks/usePolling";
import { useScrollToHashItem } from "../hooks/scrollToItem";
import { itemFromHash, itemHash, libraryLocation } from "../documentOrder";
import { useResource } from "../hooks/useResource";
import { documentLabel, formatDate, isOcrBusy } from "../format";
import { useTranslation } from "react-i18next";

const OCR_POLL_INTERVAL = 2500;

export function StackPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const toast = useToast();
  const { t } = useTranslation();
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
  useScrollToHashItem(Boolean(stack.data), (hash) => {
    const target = itemFromHash(hash);
    return target?.type === "document" ? document.querySelector(`[data-document-id="${target.id}"]`) : null;
  });

  if (stack.error) {
    return (
      <div className="page">
        <div className="alert alert--error">{stack.error.message}</div>
        <Link to="/" className="btn">
          {t("notFound.home")}
        </Link>
      </div>
    );
  }
  if (!stack.data) return <div className="page-loading">{t("stack.loading")}</div>;
  const data = stack.data;

  const update = async (change: Parameters<typeof api.updateStack>[1]) => {
    try {
      const updated = await api.updateStack(id, change);
      if (!updated) {
        toast.show(t("stack.emptyDissolved"));
        navigate("/");
        return;
      }
      stack.setData(updated);
      if (change.folders) void reloadFolders();
    } catch (error) {
      toast.error(error);
    }
  };

  const reorder = (documents: ArchiveDocument[]) => {
    const ids = documents.map((doc) => doc.id);
    stack.setData({ ...data, documentIds: ids, documents });
    void update({ documentIds: ids });
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= data.documents.length) return;
    reorder(arrayMove(data.documents, index, target));
  };

  const dissolve = async () => {
    try {
      await api.deleteStack(id);
      toast.success(t("stack.dissolved"));
      navigate("/");
    } catch (error) {
      toast.error(error);
    }
  };

  const deleteAll = async () => {
    try {
      for (const doc of data.documents) await api.deleteDocument(doc.id);
      toast.success(t("stack.deleted"));
      void reloadFolders();
      navigate("/");
    } catch (error) {
      toast.error(error);
    }
  };

  return (
    <div className="page">
      <header className="page__header page__header--detail">
        <Link to={libraryLocation() + itemHash({ type: "stack", id })} className="btn btn--ghost btn--icon" aria-label={t("common.back")}>
          <ArrowLeft size={18} />
        </Link>
        <div className="page__title">
          <EditableTitle value={data.title} onSave={(title) => update({ title })} />
          <p className="muted small">
            {t("stack.meta", { count: data.documents.length, date: formatDate(data.updatedAt) })}
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
            <span className="hide-mobile">{t("stack.addPages")}</span>
          </button>
          <button type="button" className="btn btn--ghost btn--icon" onClick={() => setConfirm("dissolve")} aria-label={t("stack.dissolve")} title={t("stack.dissolve")}>
            <Unlink size={16} />
          </button>
          <button type="button" className="btn btn--ghost btn--icon btn--danger-ghost" onClick={() => setConfirm("delete")} aria-label={t("stack.delete")} title={t("stack.delete")}>
            <Trash size={16} />
          </button>
        </div>
      </header>

      <section className="stack-meta">
        <FolderPicker value={data.folders} onChange={(folders) => update({ folders })} />
      </section>

      <SortableGrid
        className="pages"
        items={data.documents}
        itemKey={(doc) => String(doc.id)}
        itemLabel={documentLabel}
        onReorder={reorder}
        renderItem={(doc) => {
          const index = data.documents.indexOf(doc);
          return (
            <div className="page-card" data-document-id={doc.id}>
              <Link to={`/documents/${doc.id}?stack=${id}`} className="page-card__media">
                <Thumbnail {...documentThumbnail(doc)} alt={documentLabel(doc)} />
                <span className="page-card__number">{index + 1}</span>
              </Link>
              <div className="page-card__footer">
                <span className="page-card__title" title={documentLabel(doc)}>
                  {documentLabel(doc)}
                </span>
                <div className="page-card__actions">
                  <button type="button" className="btn btn--ghost btn--icon btn--xs" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t("stack.forward")}>
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--xs"
                    onClick={() => move(index, 1)}
                    disabled={index === data.documents.length - 1}
                    aria-label={t("stack.backward")}
                  >
                    <ChevronRight size={14} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost btn--icon btn--xs"
                    onClick={() => update({ documentIds: data.documentIds.filter((docId) => docId !== doc.id) })}
                    aria-label={t("stack.removeFromStack")}
                    title={t("stack.removeFromStack")}
                  >
                    <CircleMinus size={14} />
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      />

      <ConfirmDialog
        open={confirm === "dissolve"}
        title={t("stack.dissolve")}
        message={t("stack.dissolveText")}
        confirmLabel={t("stack.dissolveConfirm")}
        onConfirm={dissolve}
        onClose={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === "delete"}
        title={t("stack.delete")}
        message={t("stack.deleteText", { count: data.documents.length })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={deleteAll}
        onClose={() => setConfirm(null)}
      />
    </div>
  );
}
