import {
  Navigate as TsrNavigate,
  useNavigate as useTsrNavigate,
  useParams as useTsrParams,
  useRouterState,
  useSearch,
} from "@tanstack/react-router";
import { useMemo } from "react";

export function Navigate({ to, replace }: { to: string; replace?: boolean }) {
  return <TsrNavigate to={to as never} replace={replace} />;
}

type Setter = (next: URLSearchParams | ((prev: URLSearchParams) => URLSearchParams)) => void;

/**
 * react-router compat: returns [URLSearchParams, setter].
 * Setter pushes new search params via TanStack navigate (strict:false).
 */
export function useSearchParams(): [URLSearchParams, Setter] {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const navigate = useTsrNavigate();
  const params = useMemo(() => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(search)) {
      if (v === undefined || v === null) continue;
      usp.set(k, String(v));
    }
    return usp;
  }, [search]);
  const setSearchParams: Setter = (next) => {
    const current = new URLSearchParams(params.toString());
    const resolved = typeof next === "function" ? next(current) : next;
    const obj: Record<string, string> = {};
    resolved.forEach((value, key) => {
      obj[key] = value;
    });
    navigate({ to: ".", search: obj as never });
  };
  return [params, setSearchParams];
}

export function useNavigate() {
  const navigate = useTsrNavigate();
  return (target: string | number, opts?: { replace?: boolean }) => {
    if (typeof target === "number") {
      window.history.go(target);
      return;
    }
    const [pathname, queryStr] = target.split("?");
    const search: Record<string, string> = {};
    if (queryStr) {
      new URLSearchParams(queryStr).forEach((v, k) => {
        search[k] = v;
      });
    }
    navigate({ to: pathname as never, search: search as never, replace: opts?.replace });
  };
}

export function useParams<T extends Record<string, string> = Record<string, string>>(): T {
  return useTsrParams({ strict: false }) as unknown as T;
}

export function useLocation() {
  const location = useRouterState({ select: (s) => s.location });
  return {
    pathname: location.pathname,
    search: location.searchStr,
    hash: location.hash,
  };
}
