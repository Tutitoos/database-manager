import { Database, Folder, Plug, Table as TableIcon } from "lucide-react";
import { useInspectorContent } from "@/lib/inspector";
import { PROVIDER_UI } from "@/lib/providers";
import type { Connection } from "@/lib/types";

interface ContextProps {
  connection: Connection | null;
  database?: string | null;
  table?: string | null;
  /** Optional extra rows: label / value pairs. */
  extras?: Array<{ label: string; value: React.ReactNode }>;
  /** Label override for `table` (e.g. "Collection", "Key"). */
  tableLabel?: string;
}

/** Renders a contextual inspector content node and registers it for the duration
 *  of the host page mount. */
export function useInspectorContextFor({ connection, database, table, extras, tableLabel = "Table" }: ContextProps) {
  const ui = connection ? PROVIDER_UI[connection.plugin_id] : null;
  useInspectorContent(
    !connection ? (
      <p className="text-caption text-text-faint">No active connection.</p>
    ) : (
      <div className="flex flex-col gap-3">
        <Section title="Connection" icon={<Plug className="h-3 w-3" />}>
          <Row label="Name" value={<span className="text-text">{connection.name}</span>} />
          <Row label="Provider" value={<span className="font-mono text-text-muted">{ui?.name ?? connection.plugin_id}</span>} />
          <Row label="Host" value={<span className="font-mono text-text-muted">{connection.host}{connection.port ? `:${connection.port}` : ""}</span>} />
        </Section>
        {database && (
          <Section title="Database" icon={<Database className="h-3 w-3" />}>
            <Row label="Name" value={<span className="font-mono text-text">{database}</span>} />
          </Section>
        )}
        {table && (
          <Section title={tableLabel} icon={<TableIcon className="h-3 w-3" />}>
            <Row label="Name" value={<span className="font-mono text-text">{table}</span>} />
          </Section>
        )}
        {extras && extras.length > 0 && (
          <Section title="Details" icon={<Folder className="h-3 w-3" />}>
            {extras.map((e, i) => (
              <Row key={i} label={e.label} value={e.value} />
            ))}
          </Section>
        )}
      </div>
    ),
    [connection?.id, database, table, extrasKey(extras), tableLabel],
  );
}

/** Build a dep key from `extras` that ignores React nodes (cyclic → JSON.stringify
 *  throws). We only fingerprint labels + the count, which is enough to detect
 *  the kind of changes callers actually drive. */
function extrasKey(extras?: Array<{ label: string; value: React.ReactNode }>): string {
  if (!extras || extras.length === 0) return "";
  return extras.map((e) => e.label).join("|") + `#${extras.length}`;
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-overline mb-1 flex items-center gap-1">{icon}{title}</p>
      <div className="overflow-hidden rounded-md border border-border-subtle">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-2 py-1.5 text-[11px] last:border-b-0">
      <span className="text-text-faint">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
