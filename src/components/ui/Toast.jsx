import { useId } from 'react';
import { X } from 'lucide-react';

// Всплывающее уведомление: «Операция удалена» с отменой, «Сохранено».
// Плавает над нижней панелью (bottomOffset - высота панели плюс зазор) и
// поверх шторок, поэтому z-index выше, чем у Sheet.
//
// Положение: fixed, по центру через left 50% и translateX(-50%) с шириной
// «экран минус по 16px с боков». На узком экране тост почти во всю ширину,
// на широком упирается в 420px и остаётся по центру.
//
// Тон меняет только role: danger читалка объявляет сразу (alert), обычное
// сообщение - вежливо, не перебивая (status). Цвета у тостов одни: чернила
// с белым текстом, они читаются на любом фоне.

export default function Toast({ message, tone = 'neutral', action, onClose, bottomOffset = 104 }) {
    // Имя в view transition должно быть уникальным на странице, а тостов бывает
    // несколько сразу, поэтому оно строится из useId (двоеточия в имени не
    // годятся для CSS-идентификатора).
    const transitionName = `toast-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return (
        <div
            role={tone === 'danger' ? 'alert' : 'status'}
            style={{
                position: 'fixed',
                left: '50%',
                transform: 'translateX(-50%)',
                bottom: `${bottomOffset}px`,
                width: 'calc(100% - 32px)',
                maxWidth: '420px',
                boxSizing: 'border-box',
                zIndex: 1100,
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) var(--space-2) var(--space-2) var(--space-4)',
                minHeight: '52px',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-text-main)',
                color: 'var(--color-text-inverse)',
                boxShadow: 'var(--shadow-toast)',
                // Тост не должен ехать вместе со сменой экрана (см. index.css).
                viewTransitionName: transitionName,
                fontSize: 'var(--text-md)',
            }}
        >
            <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
            {action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    disabled={action.disabled}
                    style={{
                        flexShrink: 0,
                        minHeight: '44px',
                        padding: '0 var(--space-3)',
                        // Единственный «сырой» цвет в примитиве: полупрозрачный
                        // белый поверх чернильной заливки. Токена на него нет и
                        // заводить незачем - нигде больше он не нужен.
                        background: 'rgba(255, 255, 255, 0.14)',
                        color: 'var(--color-text-inverse)',
                        border: 'none',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--text-md)',
                        fontWeight: 'var(--weight-label)',
                        cursor: action.disabled ? 'not-allowed' : 'pointer',
                        opacity: action.disabled ? 0.6 : 1,
                    }}
                >
                    {action.label}
                </button>
            )}
            {onClose && (
                <button
                    type="button"
                    aria-label="Закрыть"
                    onClick={onClose}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        width: '44px',
                        height: '44px',
                        background: 'transparent',
                        color: 'var(--color-text-inverse)',
                        border: 'none',
                        cursor: 'pointer',
                    }}
                >
                    <X size={18} aria-hidden="true" />
                </button>
            )}
        </div>
    );
}
