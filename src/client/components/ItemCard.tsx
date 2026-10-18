import { Check, FileText, Layers, Loader, ScanText, SmartStackIcon } from "../icons";
import { type MouseEvent, useState } from "react";
import { Link } from "react-router";
import type { ArchiveDocument, LibraryItem } from "../../shared/types";
import { assetUrl } from "../api";
import { documentLabel, formatDate, isOcrBusy, ocrStatusLabel } from "../format";
import type { SmartStack } from "../smartStacks";
import { useTranslation } from "react-i18next";
import { translateServerMessage } from "../serverMessages";

interface ItemCardProps {
  item: LibraryItem;
  selected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
}

export function itemKey(item: LibraryItem): string {
  return item.type === "document" ? `d${item.document.id}` : `s${item.stack.id}`;
}

interface ThumbnailProps {
  src: string | null;
  label?: string;
  alt?: string;
}

export function Thumbnail({ src, label, alt = "" }: ThumbnailProps) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <div className="thumb thumb--file">
        <FileText size={32} strokeWidth={1.5} aria-hidden />
        {label && <span>{label}</span>}
      </div>
    );
  }
  return <img className="thumb" src={src} alt={alt} loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

export function documentThumbnail(doc: ArchiveDocument): ThumbnailProps {
  return {
    src: doc.kind === "file" ? null : assetUrl(doc, "thumbnail"),
    label: doc.originalName.includes(".") ? doc.originalName.split(".").pop()!.toUpperCase() : undefined,
  };
}

export function ItemCard({ item, selected, selectionMode, onToggle }: ItemCardProps) {
  const isStack = item.type === "stack";
  const { t } = useTranslation();
  const thumbnail: ThumbnailProps = isStack
    ? {
        src: item.stack.coverDocumentId
          ? assetUrl({ id: item.stack.coverDocumentId, updatedAt: item.stack.updatedAt }, "thumbnail")
          : null,
      }
    : documentThumbnail(item.document);
  const title = isStack ? item.stack.title : documentLabel(item.document);
  const href = isStack ? `/stacks/${item.stack.id}` : `/documents/${item.document.id}`;
  const date = isStack ? item.stack.updatedAt : item.document.createdAt;

  const onClick = (e: MouseEvent) => {
    if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <article className={`card ${isStack ? "card--stack" : ""} ${selected ? "is-selected" : ""}`}>
      <Link to={href} className="card__link" onClick={onClick} draggable={false}>
        <div className="card__media">
          {isStack && <div className="card__layers" aria-hidden />}
          <Thumbnail {...thumbnail} alt={title} />
          {isStack && (
            <span className="card__badge">
              <Layers size={12} aria-hidden />
              {item.stack.documentIds.length}
            </span>
          )}
          {!isStack && <OcrIndicator doc={item.document} />}
        </div>
        <div className="card__body">
          <h2 className="card__title" title={title}>
            {title}
          </h2>
          <p className="card__meta">
            {formatDate(date)}
            {!isStack && item.document.pageCount ? ` · ${t("card.pages", { count: item.document.pageCount })}` : ""}
            {isStack ? ` · ${t("card.stack")}` : ""}
          </p>
        </div>
      </Link>
      <button
        type="button"
        className="card__check"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? t("card.deselect", { title }) : t("card.select", { title })}
      >
        <Check size={14} strokeWidth={3} />
      </button>
    </article>
  );
}

interface SmartStackCardProps {
  stack: SmartStack;
  /** Shows only the stack's documents. */
  href: string;
  selected: boolean;
  selectionMode: boolean;
  onToggle: () => void;
}

/** A group of documents that seem to belong together; it only exists in this view. */
export function SmartStackCard({ stack, href, selected, selectionMode, onToggle }: SmartStackCardProps) {
  const [cover] = stack.documents;
  const { t } = useTranslation();
  const onClick = (e: MouseEvent) => {
    if (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      onToggle();
    }
  };
  return (
    <article className={`card card--stack card--smart ${selected ? "is-selected" : ""}`}>
      <Link to={href} className="card__link" onClick={onClick} draggable={false}>
        <div className="card__media">
          <div className="card__layers" aria-hidden />
          {cover && <Thumbnail {...documentThumbnail(cover)} alt={stack.title} />}
          <span className="card__badge" title={t("card.smartStack")}>
            <SmartStackIcon size={12} aria-hidden />
            {stack.documents.length}
          </span>
        </div>
        <div className="card__body">
          <h2 className="card__title" title={stack.title}>
            {stack.title}
          </h2>
          <p className="card__meta">{t(`card.smartReasons.${stack.reason}`)} · {t("card.smartStack")}</p>
        </div>
      </Link>
      <button
        type="button"
        className="card__check"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? t("card.deselect", { title: stack.title }) : t("card.select", { title: stack.title })}
      >
        <Check size={14} strokeWidth={3} />
      </button>
    </article>
  );
}

function OcrIndicator({ doc }: { doc: ArchiveDocument }) {
  if (isOcrBusy(doc)) {
    return (
      <span className="card__status" title={ocrStatusLabel(doc.ocrStatus)}>
        <Loader size={12} className="spin" aria-label={ocrStatusLabel(doc.ocrStatus)} />
      </span>
    );
  }
  if (doc.ocrStatus === "done" && doc.ocrText) {
    return (
      <span className="card__status" title={ocrStatusLabel("done")}>
        <ScanText size={12} aria-label={ocrStatusLabel("done")} />
      </span>
    );
  }
  if (doc.ocrStatus === "failed") {
    return (
      <span className="card__status card__status--error" title={doc.ocrError ? translateServerMessage(doc.ocrError) : ocrStatusLabel("failed")}>
        !
      </span>
    );
  }
  return null;
}
