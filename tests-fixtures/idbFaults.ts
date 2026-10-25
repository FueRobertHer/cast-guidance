/**
 * IndexedDB fault injection for tests (TEST-002). Installs a Dexie DBCore
 * middleware whose `mutate` rejects matching writes, so a test can make a
 * single table run out of space while every other table keeps working.
 *
 * Dexie builds its middleware stack when the database opens, so installing
 * and removing a fault closes the connection. Inject only while nothing is in
 * flight: closing aborts any open transaction.
 *
 * Fidelity limit: a real quota failure aborts the transaction when it commits,
 * whatever the code did with the request error. This fixture rejects the one
 * request instead, so code that catches that rejection inside a transaction
 * would see the transaction commit here but abort in a browser. Every write
 * path in the app lets the error propagate, so the two agree for it today.
 */
import type { DBCore, DBCoreMutateRequest, DBCoreTable, default as Dexie } from 'dexie';

export type IdbFaultOp = 'add' | 'put' | 'delete';

export interface IdbFaultOptions {
  /** Tables to fault; every table when omitted. */
  tables?: readonly string[];
  /** Operations to fault; add and put when omitted (what quota refuses). */
  ops?: readonly IdbFaultOp[];
  /** Matching writes to let through before faulting. Defaults to 0. */
  skip?: number;
  /** How many matching writes fail; every one when omitted. */
  times?: number;
  /** The error a faulted write rejects with; a quota error by default. */
  error?: () => Error;
}

/**
 * Removes the fault (idempotent). `attempts` counts the matching writes that
 * reached it and `hits` the ones it failed, so a test can show its fault
 * landed where it meant it to.
 */
export type IdbFaultRemover = (() => Promise<void>) & {
  readonly attempts: number;
  readonly hits: number;
};

/** The DOMException a browser raises when an origin is out of storage. */
export function quotaExceeded(): DOMException {
  return new DOMException('The quota has been exceeded.', 'QuotaExceededError');
}

const active = new Set<IdbFaultRemover>();
let sequence = 0;

function opOf(type: DBCoreMutateRequest['type']): IdbFaultOp {
  return type === 'deleteRange' ? 'delete' : type;
}

/**
 * Make matching writes on `database` reject until the returned remover runs.
 * The remover leaves the connection closed with auto-open on, so the next
 * query reopens it without the fault, as a fresh test would find it.
 */
export async function injectIdbFault(
  database: Dexie,
  options: IdbFaultOptions = {},
): Promise<IdbFaultRemover> {
  const {
    tables,
    ops = ['add', 'put'],
    skip = 0,
    times = Infinity,
    error = quotaExceeded,
  } = options;
  const name = `test-fault-${++sequence}`;
  let seen = 0;
  let hits = 0;

  const faulting = (table: DBCoreTable): DBCoreTable => ({
    ...table,
    mutate(req) {
      if (ops.includes(opOf(req.type))) {
        seen += 1;
        if (seen > skip && hits < times) {
          hits += 1;
          return Promise.reject(error());
        }
      }
      return table.mutate(req);
    },
  });

  database.close();
  database.use({
    stack: 'dbcore',
    name,
    create: (down: DBCore): DBCore => ({
      ...down,
      table(tableName) {
        const table = down.table(tableName);
        return tables === undefined || tables.includes(tableName) ? faulting(table) : table;
      },
    }),
  });
  try {
    await database.open();
  } catch (err) {
    // Leave the database as it was found: no fault installed, auto-open on.
    database.unuse({ stack: 'dbcore', name });
    database.close({ disableAutoOpen: false });
    throw err;
  }

  let removed = false;
  const remove = async (): Promise<void> => {
    if (removed) return;
    removed = true;
    active.delete(remover);
    database.close({ disableAutoOpen: false });
    database.unuse({ stack: 'dbcore', name });
  };
  const remover = Object.defineProperties(remove, {
    hits: { get: () => hits },
    attempts: { get: () => seen },
  }) as IdbFaultRemover;
  active.add(remover);
  return remover;
}

/** Remove every fault still installed, for `afterEach`. */
export async function removeIdbFaults(): Promise<void> {
  for (const remover of [...active]) await remover();
}
