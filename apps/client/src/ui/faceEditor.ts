import { BASE_PROFILES, FACE_SLIDERS, HAIR_STYLE_COUNT, decodeFace, lookSex, type AvatarLook, type FaceShape, type FaceSlider } from '@allezrobert/shared';
import { getLang, strings } from '../i18n/index.ts';
import './blocks.css';
import './faceEditor.css';

/**
 * Éditeur de visage du garage (docs/AVATARS.md § 9) : profil de départ, curseurs groupés,
 * peau et cheveux, aléatoire contrôlé, annulation. Ne manipule que la tenue (`AvatarLook`) : la
 * forme tient dans `look.face` (42 octets), rien d'autre n'est conservé.
 */

const S = strings(
  {
    skinTone: 'Teint',
    hair: 'Cheveux',
    hairBeard: 'Cheveux, barbe',
    hairstyleHelmet: 'Coiffure (tête nue ; sous le casque, courte ou attachée)',
    beard: 'Barbe',
    freckles: 'Taches de rousseur',
    moustache: 'Moustache',
    withMoustache: 'Avec moustache',
    silhouette: 'Silhouette',
    man: 'Homme',
    woman: 'Femme',
    baseProfile: 'Partir d’un profil de base',
    face: 'Visage',
    photoTitle: 'Ressemblance à partir d’une photo',
    photoText:
      'Une photo de <b>toi</b>, de face. Elle est analysée <b>sur cet appareil</b> : elle n’est ni envoyée ni conservée ; seuls les réglages obtenus (curseurs, teint, cheveux) sont enregistrés, et tu peux les retoucher ou les effacer (« Tête de base ») à tout moment.',
    photoConsent: 'J’accepte ce traitement local de ma photo',
    photoChoose: 'Choisir une photo',
    bareHead: 'Sans casque ni lunettes',
    random: 'Aléatoire',
    undo: 'Annuler',
    baseHead: 'Tête de base',
    colour: 'Couleur',
    hairstyle: 'Coiffure',
    hairNote: 'Tête nue ; sous le casque, les cheveux sont courts ou attachés.',
  },
  {
    skinTone: 'Skin tone',
    hair: 'Hair',
    hairBeard: 'Hair, beard',
    hairstyleHelmet: 'Hairstyle (bare head; under the helmet, short or tied)',
    beard: 'Beard',
    freckles: 'Freckles',
    moustache: 'Moustache',
    withMoustache: 'With moustache',
    silhouette: 'Build',
    man: 'Man',
    woman: 'Woman',
    baseProfile: 'Start from a base profile',
    face: 'Face',
    photoTitle: 'Likeness from a photo',
    photoText:
      'A photo of <b>yourself</b>, facing the camera. It is analysed <b>on this device</b>: it is never uploaded nor stored; only the resulting settings (sliders, skin tone, hair) are saved, and you can adjust or erase them (“Base head”) at any time.',
    photoConsent: 'I agree to this local processing of my photo',
    photoChoose: 'Choose a photo',
    bareHead: 'No helmet or glasses',
    random: 'Random',
    undo: 'Undo',
    baseHead: 'Base head',
    colour: 'Colour',
    hairstyle: 'Hairstyle',
    hairNote: 'Bare head; under a helmet, hair is short or tied.',
  },
);

export type FaceTab = 'head' | 'eyes' | 'nose' | 'mouth' | 'body' | 'skin';

const TABS: Array<[FaceTab, string, string]> = [
  ['head', 'Tête', 'Head'],
  ['eyes', 'Yeux', 'Eyes'],
  ['nose', 'Nez', 'Nose'],
  ['mouth', 'Bouche', 'Mouth'],
  ['body', 'Corps', 'Body'],
  ['skin', 'Peau, cheveux', 'Skin, hair'],
];

