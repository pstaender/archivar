import { Check, FileText, Layers, Loader, ScanText } from "../icons";
import { type MouseEvent, useState } from "react";
import { Link } from "react-router";
import type { ArchiveDocument, LibraryItem } from "../../shared/types";
import { assetUrl } from "../api";
import { documentLabel, formatDate, isOcrBusy, OCR_STATUS_LABEL } from "../format";

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
            {!isStack && item.document.pageCount ? ` · ${item.document.pageCount} S.` : ""}
            {isStack ? " · Stapel" : ""}
          </p>
        </div>
      </Link>
      <button
        type="button"
        className="card__check"
        onClick={onToggle}
        aria-pressed={selected}
        aria-label={selected ? `${title} abwählen` : `${title} auswählen`}
      >
        <Check size={14} strokeWidth={3} />
      </button>
    </article>
  );
}

function OcrIndicator({ doc }: { doc: ArchiveDocument }) {
  if (isOcrBusy(doc)) {
    return (
      <span className="card__status" title={OCR_STATUS_LABEL[doc.ocrStatus]}>
        <Loader size={12} className="spin" aria-label={OCR_STATUS_LABEL[doc.ocrStatus]} />
      </span>
    );
  }
  if (doc.ocrStatus === "done" && doc.ocrText) {
    return (
      <span className="card__status" title={OCR_STATUS_LABEL.done}>
        <ScanText size={12} aria-label={OCR_STATUS_LABEL.done} />
      </span>
    );
  }
  if (doc.ocrStatus === "failed") {
    return (
      <span className="card__status card__status--error" title={doc.ocrError ?? OCR_STATUS_LABEL.failed}>
        !
      </span>
    );
  }
  return null;
}
