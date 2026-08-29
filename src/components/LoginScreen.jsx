import { useState } from 'react';
import Field from './ui/Field'

// Single shared-password login screen. Shown whenever the app detects an
// unauthenticated state (a 401 from the API) - see App.jsx. There is no
// user account here, just one family password, so this is intentionally the
// simplest possible form.
function LoginScreen({ onSuccess }) {
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
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', padding: '20px' }}>
      <div className="glass-panel" style={{ padding: '32px', width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: '1.6rem', fontWeight: '800', letterSpacing: '-0.8px', color: 'var(--color-primary)', margin: 0, textAlign: 'center' }}>
          BudgetTracker
        </h1>
        <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--text-base)', color: 'var(--color-text-muted)' }}>
          Введите пароль, чтобы продолжить
        </p>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <label style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-muted)', fontWeight: '600' }}>
            Пароль
            <Field
              type="password"
              size="lg"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              placeholder="Введите пароль"
              aria-label="Пароль"
              style={{ width: '100%', marginTop: '6px' }}
            />
          </label>

          {error && (
            <div role="alert" style={{ color: 'var(--color-negative)', fontSize: 'var(--text-base)', fontWeight: '500' }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            className="btn-primary"
            disabled={isSubmitting}
            style={{ padding: '12px', borderRadius: 'var(--radius-md)', fontWeight: '700', opacity: isSubmitting ? 0.7 : 1 }}
          >
            {isSubmitting ? 'Вход...' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default LoginScreen;
