/**
 * Page d'administration (/admin.html) : statistiques d'usage, inscrits et gestion des comptes.
 * Autonome : aucun code du jeu. L'API (/api/admin) refuse tout compte autre que l'administrateur ; cette page
 * n'est qu'un affichage. Sur un poste de développement, `?api=http://localhost:2567` désigne le serveur local.
 */
import './admin.css';

const apiParam = new URLSearchParams(location.search).get('api');
const API = (apiParam && /^http:\/\/localhost:\d+$/.test(apiParam) ? apiParam : '') + '/api';
const root = document.getElementById('admin') as HTMLElement;
const REDIRECT = '/admin.html';

const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
const nf = (n: number, d = 0): string => n.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const date = (v: string | null, withTime = false): string =>
  v ? new Date(v).toLocaleString('fr-FR', withTime ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const ago = (v: string | null): string => {
  if (!v) return 'jamais';
  const s = (Date.now() - new Date(v).getTime()) / 1000;
  if (s < 90) return 'à l’instant';
  if (s < 3600) return `il y a ${Math.round(s / 60)} min`;
  if (s < 86400) return `il y a ${Math.round(s / 3600)} h`;
  return `il y a ${Math.round(s / 86400)} j`;
};
const hm = (s: number): string => `${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`;

async function api<T = any>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await fetch(`${API}/admin${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'content-type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, data: data as T };
}

/* ───────────── Portails : connexion, refus, mot de passe ───────────── */
function gate(html: string): void {
  root.innerHTML = `<div class="ad-gate"><div class="ad-card"><h1>Allez <em>Robert</em> ! <small class="muted" style="font-size:13px">admin</small></h1>${html}</div></div>`;
}

async function showLogin(): Promise<void> {
  let prov: { google?: boolean; discord?: boolean; email?: boolean; dev?: boolean } = {};
  try {
    prov = await (await fetch(`${API}/auth/providers`, { credentials: 'include' })).json();
  } catch {
    // Serveur injoignable : on affiche tout de même le message.
  }
  const back = encodeURIComponent(REDIRECT);
  const btn = (p: string, label: string) => `<a class="ad-btn" style="display:block;text-align:center;text-decoration:none;margin-top:10px;padding:11px" href="${API}/auth/${p}/start?redirect=${back}">${label}</a>`;
  gate(`<p>Page réservée à l’administrateur. Connecte-toi avec le compte autorisé.</p>
    ${prov.google ? btn('google', 'Continuer avec Google') : ''}${prov.discord ? btn('discord', 'Continuer avec Discord') : ''}
    ${prov.email ? `<div class="ad-sep">ou par e-mail</div><form id="magic"><input type="email" id="em" required placeholder="adresse e-mail du compte" autocomplete="email" /><button class="ad-btn primary" type="submit">Recevoir un lien de connexion</button></form>` : ''}
    ${prov.dev ? `<form id="dev"><button class="ad-btn" type="submit">Connexion de développement</button></form>` : ''}
    ${!prov.google && !prov.discord && !prov.email && !prov.dev ? '<p class="ad-msg">Aucune méthode de connexion disponible (serveur injoignable ?).</p>' : ''}
    <div class="ad-msg" id="msg"></div>`);
  const msg = root.querySelector('#msg') as HTMLElement;
  root.querySelector('#magic')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = (root.querySelector('#em') as HTMLInputElement).value.trim();
    const r = await fetch(`${API}/auth/magic`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, redirect: REDIRECT, locale: 'fr' }) }).catch(() => null);
    msg.className = r?.ok ? 'ad-msg ok' : 'ad-msg';
    msg.textContent = r?.ok ? 'Lien envoyé : ouvre ton e-mail sur cet appareil.' : 'Envoi impossible pour le moment.';
  });
  root.querySelector('#dev')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    await fetch(`${API}/auth/dev`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Admin' }) });
    void start();
  });
}

function showDenied(): void {
  gate(`<p>Ce compte n’a pas accès à l’administration.</p><a class="ad-btn" style="display:block;text-align:center;text-decoration:none" href="/jouer">Retour au jeu</a>`);
}

function showPassword(error = ''): void {
  gate(`<p>Mot de passe administrateur requis.</p>
    <form id="pw"><input type="password" id="pwd" autocomplete="current-password" placeholder="Mot de passe" autofocus required /><button class="ad-btn primary" type="submit">Déverrouiller</button></form>
    <div class="ad-msg" id="msg">${esc(error)}</div>`);
  (root.querySelector('#pwd') as HTMLInputElement).focus();
  root.querySelector('#pw')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api('POST', '/unlock', { password: (root.querySelector('#pwd') as HTMLInputElement).value });
    if (r.status === 200) return void start();
    showPassword(r.status === 429 ? 'Trop d’essais : réessaie dans quelques minutes.' : 'Mot de passe incorrect.');
  });
}

/* ───────────── Application ───────────── */
interface Stats {
  generatedAt: string;
  users: { total: number; disabled: number; new7d: number; new30d: number; seen24h: number; seen7d: number; seen30d: number; riding7d: number; riding30d: number };
  providers: Array<{ provider: string; n: number }>;
  activities: { total: number; distanceKm: number; elevationM: number; movingH: number };
  friendships: number;
  topRoutes: Array<{ routeId: string; n: number }>;
  daily: Array<{ day: string; signups: number; rides: number; km: number; riders: number }>;
  live: { rooms: number; riders: number; clients: number };
  server: { uptimeS: number; node: string };
}
interface UserRow {
  id: string;
  name: string;
  providers: string[];
  createdAt: string | null;
  lastLoginAt: string | null;
  lastRideAt: string | null;
  rides: number;
  distanceKm: number;
  level: number;
  disabled: boolean;
}

let tab: 'stats' | 'users' = 'stats';
let refresh: ReturnType<typeof setInterval> | undefined;
let users: UserRow[] = [];
let query = '';
let sort = 'created';

async function start(): Promise<void> {
  clearInterval(refresh);
  const st = await api('GET', '/status');
  if (st.status === 401) return void showLogin();
  if (st.status !== 200) return showDenied();
  if (st.data.passwordRequired && !st.data.unlocked) return showPassword();
  shell(st.data.name);
}

function shell(name: string): void {
  root.innerHTML = `<header class="ad-top">
      <div class="ad-brand">Allez <em>Robert</em> ! <small>Administration</small></div>
      <nav class="ad-tabs"><button class="ad-tab" data-tab="stats">Statistiques</button><button class="ad-tab" data-tab="users">Inscrits</button></nav>
      <div class="ad-right"><span id="stamp"></span><span>${esc(name)}</span><button class="ad-btn" id="reload">Actualiser</button><button class="ad-btn" id="lock">Verrouiller</button><a class="ad-btn" style="text-decoration:none" href="/jouer">Jeu</a></div>
    </header><main id="view"></main><div id="drawer"></div>`;
  root.querySelectorAll<HTMLElement>('.ad-tab').forEach((b) => b.addEventListener('click', () => ((tab = b.dataset.tab as typeof tab), render())));
  (root.querySelector('#reload') as HTMLElement).onclick = () => void render();
  (root.querySelector('#lock') as HTMLElement).onclick = async () => {
    await api('POST', '/lock');
    void start();
  };
  void render();
  refresh = setInterval(() => tab === 'stats' && !document.hidden && void render(true), 30_000);
}

async function render(silent = false): Promise<void> {
  root.querySelectorAll<HTMLElement>('.ad-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  const view = root.querySelector('#view') as HTMLElement;
  if (!view) return;
  if (!silent) view.innerHTML = '<p class="muted">Chargement…</p>';
  if (tab === 'stats') {
    const r = await api<Stats>('GET', '/stats');
    if (r.status === 403 || r.status === 401) return void start();
    if (r.status !== 200) return void (view.innerHTML = '<p class="ad-msg">Statistiques indisponibles.</p>');
    view.innerHTML = statsHtml(r.data);
    (root.querySelector('#stamp') as HTMLElement).textContent = `actualisé à ${new Date(r.data.generatedAt).toLocaleTimeString('fr-FR')}`;
  } else {
    await loadUsers(view);
  }
}

/* ───────────── Statistiques ───────────── */
function kpi(label: string, value: string, sub = '', hot = false): string {
  return `<div class="ad-kpi${hot ? ' hot' : ''}"><small>${label}</small><b class="num">${value}</b><span>${sub}</span></div>`;
}

function bars(data: Array<{ day: string; v: number; v2?: number }>, cls: string): string {
  const W = 600, H = 150, pad = 18;
  const max = Math.max(1, ...data.map((d) => d.v));
  const bw = (W - 2 * pad) / data.length;
  const rects = data.map((d, i) => {
    const h = (d.v / max) * (H - 34);
    return `<rect class="bar ${cls}" x="${(pad + i * bw + 1).toFixed(1)}" y="${(H - 18 - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${date(d.day)} : ${nf(d.v, d.v % 1 ? 1 : 0)}</title></rect>`;
  });
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><line class="axis" x1="${pad}" x2="${W - pad}" y1="${H - 18}" y2="${H - 18}"/>${rects.join('')}
    <text x="${pad}" y="${H - 4}">${date(data[0]!.day)}</text><text x="${W - pad}" y="${H - 4}" text-anchor="end">${date(data.at(-1)!.day)}</text><text x="${pad}" y="11">max ${nf(max, max % 1 ? 1 : 0)}</text></svg>`;
}

function statsHtml(s: Stats): string {
  const u = s.users;
  const maxRoute = Math.max(1, ...s.topRoutes.map((t) => t.n));
  const maxProv = Math.max(1, ...s.providers.map((p) => p.n));
  return `<h2>Inscrits</h2><div class="ad-kpis">
      ${kpi('Inscrits', nf(u.total), u.disabled ? `${u.disabled} suspendu${u.disabled > 1 ? 's' : ''}` : 'aucun suspendu', true)}
      ${kpi('Nouveaux · 7 jours', nf(u.new7d), `${nf(u.new30d)} sur 30 jours`)}
      ${kpi('Connectés · 24 h', nf(u.seen24h), `${nf(u.seen7d)} sur 7 j · ${nf(u.seen30d)} sur 30 j`)}
      ${kpi('Ont roulé · 7 jours', nf(u.riding7d), `${nf(u.riding30d)} sur 30 jours`)}
      ${kpi('En ligne maintenant', `<span class="ad-live">${nf(s.live.riders)}</span>`, `${s.live.rooms} salle${s.live.rooms > 1 ? 's' : ''} · ${s.live.clients} connexion${s.live.clients > 1 ? 's' : ''}`)}
    </div>
    <h2>Usage</h2><div class="ad-kpis">
      ${kpi('Sorties', nf(s.activities.total), 'envoyées au compte')}
      ${kpi('Distance', `${nf(s.activities.distanceKm)} km`, `${nf(s.activities.elevationM)} m de dénivelé`)}
      ${kpi('Temps de selle', `${nf(s.activities.movingH)} h`, 'toutes sorties')}
      ${kpi('Amitiés', nf(s.friendships), 'liens ami / demande')}
      ${kpi('Serveur', hm(s.server.uptimeS), `en marche · Node ${esc(s.server.node)}`)}
    </div>
    <h2>30 derniers jours</h2><div class="ad-grid2">
      <div class="ad-box ad-chart"><h3>Inscriptions par jour</h3>${bars(s.daily.map((d) => ({ day: d.day, v: d.signups })), '')}</div>
      <div class="ad-box ad-chart"><h3>Sorties par jour</h3>${bars(s.daily.map((d) => ({ day: d.day, v: d.rides })), '')}</div>
      <div class="ad-box ad-chart"><h3>Kilomètres par jour</h3>${bars(s.daily.map((d) => ({ day: d.day, v: d.km })), 'b2')}</div>
      <div class="ad-box ad-chart"><h3>Coureurs actifs par jour</h3>${bars(s.daily.map((d) => ({ day: d.day, v: d.riders })), 'b2')}</div>
    </div>
    <h2>Répartition</h2><div class="ad-grid2">
      <div class="ad-box"><h3>Itinéraires les plus roulés</h3>${s.topRoutes.map((t) => `<div class="ad-hbar"><span class="t" title="${esc(t.routeId)}">${esc(t.routeId)}</span><span class="b"><i style="width:${(t.n / maxRoute) * 100}%"></i></span><b class="num">${t.n}</b></div>`).join('') || '<p class="muted">Pas encore de sortie enregistrée.</p>'}</div>
      <div class="ad-box"><h3>Modes de connexion</h3>${s.providers.map((p) => `<div class="ad-hbar"><span class="t">${esc(p.provider)}</span><span class="b"><i style="width:${(p.n / maxProv) * 100}%"></i></span><b class="num">${p.n}</b></div>`).join('') || '<p class="muted">—</p>'}</div>
    </div>`;
}

/* ───────────── Inscrits ───────────── */
async function loadUsers(view: HTMLElement): Promise<void> {
  const r = await api<{ total: number; users: UserRow[] }>('GET', `/users?sort=${encodeURIComponent(sort)}`);
  if (r.status === 403 || r.status === 401) return void start();
  users = r.data?.users ?? [];
  view.innerHTML = `<div class="ad-tools">
      <input class="ad-search" id="q" type="search" placeholder="Chercher un nom, un identifiant, un mode de connexion…" value="${esc(query)}" />
      <select id="sort"><option value="created">Plus récents</option><option value="login">Dernière connexion</option><option value="rides">Plus de sorties</option><option value="distance">Plus de kilomètres</option><option value="name">Nom A → Z</option></select>
      <button class="ad-btn" id="csv">Exporter en CSV</button><span class="muted" id="count"></span>
    </div>
    <div class="ad-table-wrap"><table><thead><tr><th>Nom</th><th>Connexion</th><th>Inscrit</th><th>Dernière connexion</th><th>Dernière sortie</th><th class="r">Sorties</th><th class="r">Km</th><th class="r">Niveau</th><th>État</th></tr></thead><tbody id="rows"></tbody></table></div>
    <p class="muted" style="margin-top:10px">Les adresses e-mail ne sont pas conservées en clair par le serveur (empreinte seulement) : elles ne peuvent pas être affichées ici.</p>`;
  (view.querySelector('#sort') as HTMLSelectElement).value = sort;
  view.querySelector('#q')?.addEventListener('input', (e) => ((query = (e.target as HTMLInputElement).value), rows()));
  view.querySelector('#sort')?.addEventListener('change', (e) => ((sort = (e.target as HTMLSelectElement).value), void loadUsers(view)));
  (view.querySelector('#csv') as HTMLElement).onclick = exportCsv;
  rows();
}

function visible(): UserRow[] {
  const q = query.trim().toLowerCase();
  return q ? users.filter((u) => u.name.toLowerCase().includes(q) || u.id.startsWith(q) || u.providers.some((p) => p.includes(q))) : users;
}

function rows(): void {
  const tbody = root.querySelector('#rows') as HTMLElement | null;
  if (!tbody) return;
  const list = visible();
  (root.querySelector('#count') as HTMLElement).textContent = `${list.length} compte${list.length > 1 ? 's' : ''}`;
  tbody.innerHTML = list.length
    ? list
        .map(
          (u) => `<tr data-id="${esc(u.id)}"><td><b>${esc(u.name)}</b></td><td>${u.providers.map((p) => `<span class="ad-pill">${esc(p)}</span>`).join('') || '—'}</td><td>${date(u.createdAt)}</td><td title="${esc(date(u.lastLoginAt, true))}">${ago(u.lastLoginAt)}</td><td>${u.lastRideAt ? ago(u.lastRideAt) : '—'}</td><td class="r num">${u.rides}</td><td class="r num">${nf(u.distanceKm, 1)}</td><td class="r num">${u.level}</td><td>${u.disabled ? '<span class="ad-pill bad">suspendu</span>' : '<span class="ad-pill ok">actif</span>'}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="9" class="ad-empty">Aucun compte ne correspond.</td></tr>';
  tbody.querySelectorAll<HTMLElement>('tr[data-id]').forEach((tr) => tr.addEventListener('click', () => void openUser(tr.dataset.id as string)));
}

