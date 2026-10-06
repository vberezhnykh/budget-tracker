import { ArrowDownLeft, ArrowDownUp, ArrowUpRight } from 'lucide-react';
import AccountPicker from './AccountPicker';
import IconButton from '../ui/IconButton';

// Направление перевода. Каждая сторона - свой ряд чипов счетов (те же, что
// в доходе и расходе), а не нативный select: любой счёт в одно касание,
// длинные названия читаются. У строки своя цветная стрелка, а кнопка на
// разделителе меняет направление одним нажатием.
export default function TransferAccounts({ accounts, from, to, onPick, onSwap }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div style={{
                position: 'relative',
                background: 'var(--color-surface-muted)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)'
            }}>
                {[
                    { side: 'account', label: 'Откуда', value: from, accent: 'var(--color-negative)', icon: ArrowUpRight },
                    { side: 'toAccount', label: 'Куда', value: to, accent: 'var(--color-positive)', icon: ArrowDownLeft }
                ].map((row, index) => (
                    <div
                        key={row.side}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-3)',
                            padding: 'var(--space-3) var(--space-4)',
                            // Room for the swap button so the chips
                            // never run under it.
                            paddingRight: '62px',
                            borderTop: index === 0 ? 'none' : '1px solid var(--color-border)'
                        }}
                    >
                        <div style={{
                            width: '30px',
                            height: '30px',
                            flexShrink: 0,
                            borderRadius: '50%',
                                    color: row.accent,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'var(--weight-strong)',
                            fontSize: 'var(--text-xl)'
                        }}>
                            <row.icon size={20} strokeWidth={1.8} aria-hidden="true" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                                style={{
                                    color: 'var(--color-text-muted)',
                                    fontSize: 'var(--text-2xs)',
                                    fontWeight: 'var(--weight-label)',
                                    letterSpacing: '0.6px',
                                    textTransform: 'uppercase',
                                    marginBottom: 'var(--space-2)'
                                }}
                            >
                                {row.label}
                            </div>
                            <AccountPicker
                                role="group"
                                aria-label={row.label}
                                accounts={accounts}
                                scrollAlways
                                value={row.value}
                                onChange={id => onPick(row.side, id)}
                            />
                        </div>
                    </div>
                ))}
                <IconButton
                    round
                    size={38}
                    onClick={onSwap}
                    aria-label="Поменять счета местами"
                    style={{
                        position: 'absolute',
                        top: '50%',
                        right: '14px',
                        transform: 'translateY(-50%)',
                        // приподнята над строками счетов, между
                        // которыми лежит - отсюда своя подложка,
                        // рамка и тень вместо тона
                        background: 'var(--color-surface)',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-primary)',
                        fontSize: 'var(--text-2xl)',
                        lineHeight: 1,
                        boxShadow: 'var(--shadow-float)'
                    }}
                >
                    <ArrowDownUp size={20} strokeWidth={1.8} aria-hidden="true" />
                </IconButton>
            </div>
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', textAlign: 'center', margin: 0 }}>
                Общий баланс не изменится
            </p>
        </div>
    );
}
