import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { Disc as DiscordIcon, Github, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  completeOAuth,
  currentUser,
  EXAMPLE_SYNC_SERVER_URL,
  extractAuthCode,
  getSyncServerUrl,
  onDeepLink,
  setSyncServerUrl,
  startOAuth,
  SUPPORTED_PROVIDERS,
  type OAuthProvider,
} from "@/lib/auth";
import { mutedText, panel, textTitle } from "@/lib/styles";
import { cn } from "@/lib/utils";

const PROVIDER_LABELS: Record<OAuthProvider, string> = {
  discord: "Discord",
  github: "GitHub",
  google: "Google",
  microsoft: "Microsoft",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState("");
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      const existing = await getSyncServerUrl();
      if (!cancelled) setServerUrl(existing ?? "");

      const me = await currentUser();
      if (!cancelled && me) navigate("/settings/account", { replace: true });

      unlisten = await onDeepLink(async (url) => {
        const code = extractAuthCode(url);
        if (!code) return;
        setStatus("Completando inicio de sesión…");
        try {
          await completeOAuth(code);
          setStatus(null);
          setBusy(null);
          navigate("/settings/account", { replace: true });
        } catch (e) {
          setError(String(e));
          setBusy(null);
        }
      });
    })().catch((e) => setError(String(e)));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);

  async function persistServerUrl() {
    setError(null);
    try {
      await setSyncServerUrl(serverUrl.trim());
      setStatus("Servidor guardado.");
      setTimeout(() => setStatus(null), 2000);
    } catch (e) {
      setError(String(e));
    }
  }

  async function login(provider: OAuthProvider) {
    setError(null);
    setBusy(provider);
    try {
      if (serverUrl.trim()) await setSyncServerUrl(serverUrl.trim());
      await startOAuth(provider);
      setStatus(`Esperando autenticación con ${PROVIDER_LABELS[provider]}…`);
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  }

  return (
    <div className={cn("flex min-h-screen items-center justify-center", panel)}>
      <div className="w-full max-w-md space-y-6 rounded-lg border border-white/5 bg-zinc-950/80 p-8 shadow-2xl">
        <div>
          <h1 className={textTitle}>Iniciar sesión</h1>
          <p className={cn("mt-1 text-xs", mutedText)}>
            Sincroniza tus conexiones, carpetas y credenciales entre máquinas. La app funciona
            sin login si prefieres modo local.
          </p>
        </div>

        <div className="space-y-2">
          <label className="block text-[11px] uppercase tracking-wide text-zinc-500">
            URL servidor de sincronización
          </label>
          <div className="flex gap-2">
            <Input
              placeholder={EXAMPLE_SYNC_SERVER_URL}
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
            <Button size="sm" onClick={persistServerUrl}>
              Guardar
            </Button>
          </div>
          <p className="text-[11px] text-zinc-500">
            Una instancia hospedada o tu propio VPS (<code className="rounded bg-zinc-900 px-1">server/</code>).
            Sin URL = modo local sin sync.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2">
          {SUPPORTED_PROVIDERS.map((p) => (
            <Button
              key={p}
              variant="secondary"
              onClick={() => login(p)}
              disabled={busy !== null}
              className="justify-center"
            >
              {busy === p ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : p === "discord" ? (
                <DiscordIcon className="h-4 w-4" />
              ) : p === "github" ? (
                <Github className="h-4 w-4" />
              ) : null}
              Continuar con {PROVIDER_LABELS[p]}
            </Button>
          ))}
        </div>

        {status && <p className="text-xs text-zinc-400">{status}</p>}
        {error && <p className="text-xs text-red-400">{error}</p>}

        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="w-full justify-center">
          Volver
        </Button>
      </div>
    </div>
  );
}
