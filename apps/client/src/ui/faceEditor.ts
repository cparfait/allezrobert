import { BASE_PROFILES, FACE_SLIDERS, HAIR_STYLE_COUNT, decodeFace, lookSex, type AvatarLook, type FaceShape, type FaceSlider } from '@allezrobert/shared';
import { getLang } from '../i18n/index.ts';

/**
 * Éditeur de visage du garage (docs/AVATARS.md § 9) : profil de départ, curseurs groupés,
 * peau et cheveux, aléatoire contrôlé, annulation. Ne manipule que la tenue (`AvatarLook`) : la
 * forme tient dans `look.face` (42 octets), rien d'autre n'est conservé.
 */

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
  const sliders =
    tab === 'skin'
      ? `<div class="fe-grid">
          <label class="field">${L ? 'Teint' : 'Skin tone'}<input id="fe-skin" type="color" value="${look.skin}" /></label>
          <label class="field">${L ? (male ? 'Cheveux, barbe' : 'Cheveux') : male ? 'Hair, beard' : 'Hair'}<input id="fe-hair" type="color" value="${look.hair}" /></label>
        </div>
        <div class="field">${L ? 'Coiffure (tête nue ; sous le casque, courte ou attachée)' : 'Hairstyle (bare head; under the helmet, short or tied)'}<div class="fe-seg" id="fe-hairstyle">${HAIR_STYLES.map(
          ([v, fr, en]) => `<button data-v="${v}" class="${(((look.hairStyle % HAIR_STYLE_COUNT) + HAIR_STYLE_COUNT) % HAIR_STYLE_COUNT) === v ? 'on' : ''}">${L ? fr : en}</button>`,
        ).join('')}</div></div>
        ${male ? rangeHtml('fe-beard', L ? 'Barbe' : 'Beard', look.beard ?? 0, 0, 1) : ''}
        ${rangeHtml('fe-freckles', L ? 'Taches de rousseur' : 'Freckles', look.freckles ?? 0, 0, 1)}
        ${male ? `<label class="fe-check"><input id="fe-moustache" type="checkbox" ${look.moustache ? 'checked' : ''} /> ${L ? 'Moustache' : 'Moustache'}</label>` : ''}`
      : FACE_SLIDERS.filter((s) => s.group === tab)
          .map((s) => rangeHtml(`fe-s-${s.id}`, LABELS[s.id][L ? 0 : 1], sliderValue(s.id, shape), ONE_SIDED.has(s.id) ? 0 : -1, 1, s.id))
          .join('');
  return `<div class="fe">
    <div class="fe-profiles" title="${L ? 'Partir d’un profil de base' : 'Start from a base profile'}">${BASE_PROFILES.map((p) => `<button data-feprofile="${p.id}" title="${esc(p.desc[L ? 'fr' : 'en'])}">${esc(p.name)}</button>`).join('')}</div>
    <div class="fe-tabs">${TABS.map(([id, fr, en]) => `<button data-fetab="${id}" class="${id === tab ? 'on' : ''}">${L ? fr : en}</button>`).join('')}</div>
    <div class="fe-sliders">${sliders}</div>
    <details class="fe-photo"${photoOpen ? ' open' : ''}><summary>${L ? 'Ressemblance à partir d’une photo' : 'Likeness from a photo'}</summary>
      <p>${
        L
          ? 'Une photo de <b>toi</b>, de face. Elle est analysée <b>sur cet appareil</b> : elle n’est ni envoyée ni conservée ; seuls les réglages obtenus (curseurs, teint, cheveux) sont enregistrés, et tu peux les retoucher ou les effacer (« Tête de base ») à tout moment.'
          : 'A photo of <b>yourself</b>, facing the camera. It is analysed <b>on this device</b>: it is never uploaded nor stored; only the resulting settings (sliders, skin tone, hair) are saved, and you can adjust or erase them (“Base head”) at any time.'
      }</p>
      <label class="fe-check"><input id="fe-consent" type="checkbox" /> ${L ? 'J’accepte ce traitement local de ma photo' : 'I agree to this local processing of my photo'}</label>
      <label class="fe-photo-btn" id="fe-photo-label" aria-disabled="true">${L ? 'Choisir une photo' : 'Choose a photo'}<input id="fe-photo" type="file" accept="image/*" hidden disabled /></label>
      <span id="fe-photo-msg"></span>
    </details>
    <div class="fe-actions">
      <label class="fe-check"><input id="fe-bare" type="checkbox" ${bareHead ? 'checked' : ''} /> ${L ? 'Sans casque ni lunettes' : 'No helmet or glasses'}</label>
      <button id="fe-random">${L ? 'Aléatoire' : 'Random'}</button>
      <button id="fe-undo" ${canUndo ? '' : 'disabled'}>${L ? 'Annuler' : 'Undo'}</button>
      <button id="fe-reset">${L ? 'Tête de base' : 'Base head'}</button>
    </div>
  </div>`;
}

function rangeHtml(id: string, label: string, value: number, min: number, max: number, slider?: FaceSlider): string {
  return `<label class="fe-range">${esc(label)}<input id="${id}" ${slider ? `data-feslider="${slider}"` : ''} type="range" min="${min}" max="${max}" step="0.02" value="${value.toFixed(2)}" /></label>`;
}

export { withBaseHead, withLikeness, withProfile, withRandomFace, withSlider } from './faceEditorLogic.ts';
