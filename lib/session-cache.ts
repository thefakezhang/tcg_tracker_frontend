// A successful value lives for the browser session; concurrent readers share
// one load. Refresh replaces ordinary pending work without cancelling callers
// that still need its result. Concurrent refreshes share the new generation.
export function createSessionCache<T>() {
  let cached: T | undefined;
  let pending: { promise: Promise<T>; refresh: boolean } | undefined;

  return function read(
    load: () => Promise<{ value: T; cache: boolean }>,
    refresh = false,
  ): Promise<T> {
    if (refresh && !pending?.refresh) {
      cached = undefined;
      pending = undefined;
    }
    if (cached !== undefined) return Promise.resolve(cached);
    if (pending) return pending.promise;

    const request = {
      refresh,
      promise: Promise.resolve().then(load).then(({ value, cache }) => {
        if (pending === request && cache) cached = value;
        return value;
      }).finally(() => {
        // An obsolete success or failure cannot clear a newer pending read.
        if (pending === request) pending = undefined;
      }),
    };
    pending = request;
    return request.promise;
  };
}
