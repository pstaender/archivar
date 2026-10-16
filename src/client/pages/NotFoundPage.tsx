import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="empty-state">
      <h1>Nicht gefunden</h1>
      <p className="muted">Diese Seite gibt es nicht.</p>
      <Link to="/" className="btn">
        Zur Übersicht
      </Link>
    </div>
  );
}
