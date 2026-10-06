import { Component } from 'react';
import { reportClientError } from '../utils/clientErrorReporter';
import Button from './ui/Button';
import Card from './ui/Card';

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

  componentDidCatch() {
    // The server receives a fixed event code only; error, message and both
    // stacks remain out of the request payload.
    reportClientError('react_render');
    console.error('ErrorBoundary caught an error');
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
          <Card padding="lg" style={{ width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '16px', textAlign: 'center' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 'var(--weight-strong)', letterSpacing: '-0.8px', color: 'var(--color-primary)', margin: 0 }}>
              Что-то пошло не так
            </h1>
            <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-muted)' }}>
              Приложение столкнулось с ошибкой. Попробуйте перезагрузить страницу.
            </p>
            <Button block onClick={() => window.location.reload()}>
              Перезагрузить
            </Button>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
