import { CircleAlert, CircleCheck, Loader, Trash } from "../icons";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { FINISHED_STATES, type Job, type JobItem, type JobItemState } from "../../shared/jobs";
import { api, assetUrl } from "../api";
import { useJobs } from "../hooks/jobs";
import { useToast } from "../hooks/toast";
import { formatDateTime, formatDuration, formatRelativeTime, ocrLanguageName } from "../format";
import { t } from "../i18n";
import { useTranslation } from "react-i18next";
import { translateServerMessage } from "../serverMessages";

const IMPORT_STATES: JobItemState[] = ["pending", "running"];

export function jobDescription(job: Job): string {
  if (job.kind === "import") return t("jobs.files", { count: job.items.length });
  const options = job.options;
  if (!options) return "";
  const parts: string[] = [];
  if (options.rename) parts.push(t("jobs.rename", { scheme: options.rename }));
  if (options.preset) parts.push(t("jobs.preset", { name: options.preset.name }));
  if (options.ocr) {
    const details = [options.languages ? options.languages.map(ocrLanguageName).join(" + ") : null, options.allText ? t("jobs.allText") : null].filter(Boolean);
    parts.push(details.length ? t("jobs.ocrWith", { details: details.join(", ") }) : t("jobs.ocr"));
  }
  return parts.join(" · ");
}

/** The current time, updated every second while something is less than a minute old, otherwise every 30 seconds. */
function useNow(newest: string | undefined): Date {
  const [now, setNow] = useState(() => new Date());
  const fresh = newest !== undefined && now.getTime() - new Date(newest).getTime() < 60_000;
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), fresh ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [fresh]);
  return now;
}

export function JobsPage() {
  const { jobs, reload } = useJobs();
  const { t } = useTranslation();
  const now = useNow(jobs[0]?.createdAt);
  const toast = useToast();
  const [removing, setRemoving] = useState(false);
  const finished = jobs.filter((job) => !job.active);

  const remove = async (targets: Job[]) => {
    setRemoving(true);
    try {
      for (const job of targets) await api.deleteJob(job.id);
      await reload();
    } catch (error) {
      toast.error(error);
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="page">
      <header className="page__header">
        <div>
          <h1>{t("jobs.title")}</h1>
          <p className="muted small">{t("jobs.intro")}</p>
        </div>
        {finished.length > 0 && (
          <button type="button" className="btn btn--sm" onClick={() => remove(finished)} disabled={removing}>
            <Trash size={16} />
            {t("jobs.removeFinished")}
          </button>
        )}
      </header>

      {jobs.length === 0 && (
        <div className="empty-state">
          <p className="muted">
            {t("jobs.empty")}
          </p>
        </div>
      )}

      <div className="jobs">
        {jobs.map((job) => (
          <JobCard key={job.id} job={job} now={now} removing={removing} onRemove={() => remove([job])} />
        ))}
      </div>
    </div>
  );
}

function JobCard({ job, now, removing, onRemove }: { job: Job; now: Date; removing: boolean; onRemove: () => void }) {
  const { t } = useTranslation();
  const total = job.items.length;
  const done = job.items.filter((item) => FINISHED_STATES.includes(item.state)).length;
  const failed = job.items.filter((item) => item.state === "failed").length;
  const title = job.kind === "import" ? t("jobs.import") : t("jobs.title");

  return (
    <section className="job" aria-label={t("jobs.jobLabel", { title, date: formatDateTime(job.createdAt) })}>
      <header className="job__header">
        <div className="job__title">
          <h2>
            {job.active && <Loader size={16} className="spin" aria-hidden />}
            {title}
          </h2>
          <p className="muted small">
            <time dateTime={job.createdAt} title={formatDateTime(job.createdAt)}>
              {formatRelativeTime(job.createdAt, now)}
            </time>
            {job.finishedAt && ` · ${t("jobs.duration", { duration: formatDuration(new Date(job.finishedAt).getTime() - new Date(job.createdAt).getTime()) })}`}
            {jobDescription(job) && ` · ${jobDescription(job)}`}
          </p>
        </div>
        <span className="job__summary small">
          {t("jobs.doneOf", { done, total })}
          {failed > 0 && <span className="job__failed"> · {t("jobs.failed", { count: failed })}</span>}
        </span>
        {!job.active && (
          <button type="button" className="btn btn--ghost btn--icon btn--sm" onClick={onRemove} disabled={removing} aria-label={t("jobs.remove")} title={t("jobs.removeTitle")}>
            <Trash size={16} />
          </button>
        )}
      </header>
      <div className="job__progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t("jobs.progress")}>
        <span style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <details className="job__details" open={job.active}>
        <summary>{job.active ? t("jobs.documents") : t("jobs.showDocuments")}</summary>
        <ul className="job__items">
          {job.items.map((item) => (
            <JobItemRow key={item.id} item={item} kind={job.kind} />
          ))}
        </ul>
      </details>
    </section>
  );
}

function JobItemRow({ item, kind }: { item: JobItem; kind: Job["kind"] }) {
  const { t } = useTranslation();
  const doc = item.document;
  const label = kind === "import" && IMPORT_STATES.includes(item.state) ? t(`jobs.importStates.${item.state}`) : t(`jobs.states.${item.state}`);
  const name = doc ? doc.title.trim() || doc.originalName : item.name;
  return (
    <li className={`job-item job-item--${item.state}`}>
      <span className="job-item__thumb">{doc && doc.kind !== "file" && <img src={assetUrl(doc, "thumbnail")} alt="" loading="lazy" />}</span>
      <span className="job-item__name">{doc ? <Link to={`/documents/${doc.id}`}>{name}</Link> : name}</span>
      <span className="job-item__state small">
        {(item.state === "running" || item.state === "ocr") && <Loader size={14} className="spin" aria-hidden />}
        {item.state === "done" && <CircleCheck size={14} aria-hidden />}
        {item.state === "failed" && <CircleAlert size={14} aria-hidden />}
        {label}
      </span>
      {item.error && <span className="job-item__error small">{translateServerMessage(item.error)}</span>}
      {item.note && <span className="job-item__note small">{translateServerMessage(item.note)}</span>}
    </li>
  );
}
