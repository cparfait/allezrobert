/**
 * Nationalités proposées sur la fiche du coureur (code ISO 3166-1 alpha-2) : drapeau et nom
 * affichés dans « À proximité », le classement des courses et la salle d'attente.
 * Liste des nations de cyclisme et des pays d'origine les plus probables des joueurs.
 */
export interface Country {
  code: string;
  fr: string;
  en: string;
}

export const COUNTRIES: readonly Country[] = [
  { code: 'FR', fr: 'France', en: 'France' },
  { code: 'BE', fr: 'Belgique', en: 'Belgium' },
  { code: 'CH', fr: 'Suisse', en: 'Switzerland' },
  { code: 'LU', fr: 'Luxembourg', en: 'Luxembourg' },
  { code: 'CA', fr: 'Canada', en: 'Canada' },
  { code: 'ES', fr: 'Espagne', en: 'Spain' },
  { code: 'IT', fr: 'Italie', en: 'Italy' },
  { code: 'PT', fr: 'Portugal', en: 'Portugal' },
  { code: 'DE', fr: 'Allemagne', en: 'Germany' },
  { code: 'NL', fr: 'Pays-Bas', en: 'Netherlands' },
  { code: 'GB', fr: 'Royaume-Uni', en: 'United Kingdom' },
  { code: 'IE', fr: 'Irlande', en: 'Ireland' },
  { code: 'DK', fr: 'Danemark', en: 'Denmark' },
  { code: 'NO', fr: 'Norvège', en: 'Norway' },
  { code: 'SE', fr: 'Suède', en: 'Sweden' },
  { code: 'FI', fr: 'Finlande', en: 'Finland' },
  { code: 'PL', fr: 'Pologne', en: 'Poland' },
  { code: 'CZ', fr: 'Tchéquie', en: 'Czechia' },
  { code: 'AT', fr: 'Autriche', en: 'Austria' },
  { code: 'SI', fr: 'Slovénie', en: 'Slovenia' },
  { code: 'HR', fr: 'Croatie', en: 'Croatia' },
  { code: 'GR', fr: 'Grèce', en: 'Greece' },
  { code: 'RO', fr: 'Roumanie', en: 'Romania' },
  { code: 'UA', fr: 'Ukraine', en: 'Ukraine' },
  { code: 'US', fr: 'États-Unis', en: 'United States' },
  { code: 'MX', fr: 'Mexique', en: 'Mexico' },
  { code: 'CO', fr: 'Colombie', en: 'Colombia' },
  { code: 'EC', fr: 'Équateur', en: 'Ecuador' },
  { code: 'BR', fr: 'Brésil', en: 'Brazil' },
  { code: 'AR', fr: 'Argentine', en: 'Argentina' },
  { code: 'AU', fr: 'Australie', en: 'Australia' },
  { code: 'NZ', fr: 'Nouvelle-Zélande', en: 'New Zealand' },
  { code: 'JP', fr: 'Japon', en: 'Japan' },
  { code: 'CN', fr: 'Chine', en: 'China' },
  { code: 'ZA', fr: 'Afrique du Sud', en: 'South Africa' },
  { code: 'MA', fr: 'Maroc', en: 'Morocco' },
  { code: 'DZ', fr: 'Algérie', en: 'Algeria' },
  { code: 'TN', fr: 'Tunisie', en: 'Tunisia' },
  { code: 'SN', fr: 'Sénégal', en: 'Senegal' },
  { code: 'ER', fr: 'Érythrée', en: 'Eritrea' },
];

export const COUNTRY_CODE_RE = /^[A-Z]{2}$/;

/** Drapeau (émoji) d'un code pays ; chaîne vide si le code est invalide. */
export function flagEmoji(code: string | undefined): string {
  if (!code || !COUNTRY_CODE_RE.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function countryName(code: string | undefined, lang: 'fr' | 'en'): string {
  return COUNTRIES.find((c) => c.code === code)?.[lang] ?? '';
}
