import { Fragment, useLayoutEffect, useRef, useState } from 'react';
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
function RowOverlayButton({ label, onClick, inactive = false }) {
    return (
        <button
            type="button"
            aria-label={label}
            // Строка уходит из списка: до фокуса клавиатурой ей уже не должно быть дела.
            tabIndex={inactive ? -1 : undefined}
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
function CategoryFilterLink({ category, selected, onToggle, inactive = false }) {
    if (!onToggle) return <span>{category}</span>;
    return (
        <span
            role="button"
            tabIndex={inactive ? -1 : 0}
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

// Карточка дня со свежей строкой: голубая подсветка строки тянется на всю
// ширину карточки (за её внутренний отступ), и скруглённые углы карточки
// должны её обрезать.
const DAY_CARD_CLIPPED_STYLE = { ...DAY_CARD_STYLE, overflow: 'hidden' };

const ENTER_MS = 240;
const ENTER_EASING = 'cubic-bezier(.2,.8,.2,1)';
const LEAVE_EASING = 'ease-in';

// Свёрнутая строка: ни высоты, ни отступов, ни рамки. Шорткаты (padding,
// borderTop) заданы теми же шорткатами, что у самой строки, - иначе React при
// перерисовке ругается на смесь шортката и его части. Отрицательный нижний
// отступ у блока дня съедает зазор списка между днями.
const COLLAPSED_STYLE = { height: 0, padding: 0, borderTop: 'none', opacity: 0, overflow: 'hidden' };
const COLLAPSED_DAY_STYLE = { ...COLLAPSED_STYLE, marginBottom: 'calc(-1 * var(--space-4))' };

const prefersReducedMotion = () => Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
// Без движения: «уменьшить движение» в системе или нет Web Animations.
const motionOff = () => !canAnimate() || prefersReducedMotion();

// Кадры «раскрыто» и «свёрнуто» одного элемента по его нынешним размерам (в CSS
// «auto» не анимируется). gap - зазор списка под блоком дня: пока блок
// сворачивается, его отрицательный нижний отступ съедает и этот зазор.
function measureFrames(element, withGap) {
    const style = getComputedStyle(element);
    const opacity = parseFloat(style.opacity);
    const open = {
        height: `${element.getBoundingClientRect().height}px`,
        paddingTop: style.paddingTop,
        paddingBottom: style.paddingBottom,
        opacity: Number.isFinite(opacity) ? opacity : 1,
        overflow: 'hidden',
    };
    const closed = { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, overflow: 'hidden' };
    if (style.borderTopWidth) {
        open.borderTopWidth = style.borderTopWidth;
        closed.borderTopWidth = '0px';
    }
    if (withGap) {
        const gap = parseFloat(getComputedStyle(element.parentElement).rowGap) || 0;
        open.marginBottom = '0px';
        closed.marginBottom = `${-gap}px`;
    }
    return { open, closed };
}

// Движение блока списка (строки, разбитой покупки или целого дня): появление
// при монтировании (enter), сворачивание, когда блок уходит (leaving), и рост
// обратно, когда уход отменён.
//
// Сворачивание: высота, отступы и прозрачность до нуля за ENTER_MS, затем блок
// остаётся свёрнутым - сначала заливкой анимации (fill: 'forwards'), а когда она
// дошла до конца, стилем из COLLAPSED_STYLE (collapsed). Так свёрнутое
// переживает и перерисовки, и отмену анимации; когда настоящий список пришёл
// без блока, он просто размонтируется уже свёрнутым и ничего не двигает. Блок,
// который в списке уже при монтировании уходящим (экран открыли, пока удаление
// не подтверждено), сразу свёрнут, без анимации. «Уменьшить движение»: блок
// прячется и возвращается мгновенно.
//
// own - сворачивается ли блок сам. Если уходят все строки дня, сворачивается
// день целиком, а его строки только значатся уходящими (own = false): иначе
// строки и день двигались бы друг в друге. Свёрнутость, уже случившаяся у
// строки, при этом не снимается. Возвращаясь, блок растёт, только если до этого
// сворачивался сам.
//
// returns растёт с каждым возвращением блока - по нему EnterBox заново
// зажигает подсветку.
function useBlockMotion(ref, { enter = false, leaving = false, own = leaving, withGap = false }) {
    const [enterOnMount] = useState(enter && !leaving);
    const animationRef = useRef(null);
    // Блок уже свёрнут или сворачивается; при монтировании уходящим - свёрнут.
    const collapsedRef = useRef(leaving);
    const [seen, setSeen] = useState(leaving);
    const [returns, setReturns] = useState(0);
    // Анимация сворачивания дошла до конца; уходящий при монтировании - сразу.
    const [finished, setFinished] = useState(leaving);

    // Возвращение замечается при рендере (как в DayCard): «свёрнуто» сбрасывается
    // до того, как слой-эффект снимет заливку анимации и вырастит блок.
    if (seen !== leaving) {
        setSeen(leaving);
        if (!leaving) {
            setFinished(false);
            setReturns(count => count + 1);
        }
    }

    // Появление при монтировании.
    useLayoutEffect(() => {
        const element = ref.current;
        if (!enterOnMount || !element || motionOff()) return undefined;
        const { open, closed } = measureFrames(element, withGap);
        const animation = element.animate([closed, open], { duration: ENTER_MS, easing: ENTER_EASING });
        animationRef.current = animation;
        return () => animation.cancel();
    }, [enterOnMount, ref, withGap]);

    // Уход и возвращение. Недоигравшая анимация снимается до измерения: иначе
    // замерилась бы промежуточная высота.
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return;
        if (!leaving) {
            if (!collapsedRef.current) return;
            collapsedRef.current = false;
            animationRef.current?.cancel();
            animationRef.current = null;
            if (motionOff()) return;
            const { open, closed } = measureFrames(element, withGap);
            animationRef.current = element.animate([closed, open], { duration: ENTER_MS, easing: ENTER_EASING });
        } else if (own && !collapsedRef.current) {
            collapsedRef.current = true;
            animationRef.current?.cancel();
            animationRef.current = null;
            // Без движения свёрнутость даёт стиль (collapsed ниже).
            if (motionOff()) return;
            const { open, closed } = measureFrames(element, withGap);
            const animation = element.animate([open, closed], { duration: ENTER_MS, easing: LEAVE_EASING, fill: 'forwards' });
            animation.onfinish = () => setFinished(true);
            animationRef.current = animation;
        }
    }, [leaving, own, withGap, ref]);

    return { collapsed: leaving && (finished || (own && motionOff())), returns };
}

// Строка (или разбитая покупка). Появляется плавно, если она только что
// сохранена и показана до ответа сервера: высота растёт от нуля до своей, пока
// проступает прозрачность, а за строкой на всю ширину карточки светится голубая
// подсветка (TransactionList.css) и гаснет. Уходит плавным сворачиванием, если
// её удалили, а список ещё без ответа сервера, и тем же ростом с подсветкой
// возвращается, если удаление отменили (useBlockMotion).
//
// Появление - только при монтировании: `entering` запоминается один раз, и
// когда настоящий список подменяет строку (тот же key, но fresh уже нет),
// элемент остаётся тем же, подсветка доигрывает, а рост не повторяется.
// Поэтому и разметка строки не зависит от текущего fresh. Рост - через Web
// Animations на измеренной высоте (в CSS «auto» не анимируется); overflow:
// hidden действует только пока он идёт, чтобы не срезать кольцо фокуса.
// Подсветка живёт на обёртке вокруг строки, а не на ней самой: иначе
// overflow: hidden на время роста срезал бы её по ширине строки. Обёртка
// появляется у строки с самого начала, если она свежая или список следит за
// уходящими (tracked): добавить её позже значило бы пересоздать строку.
// При «уменьшить движение» рост и прозрачность пропускаются, остаётся только
// плавное угасание цвета.
// Уходящая строка недоступна: inert и aria-hidden - ни Tab, ни скринридер.
function EnterBox({ fresh = false, leaving = false, own = leaving, tracked = false, children, style, ...props }) {
    const [entering] = useState(fresh);
    const [wrapped] = useState(fresh || tracked);
    const ref = useRef(null);
    const { collapsed, returns } = useBlockMotion(ref, { enter: entering, leaving, own });

    const row = (
        <div
            ref={ref}
            {...props}
            style={collapsed ? { ...style, ...COLLAPSED_STYLE } : style}
            inert={leaving || undefined}
            aria-hidden={leaving || undefined}
        >
            {children}
        </div>
    );
    if (!wrapped) return row;
    const tinted = (entering || returns > 0) && !leaving;
    return (
        <div className={tinted ? 'tx-fresh' : undefined}>
            {tinted && <span key={returns} className="tx-fresh-glow" aria-hidden="true" />}
            {row}
        </div>
    );
}

// День целиком: заголовок с суммой и карточка. Если уходят все его строки,
// сворачивается весь блок, а не карточка с пустым заголовком.
function DayBlock({ date, leaving, children }) {
    const ref = useRef(null);
    const { collapsed } = useBlockMotion(ref, { leaving, withGap: true });
    return (
        <div
            ref={ref}
            data-history-date={date}
            inert={leaving || undefined}
            aria-hidden={leaving || undefined}
            style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...(collapsed ? COLLAPSED_DAY_STYLE : null) }}
        >
            {children}
        </div>
    );
}

