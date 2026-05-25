import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { MessageSquare, Send, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { JsonTree } from "@/components/json-tree";
import type { Connection } from "@/lib/types";

interface Message {
  id: string;
  payload: string;
  timestamp: Date;
}

/** Per-channel Pub/Sub view used by RedisLayout via WorkspaceTab dispatch.
 *  Subscribes on mount, unsubscribes on unmount.
 */
export default function RedisChannelView({
  connection,
  channel,
}: {
  connection: Connection;
  channel: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draftMessage, setDraftMessage] = useState("");
  const subscribedRef = useRef(false);

  // Subscribe once per (connection, channel)
  useEffect(() => {
    if (subscribedRef.current) return;
    subscribedRef.current = true;
    invoke("redis_subscribe", { input: connection, channel }).catch(() => {});
    return () => {
      subscribedRef.current = false;
      invoke("redis_unsubscribe", { input: connection, channel }).catch(() => {});
    };
  }, [connection, channel]);

  // Listen for messages — filter by channel.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const eventName = `plugin:${connection.plugin_id}:pubsub_message`;
    listen(eventName, (event) => {
      const payload = event.payload as { channel: string; payload: string };
      if (payload.channel !== channel) return;
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          payload: payload.payload,
          timestamp: new Date(),
        },
      ]);
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [connection.plugin_id, channel]);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!draftMessage.trim()) return;
    const msgText = draftMessage.trim();
    setDraftMessage("");
    try {
      await invoke("redis_publish", { input: connection, channel, payload: msgText });
    } catch (err) {
      void err;
    }
  }

  const reversed = [...messages].reverse();

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-surface/20">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle bg-white/[0.02] px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
            <Radio className="h-4 w-4 animate-pulse" />
          </div>
          <h2 className="text-h3 font-semibold text-text">{channel}</h2>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border-strong bg-surface-sunken px-3 py-1 text-body text-text-muted">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          {messages.length} mensajes
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {reversed.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-border-strong bg-surface-hover text-text-faint shadow-inner">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-h2 font-medium text-text">Escuchando canal</h3>
            <p className="mt-2 text-h3 text-text-faint">
              Los mensajes publicados en <span className="font-mono text-text">{channel}</span> aparecerán aquí en tiempo real.
            </p>
          </div>
        ) : (
          reversed.map((msg) => (
            <div key={msg.id} className="group relative rounded-2xl border border-border-subtle bg-white/[0.03] p-4 shadow-sm transition-all hover:bg-white/[0.05]">
              <div className="mb-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-black/30 px-2.5 py-0.5 text-[10px] font-medium text-text-muted">
                  <Radio className="h-3 w-3" />
                  {channel}
                </span>
                <span className="text-[10px] font-mono text-text-faint">
                  {msg.timestamp.toLocaleTimeString()}
                </span>
              </div>
              {(() => {
                try {
                  const parsed = JSON.parse(msg.payload);
                  if (parsed !== null && typeof parsed === "object") {
                    return (
                      <div className="rounded-xl border border-black/20 bg-surface-sunken p-4 shadow-inner">
                        <JsonTree data={parsed as Record<string, unknown> | unknown[]} />
                      </div>
                    );
                  }
                } catch {}
                return (
                  <pre className="whitespace-pre-wrap break-all rounded-xl border border-black/20 bg-surface-sunken p-4 font-mono text-body text-text shadow-inner">
                    {msg.payload}
                  </pre>
                );
              })()}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border-subtle bg-white/[0.02] p-4 backdrop-blur-xl">
        <form onSubmit={publish} className="mx-auto flex max-w-4xl gap-3">
          <Input
            value={draftMessage}
            onChange={(e) => setDraftMessage(e.target.value)}
            placeholder={`Escribe un mensaje para ${channel}...`}
            className={cn(
              "h-10 border-border-strong bg-black/50 font-mono text-h3 shadow-inner focus-visible:ring-blue-500/50",
            )}
          />
          <Button
            type="submit"
            disabled={!draftMessage.trim()}
            className="h-10 bg-blue-600 px-6 text-text shadow-lg shadow-blue-900/20 transition-all hover:bg-blue-500 hover:shadow-blue-900/40"
          >
            <Send className="mr-2 h-4 w-4" />
            Publicar
          </Button>
        </form>
      </div>
    </div>
  );
}
