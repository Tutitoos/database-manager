import { useDebouncedValue } from "@tanstack/react-pacer";

export function useDebounced<T>(value: T, waitMs = 200): T {
  const [debounced] = useDebouncedValue(value, { wait: waitMs });
  return debounced;
}
