import type { V3Equipment } from './visuals.ts';

/**
 * Les 10 coureurs du film d'accueil en style V3 (tools/menu-loop), dans l'ordre de la formation : Robert en tête
 * (cheveux et moustache gris, maillot jaune du Tour de France, vélo Specialized), puis
 * 4 coureuses et 5 coureurs, validés le 16/11/2026. Équipement, vélos et roues choisis sans marquage du catalogue ; maillots
 * du Tour de France ou d'équipes pro (dont la tenue UAE 2026 créée pour le V3 ; les maillots unis du catalogue portent un logo) ;
 * vélos de course ; pas de barbe ; chaussettes unies noires ou blanches.
 * Identifiants du catalogue Bêta.
 */
const SHAVEN = { id: 1670, color: 0 };

export const CINEMATIC_V3: readonly V3Equipment[] = [
  // 1 · Robert : S-Works Tarmac SL8, roues Roval Rapide CLX, Tour de France jaune, Kask Protone.
  //     Cheveux et moustache gris imposés par une teinte libre (la case grise n° 4 seule sortait brun foncé) ; tempes grises sous le casque.
  { bike: 'sworkstarmacsl82024', color: 0, sex: 'male', sockHeight: 'mid', hairColor: 4, beardColor: 4, hairTint: '#ffffff', beardTint: '#c9c6c0',
    wheels: 'roval-rovalrapide',
    kit: { HEAD_TYPE: { id: 1700, color: 0 }, HAIR: { id: 1679, color: 0 }, FACIAL_HAIR: { id: 1671, color: 0 }, CYCLING_JERSEY: { id: 453, color: 0 },
      HEAD_GEAR: { id: 1796, color: 0 }, GLASSES: { id: 1937, color: 0 }, CYCLING_SHOES: { id: 1987, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 2 · Coureuse à côté de Robert : Cervélo S5 2026, Zipp 404, champion du monde (Alpecin-Fenix 2022), Oakley
  //     Velo Mach noir et POC Clarity foncées (le Giro Vanquish rouge avait une visière rouge intégrée, sans autre coloris).
  { bike: 'cervelos52026', color: 0, sex: 'female', sockHeight: 'low', hairColor: 0, beardColor: 0, wheels: 'zipp-zipp-404-firecrest',
    kit: { HEAD_TYPE: { id: 1712, color: 0 }, HAIR: { id: 1693, color: 0 }, CYCLING_JERSEY: { id: 741, color: 0 }, HEAD_GEAR: { id: 1887, color: 0 },
      GLASSES: { id: 1937, color: 0 }, CYCLING_SHOES: { id: 1965, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // Pas de lunettes rouges (on ne distingue plus le coureur, demande du 22/11/2026) : les 1927 rosées des
  // coureurs 3 et 4 et les Goodr 1934 rosées de la coureuse 6 remplacées par les 1928 bleues. Coureur 3 : coiffure
  // 1686 (mèches en pointes) refusée le 23/11/2026, coupe courte 1681 à la place. Moins de peaux foncées (demande
  // du 23/11/2026) : têtes 1706 (coureur 3), 1708 (coureur 8) et 1702 (coureur 10) remplacées par 1703, 1700 et 1703.
  // Casques de plusieurs couleurs (demande du 23/11/2026, aucun rouge) : noirs Oakley (2, 3), noir à pois HJC (7),
  // rose POC (6), blanc et or Ekoi (9), Abus Movistar (10, à la place du Giro Synthe rouge).
  // 3 · Canyon Aeroad Team Edition, DT Swiss ARC 1100 62, Tour de France blanc, Oakley Velo Stelvio noir, Fizik Vento.
  { bike: 'canyonaeroadteamedition', color: 0, sex: 'male', sockHeight: 'low', hairColor: 3, beardColor: 3, wheels: 'dtswiss-arc62',
    kit: { HEAD_TYPE: { id: 1703, color: 0 }, HAIR: { id: 1681, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 452, color: 0 },
      HEAD_GEAR: { id: 1898, color: 0 }, GLASSES: { id: 1928, color: 0 }, CYCLING_SHOES: { id: 1973, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 4 · Coureuse : Pinarello Dogma F 2024, Princeton Wake 6560, Decathlon CMA CGM 2026, Giro Eclipse FDJ.
  { bike: 'pinarellodogmaf2024', color: 0, sex: 'female', sockHeight: 'low', hairColor: 3, beardColor: 3, wheels: 'princetoncarbonworks-wake6560',
    kit: { HEAD_TYPE: { id: 1710, color: 0 }, HAIR: { id: 1698, color: 0 }, CYCLING_JERSEY: { id: 1275, color: 0 }, HEAD_GEAR: { id: 1812, color: 0 },
      GLASSES: { id: 1928, color: 0 }, CYCLING_SHOES: { id: 1965, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 5 · Trek Madone, Bontrager Aeolus 5, Tour de France à pois, Lazer Sphere.
  { bike: 'trekmadone', color: 0, sex: 'male', sockHeight: 'low', hairColor: 1, beardColor: 1, wheels: 'bontrager-aeolus5',
    kit: { HEAD_TYPE: { id: 1703, color: 0 }, HAIR: { id: 1683, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 451, color: 0 },
      HEAD_GEAR: { id: 1907, color: 0 }, GLASSES: { id: 1928, color: 0 }, CYCLING_SHOES: { id: 1986, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 6 · Coureuse : Colnago V3RS, Enve SES 4.5 PRO, UAE Team Emirates XRG 2026 (tenue créée pour le V3), POC Ventral rose.
  { bike: 'colnagov3rs2020', color: 0, sex: 'female', sockHeight: 'low', hairColor: 2, beardColor: 2, wheels: 'enve-enveses4-5pro',
    kit: { HEAD_TYPE: { id: 1711, color: 0 }, HAIR: { id: 1694, color: 0 }, CYCLING_JERSEY: { id: 9001, color: 0 }, HEAD_GEAR: { id: 1780, color: 0 },
      GLASSES: { id: 1928, color: 0 }, CYCLING_SHOES: { id: 1986, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 7 · Cannondale SuperSix Evo 2026, Cadex 42, Tour de France vert, HJC Furion noir à pois.
  { bike: 'cannondalesupersixevo2026', color: 0, sex: 'male', sockHeight: 'high', hairColor: 0, beardColor: 0, wheels: 'cadex-cadex-42',
    kit: { HEAD_TYPE: { id: 1705, color: 0 }, HAIR: { id: 1681, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 450, color: 0 },
      HEAD_GEAR: { id: 1794, color: 0 }, CYCLING_SHOES: { id: 1964, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 8 · Scott Foil 2022, Shimano Dura-Ace C60, FDJ Suez, Giro Eclipse Canyon SRAM.
  { bike: 'scottfoil2022', color: 0, sex: 'male', sockHeight: 'low', hairColor: 0, beardColor: 0, wheels: 'shimano-shimanoduraacec602026',
    kit: { HEAD_TYPE: { id: 1700, color: 0 }, HAIR: { id: 1679, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 1122, color: 0 },
      HEAD_GEAR: { id: 1813, color: 0 }, CYCLING_SHOES: { id: 1984, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
  // 9 · Coureuse : Felt FR 2022 (coloris 2), Cadex 65, Fenix Deceuninck, Ekoi blanc et or, Giro Imperial.
  { bike: 'feltfr2022', color: 1, sex: 'female', sockHeight: 'high', hairColor: 1, beardColor: 1, wheels: 'cadex-cadex-65',
    kit: { HEAD_TYPE: { id: 1717, color: 0 }, HAIR: { id: 1691, color: 0 }, CYCLING_JERSEY: { id: 1128, color: 0 }, HEAD_GEAR: { id: 1893, color: 0 },
      CYCLING_SHOES: { id: 1982, color: 0 }, SOCKS: { id: 2037, color: 0 } } },
  // 10 · Canyon Aeroad 2025, Reserve 57/64, Movistar 2025, Abus GameChanger Movistar.
  { bike: 'canyonaeroadmano2025', color: 0, sex: 'male', sockHeight: 'low', hairColor: 2, beardColor: 2, wheels: 'reserve-reserve57',
    kit: { HEAD_TYPE: { id: 1703, color: 0 }, HAIR: { id: 1687, color: 0 }, FACIAL_HAIR: SHAVEN, CYCLING_JERSEY: { id: 1126, color: 0 },
      HEAD_GEAR: { id: 1802, color: 0 }, GLASSES: { id: 1947, color: 0 }, CYCLING_SHOES: { id: 1986, color: 0 }, SOCKS: { id: 2046, color: 0 } } },
];