// Карточка дня. Обрезка по скруглению включается, когда в ней появилась
// свежая или уходящая строка, и остаётся до конца жизни карточки: если снять её,
// когда настоящий список подменил строку, подсветка, не догоревшая до конца,
// выскочила бы за углы.
function DayCard({ hasFresh, children }) {
    const [clipped, setClipped] = useState(hasFresh);
    if (hasFresh && !clipped) setClipped(true);
    return (
        <div className={clipped ? 'tx-day-clipped' : undefined} style={clipped ? DAY_CARD_CLIPPED_STYLE : DAY_CARD_STYLE}>
            {children}
        </div>
    );
}

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
    // Необязательный: Set с id строк, только что вставленных до ответа сервера
    // (блок «Последние операции»). Эти строки появляются с анимацией. В Истории
    // не передаётся, и список ведёт себя как раньше.
    freshIds = null,
    // Необязательный: Set с id строк, которые только что удалены, а список ещё
    // без ответа сервера (в нём они остаются). Эти строки плавно сворачиваются и
    // остаются свёрнутыми и недоступными; день, где уходят все строки, - целиком.
    // Вернулись из Set (удаление отменили) - растут обратно с подсветкой. Без
    // него список ведёт себя как раньше.
    leavingIds = null,
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
    const subtitleParts = (item, leaving = false) => {
        const parts = [];
        if (item.category && item.category !== selectedCategory) {
            parts.push({
                key: 'category',
                node: <CategoryFilterLink category={item.category} selected={false} onToggle={toggleCategoryFilter} inactive={leaving} />,
            });
        }
        parts.push({ key: 'account', node: visibleAccounts(item) });
        if (displayComment(item)) parts.push({ key: 'comment', node: displayComment(item) });
        return parts;
    };

    // Строка-карточка (обычная операция и «шапка» разбитой): иконка,
    // название с подписью, сумма. Кнопка-подложка только у редактируемых.
    const renderRow = (item, { index, title, parts, overlay, faded, fresh = false, leaving = false, own = leaving }) => {
        const { text, color } = amountFor(item);
        return (
            <EnterBox
                key={item.id}
                fresh={fresh}
                leaving={leaving}
                own={own}
                tracked={Boolean(leavingIds)}
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
            </EnterBox>
        );
    };

    const renderSplit = (item, index, { leaving, own }) => (
        <EnterBox
            key={item.id}
            fresh={Boolean(freshIds?.has(item.id))}
            leaving={leaving}
            own={own}
            tracked={Boolean(leavingIds)}
            style={{ borderTop: index > 0 ? '1px solid var(--color-border-subtle)' : 'none' }}
        >
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
                            inactive={leaving}
                        />
                        <div style={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                            <CategoryFilterLink
                                category={subItem.category}
                                selected={selectedCategory === subItem.category}
                                onToggle={toggleCategoryFilter}
                                inactive={leaving}
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
        </EnterBox>
    );

    const isLeaving = item => Boolean(leavingIds?.has(item.id));

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {dates.map(date => {
                const { items, dailySum } = groups[date];
                // Сумма дня, округляющаяся до нуля, - то же, что ноль: плавающая
                // пыль от сложения копеек не должна рисовать «€0,00».
                const showDailySum = Math.round(Math.abs(dailySum) * 100) !== 0;
                // Уходят все строки дня - сворачивается день целиком, строки
                // только значатся уходящими.
                const dayLeaving = items.length > 0 && items.every(isLeaving);
                // Первая из остающихся строк без разделителя сверху, даже если
                // выше неё ещё сворачивается другая: так нет линии у края карточки.
                let staying = 0;
                return (
                    <DayBlock key={date} date={date} leaving={dayLeaving}>
                        <div style={DAY_HEADER_STYLE}>
                            <span style={{ color: 'var(--color-text-muted)' }}>{formatDate(date)}</span>
                            {showDailySum && (
                                <span style={{ whiteSpace: 'nowrap', color: dailySum > 0 ? POSITIVE_COLOR : 'var(--color-text-muted)' }}>
                                    {formatMoney(dailySum, { sign: 'auto' })}
                                </span>
                            )}
                        </div>

                        <DayCard hasFresh={(Boolean(freshIds) && items.some(item => freshIds.has(item.id))) || items.some(isLeaving)}>
                            {items.map((item, position) => {
                                const leaving = isLeaving(item);
                                const own = leaving && !dayLeaving;
                                const index = leaving ? position : staying++;
                                if (item.type === 'split_group') return renderSplit(item, index, { leaving, own });

                                // openEditModal ничего не делает для засеянных
                                // 'initial' операций, поэтому у них нет и кнопки:
                                // фокусируемый элемент, который на нажатие не
                                // отвечает, хуже его отсутствия.
                                const isEditable = item.type !== 'initial';
                                return renderRow(item, {
                                    index,
                                    title: displayName(item),
                                    parts: subtitleParts(item, leaving),
                                    overlay: isEditable && <RowOverlayButton label={rowLabel(item)} onClick={() => openEditModal(item)} inactive={leaving} />,
                                    faded: item.excludeFromStats,
                                    fresh: Boolean(freshIds?.has(item.id)),
                                    leaving,
                                    own,
                                });
                            })}
                        </DayCard>
                    </DayBlock>
                );
            })}
        </div>
    );
}
