import { useEffect, useState } from "react";
import { KeyRound, Loader2, Lock, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { appBg, mutedText } from "@/lib/styles";
import { cn } from "@/lib/utils";
import { refreshVault, unlockVault, useVault } from "@/store/vault";

export function VaultGate({ children }: { children: React.ReactNode }) {
  const { status, loaded } = useVault();
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    refreshVault().catch((e) => setBootError(String(e)));
  }, []);

  if (!loaded) {
    return (
      <div className={cn("grid h-screen place-items-center text-zinc-400", appBg)}>
        {bootError ? (
          <div className="max-w-md rounded-xl border border-red-900/50 bg-red-950/30 p-6 text-center text-red-200">
            <ShieldAlert className="mx-auto mb-2 h-6 w-6" />
            <p className="text-sm">No se pudo leer el estado del vault.</p>
            <p className="mt-2 text-xs text-red-300/80">{bootError}</p>
          </div>
        ) : (
          <Loader2 className="h-5 w-5 animate-spin" />
        )}
      </div>
    );
  }

  if (status.configured && !status.unlocked) {
    return <UnlockScreen />;
  }

  return <>{children}</>;
}

function UnlockScreen() {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleUnlock() {
    if (!passphrase) {
      setError("Introduce la passphrase.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unlockVault(passphrase);
      setPassphrase("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={cn("grid h-screen place-items-center px-4 text-zinc-100", appBg)}>
      <section className="w-full max-w-sm rounded-2xl border border-white/5 bg-zinc-950/60 p-6 shadow-[0_24px_64px_rgba(0,0,0,.45)] backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl border border-amber-700/60 bg-amber-950/50 text-amber-300">
            <Lock className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold tracking-[-0.01em] text-white">Vault bloqueado</h1>
            <p className={cn("text-xs", mutedText)}>
              Introduce tu passphrase para desbloquear las credenciales.
            </p>
          </div>
        </div>

        <form
          className="mt-5 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) handleUnlock();
          }}
        >
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
            <Input
              type="password"
              autoFocus
              placeholder="Passphrase"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={busy}
              className="pl-9"
            />
          </div>
          {error && (
            <p className="rounded-md border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            {busy ? "Desbloqueando…" : "Desbloquear"}
          </Button>
        </form>

        <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
          La passphrase cifra tus credenciales y datos sincronizados. Si la olvidas, los datos cifrados se pierden.
        </p>
      </section>
    </main>
  );
}
