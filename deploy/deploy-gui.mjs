// Outil de déploiement graphique autonome (sans dépendance) : une petite page locale, ouverte dans le navigateur,
// pour mettre à jour le VPS (git pull + docker, voir deploy.sh) et envoyer les zones (toutes, une seule,
// ou une nouvelle) et les vidéos du menu depuis le PC. La même chose est dans le panneau « Serveur » du
// constructeur de zone (pnpm zone-builder). Logique commune : deploy/deploy-core.mjs.
//
//   Windows : double-clic sur deploy/Deploy.bat      ou      pnpm deploy:gui      ou      node deploy/deploy-gui.mjs
//
// Sécurité : la page n'écoute que sur 127.0.0.1 et exige un jeton aléatoire (aucun autre site ne peut piloter
// l'outil). Outil du développeur : il n'est ni dans le jeu, ni dans l'installateur, ni dans les images Docker.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { configFile, DRY, job, loadConfig, localGit, localZones, remoteState, validConfig } from './deploy-core.mjs';

const token = randomBytes(18).toString('hex');

/* ───────────── Serveur local ───────────── */

const page = () => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Déploiement — Allez Robert !</title>
<style>
:root{--bg:#0a0e16;--card:#11151d;--line:rgba(255,255,255,.08);--fg:#f5f7fa;--mut:#9aa5b1;--acc:#ffd23f;--ok:#7fd18b;--warn:#f59e0b;--err:#f87171}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 70% -10%,rgba(255,196,92,.14),transparent 55%),var(--bg);color:var(--fg);font:14px/1.45 'Segoe UI',system-ui,sans-serif;padding:24px}
h1{margin:0 0 4px;font-size:28px;letter-spacing:-.02em}h1 em{color:var(--acc);font-style:normal}.sub{color:var(--mut);margin:0 0 20px}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:16px;align-items:start}@media(max-width:1000px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border-radius:16px;padding:18px 20px;box-shadow:0 14px 40px rgba(0,0,0,.4);margin-bottom:16px}
h2{margin:0 0 10px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--mut)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:8px 0}.mut{color:var(--mut)}.ok{color:var(--ok)}.warn{color:var(--warn)}.err{color:var(--err)}
button{appearance:none;border:0;border-radius:10px;padding:9px 16px;font:inherit;font-weight:700;cursor:pointer;background:rgba(255,255,255,.1);color:var(--fg)}button:hover{background:rgba(255,255,255,.18)}
button.p{background:var(--acc);color:#0a0e16}button.p:hover{filter:brightness(1.07)}button:disabled{opacity:.4;cursor:not-allowed}
input[type=text],input[type=number],select{background:rgba(255,255,255,.07);border:0;border-radius:8px;color:var(--fg);padding:7px 10px;font:inherit;min-width:0}
label.f{display:flex;flex-direction:column;gap:3px;color:var(--mut);font-size:12px}.cfg{display:grid;grid-template-columns:1fr 1fr;gap:10px}.cfg .w{grid-column:1/-1}
table{width:100%;border-collapse:collapse}th{text-align:left;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);padding:6px 8px;box-shadow:inset 0 -2px 0 var(--acc)}td{padding:7px 8px;border-top:1px solid var(--line)}tr:hover td{background:rgba(255,210,63,.06)}td.n{text-align:right;font-variant-numeric:tabular-nums}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;background:rgba(255,255,255,.08)}.chip.ok{background:rgba(127,209,139,.16)}.chip.new{background:rgba(255,210,63,.2);color:var(--acc)}.chip.old{background:rgba(245,158,11,.18);color:var(--warn)}
pre{margin:0;background:#06090f;border-radius:12px;padding:12px 14px;height:46vh;overflow:auto;font:12.5px/1.45 'Cascadia Mono',Consolas,monospace;white-space:pre-wrap;color:#cfd8e3}
details summary{cursor:pointer;color:var(--mut)}
</style></head><body>
<h1>Déploiement <em>Allez Robert !</em></h1><p class="sub">Met à jour le serveur et envoie les zones, depuis ce PC.</p>
<div class="grid"><div>
<div class="card"><h2>Application</h2><div id="gitbox" class="mut">Lecture de l’état…</div>
<div class="row"><label class="f">Branche à déployer sur le serveur<input type="text" id="branch" placeholder="(celle déjà en place)"></label>
<label class="f">Images Docker<select id="mode"><option value="build">Construites sur le serveur (sans CI)</option><option value="pull">Publiées par la CI (branche main)</option></select></label></div>
<div class="row"><label><input type="checkbox" id="push"> Envoyer d’abord mes commits vers GitHub (git push)</label></div>
<div class="row"><button class="p" id="update">Mettre à jour l’application (git pull + Docker)</button></div>
<p class="mut" style="margin:6px 0 0">Sur le serveur : <code>git pull</code> puis <code>deploy.sh</code> (sauvegarde, images, migrations, démarrage, contrôle de santé).</p></div>
<div class="card"><h2>Vidéos du menu</h2><div id="menubox" class="mut"></div><div class="row"><button id="sendmenu">Envoyer les vidéos du menu</button></div></div>
<div class="card"><h2>Connexion au serveur</h2><div class="cfg" id="cfg"></div><div class="row"><button id="savecfg">Enregistrer</button><button id="test">Tester la connexion</button><button id="installkey">Installer ma clé SSH sur le serveur</button></div>
<details open><summary>Si le serveur demande un mot de passe</summary><p class="mut">Les envois se font par clé SSH : cet outil ne saisit jamais de mot de passe. Le bouton « Installer ma clé SSH sur le serveur » ouvre une fenêtre noire où SSH demande le mot de passe, une seule fois ; ensuite plus rien à taper.</p></details></div>
</div><div>
<div class="card"><h2>Zones</h2><div id="zonesbox" class="mut">Lecture…</div>
<div class="row"><button class="p" id="sendsel">Envoyer la sélection</button><button id="sendnew">Envoyer les nouvelles et modifiées</button><button id="sendall">Tout envoyer</button><button id="refresh">Actualiser</button></div>
<p class="mut" style="margin:6px 0 0"><b>Nouvelle zone</b> : elle apparaît « Absente du serveur » dès qu’elle a un dossier <code>tiles/</code> avec <code>pack.json</code> dans <code>apps/client/public/worlds/</code>. Pense à commiter son <code>world.json</code> et le catalogue <code>index.json</code>, puis à mettre à jour l’application.</p></div>
<div class="card"><h2>Journal</h2><pre id="log"></pre></div>
</div></div>
<script>
const T=${JSON.stringify(token)};let busy=false,local=null,remote=null,cfg=null;
const $=id=>document.getElementById(id),mb=n=>n>=1e9?(n/1e9).toFixed(1)+' Go':Math.round(n/1e6)+' Mo';
const api=(p,o)=>fetch('/api/'+p+(p.includes('?')?'&':'?')+'t='+T,o).then(r=>r.json());
function log(s){const l=$('log');l.textContent+=s+'\\n';l.scrollTop=l.scrollHeight}
function lock(b){busy=b;document.querySelectorAll('button').forEach(x=>x.disabled=b)}
async function stream(action,body){if(busy)return;lock(true);$('log').textContent='';
 try{const r=await fetch('/api/run?t='+T,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,...body})});
  const rd=r.body.getReader(),dec=new TextDecoder();let buf='';for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\\n');buf=lines.pop();lines.forEach(l=>{if(l.startsWith('data:'))log(JSON.parse(l.slice(5)))})}}
 catch(e){log('✗ '+e.message)}lock(false);load()}
