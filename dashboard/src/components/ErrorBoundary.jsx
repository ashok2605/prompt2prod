import { TriangleAlert } from 'lucide-react'
import { Component } from 'react'
import { EmptyState } from './Misc.jsx'

/** Keeps a rendering error from blanking the whole dashboard. */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('[prompt2prod] UI error', error, info?.componentStack)
  }

  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page">
        <div className="card">
          <EmptyState
            icon={TriangleAlert}
            title="Something went wrong on this page"
            action={
              <div className="row-gap">
                <a className="btn btn-sm" href="#/">
                  Command Center
                </a>
                <button type="button" className="btn btn-sm btn-primary" onClick={() => window.location.reload()}>
                  Reload
                </button>
              </div>
            }
          >
            {String(this.state.error?.message || this.state.error)}
          </EmptyState>
        </div>
      </div>
    )
  }
}