function exportCsv(): void {
  const head = ['id', 'nom', 'connexion', 'inscrit', 'derniere_connexion', 'derniere_sortie', 'sorties', 'km', 'niveau', 'suspendu'];
  const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = visible().map((u) => [u.id, u.name, u.providers.join('+'), u.createdAt, u.lastLoginAt, u.lastRideAt, u.rides, u.distanceKm, u.level, u.disabled ? 'oui' : 'non'].map(cell).join(','));
  const blob = new Blob(['﻿' + [head.join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `inscrits-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ───────────── Fiche d'un compte ───────────── */
async function openUser(id: string): Promise<void> {
  const drawer = root.querySelector('#drawer') as HTMLElement;
  const r = await api<any>('GET', `/users/${encodeURIComponent(id)}`);
  if (r.status !== 200) return;
  const u = r.data;
  const close = () => (drawer.innerHTML = '');
  drawer.innerHTML = `<div class="ad-drawer-bg"><aside class="ad-drawer"><button class="ad-btn ad-x" id="x">Fermer</button>
    <h3>${esc(u.name)} ${u.disabled ? '<span class="ad-pill bad">suspendu</span>' : ''}</h3><div class="id mono">${esc(u.id)}</div>
    <dl class="ad-dl">
      <dt>Inscrit le</dt><dd>${date(u.createdAt, true)}</dd>
      <dt>Dernière connexion</dt><dd>${date(u.lastLoginAt, true)} <span class="muted">(${ago(u.lastLoginAt)})</span></dd>
      <dt>Connexion via</dt><dd>${u.identities.map((i: any) => `<span class="ad-pill">${esc(i.provider)}</span>`).join('') || '—'}</dd>
      <dt>Sessions ouvertes</dt><dd>${u.sessions}</dd>
      ${u.progression ? `<dt>Progression</dt><dd>niveau ${u.progression.level} · ${nf(u.progression.xp)} XP</dd><dt>Total</dt><dd>${u.progression.rides} sorties · ${nf(u.progression.distanceKm, 1)} km · ${nf(u.progression.elevationM)} m D+</dd>` : ''}
      ${u.disabled ? `<dt>Suspendu le</dt><dd>${date(u.disabledAt, true)}</dd>` : ''}
    </dl>
    <div class="ad-actions"><button class="ad-btn" id="toggle">${u.disabled ? 'Réactiver le compte' : 'Suspendre le compte'}</button><button class="ad-btn" id="logout">Déconnecter partout</button><button class="ad-btn danger" id="del">Supprimer…</button></div>
    <div class="ad-msg" id="dmsg"></div>
    <h2>Dernières sorties</h2>
    ${u.activities.length ? `<div class="ad-table-wrap"><table class="ad-mini"><thead><tr><th>Date</th><th>Nom</th><th class="r">Km</th><th class="r">D+</th><th class="r">Durée</th><th class="r">W moy.</th></tr></thead><tbody>${u.activities.map((a: any) => `<tr style="cursor:default"><td>${date(a.startedAt)}</td><td>${esc(a.name)}</td><td class="r num">${nf(a.distanceKm, 1)}</td><td class="r num">${a.elevationM}</td><td class="r num">${hm(a.durationS)}</td><td class="r num">${a.avgWatts ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Aucune sortie.</p>'}
  </aside></div>`;
  const msg = drawer.querySelector('#dmsg') as HTMLElement;
  (drawer.querySelector('#x') as HTMLElement).onclick = close;
  drawer.querySelector('.ad-drawer-bg')?.addEventListener('click', (e) => e.target === e.currentTarget && close());
  const done = async (m: string) => {
    msg.className = 'ad-msg ok';
    msg.textContent = m;
    if (tab === 'users') await loadUsers(root.querySelector('#view') as HTMLElement);
  };
  (drawer.querySelector('#toggle') as HTMLElement).onclick = async () => {
    const r2 = await api('POST', `/users/${encodeURIComponent(id)}/disable`, { disabled: !u.disabled });
    if (r2.status === 200) {
      await done(u.disabled ? 'Compte réactivé.' : 'Compte suspendu : ses sessions sont fermées.');
      void openUser(id);
    } else msg.textContent = (r2.data as any)?.message ?? 'Action impossible.';
  };
  (drawer.querySelector('#logout') as HTMLElement).onclick = async () => {
    const r2 = await api('POST', `/users/${encodeURIComponent(id)}/logout`);
    if (r2.status === 200) await done('Sessions fermées.');
    else msg.textContent = 'Action impossible.';
  };
  (drawer.querySelector('#del') as HTMLElement).onclick = async () => {
    const typed = prompt(`Suppression DÉFINITIVE du compte « ${u.name} » (sorties, progression, amis…).\nPour confirmer, saisis exactement son nom :`);
    if (typed === null) return;
    const r2 = await api('DELETE', `/users/${encodeURIComponent(id)}`, { confirm: typed });
    if (r2.status === 204) {
      close();
      if (tab === 'users') await loadUsers(root.querySelector('#view') as HTMLElement);
    } else {
      msg.className = 'ad-msg';
      msg.textContent = (r2.data as any)?.message ?? 'Suppression impossible.';
    }
  };
}

void start();
