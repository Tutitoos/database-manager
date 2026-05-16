import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { passphraseStatus, unlock, type PassphraseStatus } from "@/lib/auth";
import { triggerSync } from "@/lib/sync";
import { useDebounced } from "@/lib/use-debounce";
import { mutedText } from "@/lib/styles";
import { cn } from "@/lib/utils";

type CredentialView = {
  id: number;
  name: string;
  username: string;
  created_at: string;
  updated_at: string;
};

type EditorMode =
  | { mode: "create" }
  | { mode: "edit"; id: number; defaults: { name: string; username: string } };

const credentialSchema = z.object({
  name: z.string().trim().min(1, "Pon un nombre."),
  username: z.string().trim(),
  password: z.string(),
  showPassword: z.boolean(),
});

export default function CredentialsPage() {
  const [creds, setCreds] = useState<CredentialView[]>([]);
  const [query, setQuery] = useState("");
  const [editor, setEditor] = useState<EditorMode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CredentialView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [passStatus, setPassStatus] = useState<PassphraseStatus>({ configured: false, unlocked: false });
  const [unlockPass, setUnlockPass] = useState("");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  async function refresh() {
    const [list, ps] = await Promise.all([
      invoke<CredentialView[]>("list_credentials_view"),
      passphraseStatus(),
    ]);
    setCreds(list);
    setPassStatus(ps);
  }

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
  }, []);

  const debouncedQuery = useDebounced(query, 180);
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return creds;
    return creds.filter(
      (c) => c.name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q),
    );
  }, [creds, debouncedQuery]);

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedField(key);
    setTimeout(() => setCopiedField((k) => (k === key ? null : k)), 1500);
  }

  function openCreate() {
    setError(null);
    setEditor({ mode: "create" });
  }

  function openEdit(c: CredentialView) {
    setError(null);
    setEditor({ mode: "edit", id: c.id, defaults: { name: c.name, username: c.username } });
  }

  async function saveForm(values: { name: string; username: string; password: string }) {
    if (!editor) return;
    if (editor.mode === "create" && !values.password) {
      setError("La contraseña es obligatoria.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editor.mode === "create") {
        await invoke("create_credential", {
          name: values.name.trim(),
          username: values.username.trim(),
          password: values.password,
        });
      } else {
        await invoke("update_credential", {
          id: editor.id,
          name: values.name.trim(),
          username: values.username.trim(),
          password: values.password.length > 0 ? values.password : null,
        });
      }
      setEditor(null);
      await refresh();
      triggerSync();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await invoke("delete_credential", { id: deleteTarget.id });
      setDeleteTarget(null);
      await refresh();
      triggerSync();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlock() {
    setError(null);
    try {
      await unlock(unlockPass);
      setUnlockPass("");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  // ── Empty / locked states ─────────────────────────────────────────────────
  if (!passStatus.configured) {
    return (
      <div className="mx-auto max-w-2xl">
        <Header count={0} />
        <EmptyHero
          icon={<Shield className="h-5 w-5 text-amber-400" />}
          title="Configura la passphrase E2E"
          body={
            <>
              Las credenciales se cifran con una passphrase. Antes de guardar nada, créala en{" "}
              <Link to="/settings/account" className="text-blue-400 underline underline-offset-2 hover:text-blue-300">
                Mi cuenta
              </Link>
              .
            </>
          }
          accent="amber"
        />
      </div>
    );
  }

  if (!passStatus.unlocked) {
    return (
      <div className="mx-auto max-w-2xl">
        <Header count={0} />
        <div className="rounded-2xl border border-amber-900/50 bg-amber-950/30 p-6 text-amber-200">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl border border-amber-700/60 bg-amber-950/60">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Vault bloqueado</h2>
              <p className="text-xs text-amber-300/70">Introduce tu passphrase para acceder a las credenciales.</p>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <Input
              type="password"
              placeholder="Passphrase"
              value={unlockPass}
              onChange={(e) => setUnlockPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            />
            <Button onClick={handleUnlock} variant="primary">
              Desbloquear
            </Button>
          </div>
          {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  // ── Normal view ───────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <Header count={creds.length} />

      {/* Toolbar */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
          <Input
            placeholder="Buscar…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
        <Button size="sm" variant="primary" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" /> Nueva
        </Button>
      </div>

      {filtered.length === 0 ? (
        creds.length === 0 ? (
          <EmptyHero
            icon={<KeyRound className="h-5 w-5 text-blue-400" />}
            title="Sin credenciales"
            body="Crea tu primera credencial reutilizable. Se cifra con tu passphrase y viaja entre tus máquinas."
            accent="blue"
            action={
              <Button variant="primary" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" /> Crear primera
              </Button>
            }
          />
        ) : (
          <p className={cn("rounded-md border border-dashed border-zinc-800 p-6 text-center text-xs", mutedText)}>
            No hay credenciales que coincidan con "{query}".
          </p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const initials = (c.name || c.username || "?").trim().slice(0, 2).toUpperCase();
            const accent = colorFromName(c.name || c.username || "x");
            return (
              <article
                key={c.id}
                className="group relative flex items-center gap-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/50 px-3 py-2 transition-colors hover:border-zinc-700 hover:bg-zinc-900/60"
              >
                <div
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
                  style={{
                    background: `linear-gradient(135deg, ${accent.from}, ${accent.to})`,
                    color: "#fff",
                  }}
                >
                  {initials}
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-[13px] font-medium leading-tight text-zinc-100">{c.name}</h3>
                  <div className="flex items-center gap-1 text-[11px] leading-tight text-zinc-500">
                    <span className="truncate font-mono">{c.username || "—"}</span>
                    {c.username && (
                      <button
                        onClick={() => copyText(c.username, `u${c.id}`)}
                        className="rounded p-0.5 text-zinc-600 hover:bg-zinc-800 hover:text-zinc-200"
                        title="Copiar usuario"
                      >
                        {copiedField === `u${c.id}` ? (
                          <Check className="h-3 w-3 text-emerald-400" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    )}
                    <span className="text-zinc-700">·</span>
                    <span className="text-[10px] text-zinc-600">{formatDate(c.updated_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <CardBtn title="Editar" onClick={() => openEdit(c)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </CardBtn>
                  <CardBtn title="Eliminar" danger onClick={() => setDeleteTarget(c)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </CardBtn>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {error && !editor && !deleteTarget && (
        <p className="mt-4 text-xs text-red-400">{error}</p>
      )}

      {/* Editor modal */}
      {editor && (
        <Modal onClose={() => !busy && setEditor(null)}>
          <CredentialFormModal
            mode={editor.mode}
            defaults={editor.mode === "edit" ? editor.defaults : { name: "", username: "" }}
            busy={busy}
            error={error}
            onCancel={() => setEditor(null)}
            onSubmit={saveForm}
          />
        </Modal>
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <Modal onClose={() => !busy && setDeleteTarget(null)}>
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-red-950/60 text-red-300">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-zinc-100">¿Eliminar credencial?</h2>
            </div>
            <div className="mt-3 rounded-md border border-zinc-800/70 bg-zinc-900/50 px-3 py-2">
              <p className="truncate text-sm text-zinc-100">{deleteTarget.name}</p>
              <p className="truncate text-xs text-zinc-500">{deleteTarget.username}</p>
            </div>
            <p className="mt-3 text-xs text-amber-400">
              Las conexiones que la usen perderán el enlace y deberán reconfigurarse.
            </p>
            {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>
                Cancelar
              </Button>
              <Button size="sm" variant="danger" onClick={confirmDelete} disabled={busy}>
                {busy ? "Eliminando…" : "Eliminar"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function CredentialFormModal({
  mode,
  defaults,
  busy,
  error,
  onCancel,
  onSubmit,
}: {
  mode: "create" | "edit";
  defaults: { name: string; username: string };
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: { name: string; username: string; password: string }) => Promise<void>;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm({
    defaultValues: {
      name: defaults.name,
      username: defaults.username,
      password: "",
    },
    validators: {
      onChange: credentialSchema.pick({ name: true, username: true, password: true }),
    },
    onSubmit: async ({ value }) => {
      await onSubmit(value);
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="w-full max-w-md overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-zinc-800/80 px-5 py-3">
        <div className="flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-zinc-100">
            {mode === "create" ? "Nueva credencial" : "Editar credencial"}
          </h2>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          disabled={busy}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="space-y-3 p-5">
        <form.Field name="name">
          {(field) => (
            <Field label="Nombre" hint="Etiqueta corta para identificarla.">
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="Producción · API · Prod-DB"
                autoFocus
              />
              <FieldError field={field} />
            </Field>
          )}
        </form.Field>
        <form.Field name="username">
          {(field) => (
            <Field label="Usuario">
              <Input
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder="postgres"
              />
            </Field>
          )}
        </form.Field>
        <form.Field name="password">
          {(field) => (
            <Field
              label={mode === "edit" ? "Nueva contraseña" : "Contraseña"}
              hint={mode === "edit" ? "Déjalo vacío para no cambiarla." : "Se cifra antes de guardarse."}
            >
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  className="pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                  title={showPassword ? "Ocultar" : "Mostrar"}
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </Field>
          )}
        </form.Field>
        {error && (
          <div className="rounded-md border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-zinc-800/80 bg-zinc-950/80 px-5 py-3">
        <Button type="button" size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancelar
        </Button>
        <form.Subscribe selector={(s) => [s.canSubmit, s.isSubmitting] as const}>
          {([canSubmit, isSubmitting]) => (
            <Button type="submit" size="sm" variant="primary" disabled={busy || !canSubmit || isSubmitting}>
              {busy || isSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {busy || isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  );
}

function FieldError({ field }: { field: { state: { meta: { errors: unknown[]; isTouched: boolean } } } }) {
  if (!field.state.meta.isTouched || field.state.meta.errors.length === 0) return null;
  const msg = field.state.meta.errors
    .map((e) => (typeof e === "string" ? e : (e as { message?: string })?.message))
    .filter(Boolean)
    .join(" · ");
  if (!msg) return null;
  return <p className="mt-1 text-[11px] text-red-400">{msg}</p>;
}

function Header({ count }: { count: number }) {
  return (
    <header className="mb-3 flex items-center gap-2.5">
      <div className="grid h-8 w-8 place-items-center rounded-lg border border-white/5 bg-white/5">
        <KeyRound className="h-4 w-4 text-blue-300" />
      </div>
      <div className="flex-1 min-w-0">
        <h1 className="text-base font-semibold leading-tight tracking-[-0.01em] text-white">Credenciales</h1>
        <p className={cn("text-[11px] leading-tight", mutedText)}>
          Cifradas con tu passphrase, sincronizadas entre máquinas.
        </p>
      </div>
      <span className="shrink-0 rounded-full border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-400">
        {count}
      </span>
    </header>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
        {hint && <span className="text-[10px] text-zinc-600">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function CardBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded-md p-1.5 text-zinc-400 transition-colors",
        danger ? "hover:bg-red-950/50 hover:text-red-300" : "hover:bg-zinc-800 hover:text-zinc-100",
      )}
    >
      {children}
    </button>
  );
}

function EmptyHero({
  icon,
  title,
  body,
  accent,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  accent: "amber" | "blue";
  action?: React.ReactNode;
}) {
  const ring = accent === "amber" ? "ring-amber-900/40 bg-amber-950/20" : "ring-blue-900/40 bg-blue-950/20";
  return (
    <div className="flex flex-col items-center rounded-xl border border-zinc-800/80 bg-zinc-950/40 px-5 py-7 text-center">
      <div className={cn("grid h-10 w-10 place-items-center rounded-xl ring-1", ring)}>{icon}</div>
      <h2 className="mt-3 text-sm font-semibold text-zinc-100">{title}</h2>
      <p className={cn("mt-1 max-w-md text-[11px] leading-relaxed", mutedText)}>{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const GRADIENTS = [
  { from: "#3B82F6", to: "#1E40AF" },
  { from: "#14B8A6", to: "#0F766E" },
  { from: "#A855F7", to: "#6B21A8" },
  { from: "#F59E0B", to: "#B45309" },
  { from: "#EF4444", to: "#991B1B" },
  { from: "#22C55E", to: "#15803D" },
  { from: "#EC4899", to: "#9D174D" },
  { from: "#0EA5E9", to: "#075985" },
];

function colorFromName(name: string): { from: string; to: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash << 5) - hash + name.charCodeAt(i);
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const day = 86400000;
    if (diff < day) return "hoy";
    if (diff < 2 * day) return "ayer";
    if (diff < 7 * day) return `hace ${Math.floor(diff / day)} días`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
