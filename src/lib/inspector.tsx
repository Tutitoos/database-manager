import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

interface InspectorCtx {
  open: boolean;
  toggle: () => void;
  setOpen: (open: boolean) => void;
  content: React.ReactNode;
  setContent: (node: React.ReactNode) => void;
}

const Ctx = createContext<InspectorCtx | null>(null);

export function InspectorProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<React.ReactNode>(null);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const value = useMemo<InspectorCtx>(
    () => ({ open, toggle, setOpen, content, setContent }),
    [open, toggle, content],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInspector(): InspectorCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      open: false,
      toggle: () => undefined,
      setOpen: () => undefined,
      content: null,
      setContent: () => undefined,
    };
  }
  return ctx;
}

/** Helper: a component can set the inspector's content while mounted. */
export function useInspectorContent(node: React.ReactNode, deps: React.DependencyList = []) {
  const { setContent } = useInspector();
  useEffect(() => {
    setContent(node);
    return () => setContent(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
