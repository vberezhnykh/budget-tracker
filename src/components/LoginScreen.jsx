import { useState } from 'react';
import { CircleAlert, Wallet } from 'lucide-react';
import CenteredCardScreen from './CenteredCardScreen'
import Field from './ui/Field'
import Button from './ui/Button'

// Single shared-password login screen. Shown whenever the app detects an
// unauthenticated state (a 401 from the API) - see App.jsx. There is no
// user account here, just one family password, so this is intentionally the
// simplest possible form.
//
// sessionExpired - вход показан не при первом запуске, а потому что сессия
// закончилась посреди работы: подзаголовок тогда успокаивает, что данные на
// месте, а не просит «продолжить» с нуля.
function LoginScreen({ onSuccess, sessionExpired = false }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!password || isSubmitting) return;

    setIsSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });

      if (res.ok) {
        setPassword('');
        onSuccess();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Неверный пароль');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('Не удалось подключиться к серверу');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CenteredCardScreen
      icon={<Wallet size={24} />}
      tileTone="primary"
      tileSize={48}
      title="Бюджет"
    >
      <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
        {sessionExpired
          ? 'Сессия закончилась. Войдите снова, данные на месте.'
          : 'Введите пароль, чтобы продолжить'}
      </p>

      <form onSubmit={handleSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', textAlign: 'left' }}>
        <label style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', fontWeight: 'var(--weight-label)' }}>
          Пароль
          <Field
            type="password"
            size="lg"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            placeholder="Введите пароль"
            aria-label="Пароль"
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'login-error' : undefined}
            style={{
              width: '100%',
              minHeight: '50px',
              marginTop: 'var(--space-2)',
              // Ошибка - красная рамка потолще; Field сам рисует тонкую серую.
              ...(error ? { border: '1.5px solid var(--color-danger)' } : null),
            }}
          />
        </label>

        {error && (
          <div
            id="login-error"
            role="alert"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-danger)', fontSize: 'var(--text-base)', fontWeight: 'var(--weight-label)' }}
          >
            <CircleAlert size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" block disabled={isSubmitting} style={{ minHeight: '54px', fontSize: 'var(--text-lg)' }}>
          {isSubmitting ? 'Вход…' : 'Войти'}
        </Button>
      </form>
    </CenteredCardScreen>
  );
}

export default LoginScreen;
