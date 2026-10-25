import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { injectIdbFault, quotaExceeded, removeIdbFaults } from '../../tests-fixtures/idbFaults';
import { isQuotaError, storageErrorText } from './storageErrors';

/** The copy a full device gets, spelled out so a change to it is deliberate. */
const GUIDANCE =
  'This device is out of storage space for the app. Free some space on this device, then try ' +
  'again. Settings shows how much storage the app is using.';

/** A DOMException that carries only the legacy code, as an older engine might raise. */
function legacyCodeOnly(code: number): DOMException {
  return Object.defineProperty(new DOMException('full', 'UnknownError'), 'code', { value: code });
}

describe('isQuotaError', () => {
  it('recognizes the DOMException a browser raises', () => {
    expect(isQuotaError(quotaExceeded())).toBe(true);
  });

  it("recognizes Firefox's older name", () => {
    expect(isQuotaError(new DOMException('full', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true);
  });

  it('recognizes the legacy code 22 on a DOMException, and only there', () => {
    expect(isQuotaError(legacyCodeOnly(22))).toBe(true);
    expect(isQuotaError(legacyCodeOnly(8))).toBe(false);
    // A Node errno 22 (EINVAL) is not a storage quota.
    expect(isQuotaError(Object.assign(new Error('invalid argument'), { code: 22 }))).toBe(false);
    expect(isQuotaError({ name: 'Error', code: 22 })).toBe(false);
  });

  it('looks through a wrapper: inner, cause, and an aggregate of saves', () => {
    expect(isQuotaError({ name: 'DexieError', inner: quotaExceeded() })).toBe(true);
    expect(isQuotaError(new Error('save failed', { cause: quotaExceeded() }))).toBe(true);
    expect(isQuotaError(new AggregateError([new Error('other'), quotaExceeded()], 'saves'))).toBe(
      true,
    );
  });

  it("looks through Dexie's own wrappers: AbortError, BulkError, ModifyError", () => {
    // A transaction aborted by the refused write.
    expect(isQuotaError(new Dexie.AbortError('aborted', quotaExceeded()))).toBe(true);
    // bulkAdd and bulkPut: failures as a position-to-error map.
    expect(isQuotaError(new Dexie.BulkError('1 of 2 failed', { 1: quotaExceeded() }))).toBe(true);
    // Dexie 3 kept that map in `failures` itself.
    expect(isQuotaError({ name: 'BulkError', failures: { 1: quotaExceeded() } })).toBe(true);
    // Collection.modify (saveEditable): failures as an array.
    expect(isQuotaError(new Dexie.ModifyError('modify failed', [quotaExceeded()], 0, ['k']))).toBe(
      true,
    );
  });

  it('does not call other failures quota errors', () => {
    expect(isQuotaError(new Error('The quota has been exceeded.'))).toBe(false);
    expect(isQuotaError(new DOMException('gone', 'NotFoundError'))).toBe(false);
    expect(isQuotaError(new AggregateError([new Error('a')], 'saves'))).toBe(false);
    expect(isQuotaError(new Dexie.BulkError('failed', { 0: new Error('constraint') }))).toBe(false);
    expect(isQuotaError(new Dexie.ModifyError('failed', [new Error('x')], 0, ['k']))).toBe(false);
    expect(isQuotaError('QuotaExceededError')).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
  });

  it('stops on a wrapper that refers to itself', () => {
    const loop: { name: string; inner?: unknown; failures?: unknown[] } = { name: 'Wrapper' };
    loop.inner = loop;
    loop.failures = [loop];
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
    expect(storageErrorText(fromTransaction)).toBe(GUIDANCE);
    // The transaction rolled back the write to the table that had room.
    expect(await probe.table('a').count()).toBe(0);
  });
});

describe('storageErrorText', () => {
  it('replaces the browser message for a full device with guidance', () => {
    const raw = quotaExceeded();
    expect(storageErrorText(raw)).toBe(GUIDANCE);
    expect(storageErrorText(raw)).not.toContain(raw.message);
  });

  it("keeps any other error's own message", () => {
    expect(storageErrorText(new Error('simulated write failure'))).toBe('simulated write failure');
    expect(storageErrorText(new DOMException('gone', 'NotFoundError'))).toBe('gone');
    expect(storageErrorText('plain text')).toBe('plain text');
  });
});
