import type { ReactNode } from "react";
import type { RouteObject } from "react-router";
import "./i18n";
import { AppShell } from "./components/AppShell";
import { AuthGate } from "./hooks/auth";
import { ConfigProvider } from "./hooks/config";
import { FoldersProvider } from "./hooks/folders";
import { JobsProvider } from "./hooks/jobs";
import { PresetsProvider } from "./hooks/presets";
import { SettingsProvider } from "./hooks/settings";
import { ToastProvider } from "./hooks/toast";
import { UploadProvider } from "./hooks/upload";
import { DocumentPage } from "./pages/DocumentPage";
import { PresetsPage } from "./pages/PresetsPage";
import { JobsPage } from "./pages/JobsPage";
import { LibraryPage } from "./pages/LibraryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { StackPage } from "./pages/StackPage";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AuthGate>
        <ConfigProvider>
          <SettingsProvider>
            <FoldersProvider>
              <PresetsProvider>
                <JobsProvider>
                  <UploadProvider>{children}</UploadProvider>
                </JobsProvider>
              </PresetsProvider>
            </FoldersProvider>
          </SettingsProvider>
        </ConfigProvider>
      </AuthGate>
    </ToastProvider>
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
      { path: "jobs", element: <JobsPage /> },
      { path: "presets", element: <PresetsPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
];
