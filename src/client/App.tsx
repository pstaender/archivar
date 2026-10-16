import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import { AppShell } from "./components/AppShell";
import { ConfigProvider } from "./hooks/config";
import { FoldersProvider } from "./hooks/folders";
import { SettingsProvider } from "./hooks/settings";
import { ToastProvider } from "./hooks/toast";
import { UploadProvider } from "./hooks/upload";
import { DocumentPage } from "./pages/DocumentPage";
import { LibraryPage } from "./pages/LibraryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { StackPage } from "./pages/StackPage";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ConfigProvider>
      <ToastProvider>
        <SettingsProvider>
          <FoldersProvider>
            <UploadProvider>{children}</UploadProvider>
          </FoldersProvider>
        </SettingsProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}

// A data router (createBrowserRouter), because the editor blocks navigation with unsaved changes (useBlocker).
export const routes: RouteObject[] = [
  {
    element: (
      <AppProviders>
        <AppShell />
      </AppProviders>
    ),
    children: [
      { index: true, element: <LibraryPage /> },
      { path: "folders/*", element: <LibraryPage /> },
      { path: "documents/:id", element: <DocumentPage /> },
      { path: "stacks/:id", element: <StackPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