async function load(){local=await api('state');cfg=local.config;
 const g=local.git;$('gitbox').innerHTML='Branche locale : <b>'+g.branch+'</b> · '+g.last+(g.dirty?'<br><span class="warn">'+g.dirty+' fichier(s) non commité(s) : le serveur ne les verra pas.</span>':'')+(g.ahead?'<br><span class="warn">'+g.ahead+' commit(s) pas encore poussé(s) vers GitHub.</span>':'')+(g.worldsDirty?'<br><span class="mut">'+g.worldsDirty+' fichier(s) de zones modifiés (world.json, index.json…) à commiter si tu mets une zone à jour.</span>':'');
 if(!$('branch').value&&!window.__b){$('branch').value=g.branch;window.__b=1}
 $('cfg').innerHTML=[['host','Serveur (utilisateur@hôte)',1],['port','Port SSH',0],['key','Clé SSH',1],['repo','Dossier du dépôt sur le serveur',1],['url','Adresse publique',1]].map(([k,l,w])=>'<label class="f '+(w?'w':'')+'">'+l+'<input type="text" data-k="'+k+'" value="'+String(cfg[k]).replace(/"/g,'&quot;')+'"></label>').join('');
 const rem=await api('remote');remote=rem;
 $('menubox').innerHTML=rem.ok?'Sur le serveur : <b>'+rem.menu+'</b> fichier(s) loop-*':'<span class="err">'+(rem.error||'Serveur injoignable')+'</span>';
 if(rem.ok)$('gitbox').innerHTML+='<br>Serveur : branche <b>'+rem.branch+'</b> · '+rem.head;else $('gitbox').innerHTML+='<br><span class="err">Serveur : '+(rem.error||'injoignable').split('\\n')[0]+'</span>';
 drawZones()}
function status(z){if(!remote||!remote.ok)return['?','Serveur inconnu'];const v=remote.zones[z.id];if(v===undefined)return['new','Absente du serveur (nouvelle)'];return v===z.version?['ok','À jour']:['old','Différente (à mettre à jour)']}
function drawZones(){const zs=local.zones;if(!zs.length){$('zonesbox').textContent='Aucune zone avec tuiles dans apps/client/public/worlds.';return}
 $('zonesbox').innerHTML='<table><thead><tr><th></th><th>Zone</th><th style="text-align:right">Taille</th><th>État sur le serveur</th></tr></thead><tbody>'+zs.map(z=>{const[c,t]=status(z);return '<tr><td><input type="checkbox" data-z="'+z.id+'"></td><td><b>'+z.id+'</b></td><td class="n">'+mb(z.bytes)+'</td><td><span class="chip '+c+'">'+t+'</span></td></tr>'}).join('')+'</tbody></table>'}
function sel(){return[...document.querySelectorAll('[data-z]:checked')].map(x=>x.dataset.z)}
function go(ids,label){if(!ids.length)return alert('Aucune zone à envoyer.');const tot=local.zones.filter(z=>ids.includes(z.id)).reduce((s,z)=>s+z.bytes,0);if(confirm(label+' : '+ids.length+' zone(s), '+mb(tot)+' à envoyer vers le serveur. Continuer ?'))stream('send-zones',{ids})}
$('sendsel').onclick=()=>go(sel(),'Envoi de la sélection');
$('sendall').onclick=()=>go(local.zones.map(z=>z.id),'Envoi de toutes les zones');
$('sendnew').onclick=()=>go(local.zones.filter(z=>status(z)[0]!=='ok').map(z=>z.id),'Envoi des nouvelles et modifiées');
$('refresh').onclick=load;$('sendmenu').onclick=()=>confirm('Envoyer les vidéos du menu (≈250 Mo) vers le serveur ?')&&stream('send-menu',{});
$('update').onclick=()=>{const g=local.git;let m='Mettre à jour l’application sur le serveur ?\\n\\n• git pull'+($('branch').value?' (branche '+$('branch').value+')':'')+'\\n• deploy.sh : sauvegarde, images Docker, migrations, redémarrage.';if(g.dirty||g.ahead)m+='\\n\\n⚠ Des modifications locales ne sont pas poussées'+($('push').checked?' (elles le seront si les fichiers sont commités)':'')+'.';if(confirm(m))stream('update-app',{branch:$('branch').value.trim(),mode:$('mode').value,push:$('push').checked})};
$('savecfg').onclick=async()=>{const o={};document.querySelectorAll('[data-k]').forEach(i=>o[i.dataset.k]=i.dataset.k==='port'?Number(i.value):i.value);const r=await api('config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(o)});log(r.ok?'Réglages enregistrés.':'✗ '+r.error);load()};
$('installkey').onclick=()=>confirm('Installer ta clé SSH sur le serveur ?\\n\\nUne fenêtre noire va s’ouvrir : SSH y demandera le mot de passe du serveur (une seule fois).')&&stream('install-key',{});
$('test').onclick=async()=>{$('log').textContent='Test de la connexion…\\n';const r=await api('remote');log(r.ok?'✓ Connexion réussie. Branche du serveur : '+r.branch:'✗ '+r.error)};
load();
</script></body></html>`;

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  const send = (code, body, type = 'application/json') => {
    res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
  };
  if (url.searchParams.get('t') !== token) return send(403, 'Jeton invalide : relance l’outil.', 'text/plain');
  const readBody = () =>
    new Promise((r) => {
      let b = '';
      req.on('data', (d) => (b += d));
      req.on('end', () => {
        try {
          r(JSON.parse(b || '{}'));
        } catch {
          r({});
        }
      });
    });
  try {
    if (url.pathname === '/') return send(200, page(), 'text/html');
    if (url.pathname === '/api/state') return send(200, { config: loadConfig(), git: await localGit(), zones: localZones() });
    if (url.pathname === '/api/remote') {
      const c = loadConfig();
      if (DRY) return send(200, { ok: true, branch: '(essai à blanc)', head: '', zones: {}, menu: 0 });
      return send(200, await remoteState(c));
    }
    if (url.pathname === '/api/config' && req.method === 'POST') {
      const b = await readBody();
      const c = { ...loadConfig(), host: String(b.host ?? ''), port: Number(b.port), key: String(b.key ?? ''), repo: String(b.repo ?? ''), url: String(b.url ?? '') };
      if (!validConfig(c)) return send(200, { ok: false, error: 'Valeurs invalides (hôte utilisateur@domaine, port, dossier absolu, https://…).' });
      writeFileSync(configFile, JSON.stringify(c, null, 2));
      return send(200, { ok: true });
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const b = await readBody();
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
      const emit = (line) => res.write(`data:${JSON.stringify(line)}\n\n`);
      const code = await job(String(b.action), b, emit).catch((e) => (emit(`✗ ${e.message}`), 1));
      emit(code === 0 ? '\n— Terminé —' : '\n— Terminé avec des erreurs —');
      return res.end();
    }
    send(404, { error: 'introuvable' });
  } catch (e) {
    send(500, { error: String(e.message ?? e) });
  }
});

server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  const { port } = server.address();
  const addr = `http://127.0.0.1:${port}/?t=${token}`;
  console.log(`Déploiement Allez Robert ! — ${addr}${DRY ? '  (essai à blanc)' : ''}\nCtrl+C pour quitter.`);
  if (!process.env.NO_OPEN) {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', addr], { stdio: 'ignore', windowsHide: true });
    else spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [addr], { stdio: 'ignore' }).on('error', () => {});
  }
});
