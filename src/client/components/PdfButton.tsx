import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { MAX_PDF_COMPRESSION, MIN_PDF_COMPRESSION, type PdfImageQuality, type PdfQuality } from "../../shared/settings";
import { Slider } from "../editor/EditControls";
import { useSettings } from "../hooks/settings";
import { ChevronDown, Download, Loader } from "../icons";

export const PDF_QUALITY_CHOICES: { value: PdfImageQuality; label: string; description: string }[] = [
  { value: "low", label: "Niedrig", description: "150 DPI, kleine Dateien für Bildschirm und E-Mail" },
  { value: "medium", label: "Mittel", description: "300 DPI, gut zum Drucken" },
  { value: "high", label: "Hoch", description: "Bis 600 DPI, kaum komprimiert" },
  { value: "original", label: "Original", description: "Volle Auflösung, verlustfrei (PNG)" },
];

const CUSTOM_KEY = "archivar.pdfCompression";
const DEFAULT_CUSTOM = 7;

function storedCustom(): number {
  try {
    const value = Number(localStorage.getItem(CUSTOM_KEY));
    return localStorage.getItem(CUSTOM_KEY) !== null && Number.isInteger(value) && value >= MIN_PDF_COMPRESSION && value <= MAX_PDF_COMPRESSION ? value : DEFAULT_CUSTOM;
  } catch {
    return DEFAULT_CUSTOM;
  }
}

interface PdfButtonProps {
  /** Without a quality, the user's setting applies. */
  onExport: (quality?: PdfQuality) => void;
  busy: boolean;
  disabled: boolean;
  title: string;
  small?: boolean;
  /** Opens the menu upwards, e.g. in a bar at the bottom of the screen. */
  up?: boolean;
  /** Class of the label, e.g. to hide it on phones. */
  labelClassName?: string;
}

/** „PDF“ downloads with the quality from the settings; the arrow next to it offers the other qualities. */
export function PdfButton({ onExport, busy, disabled, title, small, up, labelClassName }: PdfButtonProps) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState(storedCustom);
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const btn = small ? "btn btn--sm" : "btn";

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const exportWith = (quality?: PdfQuality) => {
    setOpen(false);
    onExport(quality);
  };

  const exportCustom = () => {
    try {
      localStorage.setItem(CUSTOM_KEY, String(custom));
    } catch {
      // The value is then just not remembered.
    }
    exportWith(custom);
  };

  const menuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      toggle.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    e.preventDefault();
    items[(index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  };

  return (
    <div className="split-button" ref={root}>
      <button type="button" className={btn} onClick={() => onExport()} disabled={disabled} title={title}>
        {busy ? <Loader size={16} className="spin" /> : <Download size={16} />}
        <span className={labelClassName}>PDF</span>
      </button>
      <button
        ref={toggle}
        type="button"
        className={`${btn} btn--icon split-button__toggle`}
        onClick={() => {
          setCustomOpen(false);
          setOpen(!open);
        }}
        disabled={disabled}
        aria-label="PDF-Qualität wählen"
        title="PDF-Qualität wählen"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ChevronDown size={14} />
      </button>
      {open && (
        <div ref={menu} className={`menu split-button__menu ${up ? "split-button__menu--up" : ""}`} role="menu" aria-label="PDF-Qualität" onKeyDown={menuKeyDown}>
          {PDF_QUALITY_CHOICES.map((choice) => (
            <button key={choice.value} type="button" role="menuitem" onClick={() => exportWith(choice.value)}>
              <span className="menu__label">
                {choice.label}
                {choice.value === settings.pdfImageQuality && <span className="choice__default">Standard</span>}
              </span>
              <span className="menu__hint">{choice.description}</span>
            </button>
          ))}
          <button type="button" role="menuitem" aria-expanded={customOpen} onClick={() => setCustomOpen(!customOpen)}>
            <span className="menu__label">Eigene …</span>
            <span className="menu__hint">300 DPI, Kompression selbst wählen</span>
          </button>
          {customOpen && (
            <div className="menu__custom">
              <Slider label="Qualität" value={custom} min={MIN_PDF_COMPRESSION} max={MAX_PDF_COMPRESSION} step={1} defaultValue={DEFAULT_CUSTOM} onChange={setCustom} />
              <span className="menu__hint">je höher, desto besser die Qualität</span>
              <button type="button" className="btn btn--sm btn--primary" onClick={exportCustom}>
                <Download size={16} />
                Herunterladen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
