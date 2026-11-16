// Allez Robert : préréglages d'EZ-Tree retenus (chêne, frêne, tremble, pin).
import ashMedium from './ash_medium.json';
import aspenMedium from './aspen_medium.json';
import oakMedium from './oak_medium.json';
import oakLarge from './oak_large.json';
import pineMedium from './pine_medium.json';
import TreeOptions from '../options';

export const TreePreset = {
  'Ash Medium': ashMedium,
  'Aspen Medium': aspenMedium,
  'Oak Medium': oakMedium,
  'Oak Large': oakLarge,
  'Pine Medium': pineMedium,
};

/**
 * @param {string} name The name of the preset to load
 * @returns {TreeOptions}
 */
export function loadPreset(name) {
  const preset = TreePreset[name];
  return preset ? structuredClone(preset) : new TreeOptions();
}
