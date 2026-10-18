import { serverMessageParts } from "../shared/serverMessages";
import { i18n, t } from "./i18n";

/** A message from the server (always English) in the UI language; messages without a translation stay as they are. */
export function translateServerMessage(message: string): string {
  const { key, quoted, numbers } = serverMessageParts(message);
  if (!key || !i18n.exists(`serverMessages.${key}`)) return message;
  const values: Record<string, string> = {};
  quoted.forEach((items, index) => (values[`q${index}`] = items.map((text) => t("quoted", { text })).join(", ")));
  numbers.forEach((number, index) => (values[`n${index}`] = number));
  return t(`serverMessages.${key}`, values);
}
