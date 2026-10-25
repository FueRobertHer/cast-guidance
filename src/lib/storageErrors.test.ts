import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { injectIdbFault, quotaExceeded, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { isQuotaError, QUOTA_GUIDANCE, storageErrorText } from './storageErrors';

describe('isQuotaError', () => {
  it('recognizes the DOMException a browser raises', () => {
    expect(isQuotaError(quotaExceeded())).toBe(true);
  });

  it("recognizes Firefox's older name", () => {
    expect(isQuotaError(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
  });

  it('looks through a wrapper: inner, cause, and an aggregate of saves', () => {
    expect(isQuotaError({ name: 'DexieError', inner: quotaExceeded() })).toBe(true);
    expect(isQuotaError(new Error('save failed', { cause: quotaExceeded() }))).toBe(true);
    expect(isQuotaError(new AggregateError([new Error('other'), quotaExceeded()], 'saves'))).toBe(
      true,
    );
  });

  it('does not call other failures quota errors', () => {
    expect(isQuotaError(new Error('The quota has been exceeded.'))).toBe(false);
    expect(isQuotaError(new DOMException('gone', 'NotFoundError'))).toBe(false);
    expect(isQuotaError(new AggregateError([new Error('a')], 'saves'))).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('stops on a wrapper that refers to itself', () => {
    const loop: { name: string; inner?: unknown } = { name: 'Wrapper' };
    loop.inner = loop;
    expect(isQuotaError(loop)).toBe(false);
  });
});

describe('isQuotaError on what Dexie actually rejects with', () => {
  const probe = new Dexie('storage-errors-probe');
  probe.version(1).stores({ a: 'id', b: 'id' });

  afterEach(removeIdbFaults);
  afterAll(async () => {
    probe.close();
    await Dexie.delete('storage-errors-probe');
  });

  it('classifies a refused Table.put and a refused transaction', async () => {
    await injectIdbFault(probe, { tables: ['b'] });

    const fromPut = await probe
      .table('b')
      .put({ id: 1 })
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    const fromTransaction = await probe
      .transaction('rw', probe.table('a'), probe.table('b'), async () => {
        await probe.table('a').put({ id: 1 });
        await probe.table('b').put({ id: 1 });
      })
      .then(
        () => undefined,
        (err: unknown) => err,
      );

    // Dexie wraps the DOMException but keeps its name, and the original as inner.
    expect(fromPut).toMatchObject({ name: 'QuotaExceededError' });
    expect((fromPut as { inner?: { name?: string } }).inner?.name).toBe('QuotaExceededError');
    expect(isQuotaError(fromPut)).toBe(true);
    expect(isQuotaError(fromTransaction)).toBe(true);
    expect(storageErrorText(fromTransaction)).toBe(QUOTA_GUIDANCE);
    // The transaction rolled back the write to the table that had room.
    expect(await probe.table('a').count()).toBe(0);
  });
});

describe('storageErrorText', () => {
  it('turns a full device into guidance', () => {
    expect(storageErrorText(quotaExceeded())).toBe(QUOTA_GUIDANCE);
    expect(QUOTA_GUIDANCE).toMatch(/out of storage space/);
  });

  it("keeps any other error's own message", () => {
    expect(storageErrorText(new Error('simulated write failure'))).toBe('simulated write failure');
    expect(storageErrorText(new DOMException('gone', 'NotFoundError'))).toBe('gone');
    expect(storageErrorText('plain text')).toBe('plain text');
  });
});
