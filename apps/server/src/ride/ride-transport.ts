import type { Client } from '@colyseus/core';
import { WebSocketTransport, type TransportOptions } from '@colyseus/ws-transport';

const proofs = new WeakMap<Client['ref'], { fingerprint: string; pilot: boolean }>();

/** Colyseus restaure l'auth d'origine à la reprise. Le nouveau socket porte sa propre preuve. */
export function reconnectionCollisionProof(client: Client) {
  return proofs.get(client.ref);
}

export class RideTransport extends WebSocketTransport {
  constructor(options: TransportOptions) {
    super(options);
    this.wss.prependListener('connection', (socket, request) => {
      const params = new URLSearchParams(request.url?.split('?', 2)[1]);
      if (!params.has('reconnectionToken')) return;
      const values = params.getAll('collisionFingerprint');
      if (values.length === 1 && /^[0-9a-f]{64}$/.test(values[0]!)) {
        proofs.set(socket, { fingerprint: values[0]!, pilot: params.getAll('collisionPilot').join(',') === '1' });
      }
    });
  }
}
