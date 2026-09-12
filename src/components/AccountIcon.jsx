import {
  Banknote, BriefcaseBusiness, Coins, CreditCard, House,
  Landmark, LockKeyhole, PiggyBank, Vault, Wallet,
} from 'lucide-react';
import { resolveAccountIcon } from '../utils/accountIcons';
import './AccountIcon.css';

const ACCOUNT_ICONS = {
  'credit-card': CreditCard,
  banknote: Banknote,
  wallet: Wallet,
  landmark: Landmark,
  'piggy-bank': PiggyBank,
  vault: Vault,
  coins: Coins,
  'briefcase-business': BriefcaseBusiness,
  house: House,
  'lock-keyhole': LockKeyhole,
};

export default function AccountIcon({ icon, type, size = 20, strokeWidth = 1.8, className = '', ...props }) {
  const resolved = resolveAccountIcon(icon, type);
  const Icon = ACCOUNT_ICONS[resolved];
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      {...props}
      className={`account-icon ${className}`.trim()}
      data-account-icon={resolved}
      aria-hidden="true"
      focusable="false"
    />
  );
}
