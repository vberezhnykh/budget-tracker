import { useState } from 'react';
import {
  ArrowDownLeft, ArrowLeftRight, BookOpen, BusFront, CarFront, Clapperboard,
  Dumbbell, Flag, Gift, HeartPulse, House, Layers2, PawPrint, Plane,
  ReceiptText, Scissors, Shirt, ShoppingBag, ShoppingBasket, Smartphone,
  Utensils, Wifi, Wrench,
} from 'lucide-react';
import { resolveTransactionFallbackIcon } from '../utils/transactionIcons';
import { getTransactionLogoUrl } from '../utils/logoDev';
import './TransactionIcon.css';

// Local SVGs remain in assets/merchants for later use, but are deliberately
// not imported: merchant logos now come exclusively from Logo.dev.

const CATEGORY_ICONS = {
  groceries: [ShoppingBasket, 'green'], dining: [Utensils, 'orange'],
  taxi: [CarFront, 'amber'], car: [CarFront, 'blue'], transport: [BusFront, 'blue'],
  entertainment: [Clapperboard, 'purple'], clothing: [Shirt, 'pink'],
  shopping: [ShoppingBag, 'purple'], beauty: [Scissors, 'teal'],
  health: [HeartPulse, 'rose'], home: [House, 'blue'], pets: [PawPrint, 'orange'],
  services: [Wrench, 'slate'], travel: [Plane, 'blue'],
  subscriptions: [Smartphone, 'purple'], education: [BookOpen, 'amber'],
  sports: [Dumbbell, 'green'], gifts: [Gift, 'pink'], bills: [Wifi, 'teal'],
  other: [ReceiptText, 'slate'],
};

const TYPE_ICONS = {
  initial: [Flag, 'blue'], transfer: [ArrowLeftRight, 'blue'],
  income: [ArrowDownLeft, 'green'], split_group: [Layers2, 'blue'],
};

function RemoteTransactionIcon({ logoUrl, kind, id }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [Icon, tone] = (kind === 'type' ? TYPE_ICONS[id] : CATEGORY_ICONS[id]) || CATEGORY_ICONS.other;

  return (
    <span
      className={`transaction-icon${loaded ? ' transaction-icon--remote' : ''}`}
      data-transaction-icon={id}
      data-tone={loaded ? undefined : tone}
      data-logo-state={loaded ? 'loaded' : failed ? 'error' : logoUrl ? 'loading' : 'disabled'}
      aria-hidden="true"
    >
      {!loaded && <Icon size={20} strokeWidth={1.8} focusable="false" />}
      {logoUrl && !failed && (
        <img
          className="transaction-icon__remote-image"
          src={logoUrl}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          referrerPolicy="origin"
          onLoad={() => setLoaded(true)}
          onError={() => { setLoaded(false); setFailed(true); }}
        />
      )}
    </span>
  );
}

export default function TransactionIcon({ item }) {
  const { kind, id } = resolveTransactionFallbackIcon(item);
  const logoUrl = getTransactionLogoUrl(item);
  // Changing the merchant/key remounts only the avatar, so an old response
  // cannot reveal a stale logo after editing or reusing a transaction row.
  return <RemoteTransactionIcon key={logoUrl || 'category'} logoUrl={logoUrl} kind={kind} id={id} />;
}
