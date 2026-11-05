import { describe, expect, it, vi } from 'vitest';
import { createJevClient, jevRequestBody, parseJevAnswers } from './jev';

const endpoint = 'http://localhost/typesafe/v1/systemone';

const request = {
  state: 'Quick Step\nYou can dash as a bonus action.',
  questions: [
    { id: 'bonusAction', instructions: 'Bonus action?' },
    { id: 'reaction', instructions: 'Reaction?' },
  ],
};

/** The shape the direct API really answered with, usage included. */
const answers = {
  model: 'jev-1.14.0',
  answers: {
    bonusAction: { type: 'noul', noul: 0.97 },
    reaction: { type: 'noul', noul: 0.02 },
  },
  usage: { input_tokens: 472, output_tokens: 147 },
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

describe('jevRequestBody', () => {
  it('asks every question as a yes/no (noul) question keyed by its id', () => {
    expect(jevRequestBody(request)).toEqual({
      model: 'typesafe-ai/jev',
      state: request.state,
      questions: {
        bonusAction: { type: 'noul', instructions: 'Bonus action?' },
        reaction: { type: 'noul', instructions: 'Reaction?' },
      },
    });
  });
});

describe('parseJevAnswers', () => {
  it('reads one probability per question', () => {
    expect(parseJevAnswers(answers, ['bonusAction', 'reaction'])).toEqual({
      bonusAction: 0.97,
      reaction: 0.02,
    });
  });

  it.each([
    ['no answers object', {}, /no "answers"/],
    ['a missing question', { answers: { bonusAction: { noul: 0.5 } } }, /"reaction"/],
    [
      'an out-of-range probability',
      { answers: { ...answers.answers, reaction: { noul: 2 } } },
      /"reaction"/,
    ],
    ['a non-number', { answers: { ...answers.answers, reaction: { noul: 'yes' } } }, /"reaction"/],
  ])('refuses %s rather than reading it as "no"', (_, body, message) => {
    expect(() => parseJevAnswers(body, ['bonusAction', 'reaction'])).toThrow(message);
  });
});

describe('createJevClient', () => {
  const noWait = async () => {};

  it('posts the request with the key and returns the answers', async () => {
    const fetchImpl = vi.fn(async () => json(answers));
    const ask = createJevClient({ apiKey: 'k', endpoint, fetchImpl, sleep: noWait });
    await expect(ask(request)).resolves.toEqual({ bonusAction: 0.97, reaction: 0.02 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(endpoint);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(String(init.body))).toEqual(jevRequestBody(request));
  });

  it('retries a rate limit, honoring Retry-After, then succeeds', async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 429, { 'retry-after': '3' }))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(json(answers));
    const ask = createJevClient({ apiKey: 'k', endpoint, fetchImpl, sleep });
    await expect(ask(request)).resolves.toEqual({ bonusAction: 0.97, reaction: 0.02 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Retry-After wins over the backoff; the network error backs off 2 s.
    expect(sleep.mock.calls).toEqual([[3000], [2000]]);
  });

  it('gives up after its retries', async () => {
    const fetchImpl = vi.fn(async () => json({}, 503));
    const ask = createJevClient({ apiKey: 'k', endpoint, fetchImpl, sleep: noWait, retries: 2 });
    await expect(ask(request)).rejects.toThrow('HTTP 503');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('retries when TypeSafe answers 529 Overloaded', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}, 529))
      .mockResolvedValueOnce(json(answers));
    const ask = createJevClient({ apiKey: 'k', endpoint, fetchImpl, sleep: noWait });
    await expect(ask(request)).resolves.toEqual({ bonusAction: 0.97, reaction: 0.02 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('sends the model it was given', async () => {
    const fetchImpl = vi.fn(async () => json(answers));
    const ask = createJevClient({ apiKey: 'k', endpoint, model: 'jev-latest', fetchImpl });
    await ask(request);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).model).toBe('jev-latest');
  });

  it('does not retry a refused request or a malformed answer', async () => {
    const refused = vi.fn(async () => new Response('bad key', { status: 401 }));
    await expect(
      createJevClient({ apiKey: 'k', endpoint, fetchImpl: refused, sleep: noWait })(request),
    ).rejects.toThrow('HTTP 401: bad key');
    expect(refused).toHaveBeenCalledTimes(1);

    const malformed = vi.fn(async () => json({ answers: {} }));
    await expect(
      createJevClient({ apiKey: 'k', endpoint, fetchImpl: malformed, sleep: noWait })(request),
    ).rejects.toThrow('no probability');
    expect(malformed).toHaveBeenCalledTimes(1);
  });

  it('needs a key', () => {
    expect(() => createJevClient({ apiKey: '', endpoint })).toThrow('AI_GATEWAY_API_KEY');
  });
});
