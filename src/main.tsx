import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { router } from "./router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MigrationModal } from "./components/MigrationModal";
import { WelcomePage } from "./pages/WelcomePage";
import { ServerOfflineScreen } from "./components/ServerOfflineScreen";
import { AuthRequiredGate } from "./components/AuthRequiredGate";
import { refreshOrgs, useOrgs, fetchOrgHealth } from "./store/orgs";
import { bootAppearance } from "./lib/theme";
import "./i18n";
import "./index.css";

bootAppearance();

type Phase = "loading" | "migration" | "welcome" | "offline" | "auth-required" | "ready";

function Root() {
  const [phase, setPhase] = useState<Phase>("loading");
  // `recheckTick` bumps when the boot guards must re-run mid-session (e.g.
  // OAuth session expired, user switched orgs). Increments are observed by
  // the watch effect below to re-probe health + auth.
  const [recheckTick, setRecheckTick] = useState(0);
  const { orgs, activeId } = useOrgs();

  // Boot sequence:
  //   1. Migration ack check (legacy data still around?).
  //   2. Orgs hydrate; if zero → WelcomePage.
  //   3. Probe active org's server health → ServerOfflineScreen if unreachable.
  //   4. Mount the Router directly (passphrase removed: auth is OAuth +
  //      stored bearer; biometry is the optional gate when re-loading the
  //      bearer from the keychain).
  useEffect(() => {
    (async () => {
      try {
        const acked = await invoke<string | null>("get_app_setting", {
          key: "app.migration_export_acked",
        });
        if (!acked) {
          const hasLegacy = await invoke<boolean>("has_legacy_data");
          if (hasLegacy) {
            setPhase("migration");
            return;
          }
        }
        await refreshOrgs();
        // refreshOrgs writes to the store synchronously; effect below picks up.
        setPhase("welcome"); // tentative; overridden once we know orgs+health
      } catch (e) {
        console.error("[boot]", e);
        setPhase("welcome");
      }
    })();
  }, []);

  // Watch orgs + active server health → "auth-required" / "ready" / "offline".
  useEffect(() => {
    if (phase === "loading" || phase === "migration") return;
    if (orgs.length === 0) { setPhase("welcome"); return; }
    const active = orgs.find((o) => o.id === activeId) ?? orgs[0];
    if (!active?.server_url) { setPhase("welcome"); return; }
    // Once we're already in "ready" mode, only the org switch or an explicit
    // recheckTick should be allowed to roll us back. Otherwise transient
    // `orgs` re-references (refreshOrgs returning a fresh array) trigger an
    // extra probe whose race with the bootstrap flow flickers ready ⇆
    // auth-required. Health + user lookup are still done on org/tick
    // changes, just not on every orgs identity change.
    if (phase === "ready") return;
    let cancelled = false;
    (async () => {
      try {
        await fetchOrgHealth(active.server_url!);
        // Login mandatory always. Local orgs materialize a synthetic
        // `app_user` via `auth_create_local_user` during WelcomePage; remote
        // orgs require OAuth. Either way, missing `app_user` → AuthRequired.
        let user = await invoke<unknown>("auth_current_user").catch(() => null);
        // Self-heal: a local install that pre-dates the synthetic user
        // helper still has a passphrase-derived bearer in `local.admin_token`
        // — re-create the synthetic `__local__` user from it so the gate
        // doesn't bounce them to OAuth (which the local server doesn't even
        // expose a client_id for).
        const isLoopback = (() => {
          try {
            const h = new URL(active.server_url!).hostname;
            return h === "localhost" || h === "127.0.0.1" || h === "::1";
          } catch { return false; }
        })();
        const isLocalLike = active.server_kind === "local" || isLoopback;
        if (!user && isLocalLike) {
          try {
            const raw = await invoke<string | null>("get_app_setting", { key: "local.admin_token" });
            let token = raw ? (JSON.parse(raw) as string) : null;
            // Bootstrap path: local org was seeded by the legacy migration
            // (no WelcomePage flow) so neither token nor verifier-hash exist
            // yet. Mint a fresh bearer + push the Argon2id hash to the
            // server's first-run setup endpoint. The setup endpoint is open
            // until the server has *any* hash stored; after that it 409s and
            // the existing token must already match — we surface the error
            // via AuthRequiredGate so the user can recover.
            if (!token) {
              const derived = await invoke<{ token: string; hash: string }>("gen_local_admin_token");
              await invoke("set_app_setting", {
                key: "local.admin_token",
                valueJson: JSON.stringify(derived.token),
              });
              try {
                await invoke("local_server_setup_admin", {
                  serverUrl: active.server_url,
                  hash: derived.hash,
                });
              } catch { /* 409 already configured, or unreachable */ }
              token = derived.token;
            }
            await invoke("auth_create_local_user", { token });
            user = await invoke<unknown>("auth_current_user").catch(() => null);
          } catch { /* ignore */ }
        }
        if (!user) {
          if (!cancelled) setPhase("auth-required");
          return;
        }
        if (!cancelled) setPhase("ready");
      } catch {
        if (!cancelled) setPhase("offline");
      }
    })();
    return () => { cancelled = true; };
  }, [orgs, activeId, phase, recheckTick]);

  // Adapt the OS window size to the current boot phase. Pre-ready states
  // (welcome / offline / auth-required / loading / migration) render a single
  // centered card and look ridiculous in a 1280×800 window. We collapse to a
  // compact 620×520 while bootstrapping and expand once the Shell mounts.
  //
  // Important: do the resize *before* React paints the new phase tree so the
  // viewport constraint matches the layout the page expects. Skipping
  // `center()` avoids a second async window-event that can race the React
  // re-render and leave the page laid out for the old viewport size — the
  // visible symptom is a "doubled" app where the previous tree stays on top
  // of the new one until the next interaction.
  const resizedForReadyRef = useRef(false);
  useEffect(() => {
    if (phase === "ready") {
      if (resizedForReadyRef.current) return;
      resizedForReadyRef.current = true;
      void getCurrentWindow()
        .setSize(new LogicalSize(1280, 800))
        .catch(() => undefined);
    } else {
      resizedForReadyRef.current = false;
    }
  }, [phase]);

  // Session lifecycle: if the backend clears app_user (sync 401, manual sign
  // out, etc.) or the active org changes, force the boot machinery to
  // re-evaluate. This is how a logged-out remote org bounces back to the
  // AuthRequiredGate instead of leaving the Shell visible.
  useEffect(() => {
    const expiredP = listen("auth:session-expired", () => setRecheckTick((t) => t + 1));
    const orgP = () => setRecheckTick((t) => t + 1);
    window.addEventListener("app:org-changed", orgP);
    return () => {
      void expiredP.then((fn) => fn()).catch(() => undefined);
      window.removeEventListener("app:org-changed", orgP);
    };
  }, []);

  if (phase === "loading") return null;
  if (phase === "migration") {
    return <MigrationModal onAcknowledged={() => setPhase("welcome")} />;
  }
  if (phase === "welcome") {
    return <WelcomePage onReady={() => setPhase("ready")} />;
  }
  if (phase === "offline") {
    return <ServerOfflineScreen onRecover={() => setPhase("ready")} />;
  }
  if (phase === "auth-required") {
    return <AuthRequiredGate onAuthed={() => setPhase("ready")} />;
  }
  return <RouterProvider router={router} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
