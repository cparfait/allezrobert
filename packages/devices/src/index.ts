/**
 * @allezrobert/devices — interface unique vers le matériel : transports interchangeables
 * (Web Bluetooth, Bluetooth natif Tauri/btleplug, Wahoo Direct Connect, ANT+ USB, simulateur),
 * profils (FTMS, CPS, HRS, CSC, FE-C, ANT+ PWR/HR, adaptateurs expérimentaux), gestionnaire
 * d'appareils (rôles, priorités, reconnexion, capteur muet, lissage, power match, appairages).
 */
export * from './types.ts';
export * from './clock.ts';
export * from './random.ts';
export * from './messages.ts';
export * from './gatt-util.ts';
export * from './tauri.ts';
export * from './device.ts';
export * from './manager.ts';
export * from './pairing.ts';
export * from './power-match.ts';
export * from './smoothing.ts';
export * from './shifters.ts';
export * from './profiles/index.ts';
export * from './transports/web-bluetooth.ts';
export * from './transports/native-ble.ts';
export * from './transports/dircon.ts';
export * from './transports/ant.ts';
export * from './transports/simulator.ts';
