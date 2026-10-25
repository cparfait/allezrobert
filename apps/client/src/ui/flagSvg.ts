/**
 * Drapeaux en SVG (Windows n'affiche pas les drapeaux en émoji) : dessins simplifiés des nations
 * proposées par `COUNTRIES` (packages/shared/src/countries.ts), en 3 : 2. Aucune image externe.
 */
const W = 30;
const H = 20;

const rect = (x: number, y: number, w: number, h: number, fill: string) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
const circle = (cx: number, cy: number, r: number, fill: string) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
const poly = (pts: string, fill: string) => `<polygon points="${pts}" fill="${fill}"/>`;

/** Bandes horizontales de poids donnés. */
function hs(colors: string[], weights = colors.map(() => 1)): string {
  const total = weights.reduce((a, b) => a + b, 0);
  let y = 0;
  return colors.map((c, i) => {
    const h = ((weights[i] as number) / total) * H;
    const out = rect(0, y, W, h + 0.05, c);
    y += h;
    return out;
  }).join('');
}

/** Bandes verticales de poids donnés. */
function vs(colors: string[], weights = colors.map(() => 1)): string {
  const total = weights.reduce((a, b, i) => a + b, 0);
  let x = 0;
  return colors.map((c, i) => {
    const w = ((weights[i] as number) / total) * W;
    const out = rect(x, 0, w + 0.05, H, c);
    x += w;
    return out;
  }).join('');
}

/** Étoile à 5 branches. */
function star(cx: number, cy: number, r: number, fill: string, rot = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = ((rot + i * 36) * Math.PI) / 180;
    const rr = i % 2 ? r * 0.382 : r;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return poly(pts.join(' '), fill);
}

/** Croix nordique : bandes horizontale et verticale décalées vers le mât. */
function nordic(bg: string, cross: string, inner?: string): string {
  const x = 9;
  const y = 8;
  return rect(0, 0, W, H, bg) + rect(x - 2, 0, 4, H, cross) + rect(0, y - 2, W, 4, cross) + (inner ? rect(x - 1, 0, 2, H, inner) + rect(0, y - 1, W, 2, inner) : '');
}

const unionJack = (x = 0, y = 0, w = W, h = H): string =>
  `<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 60 40" preserveAspectRatio="none"><rect width="60" height="40" fill="#012169"/><path d="M0 0 60 40M60 0 0 40" stroke="#fff" stroke-width="8"/><path d="M0 0 60 40M60 0 0 40" stroke="#C8102E" stroke-width="3"/><path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="13"/><path d="M30 0v40M0 20h60" stroke="#C8102E" stroke-width="8"/></svg>`;

