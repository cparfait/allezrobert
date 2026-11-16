import { inDesktop, invoke } from '../platform/desktop.ts';

const desktopOrigin = inDesktop && !import.meta.env?.DEV
  ? (/Windows/i.test(navigator.userAgent) ? 'http://arv3.localhost' : 'arv3://localhost')
  : '';

export function v3Resource(path: string): string {
  return desktopOrigin + '/__v3/' + path;
}

async function access(code?: string): Promise<number> {
  if (desktopOrigin) return invoke<number>('v3_access', { code });
  const response = await fetch(v3Resource('access'), code === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', headers: { 'X-AR-V3-Code': code } });
  return response.status;
}

/**
 * État de l'accès V3 : 204 ouvert (en ligne, ou copie hors ligne de l'application de bureau), 403 code à saisir,
 * 503 service injoignable (pas de réseau) sans copie hors ligne.
 */
export async function v3AccessStatus(): Promise<number> {
  try {
    return await access();
  } catch {
    return 503;
  }
}

export async function hasV3Access(): Promise<boolean> {
  return await v3AccessStatus() === 204;
}

let recovery: Promise<void> | undefined;

/** Une seule demande de code, même si plusieurs ressources refusent une session expirée. */
export function recoverV3Access(): Promise<void> {
  return recovery ??= requestV3Access().then(unlocked => {
    if (unlocked) location.reload();
  });
}

export function requestV3Access(): Promise<boolean> {
  const fr = (localStorage.getItem('ar.lang') ?? navigator.language).startsWith('fr');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'v3-access-title');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="v3-access-title">${fr ? 'Accès au style Beta' : 'Access to style Beta'}</h2>
      <label>${fr ? 'Code d’accès' : 'Access code'}
        <input type="password" inputmode="numeric" autocomplete="off" required autofocus />
      </label>
      <p role="status"></p>
      <button type="button">${fr ? 'Annuler' : 'Cancel'}</button>
      <button type="submit">${fr ? 'Activer Beta' : 'Enable Beta'}</button>
    </form>`;
  const form = dialog.querySelector('form')!;
  const input = form.querySelector('input')!;
  const status = form.querySelector('p')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  form.querySelector('button[type="button"]')!.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    status.textContent = '';
    try {
      const result = await access(input.value);
      if (result === 204) {
        dialog.close('unlocked');
        return;
      }
      status.textContent = result === 429
        ? fr ? 'Trop de tentatives. Réessaie dans une minute.' : 'Too many attempts. Try again in a minute.'
        : result === 403
          ? fr ? 'Code incorrect.' : 'Incorrect code.'
          : fr ? 'Le service V3 est inaccessible.' : 'The V3 service is unreachable.';
    } catch {
      status.textContent = fr ? 'Le service Beta est inaccessible.' : 'The Beta service is unreachable.';
    } finally {
      submit.disabled = false;
      input.value = '';
      if (dialog.open) input.focus();
    }
  });
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      const unlocked = dialog.returnValue === 'unlocked';
      dialog.remove();
      resolve(unlocked);
    }, { once: true });
    document.body.append(dialog);
    dialog.showModal();
  });
}