/** Libellés : [fr, en, borne gauche fr, borne droite fr]. */
const LABELS: Record<FaceSlider, [string, string]> = {
  jawWidth: ['Largeur de mâchoire', 'Jaw width'],
  jawHeight: ['Hauteur de mâchoire', 'Jaw height'],
  jawAngle: ['Mâchoire fine ↔ carrée', 'Jaw narrow ↔ square'],
  chinProtrusion: ['Menton en retrait ↔ en avant', 'Chin back ↔ forward'],
  chinHeight: ['Hauteur du menton', 'Chin height'],
  chinWidth: ['Largeur du menton', 'Chin width'],
  chinCleft: ['Fossette du menton', 'Chin cleft'],
  cheekbones: ['Pommettes', 'Cheekbones'],
  cheekVolume: ['Joues creuses ↔ pleines', 'Cheeks hollow ↔ full'],
  cheekHeight: ['Hauteur des pommettes', 'Cheekbone height'],
  faceFat: ['Visage maigre ↔ rond', 'Face lean ↔ round'],
  headWidth: ['Largeur du crâne', 'Head width'],
  headLength: ['Hauteur du visage', 'Face height'],
  headDepth: ['Profondeur du crâne', 'Head depth'],
  foreheadSlope: ['Front fuyant ↔ droit', 'Forehead sloped ↔ upright'],
  earSize: ['Taille des oreilles', 'Ear size'],
  earAngle: ['Oreilles décollées', 'Protruding ears'],
  neckWidth: ['Cou fin ↔ large', 'Neck thin ↔ thick'],
  browRidge: ['Arcades', 'Brow ridge'],
  browHeight: ['Hauteur des sourcils', 'Brow height'],
  browAngle: ['Inclinaison des sourcils', 'Brow angle'],
  eyeSize: ['Taille des yeux', 'Eye size'],
  eyeSpacing: ['Écartement des yeux', 'Eye spacing'],
  eyeHeight: ['Hauteur des yeux', 'Eye height'],
  eyeTilt: ['Inclinaison des yeux', 'Eye tilt'],
  eyelidFold: ['Pli de la paupière', 'Eyelid fold'],
  noseLength: ['Longueur du nez', 'Nose length'],
  noseWidth: ['Largeur du nez', 'Nose width'],
  noseBridge: ['Arête du nez', 'Nose bridge'],
  noseTip: ['Pointe tombante ↔ relevée', 'Tip down ↔ up'],
  nostrilFlare: ['Ailes du nez', 'Nostril flare'],
  lipFullness: ['Lèvres fines ↔ pleines', 'Lips thin ↔ full'],
  mouthWidth: ['Largeur de la bouche', 'Mouth width'],
  mouthCorners: ['Commissures', 'Mouth corners'],
  sex: ['Morphologie féminine', 'Feminine build'],
  age: ['Âge', 'Age'],
  weight: ['Mince ↔ fort', 'Slim ↔ heavy'],
  muscle: ['Musculature', 'Muscle'],
  shoulders: ['Largeur d’épaules', 'Shoulder width'],
  originAfrican: ['Air d’origine : Afrique', 'Heritage: Africa'],
  originAsian: ['Air d’origine : Asie', 'Heritage: Asia'],
  originEuropean: ['Air d’origine : Europe', 'Heritage: Europe'],
};

/** Curseurs à un seul côté (0 → 1) : la morphologie féminine (sex < 0) et les trois origines. */
const ONE_SIDED = new Set<FaceSlider>(['sex', 'originAfrican', 'originAsian', 'originEuropean']);
const sliderValue = (id: FaceSlider, shape: FaceShape): number => (id === 'sex' ? -(shape.sex ?? 0) : (shape[id] ?? 0));

const HAIR_STYLES: Array<[number, string, string]> = [
  [0, 'Courts', 'Short'],
  [1, 'Queue de cheval', 'Ponytail'],
  [2, 'Tresse', 'Braid'],
  [3, 'Rasé', 'Shaved'],
  [4, 'Dégradé', 'Fade'],
  [5, 'Bouclés', 'Curly'],
  [6, 'Carré', 'Bob'],
  [7, 'Chignon', 'Bun'],
  [8, 'Coiffé', 'Quiff'],
  [9, 'Longs', 'Long'],
  [10, 'Deux tresses', 'Two braids'],
  [11, 'Queue tressée', 'Braided ponytail'],
];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

