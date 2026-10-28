/**
 * « Ride On » : encouragement reçu d'un autre coureur. Le message varie au hasard pour ne pas répéter
 * toujours la même formule ; `{name}` est remplacé par le prénom de l'expéditeur.
 */
const RIDE_ON_FR = [
  '👍 {name} t’encourage : allez, ride on !',
  '💪 {name} : tu gères, continue comme ça !',
  '🔥 {name} : quelle belle foulée, continue !',
  '🚴 {name} : ça roule, lâche rien !',
  '👏 {name} : bien joué, on t’a vu !',
  '⚡ {name} : envoie la puissance !',
  '🌟 {name} : t’es en feu, ne ralentis pas !',
  '🙌 {name} : allez, allez, allez !',
  '😄 {name} : tu pédales comme un pro !',
  '🏔️ {name} : accroche-toi, ça va passer !',
];

const RIDE_ON_EN = [
  '👍 {name} cheers you on: ride on!',
  '💪 {name}: you’ve got this, keep going!',
  '🔥 {name}: what a smooth stride, keep it up!',
  '🚴 {name}: looking strong, don’t quit!',
  '👏 {name}: well done, we saw that!',
  '⚡ {name}: put the power down!',
  '🌟 {name}: you’re on fire, don’t slow down!',
  '🙌 {name}: go, go, go!',
  '😄 {name}: you ride like a pro!',
  '🏔️ {name}: hang in there, it’ll pass!',
];

/** Un message d'encouragement au hasard (`rnd` : tirage dans [0, 1), injectable pour les tests). */
export function rideOnMessage(name: string, lang: 'fr' | 'en', rnd: () => number = Math.random): string {
  const list = lang === 'fr' ? RIDE_ON_FR : RIDE_ON_EN;
  const text = list[Math.min(list.length - 1, Math.floor(rnd() * list.length))] as string;
  return text.replace('{name}', name || (lang === 'fr' ? 'Un coureur' : 'A rider'));
}
