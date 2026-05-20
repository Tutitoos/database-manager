import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import i18n from "@/i18n";

interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error("[error-boundary]", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-screen place-items-center bg-bg p-6 text-text">
        <div className="w-full max-w-md rounded-lg border border-danger/40 bg-surface-elevated p-5 shadow-md">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-danger" strokeWidth={1.5} />
            <h1 className="text-h2 text-text">{i18n.t("errorBoundary.title")}</h1>
          </div>
          <pre className="text-body-mono mt-3 max-h-64 overflow-auto rounded-md bg-surface-sunken p-3 text-text-muted">
            {String(this.state.error?.message ?? this.state.error)}
          </pre>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="text-body inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-text hover:bg-surface-hover"
            >
              <RotateCw className="h-3 w-3" /> {i18n.t("errorBoundary.reload")}
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="text-body inline-flex h-7 items-center gap-1.5 rounded-md bg-accent px-2.5 text-text-on-accent hover:bg-accent-hover"
            >
              {i18n.t("errorBoundary.retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
