/**
 * Historique du jeu : SQLite dans l'appli de bureau, stockage du navigateur ailleurs ; API du
 * serveur pour la synchronisation (cookie de session, ou jeton dans l'appli de bureau).
 */
import { inDesktop, invoke } from '../../platform/desktop.ts';
import { apiBase } from '../../ui/account.ts';
import { BrowserHistoryStore, HistoryService, SqliteHistoryStore, tauriSqlDriver } from './index.ts';

export const rideHistory = new HistoryService(inDesktop ? new SqliteHistoryStore(tauriSqlDriver(invoke)) : new BrowserHistoryStore(), (path, init) =>
  fetch(`${apiBase()}${path}`, { credentials: 'include', ...init }),
);
