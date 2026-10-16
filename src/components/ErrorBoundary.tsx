import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="loading-screen">
          <h1>The workshop could not render this view.</h1>
          <p>
            Acknowledged saves remain in your account or device recovery buffer.
          </p>
          <button onClick={() => location.reload()}>
            Reload the application
          </button>
        </main>
      );
    return this.props.children;
  }
}
