import { Component } from 'react';

// Catches render-time exceptions anywhere below it in the tree (the
// carousel, the drawer, the transaction list, ...) and shows a fallback
// instead of letting React unmount the whole tree to a blank white screen.
// This has to be a class component - React has no hook equivalent for
// componentDidCatch/getDerivedStateFromError yet.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Still diagnosable even though the UI itself only shows a generic
    // fallback - the stack goes wherever console output for this deployment
    // already goes (browser devtools, or whatever error-reporting the host
    // captures console.error into).
    console.error('ErrorBoundary caught an error:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
          <div className="glass-panel" style={{ padding: '32px', width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--color-primary)', margin: 0 }}>
              Что-то пошло не так
            </h1>
            <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-text-muted)' }}>
              Приложение столкнулось с ошибкой. Попробуйте перезагрузить страницу.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => window.location.reload()}
              style={{ padding: '12px', borderRadius: '12px', fontWeight: '700', border: 'none', cursor: 'pointer' }}
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
