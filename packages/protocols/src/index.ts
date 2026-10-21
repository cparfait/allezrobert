/**
 * @allezrobert/protocols — encodage/décodage purs (aucune E/S) des protocoles capteurs et home trainers :
 * FTMS, CPS, HRS, CSC, batterie, Device Information, ANT (trames USB + FE-C, PWR, HR), Wahoo Direct Connect,
 * et adaptateurs optionnels expérimentaux (manettes Zwift, HEADWIND, Di2 D-Fly…).
 * Les adaptateurs optionnels sont aussi exportés ici, mais restent inactifs tant que `devices` ne les active pas.
 */
export * from './bytes.ts';
export * from './uuids.ts';
export * from './revolutions.ts';
export * from './ble/ftms.ts';
export * from './ble/cycling-power.ts';
export * from './ble/heart-rate.ts';
export * from './ble/csc.ts';
export * from './ble/device-info.ts';
export * from './ant/message.ts';
export * from './ant/profiles.ts';
export * from './ant/fec.ts';
export * from './ant/power.ts';
export * from './ant/heart-rate.ts';
export * from './dircon.ts';
export * from './optional/index.ts';
