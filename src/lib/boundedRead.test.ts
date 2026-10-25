import { describe, expect, it } from 'vitest';
import {
  ResponseTooLargeError,
  readFileTextBounded,
  readJsonBounded,
  readTextBounded,
} from './boundedRead';

/**
 * A body that hands out `chunks` one per pull and records how it was used:
 * how many pulls the reader asked for, and whether it was told to stop.
 */
function meteredBody(chunks: Uint8Array[]) {
  const seen = { pulls: 0, cancelled: false };
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls++;
      const chunk = chunks[i++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

/**
 * A body that keeps coming: what a hostile server can send. It does end, at
 * 10 MiB, only so that a reader with no limit fails this suite rather than
 * exhausting the test process.
 */
function endlessBody() {
  const seen = { pulls: 0, cancelled: false };
  const chunk = new Uint8Array(1024).fill(0x61);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      seen.pulls++;
      if (seen.pulls > 10_240) controller.close();
      else controller.enqueue(chunk);
    },
    cancel() {
      seen.cancelled = true;
    },
  });
  return { stream, seen };
}

const bytes = (n: number) => new Uint8Array(n).fill(0x61);

describe('readTextBounded', () => {
  it('refuses a declared Content-Length over the limit without reading the body', async () => {
    const { stream, seen } = meteredBody([bytes(10)]);
    // highWaterMark 0 is not settable through Response, so the first pull may
    // already have run when the response was built; what matters is that the
    // reader never asks for more.
    const before = seen.pulls;
    const res = new Response(stream, { headers: { 'content-length': '5000' } });
    const err = await readTextBounded(res, 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseTooLargeError);
    expect((err as ResponseTooLargeError).limit).toBe(1000);
    expect((err as ResponseTooLargeError).received).toBe(5000);
    expect(seen.pulls).toBe(before);
    expect(seen.cancelled).toBe(true);
  });

  it('stops a body with no Content-Length once it passes the limit, and cancels it', async () => {
    const { stream, seen } = meteredBody([bytes(1024), bytes(1024), bytes(1024), bytes(1024)]);
    const err = await readTextBounded(new Response(stream), 1024).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseTooLargeError);
    expect((err as ResponseTooLargeError).received).toBe(2048);
    expect(seen.cancelled).toBe(true);
  });

  it('stops a body that keeps coming', async () => {
    const { stream, seen } = endlessBody();
    await expect(readTextBounded(new Response(stream), 4096)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    expect(seen.cancelled).toBe(true);
    // Five 1 KiB chunks cross 4 KiB; a reader that kept going would pull on.
    expect(seen.pulls).toBeLessThan(10);
  });

  it('accepts a body exactly at the limit', async () => {
    const { stream } = meteredBody([bytes(512), bytes(512)]);
    await expect(readTextBounded(new Response(stream), 1024)).resolves.toBe('a'.repeat(1024));
  });

  it('decodes multi-byte characters split across chunks', async () => {
    const encoded = new TextEncoder().encode('café ✨');
    const { stream } = meteredBody([encoded.slice(0, 4), encoded.slice(4, 7), encoded.slice(7)]);
    await expect(readTextBounded(new Response(stream), 100)).resolves.toBe('café ✨');
  });

  it('counts bytes, not characters', async () => {
    // Four characters, twelve bytes.
    const text = '✨✨✨✨';
    await expect(readTextBounded(new Response(text), 11)).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
    await expect(readTextBounded(new Response(text), 12)).resolves.toBe(text);
  });

  it('still enforces the limit on a response with no stream', async () => {
    const big = {
      headers: new Headers(),
      body: null,
      text: () => Promise.resolve('x'.repeat(2000)),
    } as unknown as Response;
    await expect(readTextBounded(big, 1000)).rejects.toBeInstanceOf(ResponseTooLargeError);
    const small = { ...big, text: () => Promise.resolve('ok') } as unknown as Response;
    await expect(readTextBounded(small, 1000)).resolves.toBe('ok');
  });
});

describe('readJsonBounded', () => {
  it('parses a body within the limit', async () => {
    await expect(readJsonBounded(new Response('{"a":1}'), 100)).resolves.toEqual({ a: 1 });
  });

  it('refuses before parsing a body over it', async () => {
    const res = new Response(JSON.stringify({ pad: 'x'.repeat(200) }));
    await expect(readJsonBounded(res, 100)).rejects.toBeInstanceOf(ResponseTooLargeError);
  });
});

describe('readFileTextBounded', () => {
  it('refuses a file by its size without reading it', async () => {
    let read = false;
    const file = {
      size: 5000,
      text: () => {
        read = true;
        return Promise.resolve('');
      },
    } as unknown as Blob;
    const err = await readFileTextBounded(file, 1000).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ResponseTooLargeError);
    expect((err as Error).message).toMatch(/^file is larger/);
    expect(read).toBe(false);
  });

  it('reads a file within the limit', async () => {
    await expect(readFileTextBounded(new Blob(['hello']), 5)).resolves.toBe('hello');
  });
});
