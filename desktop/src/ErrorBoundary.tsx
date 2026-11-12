import { Component, type ReactNode } from 'react'

/** If a screen crashes, show a way back instead of a blank window. Saved transcripts are on disk and safe. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="d-crash" role="alert">
        <h1>Something went wrong</h1>
        <p className="small muted">Your recordings and saved transcripts are safe on this computer. Reload to carry on.</p>
        <pre className="tiny">{this.state.error.message}</pre>
        <button className="btn btn-lime" onClick={() => location.reload()}>Reload SPATREN Desktop</button>
      </div>
    )
  }
}
