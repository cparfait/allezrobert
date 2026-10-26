/**
 * Identités des coureurs IA : nationalité, puis « Prénom NOM » de cette nationalité (prénom du
 * bon genre). Tirées sans hasard à partir du rang de l'IA : la même salle redonne les mêmes noms.
 */
interface Pool {
  m: readonly string[];
  f: readonly string[];
  last: readonly string[];
}

const POOLS: Record<string, Pool> = {
  FR: { m: ['Jean', 'Julien', 'Thibaut', 'Romain', 'Lucien'], f: ['Camille', 'Margaux', 'Élodie', 'Mireille', 'Océane'], last: ['Dupont', 'Moreau', 'Lefèvre', 'Garnier', 'Bernard', 'Rousseau'] },
  ES: { m: ['Javier', 'Alejandro', 'Iván', 'Miguel', 'Carlos'], f: ['Lucía', 'Carmen', 'Marta', 'Paula', 'Inés'], last: ['García', 'Fernández', 'Martínez', 'Ruiz', 'Navarro', 'Ortega'] },
  IT: { m: ['Marco', 'Luca', 'Matteo', 'Giovanni', 'Fabio'], f: ['Giulia', 'Chiara', 'Francesca', 'Elena', 'Sofia'], last: ['Rossi', 'Bianchi', 'Moretti', 'Conti', 'Ferrari', 'Colombo'] },
  BE: { m: ['Wout', 'Thomas', 'Kevin', 'Bart', 'Maxime'], f: ['Lotte', 'Charlotte', 'Sarah', 'Emma', 'Marie'], last: ['Peeters', 'Janssens', 'Dubois', 'Maes', 'Lambert', 'Claes'] },
  NL: { m: ['Jasper', 'Bram', 'Daan', 'Sven', 'Joost'], f: ['Anouk', 'Lieke', 'Sanne', 'Fleur', 'Marloes'], last: ['De Vries', 'Van Dijk', 'Bakker', 'Visser', 'Smit', 'Mulder'] },
  GB: { m: ['Oliver', 'Harry', 'Callum', 'Jack', 'Edward'], f: ['Charlotte', 'Amelia', 'Hannah', 'Grace', 'Lucy'], last: ['Smith', 'Taylor', 'Evans', 'Walker', 'Wright', 'Hughes'] },
  DE: { m: ['Lukas', 'Jonas', 'Felix', 'Tobias', 'Maximilian'], f: ['Anna', 'Lena', 'Katharina', 'Hannah', 'Julia'], last: ['Müller', 'Schmidt', 'Fischer', 'Weber', 'Wagner', 'Becker'] },
  CH: { m: ['Reto', 'Nicolas', 'Fabian', 'Urs', 'Stefan'], f: ['Nina', 'Selina', 'Céline', 'Andrea', 'Martina'], last: ['Meier', 'Keller', 'Gerber', 'Brunner', 'Baumann', 'Favre'] },
  DK: { m: ['Mads', 'Rasmus', 'Søren', 'Anders', 'Kasper'], f: ['Mette', 'Freja', 'Ida', 'Sofie', 'Katrine'], last: ['Jensen', 'Nielsen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen'] },
  SI: { m: ['Matej', 'Luka', 'Jan', 'Primož', 'Tadej'], f: ['Nina', 'Maja', 'Ana', 'Eva', 'Urška'], last: ['Novak', 'Horvat', 'Kovačič', 'Krajnc', 'Zupančič', 'Potočnik'] },
  CO: { m: ['Santiago', 'Nairo', 'Andrés', 'Esteban', 'Camilo'], f: ['Valentina', 'Daniela', 'Mariana', 'Juliana', 'Catalina'], last: ['Quintana', 'Rodríguez', 'Gómez', 'Herrera', 'Castaño', 'Ospina'] },
  PT: { m: ['João', 'Rui', 'Tiago', 'Nuno', 'Rafael'], f: ['Inês', 'Beatriz', 'Mariana', 'Catarina', 'Sofia'], last: ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Costa', 'Almeida'] },
  AU: { m: ['Jack', 'Liam', 'Mitchell', 'Lachlan', 'Cameron'], f: ['Chloe', 'Matilda', 'Olivia', 'Zoe', 'Jessica'], last: ['Smith', 'Jones', 'Williams', 'Brown', 'Wilson', 'Kelly'] },
  US: { m: ['Tyler', 'Ethan', 'Brandon', 'Connor', 'Wyatt'], f: ['Madison', 'Ashley', 'Emily', 'Megan', 'Taylor'], last: ['Johnson', 'Miller', 'Davis', 'Anderson', 'Thompson', 'Clark'] },
  NO: { m: ['Magnus', 'Håkon', 'Sander', 'Erlend', 'Jonas'], f: ['Ingrid', 'Kari', 'Silje', 'Thea', 'Nora'], last: ['Hansen', 'Johansen', 'Olsen', 'Larsen', 'Berg', 'Haugen'] },
  PL: { m: ['Tomasz', 'Piotr', 'Michał', 'Kamil', 'Jakub'], f: ['Agnieszka', 'Katarzyna', 'Magdalena', 'Ewa', 'Zofia'], last: ['Kowalski', 'Nowak', 'Wiśniewski', 'Wójcik', 'Kamiński', 'Lewandowski'] },
};

/** Ordre des nationalités des IA : un peloton mêlé, la France et ses voisins d'abord. */
export const AI_NATIONS = ['FR', 'ES', 'IT', 'BE', 'NL', 'GB', 'DE', 'CH', 'DK', 'SI', 'CO', 'PT', 'AU', 'US', 'NO', 'PL'] as const;

export interface AiIdentity {
  /** « Prénom NOM » de la nationalité. */
  name: string;
  /** Code ISO du pays. */
  nationality: string;
}

/** Identité du k-ième coureur IA ; `female` choisit un prénom féminin ou masculin. */
export function aiIdentity(k: number, female: boolean): AiIdentity {
  const nationality = AI_NATIONS[k % AI_NATIONS.length] as string;
  const pool = POOLS[nationality] as Pool;
  const round = Math.floor(k / AI_NATIONS.length);
  const firsts = female ? pool.f : pool.m;
  const first = firsts[(round + k) % firsts.length] as string;
  const last = pool.last[(round * 2 + k) % pool.last.length] as string;
  return { name: `${first} ${last.toLocaleUpperCase('fr')}`, nationality };
}
