import { sanitizeFileName } from "./web-capture";

export function resolveAutoTitle(resourceInfo: string) {
  return sanitizeFileName(resourceInfo);
}

export function shouldApplyAutoTitle(currentTitle: string, autoTitle: string, hasManualTitleOverride: boolean) {
  if (!hasManualTitleOverride) return true;
  if (!currentTitle.trim()) return true;
  if (currentTitle === autoTitle) return true;
  return false;
}
