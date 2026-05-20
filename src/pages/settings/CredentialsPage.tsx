import { invoke } from "@tauri-apps/api/core";
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  Search,
  Shield,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { Modal } from "@/components/modal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { pushToast } from "@/components/ui/toast";
import { SettingsCard, SettingsRow } from "@/components/settings/SettingsCard";
// passphrase removed — credentials always available once the user is signed
// into an org (server gates them via RBAC).
import { useDebounced } from "@/lib/use-debounce";
import { cn } from "@/lib/utils";
import type { Connection } from "@/lib/types";

interface CredentialView {
  id: number;
  name: string;
  username: string;
  created_at: string;
  updated_at: string;
}

interface DecryptedCredential {
  id: number;
  name: string;
  username: string;
  password: string;
}

export default function CredentialsPage() {
  const { t } = useTranslation();
  const [creds, setCreds] = useState<CredentialView[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editing, setEditing] = useState<{ id?: number; defaults?: CredentialView } | null>(null);
  const [deleting, setDeleting] = useState<CredentialView | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  async function refresh() {
    const [list, conns] = await Promise.all([
      invoke<CredentialView[]>("list_credentials_view").catch(() => []),
      invoke<Connection[]>("list_connections").catch(() => []),
    ]);
    setCreds(list);
    setConnections(conns);
  }

  useEffect(() => {
    refresh().catch((e) => pushToast({ level: "danger", title: String(e) }));
  }, []);

  useEffect(() => {
    if (selectedId == null && creds.length > 0) setSelectedId(creds[0].id);
  }, [creds, selectedId]);

  const debouncedQuery = useDebounced(query, 180);
  const filtered = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return creds;
    return creds.filter((c) => c.name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q));
  }, [creds, debouncedQuery]);

  const selected = useMemo(() => creds.find((c) => c.id === selectedId) ?? null, [creds, selectedId]);
  const linkedConns = useMemo(() => connections.filter((c) => c.credential_id === selectedId), [connections, selectedId]);

  function copy(text: string, key: string, toastTitle: string) {
    navigator.clipboard.writeText(text).catch(() => undefined);
    setCopiedKey(key);
    pushToast({ level: "success", title: toastTitle, ttl: 1500 });
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }

  async function revealPassword(id: number) {
    if (revealed[id]) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const dec = await invoke<DecryptedCredential>("decrypt_credential", { id });
      setRevealed((r) => ({ ...r, [id]: dec.password }));
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  async function copyPassword(id: number) {
    try {
      const dec = await invoke<DecryptedCredential>("decrypt_credential", { id });
      copy(dec.password, `p${id}`, t("credentials.toasts.copiedPassword"));
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  async function duplicate(c: CredentialView) {
    try {
      const dec = await invoke<DecryptedCredential>("decrypt_credential", { id: c.id });
      await invoke("create_credential", {
        name: c.name + t("credentials.copySuffix"),
        username: c.username,
        password: dec.password,
      });
      await refresh();
      pushToast({ level: "success", title: t("credentials.toasts.duplicated") });
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }

  async function performDelete(c: CredentialView) {
    try {
      await invoke("delete_credential", { id: c.id });
      setDeleting(null);
      if (selectedId === c.id) setSelectedId(null);
      await refresh();
      pushToast({ level: "info", title: t("credentials.toasts.deleted") });
    } catch (e) {
      pushToast({ level: "danger", title: String(e) });
    }
  }


  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 pb-12">
      <PageHeader count={creds.length} onNew={() => setEditing({})} />

      {/* Search toolbar */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-text-faint" />
        <Input
          placeholder={t("credentials.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-8 text-body"
        />
      </div>

      {creds.length === 0 ? (
        <Hero
          icon={<KeyRound className="h-5 w-5 text-info" />}
          title={t("credentials.empty.title")}
          body={t("credentials.empty.body")}
          accent="blue"
          action={
            <Button variant="primary" size="sm" onClick={() => setEditing({})}>
              <Plus className="h-3.5 w-3.5" /> {t("credentials.empty.cta")}
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-12 gap-4">
          {/* Master list */}
          <div className="col-span-5">
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface-elevated">
              {filtered.length === 0 && (
                <p className="text-body p-4 text-text-muted">
                  {t("credentials.noMatches", { query })}
                </p>
              )}
              {filtered.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 border-b border-border-subtle px-3 py-2.5 text-left transition-colors last:border-b-0",
                    selectedId === c.id ? "bg-accent-soft" : "hover:bg-surface-hover",
                  )}
                >
                  <Avatar name={c.name || c.username || "?"} />
                  <div className="min-w-0 flex-1">
                    <p className="text-body truncate font-medium text-text">{c.name}</p>
                    <p className="text-caption truncate font-mono text-text-muted">{c.username || "—"}</p>
                  </div>
                  <span className="text-tiny text-text-faint">{relativeDate(c.updated_at)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Detail */}
          <div className="col-span-7">
            {!selected && (
              <div className="grid h-48 place-items-center rounded-lg border border-dashed border-border-subtle text-caption text-text-muted">
                {t("credentials.select")}
              </div>
            )}
            {selected && (
              <DetailPanel
                cred={selected}
                linkedConns={linkedConns}
                revealedPassword={revealed[selected.id]}
                copiedKey={copiedKey}
                onCopyUser={(u) => copy(u, `u${selected.id}`, t("credentials.toasts.copiedUser"))}
                onCopyPassword={() => copyPassword(selected.id)}
                onReveal={() => revealPassword(selected.id)}
                onDuplicate={() => duplicate(selected)}
                onEdit={() => setEditing({ id: selected.id, defaults: selected })}
                onDelete={() => setDeleting(selected)}
              />
            )}
          </div>
        </div>
      )}

      {editing && (
        <Modal onClose={() => setEditing(null)}>
          <EditorForm
            defaults={editing.defaults}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await refresh();
                      pushToast({ level: "success", title: t("credentials.toasts.saved") });
            }}
          />
        </Modal>
      )}

      {deleting && (
        <Modal onClose={() => setDeleting(null)}>
          <div className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-danger-soft text-danger">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <h2 className="text-h2 text-text">{t("credentials.deleteConfirm.title")}</h2>
            </div>
            <p className="text-body mt-3 text-text-muted">
              {t("credentials.deleteConfirm.body", { name: deleting.name })}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setDeleting(null)}>
                {t("credentials.deleteConfirm.cancel")}
              </Button>
              <Button size="sm" variant="danger" onClick={() => performDelete(deleting)}>
                {t("credentials.deleteConfirm.confirm")}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PageHeader({ count, onNew, disabled }: { count: number; onNew: () => void; disabled?: boolean }) {
  const { t } = useTranslation();
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="grid h-9 w-9 place-items-center rounded-lg border border-border-subtle bg-surface-elevated text-text">
          <KeyRound strokeWidth={1.5} className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-h1 text-text">{t("credentials.title")}</h1>
          <p className="text-caption text-text-muted">{t("credentials.subtitle")}</p>
        </div>
        <span className="text-tiny rounded-full border border-border-subtle bg-surface-elevated px-2 py-0.5 text-text-muted">
          {t("credentials.count", { count })}
        </span>
      </div>
      <Button variant="primary" size="sm" onClick={onNew} disabled={disabled}>
        <Plus className="h-3.5 w-3.5" /> {t("credentials.new")}
      </Button>
    </header>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.trim().slice(0, 2).toUpperCase();
  const accent = colorFromName(name);
  return (
    <span
      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-tiny font-semibold text-white"
      style={{ background: `linear-gradient(135deg, ${accent.from}, ${accent.to})` }}
    >
      {initials}
    </span>
  );
}

function DetailPanel({
  cred,
  linkedConns,
  revealedPassword,
  copiedKey,
  onCopyUser,
  onCopyPassword,
  onReveal,
  onDuplicate,
  onEdit,
  onDelete,
}: {
  cred: CredentialView;
  linkedConns: Connection[];
  revealedPassword?: string;
  copiedKey: string | null;
  onCopyUser: (u: string) => void;
  onCopyPassword: () => void;
  onReveal: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-surface-elevated p-4">
        <Avatar name={cred.name || cred.username || "?"} />
        <div className="min-w-0 flex-1">
          <h2 className="text-h1 truncate text-text">{cred.name}</h2>
          <p className="text-caption truncate text-text-muted">{cred.username || "—"}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" /> {t("credentials.detail.edit")}
        </Button>
      </div>

      <SettingsCard title="">
        <SettingsRow
          label={t("credentials.detail.username")}
          control={
            <div className="flex items-center gap-2">
              <span className="text-body-mono text-text">{cred.username || "—"}</span>
              {cred.username && (
                <button
                  type="button"
                  onClick={() => onCopyUser(cred.username)}
                  className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
                  title={t("credentials.detail.copyUser")}
                >
                  {copiedKey === `u${cred.id}` ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
                </button>
              )}
            </div>
          }
        />
        <SettingsRow
          label={t("credentials.detail.password")}
          control={
            <div className="flex items-center gap-2">
              <span className="text-body-mono text-text">
                {revealedPassword ?? "••••••••••"}
              </span>
              <button
                type="button"
                onClick={onReveal}
                className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
                title={revealedPassword ? t("credentials.detail.hide") : t("credentials.detail.reveal")}
              >
                {revealedPassword ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
              </button>
              <button
                type="button"
                onClick={onCopyPassword}
                className="grid h-6 w-6 place-items-center rounded-md text-text-faint hover:bg-surface-hover hover:text-text"
                title={t("credentials.detail.copyPassword")}
              >
                {copiedKey === `p${cred.id}` ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              </button>
            </div>
          }
        />
        <SettingsRow label={t("credentials.detail.updated")} control={<span className="text-body text-text-muted">{formatDate(cred.updated_at)}</span>} />
        <SettingsRow label={t("credentials.detail.created")} control={<span className="text-body text-text-muted">{formatDate(cred.created_at)}</span>} />
      </SettingsCard>

      <SettingsCard title={t("credentials.detail.linkedConnections")}>
        {linkedConns.length === 0 ? (
          <p className="text-body p-3 text-text-muted">{t("credentials.detail.linkedEmpty")}</p>
        ) : (
          linkedConns.map((c) => (
            <Link
              key={c.id}
              to="/connections"
              search={{ id: c.id } as never}
              className="flex items-center gap-2 border-b border-border-subtle px-4 py-2 last:border-b-0 hover:bg-surface-hover"
            >
              <Users className="h-3 w-3 text-text-faint" />
              <span className="text-body text-text">{c.name}</span>
              <span className="text-caption ml-auto text-text-faint">{c.plugin_id}</span>
            </Link>
          ))
        )}
      </SettingsCard>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onDuplicate}>
          <Copy className="h-3.5 w-3.5" /> {t("credentials.detail.duplicate")}
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} className="ml-auto text-danger">
          <Trash2 className="h-3.5 w-3.5" /> {t("credentials.detail.delete")}
        </Button>
      </div>
    </div>
  );
}

function EditorForm({
  defaults,
  onCancel,
  onSaved,
}: {
  defaults?: CredentialView;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isEdit = Boolean(defaults);
  const [name, setName] = useState(defaults?.name ?? "");
  const [username, setUsername] = useState(defaults?.username ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!isEdit && !password) {
      setError(t("credentials.form.required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (isEdit && defaults) {
        await invoke("update_credential", {
          id: defaults.id,
          name: name.trim(),
          username: username.trim(),
          password: password.length > 0 ? password : null,
        });
      } else {
        await invoke("create_credential", {
          name: name.trim(),
          username: username.trim(),
          password,
        });
      }
      onSaved();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void save(); }}
      className="w-full max-w-md rounded-lg border border-border-subtle bg-surface-overlay p-5"
    >
      <h2 className="text-h2 text-text">
        {isEdit ? t("credentials.form.editTitle") : t("credentials.form.newTitle")}
      </h2>
      <div className="mt-4 flex flex-col gap-3">
        <Field label={t("credentials.detail.name")} hint={t("credentials.form.nameHint")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("credentials.form.namePlaceholder")} autoFocus />
        </Field>
        <Field label={t("credentials.detail.username")}>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("credentials.form.usernamePlaceholder")} />
        </Field>
        <Field label={t("credentials.detail.password")} hint={isEdit ? t("credentials.form.passwordHintEdit") : t("credentials.form.passwordHintCreate")}>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-9"
              placeholder={t("credentials.form.passwordPlaceholder")}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text"
              title={showPassword ? t("credentials.detail.hide") : t("credentials.detail.reveal")}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          </div>
        </Field>
        {error && <p className="text-body text-danger">{error}</p>}
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          {t("credentials.detail.cancel")}
        </Button>
        <Button type="submit" variant="primary" size="sm" disabled={busy}>
          {busy ? t("credentials.form.saving") : t("credentials.detail.save")}
        </Button>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-caption font-semibold uppercase tracking-wider text-text-muted">{label}</span>
        {hint && <span className="text-tiny text-text-faint">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function Hero({
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
  return (
    <div className="flex flex-col items-center rounded-xl border border-border-subtle bg-surface-elevated px-5 py-8 text-center">
      <div
        className={cn(
          "grid h-10 w-10 place-items-center rounded-xl ring-1",
          accent === "amber" ? "bg-warn-soft ring-warn/30" : "bg-info-soft ring-info/30",
        )}
      >
        {icon}
      </div>
      <h2 className="text-h2 mt-3 text-text">{title}</h2>
      <p className="text-body mt-1 max-w-md text-text-muted">{body}</p>
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
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

function relativeDate(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const day = 86400000;
    if (diff < day) return "hoy";
    if (diff < 2 * day) return "ayer";
    if (diff < 7 * day) return `${Math.floor(diff / day)}d`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}
