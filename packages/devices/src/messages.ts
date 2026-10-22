/** Messages d'avertissement affichés par l'écran d'appairage / le HUD (français). */
import type { DeviceWarningCode } from './types.ts';

export const WARNING_MESSAGES: Record<DeviceWarningCode, string> = {
  'trainer-control-not-permitted':
    "Le home trainer refuse le contrôle : une autre appli ou un compteur le pilote déjà (Garmin Edge, Zwift, appli Wahoo…). " +
    "Sur l'Edge 1050, gardez le trainer en simple capteur (ne pas le « contrôler ») ou déconnectez-le, puis réessayez. " +
    'Le jeu doit être le seul à piloter le trainer pendant une sortie.',
  'trainer-control-lost':
    'Le contrôle du home trainer a été pris par un autre appareil. Reprise automatique en cours ; vérifiez que l’Edge ou une autre appli ne le pilote pas.',
  'assioma-single-side':
    'Assioma : la balance gauche/droite n’arrive jamais. En Bluetooth, les Assioma DUO doivent être réglées en mode « G+D combiné » dans l’appli Favero ' +
    '(sinon une seule pédale est lue et la puissance est doublée). Ignorez ce message pour des Assioma UNO.',
  'single-ble-connection':
    'Ce capteur n’accepte qu’une seule connexion Bluetooth à la fois : fermez les autres applis (Favero, Zwift, téléphone) avant de l’appairer.',
  'sensor-silent': 'Capteur connecté mais muet depuis plus de 5 s (pile, mise en veille, distance ?).',
  'reconnect-failed': 'Impossible de se reconnecter à l’appareil après plusieurs essais.',
  'experimental-adapter': 'Adaptateur expérimental : protocole non documenté, peut cesser de fonctionner après une mise à jour du firmware.',
  'ant-network-key-missing':
    'Clé réseau ANT+ absente : renseignez-la dans les réglages de l’app (ANT_PLUS_NETWORK_KEY). Elle n’est pas fournie avec le jeu (licence ANT+).',
  'dircon-single-client': 'Direct Connect n’accepte qu’un client TCP à la fois : fermez les autres applis connectées en WiFi/Ethernet au trainer.',
  'command-failed': 'Le home trainer a refusé une commande.',
  'zwift-controller-locked':
    'Manette Zwift verrouillée par Zwift (Click v2 gauche, Ride v2) : ouvrez l’appli Zwift (compte gratuit), connectez-y la manette 10 à 30 s, ' +
    'fermez Zwift puis reconnectez-la ici. Le déverrouillage dure environ 24 h. Le palet droit du Click v2 fonctionne sans déverrouillage.',
  'sram-axs-not-bonded':
    'SRAM AXS non appairé : seuls des appuis anonymes sont lus (clic = monter, double clic = descendre). Pour lire le rapport engagé, ' +
    'lancez l’appairage en maintenant le bouton AXS du dérailleur jusqu’au clignotement (l’appli SRAM se ré-appairera seule ensuite).',
};
