/**
 * Script versionné de la voix off du tutoriel (FR / EN). Chaque réplique est lue par la
 * synthèse vocale et affichée en sous-titres. Modifier ici, jamais dans le code de l'écran.
 */
export interface Line {
  fr: string;
  en: string;
}

export const ONBOARDING_SCRIPT: Record<string, Line[]> = {
  welcome: [
    {
      fr: "Bienvenue dans Allez Robert ! Un clin d'œil à Robert Marchand, recordman de l'heure à cent cinq ans. Ici, on roule ensemble, chacun chez soi.",
      en: 'Welcome to Allez Robert! A nod to Robert Marchand, who set the hour record at one hundred and five. Here we ride together, each from home.',
    },
    { fr: 'En quelques minutes, on règle ton profil, ton avatar et tes capteurs, puis on part pour une première sortie.', en: "In a few minutes we'll set up your profile, avatar and sensors, then head out for a first ride." },
  ],
  profile: [
    {
      fr: "Ton poids et ta taille servent à la physique : en côte, chaque kilo compte. La FTP, c'est la puissance que tu tiens environ une heure. Si tu ne la connais pas, le test FTP la calculera pour toi.",
      en: "Your weight and height drive the physics: on climbs, every kilo counts. FTP is the power you can hold for about an hour. If you don't know it, the FTP test will work it out.",
    },
  ],
  avatar: [{ fr: 'Choisis les couleurs de ton maillot et de ton vélo. Tu débloqueras d’autres tenues en roulant.', en: "Pick your jersey and bike colours. You'll unlock more kit as you ride." }],
  devices: [
    {
      fr: "Place aux capteurs. Réveille ton home trainer en pédalant un peu, puis appaire-le. Les pédales Assioma n'acceptent qu'une seule connexion Bluetooth : ferme Zwift, MyWhoosh ou l'appli Favero sur ton téléphone. Et active le mode gauche plus droite combinés, sinon la puissance d'une seule pédale serait doublée.",
      en: "Now the sensors. Wake your smart trainer by pedalling a little, then pair it. Assioma pedals accept only one Bluetooth connection: close Zwift, MyWhoosh or the Favero phone app. And enable combined left plus right mode, otherwise one pedal's power would be doubled.",
    },
    {
      fr: "Si tu enregistres aussi la sortie sur ton Garmin, garde les capteurs en ANT+ vers le compteur, et ne le laisse jamais piloter le home trainer : c'est le jeu qui s'en charge.",
      en: 'If you also record on your Garmin, keep the sensors on ANT+ to the head unit, and never let it control the trainer: the game does that.',
    },
  ],
  gears: [
    {
      fr: "Les vitesses sont virtuelles : vingt-quatre rapports, gérés par le jeu. Avec un Zwift Cog, tu changes avec tes manettes Di2, un Zwift Click, la manette ou les flèches du clavier.",
      en: 'Gears are virtual: twenty-four ratios handled by the game. With a Zwift Cog, shift with your Di2 levers, a Zwift Click, a gamepad or the arrow keys.',
    },
  ],
  ride: [
    { fr: "C'est parti pour une boucle dans la vallée de Chevreuse. Pédale à ton rythme : la pente de la route se ressent dans le home trainer.", en: "Let's ride a loop in the Chevreuse valley. Pedal at your own pace: you'll feel the road gradient in the trainer." },
  ],
  firstShift: [{ fr: 'Bien joué, tu viens de changer de vitesse. Monte les pignons en côte pour garder une bonne cadence.', en: 'Nice, you just shifted. Shift to easier gears on climbs to keep a good cadence.' }],
  firstClimb: [{ fr: "Voici une côte. Reste assis, souple, et regarde le profil en bas de l'écran pour doser ton effort.", en: 'Here comes a climb. Stay seated and smooth, and watch the profile at the bottom of the screen to pace yourself.' }],
  segment: [{ fr: "Tu entres dans un segment chronométré. Ton temps sera comparé à celui de tes amis.", en: "You're entering a timed segment. Your time will be compared with your friends'." }],
  draft: [{ fr: "Abrite-toi derrière un autre coureur : l'aspiration t'économise jusqu'à un tiers de ton effort.", en: 'Tuck in behind another rider: drafting saves you up to a third of your effort.' }],
  done: [{ fr: "Tu es prêt. À la fin de chaque sortie, télécharge ton fichier FIT ou envoie-le vers Strava et intervals.icu. Allez, Robert !", en: "You're all set. After each ride, download your FIT file or send it to Strava and intervals.icu. Allez Robert!" }],
};
