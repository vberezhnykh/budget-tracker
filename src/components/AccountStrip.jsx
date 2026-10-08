import { useEffect, useRef } from 'react';
import AccountIcon from './AccountIcon';
import { formatMoney } from '../utils/money';
import './accountThemes.css';
import './AccountStrip.css';

// Лента счетов на Обзоре: «Все счета», затем счета, замороженные в конце
// (порядок задаёт App в slides). Одиночный выбор нажатием, как и раньше;
// прокрутка ленты выбор не меняет - раньше карточка, осевшая по центру,
// выбиралась сама, и пролистать ленту, не сменив счёт, было нельзя.
export default function AccountStrip({ slides, selectedAccount, onSelect }) {
  const rowRef = useRef(null);

  // Выбор могли поменять не нажатием (сброс удалённого счёта, возврат на
  // вкладку): выбранная карточка может оказаться за краем ленты - подводим её
  // в видимую область. 'nearest' - сдвиг ровно на сколько нужно, а при
  // видимой карточке не происходит ничего (нажатие на неё же не дёргает ленту).
  useEffect(() => {
    const selected = rowRef.current?.querySelector('[aria-pressed="true"]');
    selected?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [selectedAccount]);

  return (
    <div ref={rowRef} data-testid="accounts-row" className="account-strip no-scrollbar">
      {slides.map((slide) => {
        const isActive = slide.filter === selectedAccount;
        // Минус только у ушедшего в минус баланса: «−€6.890,00», а не «€-6.890,00».
        const balanceText = formatMoney(slide.amount, { sign: slide.amount < 0 ? 'minus' : 'none' });
        return (
          <button
            key={slide.key}
            type="button"
            className="account-chip"
            data-account-theme={slide.theme}
            aria-pressed={isActive}
            aria-label={slide.note ? `${slide.name}: ${balanceText}, ${slide.note}` : `${slide.name}: ${balanceText}`}
            onClick={() => onSelect(slide)}
          >
            <span className="account-chip__icon" aria-hidden="true">
              <AccountIcon icon={slide.icon} type={slide.type} size={18} />
            </span>
            <span className="account-chip__name">{slide.name}</span>
            <span className="account-chip__balance">{balanceText}</span>
            {slide.note && <span className="account-chip__note">{slide.note}</span>}
          </button>
        );
      })}
    </div>
  );
}
