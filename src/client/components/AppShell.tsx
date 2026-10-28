import { Menu, Search, Settings, X } from "../icons";
import { type FormEvent, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate, useSearchParams } from "react-router";
import { isLibraryPath } from "../routes";
import { DragArea } from "./DragAndDrop";
import { DropZone } from "./DropZone";
import { FolderTree } from "./FolderTree";
import { SettingsDialog } from "./SettingsDialog";
import { UploadButtons } from "./UploadButtons";
import { UploadProgress } from "./UploadProgress";
import { useTranslation } from "react-i18next";

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { t } = useTranslation();

  useEffect(() => setSidebarOpen(false), [location.pathname, location.search]);

  return (
    <div className="shell" data-sidebar-open={sidebarOpen || undefined}>
      <header className="topbar">
        <button type="button" className="btn btn--ghost btn--icon menu-button" onClick={() => setSidebarOpen((v) => !v)} aria-label={t("shell.menu")}>
          {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <Link to="/" className="logo" aria-label={t("shell.home")}>
          <span className="logo__mark" aria-hidden />
          archivar
        </Link>
        <SearchField />
        <UploadButtons />
      </header>
      <DragArea>
        <aside className="sidebar">
          <FolderTree onNavigate={() => setSidebarOpen(false)} />
          <SidebarFooter />
        </aside>
        <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
        <main className="content">
          <Outlet />
        </main>
      </DragArea>
      <DropZone />
      <UploadProgress />
    </div>
  );
}

function SearchField() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [value, setValue] = useState(params.get("q") ?? "");
  const { t } = useTranslation();

  useEffect(() => setValue(params.get("q") ?? ""), [params]);

  const onLibrary = isLibraryPath(location.pathname);

  const apply = (q: string) => {
    const next = new URLSearchParams(onLibrary ? params : undefined);
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    const search = next.toString();
    const pathname = onLibrary ? location.pathname : "/";
    navigate(search ? `${pathname}?${search}` : pathname, { replace: onLibrary });
  };

  useEffect(() => {
    if (!onLibrary || value === (params.get("q") ?? "")) return;
    const timer = setTimeout(() => apply(value), 300);
    return () => clearTimeout(timer);
  }, [value]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    apply(value);
  };

  return (
    <form className="search" role="search" onSubmit={onSubmit}>
      <Search size={16} className="search__icon" aria-hidden />
      <input
        type="search"
        className="search__input"
        placeholder={t("shell.searchPlaceholder")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-label={t("shell.search")}
      />
    </form>
  );
}

function SidebarFooter() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <div className="sidebar__footer">
      <button type="button" className="btn btn--ghost btn--sm sidebar__settings" onClick={() => setSettingsOpen(true)}>
        <Settings size={16} />
        {t("shell.settings")}
      </button>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
