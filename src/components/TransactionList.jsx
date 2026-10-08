import { Fragment } from 'react';
import { ArrowRight, EyeOff } from 'lucide-react';
import TransactionIcon from './TransactionIcon';
import { formatMoney } from '../utils/money';
import './TransactionList.css';

const hasCompanyField = (item) => typeof item.companyName === 'string';
const displayName = (item) => hasCompanyField(item)
    ? item.companyName || (item.type === 'split_group' ? 'Операция' : item.category || item.title || 'Расход')
    : item.description || item.title;
const displayComment = (item) => hasCompanyField(item) ? item.description || '' : '';

// Список операций, сгруппированный по дням. Один и тот же список нужен в
// трёх местах - в экране истории (результаты поиска и обычная история) и
// блоком «Последние операции» на главной, - а до этого он был написан
// дважды, почти одинаково, с уже начавшимися расхождениями: разбитые
// операции разворачивались только в истории, но не в результатах поиска.
//
// На вход идёт уже сгруппированная структура { дата: { items, dailySum } } -
// ровно та, что отдаёт сервер (/api/history); сортировка по
// убыванию даты здесь, потому что порядок ключей объекта - не порядок дней.
//
// Вид - по макету «История»: заголовок дня с суммой дня лежит на сером фоне
// страницы, а сами операции дня - в белой карточке под ним. Своей внешней
// карточки у списка нет, поэтому серый фон под ним обеспечивает экран.

// Ширина плитки иконки (см. TransactionIcon.css) и зазор до текста: части
// разбитой операции сдвинуты ровно на их сумму, чтобы встать под название.
const ICON_WIDTH = '40px';
const NESTED_INDENT = `calc(${ICON_WIDTH} + var(--space-3))`;

const MAIN_COLOR = 'var(--color-text-main)';
const POSITIVE_COLOR = 'var(--color-positive)';

// Сумма строки: текст и цвет. Расход - «−€24,90» основным цветом, доход -
// «+€3.900,00» зелёным, перевод и начальный остаток - без знака: деньги
// просто переехали или были. Разбитая операция типа не имеет, поэтому её
// знак берётся из суммы частей.
function amountFor(item) {
    const value = item.visualAmount;
    if (item.type === 'income' || (item.type === 'split_group' && value > 0)) {
        return { text: formatMoney(value, { sign: 'auto' }), color: POSITIVE_COLOR };
    }
    if (item.type === 'transfer' || item.type === 'initial') {
        return { text: formatMoney(value), color: MAIN_COLOR };
    }
    return { text: formatMoney(value, { sign: 'minus' }), color: MAIN_COLOR };
}

// Строка целиком кликабельна, но внутри неё есть вторая цель -
// категория, включающая фильтр. Поэтому «растянутая» кнопка лежит
// отдельным слоем под содержимым (position: absolute + inset: 0), а не
// оборачивает его: вложенная в кнопку кнопка невалидна, а щелчок по
// категории иначе открывал бы редактирование.
function RowOverlayButton({ label, onClick }) {
    return (
        <button
            type="button"
            aria-label={label}
            onClick={onClick}
            style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                margin: 0,
                padding: 0,
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                zIndex: 0,
            }}
        />
    );
}

// Категория как переключатель фильтра. Не <button>: она лежит внутри
// строки, у которой уже есть своя кнопка-подложка, - зато role и
// обработка Enter/Space возвращают ей клавиатурное поведение кнопки.
//
// Там, где фильтра по категории нет (блок «Последние операции» на Обзоре),
// onToggle не передаётся, и категория остаётся простым текстом: «ссылка»,
// которая ничего не делает, хуже её отсутствия.
function CategoryFilterLink({ category, selected, onToggle }) {
    if (!onToggle) return <span>{category}</span>;
    return (
        <span
            role="button"
            tabIndex={0}
            className="tx-category-link"
            onClick={() => onToggle(category)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onToggle(category);
                }
            }}
            style={{
                position: 'relative',
                zIndex: 1,
                color: selected ? 'var(--color-primary)' : 'inherit',
                fontWeight: selected ? 'var(--weight-label)' : 'var(--weight-text)',
            }}
        >
            {category}
        </span>
    );
}

