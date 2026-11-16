import type { V3Equipment } from './visuals.ts';

/**
 * Les 10 coureurs du film d'accueil en style V3 (tools/menu-loop), dans l'ordre de la formation : Robert en tête
 * (cheveux et moustache gris, maillot jaune du Tour de France, Specialized faute de Lapierre chez Zwift), puis
 * 4 coureuses et 5 coureurs, validés le 16/11/2026. Ni équipement, ni vélo, ni roues (pneus marqués) Zwift ; maillots
 * du Tour de France ou d'équipes pro (dont la tenue UAE 2026 créée pour le V3 ; les « unis » de Zwift portent son logo) ;
 * vélos de course ; pas de barbe ; chaussettes unies noires ou blanches.
 * Identifiants du catalogue local de Zwift (style V3 : développement seulement, rien de distribué).
 */
const SHAVEN = { id: 1670, color: 0 };

export const CINEMATIC_V3: readonly V3Equipment[] = [
  // 1 · Robert : S-Works Tarmac SL8, roues Roval Rapide CLX, Tour de France jaune, Kask Protone.
  { bike: 'sworkstarmacsl82024', color: 0, sex: 'male', sockHeight: 'mid', hairColor: 4, beardColor: 4, wheels: 'roval-rovalrapide',
    kit: { HEAD_TYPE: { id: 1700, color: 0 }, HAIR: { id: 1679, color: 0 }, FACIAL_HAIR: { id: 1671, color: 0 }, CYCLING_JERSEY: { id: 453, color: 0 },
      HEAD_GEAR: { id: 1796, color: 0 }, GLASSES: { id: 1937, color: 0 }, CYCLING_SHOES: { id: 1987, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 2 · Coureuse à côté de Robert : Cervélo S5 2026, Zipp 404, champion du monde (Alpecin-Fenix 2022), Giro Vanquish.
  { bike: 'cervelos52026', color: 0, sex: 'female', sockHeight: 'low', hairColor: 0, beardColor: 0, wheels: 'zipp-zipp-404-firecrest',
    kit: { HEAD_TYPE: { id: 1712, color: 0 }, HAIR: { id: 1693, color: 0 }, CYCLING_JERSEY: { id: 741, color: 0 }, HEAD_GEAR: { id: 1744, color: 0 },
      CYCLING_SHOES: { id: 1965, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 3 · Canyon Aeroad Team Edition, DT Swiss ARC 1100 62, Tour de France blanc, Lazer Vento, Fizik Vento.
  { bike: 'canyonaeroadteamedition', color: 0, sex: 'male', sockHeight: 'low', hairColor: 3, beardColor: 3, wheels: 'dtswiss-arc62',
    kit: { HEAD_TYPE: { id: 1706, color: 0 }, HAIR: { id: 1686, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 452, color: 0 },
      HEAD_GEAR: { id: 1742, color: 0 }, GLASSES: { id: 1927, color: 0 }, CYCLING_SHOES: { id: 1973, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 4 · Coureuse : Pinarello Dogma F 2024, Princeton Wake 6560, Decathlon CMA CGM 2026, Giro Eclipse FDJ.
  { bike: 'pinarellodogmaf2024', color: 0, sex: 'female', sockHeight: 'low', hairColor: 3, beardColor: 3, wheels: 'princetoncarbonworks-wake6560',
    kit: { HEAD_TYPE: { id: 1710, color: 0 }, HAIR: { id: 1698, color: 0 }, CYCLING_JERSEY: { id: 1275, color: 0 }, HEAD_GEAR: { id: 1812, color: 0 },
      GLASSES: { id: 1927, color: 0 }, CYCLING_SHOES: { id: 1965, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 5 · Trek Madone, Bontrager Aeolus 5, Tour de France à pois, Lazer Sphere.
  { bike: 'trekmadone', color: 0, sex: 'male', sockHeight: 'low', hairColor: 1, beardColor: 1, wheels: 'bontrager-aeolus5',
    kit: { HEAD_TYPE: { id: 1703, color: 0 }, HAIR: { id: 1683, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 451, color: 0 },
      HEAD_GEAR: { id: 1907, color: 0 }, GLASSES: { id: 1928, color: 0 }, CYCLING_SHOES: { id: 1986, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 6 · Coureuse : Colnago V3RS, Enve SES 4.5 PRO, UAE Team Emirates XRG 2026 (tenue créée pour le V3), Lazer Sphere.
  { bike: 'colnagov3rs2020', color: 0, sex: 'female', sockHeight: 'low', hairColor: 2, beardColor: 2, wheels: 'enve-enveses4-5pro',
    kit: { HEAD_TYPE: { id: 1711, color: 0 }, HAIR: { id: 1694, color: 0 }, CYCLING_JERSEY: { id: 9001, color: 0 }, HEAD_GEAR: { id: 1907, color: 0 },
      GLASSES: { id: 1934, color: 0 }, CYCLING_SHOES: { id: 1986, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 7 · Cannondale SuperSix Evo 2026, Cadex 42, Tour de France vert, Kask Protone.
  { bike: 'cannondalesupersixevo2026', color: 0, sex: 'male', sockHeight: 'high', hairColor: 0, beardColor: 0, wheels: 'cadex-cadex-42',
    kit: { HEAD_TYPE: { id: 1705, color: 0 }, HAIR: { id: 1681, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 450, color: 0 },
      HEAD_GEAR: { id: 1796, color: 0 }, CYCLING_SHOES: { id: 1964, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 8 · Scott Foil 2022, Shimano Dura-Ace C60, FDJ Suez, Giro Eclipse Canyon SRAM.
  { bike: 'scottfoil2022', color: 0, sex: 'male', sockHeight: 'low', hairColor: 0, beardColor: 0, wheels: 'shimano-shimanoduraacec602026',
    kit: { HEAD_TYPE: { id: 1708, color: 0 }, HAIR: { id: 1679, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 1122, color: 0 },
      HEAD_GEAR: { id: 1813, color: 0 }, CYCLING_SHOES: { id: 1984, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 9 · Coureuse : Felt FR 2022 (coloris 2), Cadex 65, Fenix Deceuninck, S-Works Evade, Giro Imperial.
  { bike: 'feltfr2022', color: 1, sex: 'female', sockHeight: 'high', hairColor: 1, beardColor: 1, wheels: 'cadex-cadex-65',
    kit: { HEAD_TYPE: { id: 1717, color: 0 }, HAIR: { id: 1691, color: 0 }, CYCLING_JERSEY: { id: 1128, color: 0 }, HEAD_GEAR: { id: 1747, color: 0 },
      CYCLING_SHOES: { id: 1982, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 10 · Canyon Aeroad 2025, Reserve 57/64, Movistar 2025, Giro Synthe.
  { bike: 'canyonaeroadmano2025', color: 0, sex: 'male', sockHeight: 'low', hairColor: 2, beardColor: 2, wheels: 'reserve-reserve57',
    kit: { HEAD_TYPE: { id: 1702, color: 0 }, HAIR: { id: 1687, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 1126, color: 0 },
      HEAD_GEAR: { id: 1743, color: 0 }, GLASSES: { id: 1947, color: 0 }, CYCLING_SHOES: { id: 1986, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
];
