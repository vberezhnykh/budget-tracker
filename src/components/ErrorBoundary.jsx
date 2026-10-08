import { Component } from 'react';
import { reportClientError } from '../utils/clientErrorReporter';
import { TriangleAlert } from 'lucide-react';
import CenteredCardScreen from './CenteredCardScreen';
import Button from './ui/Button';

// Catches render-time exceptions anywhere below it in the tree (a
// screen, a sheet, the transaction list, ...) and shows a fallback
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
        <CenteredCardScreen icon={<TriangleAlert size={26} />} title="Что-то пошло не так">
          <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-muted)' }}>
            Приложение столкнулось с ошибкой. Попробуйте перезагрузить страницу.
          </p>
          <Button block onClick={() => window.location.reload()}>
            Перезагрузить
          </Button>
        </CenteredCardScreen>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