// Подпись под названием: куски через « · », не больше двух строк.
function Subtitle({ parts }) {
    if (parts.length === 0) return null;
    return (
        <div
            data-testid="transaction-subtitle"
            style={{
                marginTop: '2px',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                overflowWrap: 'anywhere',
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 2,
                overflow: 'hidden',
            }}
        >
            {parts.map((part, index) => (
                <Fragment key={part.key}>
                    {index > 0 && ' · '}
                    <span>{part.node}</span>
                </Fragment>
            ))}
        </div>
    );
}

const DAY_HEADER_STYLE = {
    display: 'flex',
    justifyContent: 'space-between',
    gap: 'var(--space-3)',
    padding: '0 var(--space-1)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--weight-label)',
};

const DAY_CARD_STYLE = {
    background: 'var(--color-surface)',
    borderRadius: 'var(--radius-lg)',
    padding: '0 var(--space-4)',
};

export default function TransactionList({
    groups,
    selectedCategory,
    toggleCategoryFilter,
    openEditModal,
    getAccountDisplay,
    formatDate,
    emptyText = 'Нет операций',
    // Необязательные: маленькая иконка над строкой и действие под ней
    // (например, «Сбросить фильтры» в пустом месяце Истории).
    emptyIcon = null,
    emptyAction = null,
}) {
    const dates = Object.keys(groups || {}).sort((a, b) => new Date(b) - new Date(a));

    if (dates.length === 0) {
        return (
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    padding: 'var(--space-8) var(--space-4)',
                    textAlign: 'center',
                    fontSize: 'var(--text-md)',
                    color: 'var(--color-text-muted)',
                }}
            >
                {emptyIcon}
                <div>{emptyText}</div>
                {emptyAction}
            </div>
        );
    }

    // Строка счёта. Перевод двигает деньги между счетами, поэтому назвать
    // только источник нельзя - это читалось бы как обычный расход.
    const rowAccounts = (item) => (
        item.type === 'transfer' && item.toAccount
            ? `${getAccountDisplay(item.account)} → ${getAccountDisplay(item.toAccount)}`
            : getAccountDisplay(item.account)
    );

    const visibleAccounts = (item) => (
        item.type === 'transfer' && item.toAccount
            ? <>{getAccountDisplay(item.account)} <ArrowRight size={12} strokeWidth={1.8} aria-hidden="true" /> {getAccountDisplay(item.toAccount)}</>
            : getAccountDisplay(item.account)
    );

    // Доступное имя строки повторяет то, что и так видно глазами:
    // название, счета, категория, сумма со знаком.
    const rowLabel = (item) => {
        const parts = [displayName(item)];
        if (displayComment(item)) parts.push(displayComment(item));
        parts.push(rowAccounts(item));
        if (item.category) parts.push(item.category);
        parts.push(amountFor(item).text);
        return parts.join(', ');
    };

    // Подпись «категория · счёт · комментарий». Категорию не повторяем,
    // когда список и так отфильтрован по ней: в каждой строке она была бы
    // одним и тем же словом.
    const subtitleParts = (item) => {
        const parts = [];
        if (item.category && item.category !== selectedCategory) {
            parts.push({
                key: 'category',
                node: <CategoryFilterLink category={item.category} selected={false} onToggle={toggleCategoryFilter} />,
            });
        }
        parts.push({ key: 'account', node: visibleAccounts(item) });
        if (displayComment(item)) parts.push({ key: 'comment', node: displayComment(item) });
        return parts;
    };

    // Строка-карточка (обычная операция и «шапка» разбитой): иконка,
    // название с подписью, сумма. Кнопка-подложка только у редактируемых.
    const renderRow = (item, { index, title, parts, overlay, faded }) => {
        const { text, color } = amountFor(item);
        return (
            <div
                key={item.id}
                data-history-item={item.id}
                style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-3) 0',
                    borderTop: index > 0 ? '1px solid var(--color-border-subtle)' : 'none',
                    cursor: overlay ? 'pointer' : 'default',
                    opacity: faded ? 0.5 : 1,
                }}
            >
                {overlay}
                <TransactionIcon item={item} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-label)', color: MAIN_COLOR, overflowWrap: 'anywhere' }}>
                        {title}
                        {item.excludeFromStats && (
                            <span role="img" aria-label="Исключено из статистики" title="Исключено из статистики" style={{ marginLeft: 'var(--space-1-5)', color: 'var(--color-text-muted)' }}><EyeOff size={14} strokeWidth={1.8} aria-hidden="true" /></span>
                        )}
                    </div>
                    <Subtitle parts={parts} />
                </div>
                {/* nowrap - чтобы знак не оставался на строке один, когда
                    сумма длинная, а название операции широкое. */}
                <div style={{ flexShrink: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-strong)', whiteSpace: 'nowrap', color }}>
                    {text}
                </div>
            </div>
        );
    };

    const renderSplit = (item, index) => (
        <div key={item.id} style={{ borderTop: index > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}>
            {renderRow(item, {
                index: 0,
                title: `${displayName(item)} (Разделено)`,
                parts: [
                    { key: 'account', node: visibleAccounts(item) },
                    ...(displayComment(item) ? [{ key: 'comment', node: displayComment(item) }] : []),
                ],
            })}

            {/* Части разбитой операции. Засеянными 'initial' они не
                бывают, поэтому редактируются всегда. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', paddingLeft: NESTED_INDENT, paddingBottom: 'var(--space-3)' }}>
                {item.items.map(subItem => (
                    <div
                        key={subItem.id}
                        style={{
                            position: 'relative',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            gap: 'var(--space-3)',
                            padding: 'var(--space-1-5) 0 var(--space-1-5) var(--space-3)',
                            fontSize: 'var(--text-base)',
                            cursor: 'pointer',
                            borderLeft: '2px solid var(--color-border-strong)',
                        }}
                    >
                        <RowOverlayButton
                            label={`${displayName(item)} (Разделено): ${rowLabel(subItem)}`}
                            onClick={() => openEditModal(subItem)}
                        />
                        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            <CategoryFilterLink
                                category={subItem.category}
                                selected={selectedCategory === subItem.category}
                                onToggle={toggleCategoryFilter}
                            />
                            {hasCompanyField(item) && subItem.companyName && subItem.companyName !== item.companyName && (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{subItem.companyName}</div>
                            )}
                            {hasCompanyField(item) && !hasCompanyField(subItem) && displayName(subItem) && (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{displayName(subItem)}</div>
                            )}
                            {displayComment(subItem) && displayComment(subItem) !== displayComment(item) && (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>{displayComment(subItem)}</div>
                            )}
                        </div>
                        <div style={{ flexShrink: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', color: MAIN_COLOR }}>
                            {formatMoney(subItem.visualAmount)}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {dates.map(date => {
                const { items, dailySum } = groups[date];
                // Сумма дня, округляющаяся до нуля, - то же, что ноль: плавающая
                // пыль от сложения копеек не должна рисовать «€0,00».
                const showDailySum = Math.round(Math.abs(dailySum) * 100) !== 0;
                return (
                    <div key={date} data-history-date={date} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <div style={DAY_HEADER_STYLE}>
                            <span style={{ color: 'var(--color-text-muted)' }}>{formatDate(date)}</span>
                            {showDailySum && (
                                <span style={{ whiteSpace: 'nowrap', color: dailySum > 0 ? POSITIVE_COLOR : 'var(--color-text-muted)' }}>
                                    {formatMoney(dailySum, { sign: 'auto' })}
                                </span>
                            )}
                        </div>

                        <div style={DAY_CARD_STYLE}>
                            {items.map((item, index) => {
                                if (item.type === 'split_group') return renderSplit(item, index);

                                // openEditModal ничего не делает для засеянных
                                // 'initial' операций, поэтому у них нет и кнопки:
                                // фокусируемый элемент, который на нажатие не
                                // отвечает, хуже его отсутствия.
                                const isEditable = item.type !== 'initial';
                                return renderRow(item, {
                                    index,
                                    title: displayName(item),
                                    parts: subtitleParts(item),
                                    overlay: isEditable && <RowOverlayButton label={rowLabel(item)} onClick={() => openEditModal(item)} />,
                                    faded: item.excludeFromStats,
                                });
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
