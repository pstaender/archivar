import { Folder as FolderIcon, X } from "../icons";
import { type KeyboardEvent, useId, useState } from "react";
import { normalizeFolderPath } from "../../shared/folders";
import { useFolders } from "../hooks/folders";

interface FolderPickerProps {
  value: string[];
  onChange: (folders: string[]) => void;
  label?: string;
}

export function FolderPicker({ value, onChange, label = "Ordner" }: FolderPickerProps) {
  const { folders } = useFolders();
  const [input, setInput] = useState("");
  const listId = useId();
  const inputId = useId();

  const add = () => {
    const path = normalizeFolderPath(input);
    if (path && !value.includes(path)) onChange([...value, path].sort());
    setInput("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      add();
    } else if (e.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className="folder-picker">
      <label htmlFor={inputId} className="field__label">
        {label}
      </label>
      <div className="folder-picker__box">
        {value.map((path) => (
          <span key={path} className="chip">
            <FolderIcon size={13} aria-hidden />
            {path}
            <button
              type="button"
              className="chip__remove"
              onClick={() => onChange(value.filter((p) => p !== path))}
              aria-label={`${path} entfernen`}
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          className="folder-picker__input"
          list={listId}
          value={input}
          placeholder={value.length ? "" : "z.B. wichtig/2026"}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
        />
      </div>
      <datalist id={listId}>
        {folders
          .filter((f) => !value.includes(f.path))
          .map((f) => (
            <option key={f.id} value={f.path} />
          ))}
      </datalist>
    </div>
  );
}
