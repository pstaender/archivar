import type { ReactNode } from "react";

export function Switch({ checked, disabled, onChange, children, hint }: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint: string;
}) {
  return (
    <label className="switch switch--described">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch__track" aria-hidden />
      <span className="choice__text">
        <span className="choice__label">{children}</span>
        <span className="choice__description">{hint}</span>
      </span>
    </label>
  );
}
