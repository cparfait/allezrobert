/**
 * Windows n'affiche pas les drapeaux en émoji (deux lettres à la place) : on le détecte une fois et
 * la classe `no-flag-emoji` de <html> habille alors ces lettres en pastille de code pays.
 */
export function detectFlagEmoji(): void {
  try {
    const c = document.createElement('canvas');
    c.width = 32;
    c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.font = '14px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    g.textBaseline = 'top';
    g.fillText('\u{1F1EB}\u{1F1F7}', 0, 0);
    const d = g.getImageData(0, 0, 32, 16).data;
    // Un vrai drapeau est coloré (bleu, rouge) ; deux lettres de repli sont grises.
    let colored = 0;
    for (let i = 0; i < d.length; i += 4) if ((d[i + 3] as number) > 80 && Math.max(Math.abs((d[i] as number) - (d[i + 1] as number)), Math.abs((d[i + 1] as number) - (d[i + 2] as number))) > 60) colored++;
    document.documentElement.classList.toggle('no-flag-emoji', colored < 8);
  } catch {
    document.documentElement.classList.add('no-flag-emoji');
  }
}
