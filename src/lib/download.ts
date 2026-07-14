/**
 * One cross-browser file-download helper, shared by character and homebrew
 * exports (previously duplicated). Appends the anchor to the DOM before
 * clicking (required by Firefox) and revokes the object URL on the next tick
 * (an immediate revoke cancels the download in some browsers).
 */

/** Ensure a filename ends in `.json` exactly once. */
export function jsonFilename(name: string): string {
  const trimmed = name.trim() || 'download';
  return trimmed.toLowerCase().endsWith('.json') ? trimmed : `${trimmed}.json`;
}

/** Trigger a browser download of `blob` as `filename`. */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Download `data` as a pretty-printed `.json` file named `name`. */
export function downloadJson(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(jsonFilename(name), blob);
}
