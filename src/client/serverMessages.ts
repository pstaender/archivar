import { serverMessageParts } from "../shared/serverMessages";
import { i18n, t } from "./i18n";

/** An English message in the UI language, looked up in `section`; messages without a translation stay as they are. */
function translateMessage(message: string, section: "serverMessages" | "workerMessages"): string {
  const { key, quoted, numbers } = serverMessageParts(message);
  if (!key || !i18n.exists(`${section}.${key}`)) return message;
  const values: Record<string, string> = {};
  quoted.forEach((items, index) => (values[`q${index}`] = items.map((text) => t("quoted", { text })).join(", ")));
  numbers.forEach((number, index) => (values[`n${index}`] = number));
  return t(`${section}.${key}`, values);
}

/** A message from the server, which always answers in English. */
export const translateServerMessage = (message: string) => translateMessage(message, "serverMessages");

/** A message from the preview or vectorizer worker (or code they share with the server), which are English too. */
export const translateWorkerMessage = (message: string) => translateMessage(message, "workerMessages");

/** `error` with its message translated, for errors that come from a worker. */
export function translateWorkerError(error: unknown): unknown {
  return error instanceof Error && error.constructor === Error ? new Error(translateWorkerMessage(error.message)) : error;
}
