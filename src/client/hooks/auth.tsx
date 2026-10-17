import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import type { AuthStatus } from "../../shared/auth";
import { api, LOGGED_OUT_EVENT } from "../api";
import { Loader } from "../icons";
import { LoginPage } from "../pages/LoginPage";

interface AuthApi {
  status: AuthStatus;
  refresh(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

/** Shows the login instead of the app while a password is set and this browser has no session. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.authStatus());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onLoggedOut = () => void refresh();
    window.addEventListener(LOGGED_OUT_EVENT, onLoggedOut);
    return () => window.removeEventListener(LOGGED_OUT_EVENT, onLoggedOut);
  }, [refresh]);

  if (!status) {
    return (
      <div className="empty-state">
        {failed ? (
          <>
            <p>Der Server ist nicht erreichbar.</p>
            <button type="button" className="btn" onClick={refresh}>
              Erneut versuchen
            </button>
          </>
        ) : (
          <Loader size={24} className="spin" aria-label="Wird geladen" />
        )}
      </div>
    );
  }
  if (!status.user) return <LoginPage status={status} onLogin={refresh} />;
  return (
    <AuthContext.Provider key={status.user.id} value={{ status, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthGate");
  return ctx;
}
