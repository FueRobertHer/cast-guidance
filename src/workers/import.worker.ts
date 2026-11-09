/**
 * Converts another app's XML for the homebrew import, off the main thread: a
 * community compendium runs to 56 MB, and reading it on the page would freeze
 * it for seconds. One file per worker; the page ends the worker once it has
 * the result, or to cancel.
 */
import { type ImportJobMessage, type ImportJobRequest, runImportJob } from '@/convert/importJob';

self.onmessage = (ev: MessageEvent<ImportJobRequest>) => {
  void runImportJob(ev.data, (message: ImportJobMessage) => postMessage(message));
};
