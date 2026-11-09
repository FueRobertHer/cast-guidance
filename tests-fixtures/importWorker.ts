/**
 * The XML import worker, run in place: neither jsdom nor Node has a web
 * Worker. It answers through the same `runImportJob` the real worker runs,
 * a message at a time as the real one posts them, each a copy as a real
 * worker's would be, and says nothing more once it is terminated, so a
 * cancelled import is heard from no more.
 *
 * Install it with `vi.stubGlobal('Worker', InlineImportWorker)`.
 */
import { type ImportJobMessage, type ImportJobRequest, runImportJob } from '@/convert/importJob';

export class InlineImportWorker {
  /** Every worker started, the latest last. */
  static started: InlineImportWorker[] = [];
  onmessage: ((ev: MessageEvent<ImportJobMessage>) => void) | null = null;
  onerror: ((ev: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    InlineImportWorker.started.push(this);
  }

  postMessage(request: ImportJobRequest): void {
    void runImportJob(request, (message) => {
      const data = structuredClone(message);
      setTimeout(() => {
        if (!this.terminated) this.onmessage?.({ data } as MessageEvent<ImportJobMessage>);
      });
    });
  }

  terminate(): void {
    this.terminated = true;
  }
}