export function faceEditorHtml(look: AvatarLook, tab: FaceTab, bareHead: boolean, canUndo: boolean, photoOpen = false): string {
  const L = getLang() === 'fr';
  const shape = decodeFace(look.face);
  // Barbe et moustache : seulement pour les hommes.
  const male = lookSex(look) === 'male';
  const sex = male ? 'male' : 'female';
  const sliders =
    tab === 'skin'
      ? `<div class="fe-grid">
          <label class="field">${S('skinTone')}<input id="fe-skin" type="color" value="${look.skin}" /></label>
          <label class="field">${S(male ? 'hairBeard' : 'hair')}<input id="fe-hair" type="color" value="${look.hair}" /></label>
        </div>
        <div class="field">${S('hairstyleHelmet')}<div class="fe-seg" id="fe-hairstyle">${HAIR_STYLES.map(
          ([v, fr, en]) => `<button type="button" data-v="${v}" class="${(((look.hairStyle % HAIR_STYLE_COUNT) + HAIR_STYLE_COUNT) % HAIR_STYLE_COUNT) === v ? 'on' : ''}">${L ? fr : en}</button>`,
        ).join('')}</div></div>
        ${male ? rangeHtml('fe-beard', S('beard'), look.beard ?? 0, 0, 1) : ''}
        ${rangeHtml('fe-freckles', S('freckles'), look.freckles ?? 0, 0, 1)}
        ${male ? `<label class="fe-check"><input id="fe-moustache" type="checkbox" ${look.moustache ? 'checked' : ''} /> ${S('moustache')}</label>` : ''}`
      : FACE_SLIDERS.filter((s) => s.group === tab)
          .map((s) => rangeHtml(`fe-s-${s.id}`, LABELS[s.id][L ? 0 : 1], sliderValue(s.id, shape), ONE_SIDED.has(s.id) ? 0 : -1, 1, s.id))
          .join('');
  // Sections à titres « gros blocs » (casse normale) ; actions en pied, boutons ab-btn (l'action principale de l'écran
  // reste celle du garage).
  return `<div class="fe">
    <h3 class="ab-section fe-title">${S('silhouette')}</h3>
    <div class="fe-seg fe-sex" role="radiogroup" aria-label="${S('silhouette')}">${(['male', 'female'] as const).map((x) => `<button type="button" data-fesex="${x}" role="radio" aria-checked="${sex === x}" class="${sex === x ? 'on' : ''}">${S(x === 'male' ? 'man' : 'woman')}</button>`).join('')}</div>
    <div class="fe-profiles" title="${S('baseProfile')}">${BASE_PROFILES.filter((p) => (p.shape.sex ?? 0) < -0.5 !== male).map((p) => `<button type="button" data-feprofile="${p.id}" title="${esc(p.desc[L ? 'fr' : 'en'])}">${esc(p.name)}</button>`).join('')}</div>
    <h3 class="ab-section fe-title">${S('face')}</h3>
    <div class="fe-tabs">${TABS.filter(([id]) => id !== 'skin').map(([id, fr, en]) => `<button type="button" data-fetab="${id}" class="${id === tab ? 'on' : ''}" aria-pressed="${id === tab}">${L ? fr : en}</button>`).join('')}</div>
    <div class="fe-sliders">${sliders}</div>
    <details class="fe-photo"${photoOpen ? ' open' : ''}><summary>${S('photoTitle')}</summary>
      <p>${S('photoText')}</p>
      <label class="fe-check"><input id="fe-consent" type="checkbox" /> ${S('photoConsent')}</label>
      <label class="fe-photo-btn" id="fe-photo-label" aria-disabled="true">${S('photoChoose')}<input id="fe-photo" type="file" accept="image/*" hidden disabled /></label>
      <span id="fe-photo-msg"></span>
    </details>
    <div class="fe-actions ab-foot">
      <label class="fe-check"><input id="fe-bare" type="checkbox" ${bareHead ? 'checked' : ''} /> ${S('bareHead')}</label>
      <div class="ab-btns">
        <button type="button" class="ab-btn" id="fe-random">${S('random')}</button>
        <button type="button" class="ab-btn" id="fe-undo" ${canUndo ? '' : 'disabled'}>${S('undo')}</button>
        <button type="button" class="ab-btn" id="fe-reset">${S('baseHead')}</button>
      </div>
    </div>
  </div>`;
}

export function rangeHtml(id: string, label: string, value: number, min: number, max: number, slider?: FaceSlider): string {
  return `<label class="fe-range">${esc(label)}<input id="${id}" ${slider ? `data-feslider="${slider}"` : ''} type="range" min="${min}" max="${max}" step="0.02" value="${value.toFixed(2)}" /></label>`;
}

export { withBaseHead, withLikeness, withProfile, withRandomFace, withSlider } from './faceEditorLogic.ts';


/** Types du personnage hors visage : peau (teint, taches), cheveux (couleur, coiffure) et barbe (hommes). */
export const HAIR_STYLE_CHOICES = HAIR_STYLES;
export function characterTypeHtml(kind: 'skin' | 'hair' | 'beard', look: AvatarLook, colorRow: (label: string, key: 'skin' | 'hair', current: string) => string): string {
  const L = getLang() === 'fr';
  if (kind === 'skin') return `${colorRow(S('skinTone'), 'skin', look.skin)}<div class="fe-sliders">${rangeHtml('fe-freckles', S('freckles'), look.freckles ?? 0, 0, 1)}</div>`;
  if (kind === 'hair') {
    const cur = ((look.hairStyle % HAIR_STYLE_COUNT) + HAIR_STYLE_COUNT) % HAIR_STYLE_COUNT;
    return `${colorRow(S('colour'), 'hair', look.hair)}<div class="gr-vopt"><small>${S('hairstyle')}</small><div id="fe-hairstyle">${HAIR_STYLES.map(
      ([v, fr, en]) => `<button type="button" data-v="${v}" class="gr-vchip ${cur === v ? 'on' : ''}" aria-pressed="${cur === v}">${L ? fr : en}</button>`,
    ).join('')}</div></div><p class="gr-note">${S('hairNote')}</p>`;
  }
  return `<div class="fe-sliders">${rangeHtml('fe-beard', S('beard'), look.beard ?? 0, 0, 1)}</div><div class="gr-vopt"><small>${S('moustache')}</small><div><label class="fe-check"><input id="fe-moustache" type="checkbox" ${look.moustache ? 'checked' : ''} /> ${S('withMoustache')}</label></div></div>`;
}
