import { getIconData, iconToSVG } from "@iconify/utils";
import icons from "@iconify-json/keyline-icons/icons.json";

export interface IconData {
  body: string;
  viewBox: string;
}

/** Bun macro: runs at bundle time so only the used icons end up in the client bundle. */
export function keyline(name: string): IconData {
  const data = getIconData(icons as Parameters<typeof getIconData>[0], name);
  if (!data) throw new Error(`Unknown Keyline icon: ${name}`);
  const svg = iconToSVG(data);
  return { body: svg.body, viewBox: svg.attributes.viewBox };
}
