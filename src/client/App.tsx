import { Route, Routes } from "react-router";
import { AppShell } from "./components/AppShell";
import { ConfigProvider } from "./hooks/config";
import { FoldersProvider } from "./hooks/folders";
import { ToastProvider } from "./hooks/toast";
import { UploadProvider } from "./hooks/upload";
import { DocumentPage } from "./pages/DocumentPage";
import { LibraryPage } from "./pages/LibraryPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { StackPage } from "./pages/StackPage";

export function App() {
  return (
    <ConfigProvider>
      <ToastProvider>
        <FoldersProvider>
          <UploadProvider>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<LibraryPage />} />
                <Route path="folders/*" element={<LibraryPage />} />
                <Route path="documents/:id" element={<DocumentPage />} />
                <Route path="stacks/:id" element={<StackPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Route>
            </Routes>
          </UploadProvider>
        </FoldersProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}
