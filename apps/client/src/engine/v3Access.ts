const ENDPOINT = '/__v3/access';

export async function hasV3Access(): Promise<boolean> {
  try {
    return (await fetch(ENDPOINT, { cache: 'no-store' })).status === 204;
  } catch {
    return false;
  }
}

export function requestV3Access(): Promise<boolean> {
  const fr = (localStorage.getItem('ar.lang') ?? navigator.language).startsWith('fr');
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'v3-access-title');
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="v3-access-title">${fr ? 'Accès au style V3' : 'Access to style V3'}</h2>
      <label>${fr ? 'Code d’accès' : 'Access code'}
        <input type="password" inputmode="numeric" autocomplete="off" required autofocus />
      </label>
      <p role="status"></p>
      <button type="button">${fr ? 'Annuler' : 'Cancel'}</button>
      <button type="submit">${fr ? 'Activer V3' : 'Enable V3'}</button>
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
      const result = await fetch(ENDPOINT, { method: 'POST', headers: { 'X-AR-V3-Code': input.value } });
      if (result.status === 204) {
        dialog.close('unlocked');
        return;
      }
      status.textContent = result.status === 429
        ? fr ? 'Trop de tentatives. Réessaie dans une minute.' : 'Too many attempts. Try again in a minute.'
        : fr ? 'Code incorrect.' : 'Incorrect code.';
    } catch {
      status.textContent = fr ? 'Le service V3 est inaccessible.' : 'The V3 service is unreachable.';
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
