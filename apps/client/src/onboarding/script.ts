/**
 * Script versionné de la voix off du tutoriel (FR / EN). Chaque réplique est lue par la
 * synthèse vocale et affichée en sous-titres. Modifier ici, jamais dans le code de l'écran.
 *
 * Balises Cartesia (sonic-3 et plus récents), retirées des sous-titres : `<emotion value="happy"/>`,
 * `<speed ratio="1.1"/>` (0,6 à 1,5), `<volume ratio="1.2"/>` (0,5 à 2), `<break time="300ms"/>`.
 * Une seule émotion par réplique, en tête (les changements en cours de phrase sont instables),
 * et peu de pauses : la ponctuation suffit le plus souvent.
 */
export interface Line {
  fr: string;
  en: string;
}

export const ONBOARDING_SCRIPT: Record<string, Line[]> = {
  welcome: [
    {
      fr: '<emotion value="excited"/>Bienvenue dans Allez Robert ! <break time="300ms"/>Un clin d\'œil à Robert Marchand, recordman de l\'heure à cent cinq ans, et à Robert Chassat, un passionné de vélo qui a su transmettre sa passion à tous ceux qui ont roulé avec lui. Ici, on roule ensemble, chacun chez soi !',
      en: '<emotion value="excited"/>Welcome to Allez Robert! <break time="300ms"/>A nod to Robert Marchand, who set the hour record at one hundred and five, and to Robert Chassat, a cycling enthusiast who passed his passion on to everyone who rode with him. Here we ride together, each from home!',
    },
    {
      fr: '<emotion value="happy"/>En quelques minutes, on règle ton équipement, puis ton profil et ton avatar, et hop, on part pour une première sortie !',
      en: "<emotion value=\"happy\"/>In a few minutes we'll set up your equipment, then your profile and avatar, and off we go for a first ride!",
    },
  ],
  profile: [
    {
      fr: '<emotion value="content"/>Ton poids et ta taille servent à la physique : en côte, chaque kilo compte ! La FTP, c\'est la puissance que tu tiens environ une heure. Tu ne la connais pas ? Pas de souci, le test FTP la calculera pour toi.',
      en: "<emotion value=\"content\"/>Your weight and height drive the physics: on climbs, every kilo counts! FTP is the power you can hold for about an hour. Don't know it? No worries, the FTP test will work it out.",
    },
  ],
  avatar: [
    {
      fr: '<emotion value="happy"/>À toi de jouer : choisis les couleurs de ton maillot et de ton vélo. Et tu débloqueras d’autres tenues en roulant !',
      en: "<emotion value=\"happy\"/>Your turn: pick your jersey and bike colours. And you'll unlock more kit as you ride!",
    },
  ],
  devices: [
    {
      fr: '<emotion value="enthusiastic"/>Place aux capteurs ! Réveille ton home trainer en pédalant un peu, puis appaire-le. <break time="250ms"/><speed ratio="0.95"/>Les pédales Assioma n\'acceptent qu\'une seule connexion Bluetooth : ferme Zwift, MyWhoosh ou l\'appli Favero sur ton téléphone. Et active le mode gauche plus droite combinés, sinon la puissance d\'une seule pédale serait doublée.',
      en: '<emotion value="enthusiastic"/>Now the sensors! Wake your smart trainer by pedalling a little, then pair it. <break time="250ms"/><speed ratio="0.95"/>Assioma pedals accept only one Bluetooth connection: close Zwift, MyWhoosh or the Favero phone app. And enable combined left plus right mode, otherwise one pedal\'s power would be doubled.',
    },
    {
      fr: '<emotion value="content"/>Si tu enregistres aussi la sortie sur ton Garmin, garde les capteurs en ANT+ vers le compteur, et ne le laisse jamais piloter le home trainer : c\'est le jeu qui s\'en charge.',
      en: '<emotion value="content"/>If you also record on your Garmin, keep the sensors on ANT+ to the head unit, and never let it control the trainer: the game does that.',
    },
  ],
  gears: [
    {
      fr: '<emotion value="enthusiastic"/>Les vitesses sont virtuelles : vingt-quatre rapports, gérés par le jeu ! <speed ratio="0.85"/>Avec un Zwift Cog, tu changes avec tes manettes Di2, un Zwift Click, la manette ou les flèches du clavier.',
      en: '<emotion value="enthusiastic"/>Gears are virtual: twenty-four ratios handled by the game! <speed ratio="0.9"/>With a Zwift Cog, shift with your Di2 levers, a Zwift Click, a gamepad or the arrow keys.',
    },
  ],
  finish: [{ fr: '<emotion value="excited"/><volume ratio="1.15"/>Bonnes balades !', en: '<emotion value="excited"/><volume ratio="1.15"/>Happy riding!' }],
  ride: [
    {
      fr: '<emotion value="excited"/><speed ratio="1.05"/>C\'est parti ! <break time="200ms"/>Pédale à ton rythme : la pente de la route se ressent dans le home trainer.',
      en: '<emotion value="excited"/><speed ratio="1.05"/>Let\'s go! <break time="200ms"/>Pedal at your own pace: you\'ll feel the road gradient in the trainer.',
    },
  ],
  firstShift: [
    {
      fr: '<emotion value="happy"/>Bien joué, tu viens de changer de vitesse ! Monte les pignons en côte pour garder une bonne cadence.',
      en: '<emotion value="happy"/>Nice one, you just shifted! Shift to easier gears on climbs to keep a good cadence.',
    },
  ],
  firstClimb: [
    {
      fr: '<emotion value="determined"/>Et voici une côte ! Reste assis, souple, et regarde le profil en bas de l\'écran pour doser ton effort.',
      en: '<emotion value="determined"/>And here comes a climb! Stay seated and smooth, and watch the profile at the bottom of the screen to pace yourself.',
    },
  ],
  segment: [
    {
      fr: '<emotion value="excited"/>Tu entres dans un segment chronométré ! Ton temps sera comparé à celui de tes amis. À fond !',
      en: "<emotion value=\"excited\"/>You're entering a timed segment! Your time will be compared with your friends'. Go for it!",
    },
  ],
  draft: [
    {
      fr: '<emotion value="curious"/>Petite astuce : abrite-toi derrière un autre coureur. L\'aspiration t\'économise jusqu\'à un tiers de ton effort !',
      en: '<emotion value="curious"/>Quick tip: tuck in behind another rider. Drafting saves you up to a third of your effort!',
    },
  ],
  done: [
    {
      fr: '<emotion value="proud"/>Tu es prêt ! À la fin de chaque sortie, télécharge ton fichier FIT ou envoie-le vers Strava et intervals.icu. <break time="300ms"/><volume ratio="1.15"/>Allez, Robert !',
      en: '<emotion value="proud"/>You\'re all set! After each ride, download your FIT file or send it to Strava and intervals.icu. <break time="300ms"/><volume ratio="1.15"/>Allez Robert!',
    },
  ],
};

/** Texte affiché (sous-titres, voix du système) : sans les balises Cartesia. */
export function plainText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s{2,}/g, ' ').trim();
}
