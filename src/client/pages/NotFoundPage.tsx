import { Link } from "react-router";
import { useTranslation } from "react-i18next";

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="empty-state">
      <h1>{t("notFound.title")}</h1>
      <p className="muted">{t("notFound.text")}</p>
      <Link to="/" className="btn">
        {t("notFound.home")}
      </Link>
    </div>
  );
}
