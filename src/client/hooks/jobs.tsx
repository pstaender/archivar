import { createContext, type ReactNode, useContext, useEffect, useMemo, useRef } from "react";
import type { Job } from "../../shared/jobs";
import { FINISHED_STATES } from "../../shared/jobs";
import { api } from "../api";
import { useResource } from "./useResource";

export const JOB_POLL_INTERVAL = 2000;

interface JobsApi {
  jobs: Job[];
  /** Jobs with items still waiting or running. */
  activeCount: number;
  /** Grows whenever another job item finishes, so pages can show the processed documents. */
  finished: number;
  reload: () => Promise<void>;
}

const JobsContext = createContext<JobsApi | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const { data, refresh } = useResource(() => api.jobs(), []);
  const jobs = data ?? [];
  const activeCount = jobs.filter((job) => job.active).length;
  const finished = jobs.reduce((sum, job) => sum + job.items.filter((item) => FINISHED_STATES.includes(item.state) || item.state === "ocr").length, 0);

  // Jobs can run for a long time, so unlike usePolling this keeps going as long as something is active.
  useEffect(() => {
    if (activeCount === 0) return;
    const timer = setInterval(() => void refresh(), JOB_POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [activeCount > 0, refresh]);

  const value = useMemo(() => ({ jobs, activeCount, finished, reload: refresh }), [data, refresh]);
  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsApi {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs must be used inside JobsProvider");
  return ctx;
}

/** Calls `refresh` (a background reload) when a job processed another document. */
export function useRefreshOnJobProgress(refresh: () => void): void {
  const { finished } = useJobs();
  const seen = useRef(finished);
  useEffect(() => {
    if (finished === seen.current) return;
    const grew = finished > seen.current;
    seen.current = finished;
    if (grew) refresh();
  }, [finished, refresh]);
}
