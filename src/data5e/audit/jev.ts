/**
 * The one place that knows Jev's wire format. Jev (TypeSafe AI) answers typed
 * questions about a piece of text instead of writing any; the audit asks it
 * yes/no questions about rules prose and keeps the probabilities.
 *
 * The request and response shapes come from Vercel's AI Gateway docs for the
 * TypeSafe "systemone" endpoint, read through search summaries rather than
 * the pages themselves:
 *
 *   POST <AI Gateway>/typesafe/v1/systemone
 *   Authorization: Bearer $AI_GATEWAY_API_KEY
 *   { "model": "typesafe-ai/jev", "state": "<text>",
 *     "questions": { "<id>": { "type": "noul", "instructions": "<question>" } } }
 *
 *   -> { "answers": { "<id>": { "noul": 0.93 } } }
 *
 * Only `noul` (yes/no, answered with a probability) is used, the one type the
 * docs show end to end. If the live API differs, this file is the only one to
 * change: `jevRequestBody` and `parseJevAnswers` are the whole contract. The
 * endpoint itself comes from `scripts/data-judge.ts`: nothing the app ships
 * names an origin its content security policy does not allow, and this code
 * never runs in the browser.
 *
 * Relative imports only: `scripts/data-judge.ts` loads this under plain Bun.
 */

export const JEV_MODEL = 'typesafe-ai/jev';

export interface JevQuestion {
  id: string;
  /** The yes/no question, phrased so "yes" is the probability we keep. */
  instructions: string;
}

export interface JevRequest {
  /** The text Jev judges. */
  state: string;
  questions: readonly JevQuestion[];
}

/** Probability of "yes" per question id, each in [0, 1]. */
export type JevAnswers = Record<string, number>;

export type AskJev = (request: JevRequest) => Promise<JevAnswers>;

export function jevRequestBody(request: JevRequest, model: string = JEV_MODEL): unknown {
  const questions: Record<string, { type: 'noul'; instructions: string }> = {};
  for (const q of request.questions)
    questions[q.id] = { type: 'noul', instructions: q.instructions };
  return { model, state: request.state, questions };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Read one probability per asked question. A missing or out-of-range answer
 * throws, naming it: a judgment with a hole in it must not be saved as if the
 * model had said no.
 */
export function parseJevAnswers(body: unknown, ids: readonly string[]): JevAnswers {
  const answers = isRecord(body) ? body.answers : undefined;
  if (!isRecord(answers)) throw new Error('Jev response has no "answers" object');
  const out: JevAnswers = {};
  for (const id of ids) {
    const answer = answers[id];
    const p = isRecord(answer) ? answer.noul : undefined;
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1) {
      throw new Error(`Jev response has no probability for "${id}"`);
    }
    out[id] = p;
  }
  return out;
}

export interface JevClientOptions {
  apiKey: string;
  /** The systemone URL; `scripts/data-judge.ts` names the gateway's. */
  endpoint: string;
  model?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Attempts after the first, for rate limits, 5xx answers and network errors. */
  retries?: number;
  /** Injected so tests do not wait out the backoff. */
  sleep?: (ms: number) => Promise<void>;
}

/** Statuses worth another attempt: rate limits and server-side failures. */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

class JevHttpError extends Error {
  readonly status: number;

  constructor(status: number, detail: string) {
    super(`Jev answered HTTP ${status}${detail === '' ? '' : `: ${detail}`}`);
    this.status = status;
  }
}

/** Seconds from a numeric `Retry-After` header, capped so one answer cannot stall a run. */
function retryAfterMs(res: Response): number | undefined {
  const seconds = Number(res.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) * 1000 : undefined;
}

export function createJevClient(options: JevClientOptions): AskJev {
  const {
    apiKey,
    endpoint,
    model = JEV_MODEL,
    fetchImpl = globalThis.fetch,
    timeoutMs = 30_000,
    retries = 4,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  } = options;
  if (apiKey === '') throw new Error('Jev needs an API key (AI_GATEWAY_API_KEY)');

  return async (request) => {
    const ids = request.questions.map((q) => q.id);
    const body = JSON.stringify(jevRequestBody(request, model));
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      let wait = 1000 * 2 ** attempt;
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 200);
          const error = new JevHttpError(res.status, detail);
          if (!RETRYABLE.has(res.status)) throw error;
          lastError = error;
          wait = retryAfterMs(res) ?? wait;
        } else {
          return parseJevAnswers(await res.json(), ids);
        }
      } catch (error) {
        // A refused request or a malformed answer will not improve on retry.
        if (error instanceof JevHttpError && !RETRYABLE.has(error.status)) throw error;
        if (error instanceof Error && error.message.startsWith('Jev response')) throw error;
        lastError = error;
      }
      if (attempt < retries) await sleep(wait);
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  };
}
