import { strings } from '../i18n/index.ts';

const S = strings(
  { leisure: 'loisir', regular: 'régulier', sporty: 'sportif', pro: 'pro', rpm: 'tr/min' },
  { leisure: 'leisure', regular: 'regular', sporty: 'sporty', pro: 'pro', rpm: 'rpm' },
);

/**
 * Niveau d'un coureur d'après sa FTP rapportée au poids, sur la même échelle que les cyclistes croisés
 * (world/cyclists.ts : loisir, régulier, sportif, pro), pour la liste « À proximité ».
 */
export function levelOfFtpWkg(wkg: number): string {
  if (!(wkg > 0)) return '';
  if (wkg < 2.2) return S('leisure');
  if (wkg < 3.2) return S('regular');
  if (wkg < 4.2) return S('sporty');
  return S('pro');
}

/** Cadence affichée : « 88 tr/min » (« rpm » en anglais), rien quand on ne pédale pas ou qu'elle est inconnue. */
export function cadenceLabel(rpm: number | undefined): string {
  if (rpm === undefined || !(rpm > 0)) return '';
  return `${Math.round(rpm)} ${S('rpm')}`;
}
