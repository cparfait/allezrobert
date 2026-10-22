/**
 * @allezrobert/physics — physique du vélo (Martin 1998), aspiration, groupe soudé,
 * vitesses virtuelles et pente trainer, posture d'avatar, coureurs IA, indicateurs
 * d'entraînement et séances (.zwo / .erg / .mrc). Code pur et déterministe, partagé par
 * le client (60 Hz) et le serveur (10 Hz).
 */
export * from './model.ts';
export * from './conditions.ts';
export * from './drafting.ts';
export * from './sticky-group.ts';
export * from './gearing.ts';
export * from './pose.ts';
export * from './rng.ts';
export * from './training.ts';
export * from './ai.ts';
export * from './workout/index.ts';
