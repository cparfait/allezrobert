/**
 * Mini-analyseur XML sans DOM ni dépendance, suffisant pour les fichiers .zwo :
 * éléments, attributs (guillemets simples ou doubles), texte, entités standard et
 * numériques, commentaires, CDATA, prologue et DOCTYPE ignorés. Pas de namespaces
 * (le préfixe fait partie du nom) ni de validation.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Texte concaténé directement contenu dans l'élément (hors enfants), non rogné. */
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXmlEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

export class XmlParseError extends Error {
  readonly position: number;
  constructor(message: string, position: number) {
    super(`${message} (position ${position})`);
    this.position = position;
  }
}

/** Analyse un document et renvoie l'élément racine. */
export function parseXml(src: string): XmlElement {
  let i = 0;
  const n = src.length;
  // BOM
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  const root: XmlElement = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlElement[] = [root];

  const isNameChar = (c: number): boolean =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 45 || c === 46 || c === 58 || c > 127;
  const isSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 13;

  while (i < n) {
    const lt = src.indexOf('<', i);
    const top = stack[stack.length - 1]!;
    if (lt < 0) {
      top.text += decodeXmlEntities(src.slice(i));
      break;
    }
    if (lt > i) top.text += decodeXmlEntities(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      if (end < 0) throw new XmlParseError('Commentaire non fermé', i);
      i = end + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9);
      if (end < 0) throw new XmlParseError('CDATA non fermé', i);
      top.text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2);
      if (end < 0) throw new XmlParseError('Instruction non fermée', i);
      i = end + 2;
    } else if (src.startsWith('<!', i)) {
      const end = src.indexOf('>', i + 2);
      if (end < 0) throw new XmlParseError('Déclaration non fermée', i);
      i = end + 1;
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i + 2);
      if (end < 0) throw new XmlParseError('Balise fermante non terminée', i);
      const name = src.slice(i + 2, end).trim();
      if (stack.length <= 1) throw new XmlParseError(`Balise fermante inattendue </${name}>`, i);
      const open = stack.pop()!;
      if (open.name !== name) throw new XmlParseError(`</${name}> ferme <${open.name}>`, i);
      i = end + 1;
    } else {
      i++;
      const start = i;
      while (i < n && isNameChar(src.charCodeAt(i))) i++;
      if (i === start) throw new XmlParseError('Nom de balise attendu', i);
      const el: XmlElement = { name: src.slice(start, i), attrs: {}, children: [], text: '' };
      let selfClosing = false;
      for (;;) {
        while (i < n && isSpace(src.charCodeAt(i))) i++;
        if (i >= n) throw new XmlParseError(`Balise <${el.name}> non terminée`, start);
        const c = src[i];
        if (c === '>') {
          i++;
          break;
        }
        if (c === '/' && src[i + 1] === '>') {
          selfClosing = true;
          i += 2;
          break;
        }
        const as = i;
        while (i < n && isNameChar(src.charCodeAt(i))) i++;
        if (i === as) throw new XmlParseError(`Attribut invalide dans <${el.name}>`, i);
        const an = src.slice(as, i);
        while (i < n && isSpace(src.charCodeAt(i))) i++;
        if (src[i] !== '=') {
          el.attrs[an] = ''; // attribut sans valeur (toléré)
          continue;
        }
        i++;
        while (i < n && isSpace(src.charCodeAt(i))) i++;
        const q = src[i];
        if (q !== '"' && q !== "'") throw new XmlParseError(`Valeur d'attribut sans guillemets (${an})`, i);
        const ve = src.indexOf(q, i + 1);
        if (ve < 0) throw new XmlParseError(`Valeur d'attribut non fermée (${an})`, i);
        el.attrs[an] = decodeXmlEntities(src.slice(i + 1, ve));
        i = ve + 1;
      }
      top.children.push(el);
      if (!selfClosing) stack.push(el);
    }
  }
  if (stack.length > 1) throw new XmlParseError(`Balise <${stack[stack.length - 1]!.name}> non fermée`, n);
  const first = root.children[0];
  if (!first) throw new XmlParseError('Document vide', 0);
  return first;
}

/** Premier enfant portant ce nom (insensible à la casse). */
export function xmlChild(el: XmlElement, name: string): XmlElement | undefined {
  const lower = name.toLowerCase();
  return el.children.find((c) => c.name.toLowerCase() === lower);
}

/** Attribut insensible à la casse. */
export function xmlAttr(el: XmlElement, name: string): string | undefined {
  if (name in el.attrs) return el.attrs[name];
  const lower = name.toLowerCase();
  for (const k in el.attrs) if (k.toLowerCase() === lower) return el.attrs[k];
  return undefined;
}

/** Texte rogné de l'élément et de ses descendants. */
export function xmlText(el: XmlElement): string {
  let s = el.text;
  for (const c of el.children) s += xmlText(c);
  return s.trim();
}
