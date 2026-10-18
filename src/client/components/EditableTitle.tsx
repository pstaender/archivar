import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface EditableTitleProps {
  value: string;
  placeholder?: string;
  onSave: (value: string) => unknown;
}

export function EditableTitle({ value, placeholder, onSave }: EditableTitleProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    const next = draft.trim();
    if (next === value) return;
    if (!next) return setDraft(value);
    void onSave(next);
  };

  return (
    <input
      className="editable-title"
      value={draft}
      placeholder={placeholder ?? t("editableTitle.untitled")}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      aria-label={t("editableTitle.label")}
    />
  );
}
