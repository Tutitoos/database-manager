import { invoke } from "@tauri-apps/api/core";
import { Loader2, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { PROVIDER_UI, ProviderIcon } from "@/lib/providers";
import type { Connection } from "@/lib/types";
import { useNavigate } from "@/lib/router-compat";
import { useSessionsStore, sessionRoute } from "@/store/sessions";

type ConnectingState = {
  connection: Connection;
  status: "checking" | "error";
  error?: string;
};

type ConnectGateCtx = {
  /** Pre-flight test + open connection. Always tests, shows modal during. */
  openConnection: (c: Connection) => Promise<void>;
};

const Ctx = createContext<ConnectGateCtx | null>(null);

export function ConnectGateProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { addSession } = useSessionsStore();
  const [state, setState] = useState<ConnectingState | null>(null);

  const openConnection = useCallback(
    async (c: Connection): Promise<void> => {
      setState({ connection: c, status: "checking" });
      try {
        await invoke("test_connection", { input: c });
        addSession(c);
        const session = useSessionsStore.getState().sessions[c.id];
        const route = session
          ? sessionRoute(session)
          : (() => {
              const view = PROVIDER_UI[c.plugin_id]?.id === "mongodb"
                ? "document"
                : c.plugin_id === "redis"
                  ? "redis"
                  : "sql";
              return `/connections/${view}?id=${c.id}`;
            })();
        setState(null);
        navigate(route);
      } catch (e) {
        setState({ connection: c, status: "error", error: String(e) });
        throw e;
      }
    },
    [addSession, navigate],
  );

  const value = useMemo<ConnectGateCtx>(() => ({ openConnection }), [openConnection]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {state && (
        <Modal onClose={state.status === "error" ? () => setState(null) : () => undefined}>
          <div className="w-full max-w-md space-y-4 rounded-lg border border-border-subtle bg-surface-overlay p-5 shadow-xl">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border-subtle">
                <ProviderIcon
                  providerId={state.connection.plugin_id}
                  className="block h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-h3 truncate font-semibold text-text">
                  {state.connection.name}
                </h2>
                <p className="text-tiny truncate font-mono text-text-muted">
                  {state.connection.host}:{state.connection.port ?? "-"}
                </p>
              </div>
            </div>
            {state.status === "checking" ? (
              <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent-soft/40 p-3 text-body text-text-muted">
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" />
                <span>Comprobando host, credenciales y base de datos…</span>
              </div>
            ) : (
              <>
                <div className="space-y-1 rounded-md border border-danger/40 bg-danger-soft p-3">
                  <div className="flex items-center gap-2 text-body font-medium text-danger">
                    <XCircle className="h-4 w-4 shrink-0" />
                    <span>No se pudo conectar</span>
                  </div>
                  <p className="break-words font-mono text-tiny text-danger/80">
                    {state.error ?? "Error desconocido."}
                  </p>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setState(null)}>
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => void openConnection(state.connection)}
                  >
                    Reintentar
                  </Button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}

export function useOpenConnection(): (c: Connection) => Promise<void> {
  const ctx = useContext(Ctx);
  if (!ctx) {
    // Fallback no-op (or could throw). Returns rejected promise so caller knows.
    return async () => {
      throw new Error("ConnectGateProvider missing");
    };
  }
  return ctx.openConnection;
}
