import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Camera, X } from 'lucide-react';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';

const FOCUSABLE = 'button:not([disabled])';
const GHOST = 'rgba(255, 255, 255, 0.14)';

// Фото чека на весь экран: сверить поля с оригиналом. Поверх листа формы
// (у листа z-index 1000), поэтому живёт в портале. Лист слушает Escape и Tab
// на document, а нам нужно, чтобы Escape закрывал только просмотр и Tab не
// уходил в форму под ним. Поэтому слушатель стоит на window в фазе захвата и
// останавливает событие до того, как оно дойдёт до листа.
//
// Фокус при открытии - на крестик. Вернуть его после закрытия (на миниатюру
// или, если фото убрали, на камеру) должен родитель: Safari не фокусирует
// кнопку при нажатии, и запомнить прежний фокус здесь нечем.
export default function ReceiptPreview({ url, onClose, onReplace, onRemove }) {
    const dialogRef = useRef(null);
    const closeRef = useRef(null);
    const onCloseRef = useRef(onClose);
    useEffect(() => {
        onCloseRef.current = onClose;
    });

    useEffect(() => {
        closeRef.current?.focus();

        const handleKeyDown = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onCloseRef.current?.();
                return;
            }
            if (event.key !== 'Tab') return;
            event.stopPropagation();
            const focusable = Array.from(dialogRef.current?.querySelectorAll(FOCUSABLE) || []);
            if (focusable.length === 0) {
                event.preventDefault();
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const inside = dialogRef.current.contains(document.activeElement);
            if (event.shiftKey && (document.activeElement === first || !inside)) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
                event.preventDefault();
                first.focus();
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
        };
    }, []);

    return createPortal(
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Фото чека"
            style={{
                position: 'fixed',
                inset: 0,
                zIndex: 1200,
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--color-text-main)',
                color: 'var(--color-text-inverse)',
                overscrollBehavior: 'contain',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'calc(var(--space-4) + env(safe-area-inset-top, 0px)) var(--space-5) var(--space-4)' }}>
                <span style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-strong)' }}>Фото чека</span>
                <IconButton ref={closeRef} round size={44} aria-label="Закрыть" onClick={onClose} style={{ background: GHOST, color: 'inherit' }}>
                    <X size={20} strokeWidth={1.8} aria-hidden="true" />
                </IconButton>
            </div>

            <div style={{ flex: 1, minHeight: 0, padding: 'var(--space-2) var(--space-5)' }}>
                {url && <img src={url} alt="Снимок чека" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-4) var(--space-5) calc(var(--space-6) + env(safe-area-inset-bottom, 0px))' }}>
                <p style={{ margin: 0, color: 'rgba(255, 255, 255, 0.75)', fontSize: 'var(--text-sm)', lineHeight: 1.5, textAlign: 'center' }}>
                    Фото нужно, чтобы сверить поля. Оно не сохраняется ни в операции, ни на сервере.
                </p>
                <Button size="lg" onClick={onReplace} style={{ background: GHOST, color: 'inherit', boxShadow: 'none', fontSize: 'var(--text-lg)' }}>
                    <Camera size={18} strokeWidth={1.8} aria-hidden="true" />
                    Другое фото
                </Button>
                <Button tone="text" onClick={onRemove} style={{ minHeight: '44px', color: 'rgba(255, 255, 255, 0.85)', fontSize: 'var(--text-md)' }}>
                    Убрать фото
                </Button>
            </div>
        </div>,
        document.body
    );
}
