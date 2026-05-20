import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { MessageSquare, Plus, Send, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { mutedText, panel, sectionBorder, surface } from "@/lib/styles";
import { JsonTree } from "@/components/json-tree";
import { useSessionsStore, type RedisSession } from "@/store/sessions";
import type { Connection } from "@/lib/types";

interface Message {
  id: string;
  channel: string;
  payload: string;
  timestamp: Date;
}

export default function RedisPubSubPage({ connection }: { connection: Connection }) {
  const { sessions, updateSession } = useSessionsStore();
  const stored = sessions[connection.id] as RedisSession | undefined;

  const [channels, setChannels] = useState<string[]>(() => stored?.pubsubChannels ?? []);
  const [activeChannel, setActiveChannel] = useState<string | null>(() => stored?.pubsubActiveChannel ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newChannel, setNewChannel] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const restoredRef = useRef(false);

  // Sync channels + activeChannel back to store
  useEffect(() => {
    updateSession(connection.id, { pubsubChannels: channels, pubsubActiveChannel: activeChannel });
  }, [channels, activeChannel]);

  // Re-subscribe to persisted channels on first mount
  useEffect(() => {
    if (restoredRef.current || channels.length === 0) return;
    restoredRef.current = true;
    for (const ch of channels) {
      invoke("redis_subscribe", { input: connection, channel: ch }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    const eventName = `plugin:${connection.plugin_id}:pubsub_message`;
    listen(eventName, (event) => {
      const payload = event.payload as { channel: string; payload: string };
      setMessages((prev) => [
        ...prev,
        {
          id: Math.random().toString(36).slice(2),
          channel: payload.channel,
          payload: payload.payload,
          timestamp: new Date(),
        },
      ]);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlisten = fn;
      }
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [connection.plugin_id]);

  async function subscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!newChannel.trim()) return;
    const ch = newChannel.trim();
    if (!channels.includes(ch)) {
      setChannels((prev) => [...prev, ch]);
    }
    setActiveChannel(ch);
    setNewChannel("");

    try {
      await invoke("redis_subscribe", { input: connection, channel: ch });
    } catch (err) {
      void err;
    }
  }

  async function unsubscribe(channel: string) {
    setChannels((prev) => prev.filter((c) => c !== channel));
    if (activeChannel === channel) setActiveChannel(null);

    try {
      await invoke("redis_unsubscribe", { input: connection, channel });
    } catch (err) {
      void err;
    }
  }

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    if (!activeChannel || !draftMessage.trim()) return;

    const msgText = draftMessage.trim();
    setDraftMessage("");

    try {
      await invoke("redis_publish", { input: connection, channel: activeChannel, payload: msgText });
    } catch (err) {
      void err;
    }
  }

  const activeMessages = messages.filter((m) => m.channel === activeChannel).reverse();

  return (
    <div className="flex h-full w-full min-h-0 flex-1 bg-surface-sunken">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border-subtle bg-surface/50">
        <div className="flex h-14 shrink-0 items-center border-b border-border-subtle px-5">
          <span className="text-[10px] font-bold uppercase tracking-[.15em] text-text-faint">
            Suscripciones
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          {channels.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border-strong p-6 text-center">
              <p className="text-body text-text-faint">Sin suscripciones activas.</p>
            </div>
          ) : (
            channels.map((channel) => (
              <div
                key={channel}
                className={cn(
                  "group flex items-center justify-between rounded-xl px-3 py-2.5 text-h3 transition-all",
                  activeChannel === channel
                    ? "bg-blue-500/10 text-blue-400 border border-blue-500/20 shadow-inner"
                    : "border border-transparent text-text-muted hover:bg-surface-hover hover:text-text"
                )}
              >
                <button
                  onClick={() => setActiveChannel(channel)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Radio className={cn("h-4 w-4 shrink-0", activeChannel === channel ? "animate-pulse" : "")} />
                  <span className="truncate font-medium">{channel}</span>
                </button>
                <button
                  onClick={() => unsubscribe(channel)}
                  className="opacity-0 transition-opacity group-hover:opacity-100 text-text-faint hover:text-red-400 p-1"
                  title="Desuscribirse"
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
        <div className="shrink-0 border-t border-border-subtle bg-white/[0.02] p-4 backdrop-blur-xl">
          <form onSubmit={subscribe} className="flex items-center gap-2">
            <Input
              value={newChannel}
              onChange={(e) => setNewChannel(e.target.value)}
              placeholder="Añadir canal..."
              className="h-9 border-border-strong bg-black/50 text-h3 focus-visible:ring-blue-500/50"
            />
            <Button
              type="submit"
              variant="secondary"
              className="h-9 w-9 shrink-0 p-0 border border-border-strong bg-surface-hover hover:bg-surface-active"
              disabled={!newChannel.trim()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col bg-surface/20">
        {activeChannel ? (
          <>
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle bg-white/[0.02] px-6 backdrop-blur-md">
              <div className="flex items-center gap-3">
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
                  <Radio className="h-4 w-4 animate-pulse" />
                </div>
                <h2 className="text-h3 font-semibold text-text">{activeChannel}</h2>
              </div>
              <div className="flex items-center gap-2 rounded-full border border-border-strong bg-surface-sunken px-3 py-1 text-body text-text-muted">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                {activeMessages.length} mensajes
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {activeMessages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center">
                  <div className="grid h-16 w-16 place-items-center rounded-2xl border border-border-strong bg-surface-hover text-text-faint shadow-inner">
                    <MessageSquare className="h-6 w-6" />
                  </div>
                  <h3 className="mt-5 text-h2 font-medium text-text">Escuchando canal</h3>
                  <p className="mt-2 text-h3 text-text-faint">
                    Los mensajes publicados en <span className="font-mono text-text">{activeChannel}</span> aparecerán aquí en tiempo real.
                  </p>
                </div>
              ) : (
                activeMessages.map((msg) => (
                  <div key={msg.id} className="group relative rounded-2xl border border-border-subtle bg-white/[0.03] p-4 shadow-sm transition-all hover:bg-white/[0.05]">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border-strong bg-black/30 px-2.5 py-0.5 text-[10px] font-medium text-text-muted">
                        <Radio className="h-3 w-3" />
                        {msg.channel}
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
                  placeholder={`Escribe un mensaje para ${activeChannel}...`}
                  className="h-10 border-border-strong bg-black/50 font-mono text-h3 shadow-inner focus-visible:ring-blue-500/50"
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
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="grid h-16 w-16 place-items-center rounded-2xl border border-border-strong bg-surface-hover text-text-faint shadow-inner">
              <Radio className="h-6 w-6" />
            </div>
            <h3 className="mt-5 text-h1 font-semibold tracking-tight text-text">Pub/Sub</h3>
            <p className="mt-2 max-w-sm text-h3 text-text-faint">
              Selecciona o añade un canal en el panel izquierdo para empezar a enviar y recibir mensajes.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
