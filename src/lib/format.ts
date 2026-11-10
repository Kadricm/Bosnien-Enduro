import { t, type Lang } from '../i18n';

export const eur = (n: number, lang: Lang = 'de') =>
  n.toLocaleString(t(lang).locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};

export const weekday = (iso: string, lang: Lang = 'de') => t(lang).weekdays[new Date(iso + 'T12:00:00Z').getUTCDay()];
