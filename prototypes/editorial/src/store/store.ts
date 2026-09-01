import { useCallback, useRef, useSyncExternalStore } from "react";

/**
 * A ~40 line external store. The point is selector-scoped subscriptions: while
 * an assistant message streams, only that one message re-renders instead of the
 * whole transcript.
 */
export function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();

  const get = () => state;

  const set = (updater: (prev: T) => T) => {
    const next = updater(state);
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  };

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  return { get, set, subscribe };
}

export type Store<T> = ReturnType<typeof createStore<T>>;

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object);
  const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  return ak.every((k) =>
    Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/**
 * Reads a slice of the store. `isEqual` guards the snapshot identity so
 * selectors that build fresh arrays or objects do not loop.
 */
export function createUseStore<T>(store: Store<T>) {
  return function useStore<S>(
    selector: (state: T) => S,
    isEqual: (a: S, b: S) => boolean = Object.is,
  ): S {
    const cache = useRef<{ value: S; filled: boolean }>({ value: undefined as never, filled: false });

    const getSnapshot = useCallback(() => {
      const next = selector(store.get());
      if (!cache.current.filled || !isEqual(cache.current.value, next)) {
        cache.current = { value: next, filled: true };
      }
      return cache.current.value;
      // Selectors are inline arrows; re-reading every render is cheap and the
      // cache above keeps the returned identity stable.
    }, [selector, isEqual]);

    return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
  };
}
