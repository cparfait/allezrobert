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
      fr: '<emotion value="excited"/>Bienvenue dans Allez Robert ! <break time="300ms"/>Un clin d\'œil à Robert Chassat, un passionné de vélo qui a su transmettre sa passion à tous ceux qui ont roulé avec lui, et à Robert Marchand, recordman de l\'heure à cent cinq ans. Ici, on roule ensemble, chacun chez soi !',
      en: '<emotion value="excited"/>Welcome to Allez Robert! <break time="300ms"/>A nod to Robert Chassat, a cycling enthusiast who passed his passion on to everyone who rode with him, and to Robert Marchand, who set the hour record at one hundred and five. Here we ride together, each from home!',
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
      fr: '<emotion value="happy"/>À toi de jouer : choisis ton teint, tes cheveux, ou aucun si tu préfères, et quelques couleurs pour ton maillot, ton casque et ton vélo. Tu débloqueras bien d’autres tenues en roulant !',
      en: "<emotion value=\"happy\"/>Your turn: pick your skin tone, your hair, or none if you prefer, and a few colours for your jersey, helmet and bike. You'll unlock many more outfits as you ride!",
    },
  ],
  devices: [
    {
      fr: '<emotion value="enthusiastic"/>Place aux capteurs ! Tu peux connecter ton home trainer, tes pédales ou ton capteur de puissance, une ceinture cardio, un capteur de cadence et tes commandes de vitesses. <break time="250ms"/>Réveille ton matériel en pédalant un peu, puis appaire-le.',
      en: '<emotion value="enthusiastic"/>Now the sensors! You can connect your smart trainer, your pedals or power meter, a heart rate strap, a cadence sensor and your shifters. <break time="250ms"/>Wake your gear by pedalling a little, then pair it.',
    },
  ],
  assioma: [
    {
      fr: '<emotion value="content"/>Des pédales Assioma : elles n\'acceptent qu\'une seule connexion Bluetooth, ferme les autres applis. Et active le mode gauche plus droite combinés dans l\'appli Favero, sinon la puissance d\'une seule pédale serait doublée.',
      en: '<emotion value="content"/>Assioma pedals: they accept only one Bluetooth connection, so close your other apps. And enable the combined left plus right mode in the Favero app, otherwise one pedal\'s power would be doubled.',
    },
  ],
  gears: [
    {
      fr: '<emotion value="enthusiastic"/>Les vitesses sont gérées par le jeu, sur ton home trainer. <speed ratio="0.9"/>Si tu changes de vitesse sur ton vrai vélo, indique le nombre de pignons de ta cassette pour que le jeu s\'adapte, et ton modèle de Di2 si tu en as un.',
      en: '<emotion value="enthusiastic"/>Gears are handled by the game on your trainer. <speed ratio="0.9"/>If you shift on your real bike, tell us how many sprockets your cassette has so the game can adapt, and your Di2 model if you have one.',
    },
  ],
  companion: [
    {
      fr: '<emotion value="enthusiastic"/>Ton téléphone peut devenir ta télécommande : change de vitesse et choisis ta route aux carrefours. Scanne le code avec l\'appareil photo, sans créer de compte.',
      en: '<emotion value="enthusiastic"/>Your phone can be your remote: shift gears and pick your way at junctions. Scan the code with the camera, no account needed.',
    },
  ],
  ftp: [
    {
      fr: '<emotion value="determined"/>Le test FTP, c\'est une rampe : tu pars de cent watts, et la puissance monte de vingt watts chaque minute. Garde une cadence régulière, entre quatre-vingt-cinq et quatre-vingt-quinze tours par minute. <break time="300ms"/>Quand tu ne tiens plus le palier, arrête-toi : ta FTP est calculée à partir de ta meilleure minute, et elle règle tes zones et tes séances. Repose-toi bien, allume un ventilateur, et garde un bidon à portée de main. Prêt ?',
      en: '<emotion value="determined"/>The FTP test is a ramp: you start at one hundred watts, and the power rises by twenty watts every minute. Keep a steady cadence, between eighty-five and ninety-five rpm. <break time="300ms"/>When you can no longer hold the step, stop: your FTP is worked out from your best minute, and sets your zones and workouts. Be well rested, turn on a fan, and keep a bottle within reach. Ready?',
    },
  ],
  finish: [
    {
      fr: '<emotion value="excited"/><volume ratio="1.15"/>Amuse-toi bien, seul ou entre amis. Bonnes balades !',
      en: '<emotion value="excited"/><volume ratio="1.15"/>Have fun, on your own or with friends. Happy riding!',
    },
  ],
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

/** Texte prononcé : graphie phonétique des mots anglais en français (le sous-titre garde l'original). */
export function spoken(text: string, lang: 'fr' | 'en'): string {
  if (lang !== 'fr') return text;
  return text
    .replace(/\bGarmin\b/g, 'Garmine')
    .replace(/\bhome[- ]trainers\b/gi, 'home traineurs')
    .replace(/\bhome[- ]trainer\b/gi, 'home traineur');
}

/** Texte affiché (sous-titres, voix du système) : sans les balises Cartesia. */
export function plainText(text: string): string {
  return text.replace(/<[^>]*>/g, '').replace(/\s{2,}/g, ' ').trim();
}
