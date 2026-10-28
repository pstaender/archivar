import { normalizePresetSteps, type PresetSteps, presetStepsFromSettings } from "../shared/presets";
import type { EditSettings } from "../shared/types";

const KEY = "archivar.copiedEdits";

/**
 * Keeps an image's edit settings (in this browser) to paste onto other images. They are kept as preset steps with
 * fixed values, except the dewarp grid, which only fits its own image and is predicted again.
 */
export function copyEdits(settings: EditSettings): PresetSteps {
  const steps = presetStepsFromSettings(settings);
  try {
    localStorage.setItem(KEY, JSON.stringify(steps));
  } catch {
    // Without storage the steps are only kept by the page that copied them.
  }
  return steps;
}

export function copiedEdits(): PresetSteps | null {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === null ? null : normalizePresetSteps(JSON.parse(stored));
  } catch {
    return null;
  }
}
