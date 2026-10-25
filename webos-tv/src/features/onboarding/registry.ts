import type { Route } from '../../app/router';

/** A way to bring music into the TV that onboarding may offer (phone transfer, file, account…). */
export interface ImportOption {
  id: string;
  titleKey: string;
  title: string;
  /** String key for the description; falls back to `description`. */
  descriptionKey?: string;
  description: string;
  route: Route;
}

const options = new Map<string, ImportOption>();

/** Later stages register their entry point here; with none registered, onboarding skips the step. */
export function registerImportOption(option: ImportOption): void { options.set(option.id, option); }
export function listImportOptions(): ImportOption[] { return [...options.values()]; }
export function clearImportOptions(): void { options.clear(); }