const FLAGS: Record<string, string> = {
  FR: vs(['#0055A4', '#fff', '#EF4135']),
  BE: vs(['#000', '#FAE042', '#ED2939']),
  CH: rect(0, 0, W, H, '#DA291C') + rect(13, 4, 4, 12, '#fff') + rect(9, 8, 12, 4, '#fff'),
  LU: hs(['#ED2939', '#fff', '#00A1DE']),
  CA: vs(['#D52B1E', '#fff', '#D52B1E'], [1, 2, 1]) + poly('15,4 16.8,8.4 20.5,7.2 18.2,10.6 20,12 15.8,12 15.8,16 14.2,16 14.2,12 10,12 11.8,10.6 9.5,7.2 13.2,8.4', '#D52B1E'),
  ES: hs(['#AA151B', '#F1BF00', '#AA151B'], [1, 2, 1]),
  IT: vs(['#009246', '#fff', '#CE2B37']),
  PT: vs(['#006600', '#FF0000'], [2, 3]) + circle(12, 10, 3.4, '#FFE000') + circle(12, 10, 2, '#FF0000'),
  DE: hs(['#000', '#DD0000', '#FFCE00']),
  NL: hs(['#AE1C28', '#fff', '#21468B']),
  GB: unionJack(),
  IE: vs(['#169B62', '#fff', '#FF883E']),
  DK: nordic('#C8102E', '#fff'),
  NO: nordic('#BA0C2F', '#fff', '#00205B'),
  SE: nordic('#006AA7', '#FECC02'),
  FI: nordic('#fff', '#003580'),
  PL: hs(['#fff', '#DC143C']),
  CZ: hs(['#fff', '#D7141A']) + poly('0,0 15,10 0,20', '#11457E'),
  AT: hs(['#ED2939', '#fff', '#ED2939']),
  SI: hs(['#fff', '#005DA4', '#ED1C24']) + rect(5, 3, 5, 6, '#005DA4') + rect(5.8, 3.8, 3.4, 4.4, '#fff'),
  HR: hs(['#FF0000', '#fff', '#171796']) + rect(12.5, 7, 5, 6, '#FF0000') + rect(13.3, 7.8, 3.4, 4.4, '#fff'),
  GR: hs(['#0D5EAF', '#fff', '#0D5EAF', '#fff', '#0D5EAF', '#fff', '#0D5EAF', '#fff', '#0D5EAF']) + rect(0, 0, 11, 11, '#0D5EAF') + rect(4.5, 0, 2, 11, '#fff') + rect(0, 4.5, 11, 2, '#fff'),
  RO: vs(['#002B7F', '#FCD116', '#CE1126']),
  UA: hs(['#0057B7', '#FFD700']),
  US: hs(['#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234', '#fff', '#B22234']) + rect(0, 0, 13, 10.8, '#3C3B6E') + [2.5, 5.5, 8.5, 11].flatMap((x) => [2.5, 5.5, 8.5].map((y) => circle(x, y, 0.55, '#fff'))).join(''),
  MX: vs(['#006847', '#fff', '#CE1126']) + circle(15, 10, 2.2, '#8C6B3C'),
  CO: hs(['#FCD116', '#003893', '#CE1126'], [2, 1, 1]),
  EC: hs(['#FFDD00', '#034EA2', '#ED1C24'], [2, 1, 1]),
  BR: rect(0, 0, W, H, '#009C3B') + poly('15,2.5 27,10 15,17.5 3,10', '#FFDF00') + circle(15, 10, 4.3, '#002776'),
  AR: hs(['#74ACDF', '#fff', '#74ACDF']) + circle(15, 10, 2.4, '#F6B40E'),
  AU: rect(0, 0, W, H, '#012169') + unionJack(0, 0, 15, 10) + star(7.5, 15, 2.4, '#fff') + star(22, 4.5, 1.4, '#fff') + star(26, 9, 1.4, '#fff') + star(22, 15.5, 1.4, '#fff') + star(18.5, 9.5, 1.4, '#fff'),
  NZ: rect(0, 0, W, H, '#012169') + unionJack(0, 0, 15, 10) + star(22, 5, 1.6, '#CC142B') + star(26, 9, 1.6, '#CC142B') + star(22, 16, 1.6, '#CC142B') + star(18.5, 10, 1.6, '#CC142B'),
  JP: rect(0, 0, W, H, '#fff') + circle(15, 10, 6, '#BC002D'),
  CN: rect(0, 0, W, H, '#DE2910') + star(5.5, 5.5, 3, '#FFDE00') + star(11, 2.5, 1, '#FFDE00') + star(13, 5, 1, '#FFDE00') + star(13, 8.2, 1, '#FFDE00') + star(11, 10.5, 1, '#FFDE00'),
  ZA: rect(0, 0, W, 9.4, '#E03C31') + rect(0, 10.6, W, 9.4, '#001489') + '<path d="M0 1.4 12 10 0 18.6M12 10H30" stroke="#fff" stroke-width="5.6" fill="none"/>' + '<path d="M0 1.4 12 10 0 18.6M12 10H30" stroke="#007749" stroke-width="3.4" fill="none"/>' + poly('0,3.2 8.6,10 0,16.8', '#FFB81C') + poly('0,5 6.4,10 0,15', '#000'),
  MA: rect(0, 0, W, H, '#C1272D') + star(15, 10.4, 5.2, 'none').replace('fill="none"', 'fill="none" stroke="#006233" stroke-width="1"'),
  DZ: vs(['#006233', '#fff']) + circle(15.6, 10, 5.2, '#D21034') + circle(17.2, 10, 4.2, '#fff') + star(17.8, 10, 2.4, '#D21034', -72),
  TN: rect(0, 0, W, H, '#E70013') + circle(15, 10, 6, '#fff') + circle(15.8, 10, 4.2, '#E70013') + circle(16.2, 10, 3.2, '#fff') + star(16.4, 10, 2, '#E70013', -72),
  SN: vs(['#00853F', '#FDEF42', '#E31B23']) + star(15, 10, 3.2, '#00853F'),
  ER: rect(0, 0, W, H, '#4189DD') + poly('0,0 30,0 30,10', '#12AD2B') + poly('0,20 30,20 30,10', '#4189DD') + poly('0,0 30,10 0,20', '#EA0437') + circle(7, 10, 3, 'none'),
};

/** Drapeau SVG (3 : 2) d'un code pays, à la hauteur `h` px ; chaîne vide si inconnu. */
export function flagSvg(code: string | undefined, h = 13): string {
  const body = code ? FLAGS[code] : undefined;
  if (!body) return '';
  const w = Math.round((h * 3) / 2);
  return `<svg class="flag-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${w}" height="${h}" role="img" aria-label="${code}" preserveAspectRatio="xMidYMid slice"><clipPath id="fc-${code}"><rect width="${W}" height="${H}" rx="2.2"/></clipPath><g clip-path="url(#fc-${code})">${body}</g><rect width="${W}" height="${H}" rx="2.2" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="0.8"/></svg>`;
}
