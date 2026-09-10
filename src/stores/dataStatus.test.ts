import { beforeEach, describe, expect, it } from 'vitest';
import { dataStatusStore } from './dataStatus';

beforeEach(() => {
  dataStatusStore.setState({
    phase: 'idle',
    packs: {},
    filesDone: 0,
    filesTotal: 0,
    error: undefined,
    failedTag: undefined,
  });
});

describe('dataStatusStore', () => {
  it('tracks phase + error', () => {
    dataStatusStore.getState().setPhase('working');
    expect(dataStatusStore.getState().phase).toBe('working');
    dataStatusStore.getState().setPhase('error', 'boom');
    expect(dataStatusStore.getState()).toMatchObject({ phase: 'error', error: 'boom' });
  });

  it('accumulates file progress', () => {
    const s = dataStatusStore.getState();
    s.addTotal(5);
    s.fileStarted('races.json');
    s.fileDone();
    s.fileDone();
    const next = dataStatusStore.getState();
    expect(next.filesTotal).toBe(5);
    expect(next.filesDone).toBe(2);
    expect(next.currentPath).toBe('races.json');
  });

  it('beginRun clears the previous attempt: counters, error, and failed tag', () => {
    const s = dataStatusStore.getState();
    s.addTotal(20);
    s.fileStarted('races.json');
    s.fileDone();
    s.setFailedTag('v2.33.0');
    s.setPhase('error', 'offline');

    dataStatusStore.getState().beginRun();

    expect(dataStatusStore.getState()).toMatchObject({
      phase: 'working',
      filesDone: 0,
      filesTotal: 0,
      currentPath: undefined,
      error: undefined,
      failedTag: undefined,
    });
  });

  it('setPhase drops the failed tag with the failure it belonged to', () => {
    dataStatusStore.getState().setFailedTag('v2.33.0');
    dataStatusStore.getState().setPhase('error', 'a different failure');
    expect(dataStatusStore.getState().failedTag).toBeUndefined();
  });

  it('records per-pack state', () => {
    dataStatusStore.getState().setPack('essentials', 'downloading');
    dataStatusStore.getState().setPack('essentials', 'ready');
    dataStatusStore.getState().setPack('items-full', 'missing');
    expect(dataStatusStore.getState().packs).toEqual({
      essentials: 'ready',
      'items-full': 'missing',
    });
  });
});
