/** Pictogrammes du garage V3 : mêmes tracés que ceux du garage Réel et Poly (ui/menu.ts). */
const svg = (d: string, size = 22) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const V3_ICON = {
  tenue: svg('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3Z"/>', 18),
  bike: svg('<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-8h5l3 8M10 8 8 5H6M12 16l-2-8"/>', 18),
  dice: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.1"/><circle cx="15" cy="9" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="9" cy="15" r="1.1"/><circle cx="15" cy="15" r="1.1"/>', 20),
  face: svg('<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1"/><circle cx="15" cy="10" r="1"/><path d="M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>', 18),
};

/** Pictogramme et libellé court de chaque type d'équipement V3, dans l'ordre du garage Réel. */
export const V3_SLOTS: Record<string, { label: string; icon: string }> = {
  CYCLING_JERSEY: { label: 'Maillot', icon: svg('<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.6-2 2.5-4 2.5S8.5 4.6 8 3Z"/>', 26) },
  HEAD_GEAR: { label: 'Casque', icon: svg('<path d="M3 15a9 8 0 0 1 18 0v2H3Z"/><path d="M8 8.5 9.5 15M12 7v8M16 8.5 14.5 15"/><path d="M6 17v2.5M18 17v2.5"/>', 26) },
  GLASSES: { label: 'Lunettes', icon: svg('<path d="M2.5 9.5h19"/><path d="M4 9.5c0 4.5 2 6 4.5 6S11 13 11 10M13 10c0 3 .8 5.5 3.5 5.5S20 14 20 9.5"/>', 26) },
  GLOVES: { label: 'Gants', icon: svg('<path d="M7 21v-8L5.5 9.5c-.5-1.2 1-2 1.8-1L9 11V4.5c0-1.3 2-1.3 2 0V10V3.5c0-1.3 2-1.3 2 0V10V4.5c0-1.3 2-1.3 2 0V11V6.5c0-1.3 2-1.3 2 0V15c0 3.5-2 6-5.5 6Z"/>', 26) },
  SOCKS: { label: 'Chaussettes', icon: svg('<path d="M9 3h6v10l4.5 3c1.5 1 1 4-1.5 4H10c-2 0-2-1.5-2-3Z"/><path d="M9 7h6"/>', 26) },
  CYCLING_SHOES: { label: 'Chaussures', icon: svg('<path d="M3 17v-5l5-1 3 3 8 1.5c1.8.3 2.2 3.5 0 3.5H4a1 1 0 0 1-1-1Z"/><path d="M8 11l1.5 2M12 14l1 2"/>', 26) },
  STREAK_FLAIR: { label: 'Mascotte', icon: svg('<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6L3.4 9.3l6-.7Z"/>', 26) },
  HEAD_TYPE: { label: 'Tête', icon: svg('<circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10.5" r=".9"/><circle cx="15" cy="10.5" r=".9"/><path d="M8.5 15c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8"/>', 26) },
  HAIR: { label: 'Cheveux', icon: svg('<path d="M5 14c0-6 3-9 7-9s7 3 7 9v1c-2-1-3-3-3-5-2 2-6 2-8 0 0 2-1 4-3 5Z"/>', 26) },
  FACIAL_HAIR: { label: 'Barbe', icon: svg('<path d="M6 8c0 6 2 10 6 10s6-4 6-10M9 14c1 1 5 1 6 0"/>', 26) },
};
