import { Component, type ReactNode } from "react";
export default class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; reopening: boolean }
> {
  state = { failed: false, reopening: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.error(
      "Madina Express could not render this screen. Reopen the application to retrieve the current records.",
    );
  }
  render() {
    return this.state.failed ? (
      <div className="app-loading" role="alert">
        <h1>Madina Express could not open this screen</h1>
        <p>
          Your saved tickets remain in the system. Reopen the application, then
          check the latest records before repeating a payment.
        </p>
        <button
          className="primary-button"
          disabled={this.state.reopening}
          onClick={async () => {
            this.setState({ reopening: true });
            const controller = new AbortController(),
              timer = window.setTimeout(() => controller.abort(), 2000);
            try {
              await fetch("/browser-recovery", {
                cache: "no-store",
                credentials: "same-origin",
                headers: { "X-Madina-Recovery": "startup" },
                signal: controller.signal,
              });
            } catch {
              /* A fresh navigation still works when the repair endpoint is unavailable. */
            } finally {
              window.clearTimeout(timer);
              const url = new URL(location.href);
              url.searchParams.set("_madina_reload", String(Date.now()));
              location.replace(url.href);
            }
          }}
        >
          {this.state.reopening ? "Reopening…" : "Reopen application"}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
