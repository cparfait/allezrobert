/* Site de présentation d'Allez Robert ! — télémétrie du hero, défilement, comparateur, zones, version publiée. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var root = document.documentElement;
  var body = document.body;
  var fr = function (n, d) { return n.toLocaleString('fr-FR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmtMo = function (b) { return (b / 1e6 < 10 ? (b / 1e6).toFixed(1) : Math.round(b / 1e6)).toString().replace('.', ',') + ' Mo'; };
  var ease = function (t) { return 1 - Math.pow(1 - t, 3); };

  /* ——— entrée du hero ——— */
  root.classList.add('ready');
  body.classList.add('ready');

  /* ——— compteurs du hero : même cadran que le jeu, valeurs en fonction du temps (pas d'aléatoire) ——— */
  var ZH = ['#9aa5b1', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7'], ZB = [.55, .75, .9, 1.05, 1.2, 1.5];
  var ZN = ['Z1 Récup', 'Z2 Endurance', 'Z3 Tempo', 'Z4 Seuil', 'Z5 VO2max', 'Z6 Anaérobie', 'Z7 Sprint'];
  var FTP = 250, DC = 2 * Math.PI * 66, DL = DC * .75;
  var hfc = $('#h-fc'), hr = $('#h-rpm'), hw = $('#h-w'), hwkg = $('#h-wkg'), hk = $('#h-kmh'), hp = $('#h-pct');
  var hfill = $('#h-fill'), hdial = $('#h-dial');
  var heroEl = $('.hero'), heroVisible = true;
  function tele() {
    var t = performance.now() / 1000;
    var pct = 9.4 + 0.7 * Math.sin(t * .35) + 0.25 * Math.sin(t * 1.1);
    var w = 214 + 40 * Math.sin(t * .5) + 9 * Math.sin(t * 2.6) + (pct - 9.4) * 14;
    var r = w / FTP, zi = 0;
    while (zi < ZB.length && r >= ZB[zi]) zi++;
    hw.textContent = Math.round(w);
    hfc.textContent = Math.round(144 + 6 * Math.sin(t * .25) + 3 * Math.sin(t * 1.7) + (w - 214) * .12);
    hr.textContent = Math.round(87 + 4 * Math.sin(t * 1.3) + 2 * Math.sin(t * 3.1));
    hk.textContent = fr(17.3 + 0.8 * Math.sin(t * .6) - (pct - 9.4) * .7, 1);
    hp.textContent = fr(pct, 1) + ' %';
    hwkg.textContent = fr(w / 76, 1) + ' W/kg · ' + ZN[zi];
    hfill.setAttribute('stroke-dasharray', Math.max(.01, Math.min(1, r / 1.6) * DL).toFixed(1) + ' ' + DC.toFixed(1));
    hfill.setAttribute('stroke', ZH[zi]);
    hdial.style.setProperty('--zone', ZH[zi]);
  }
  tele();
  if (!reduce) {
    new IntersectionObserver(function (en) { heroVisible = en[0].isIntersecting; }).observe(heroEl);
    setInterval(function () { if (heroVisible) tele(); }, 140);
  }

  /* ——— défilement : progression, barre du haut, parallaxe, coureur du bas de page ——— */
  var bar = $('#progress'), top = $('#top'), heroImg = $('#hero-img'), rider = $('.rider'), dl = $('#telecharger');
  var navLinks = $$('.top nav a');
  var sections = navLinks.map(function (a) { return $(a.getAttribute('href')); });
  var ticking = false;
  function onScroll() {
    ticking = false;
    var y = window.scrollY, h = document.documentElement.scrollHeight - window.innerHeight;
    bar.style.transform = 'scaleX(' + (h > 0 ? y / h : 0) + ')';
    top.classList.toggle('stuck', y > 30);
    if (!reduce && y < window.innerHeight * 1.2) heroImg.style.setProperty('--py', (y * .28).toFixed(1) + 'px');
    var r = dl.getBoundingClientRect(), vh = window.innerHeight;
    rider.style.setProperty('--rx', Math.max(0, Math.min(1, (vh - r.top) / (vh + r.height * .4))).toFixed(3));
    var cur = -1;
    sections.forEach(function (s, i) { if (s && s.getBoundingClientRect().top < vh * .4) cur = i; });
    navLinks.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
  }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* ——— apparition, chiffres ——— */
  function countUp(el) {
    var to = Number(el.dataset.count), t0 = performance.now(), dur = 1400;
    if (reduce) { el.textContent = fr(to); return; }
    (function tick(now) {
      var k = Math.min(1, (now - t0) / dur);
      el.textContent = fr(Math.round(to * ease(k)));
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      var c = $('[data-count]', e.target);
      if (c) countUp(c);
      io.unobserve(e.target);
    });
  }, { threshold: .14, rootMargin: '0px 0px -6% 0px' });
  $$('.reveal').forEach(function (el) {
    var sibs = el.parentElement ? $$('.reveal', el.parentElement).filter(function (s) { return s.parentElement === el.parentElement; }) : [];
    if (sibs.length > 1) el.style.setProperty('--d', (sibs.indexOf(el) % 4) * 0.08 + 's');
    io.observe(el);
  });

  /* ——— inclinaison des captures ——— */
  if (!reduce && window.matchMedia('(hover: hover)').matches) {
    $$('.tilt').forEach(function (f) {
      f.addEventListener('pointermove', function (e) {
        var b = f.getBoundingClientRect();
        f.style.setProperty('--ry', (((e.clientX - b.left) / b.width) - .5) * 5 + 'deg');
        f.style.setProperty('--rx', (.5 - ((e.clientY - b.top) / b.height)) * 4 + 'deg');
      });
      f.addEventListener('pointerleave', function () { f.style.setProperty('--ry', '0deg'); f.style.setProperty('--rx', '0deg'); });
    });
  }

  /* ——— comparateur ——— */
  var cmp = $('#compare'), rng = $('#compare-range');
  rng.addEventListener('input', function () { cmp.style.setProperty('--p', rng.value + '%'); });
  var cmpIo = new IntersectionObserver(function (en) {
    if (!en[0].isIntersecting || reduce) return;
    cmpIo.disconnect();
    var t0 = performance.now();
    (function tick(now) { // petit balayage d'invitation
      var k = Math.min(1, (now - t0) / 1800);
      if (rng.matches(':active') || document.activeElement === rng) return;
      var v = 50 + 28 * Math.sin(k * Math.PI * 2) * (1 - k);
      rng.value = v; cmp.style.setProperty('--p', v + '%');
      if (k < 1) requestAnimationFrame(tick);
    })(t0);
  }, { threshold: .6 });
  cmpIo.observe(cmp);

  /* ——— version publiée (deploy/publish-desktop.sh écrit version.json à côté des installateurs) ——— */
  fetch('/telechargement/version.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (v) {
      if (!v || !v.exe) return;
      var date = v.date ? new Date(v.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      $('#hero-version').textContent = 'Version ' + v.version + ' · ' + fmtMo(v.exe.bytes) + ' · Windows 10 / 11 · 64 bits · gratuit';
      $('#dl-version').textContent = 'Version ' + v.version + (date ? ' du ' + date : '') + ' · ' + fmtMo(v.exe.bytes);
      $$('a[data-dl="exe"]').forEach(function (a) { a.href = '/telechargement/' + v.exe.file; });
      if (v.msi) $$('a[data-dl="msi"]').forEach(function (a) { a.href = '/telechargement/' + v.msi.file; });
      else $('#dl-msi').removeAttribute('href');
      $('#dl-sha').textContent = 'SHA-256 : ' + v.exe.sha256;
    })
    .catch(function () {});

  /* ——— catalogue des zones : le même que celui du jeu ——— */
  var zones = [], sort = 'name', query = '';
  var norm = function (s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); };
  function stat(z) {
    var rs = z.routes || [];
    return {
      len: rs.reduce(function (m, r) { return Math.max(m, r.lengthM || 0); }, 0),
      gain: rs.reduce(function (m, r) { return Math.max(m, r.elevationGainM || 0); }, 0),
      n: rs.length
    };
  }
  function renderZones() {
    var list = $('#zone-list');
    var maxGain = zones.reduce(function (m, z) { return Math.max(m, z.s.gain); }, 1);
    var q = norm(query);
    var rows = zones.filter(function (z) { return !q || norm(z.name + ' ' + (z.region || '')).indexOf(q) >= 0; });
    rows.sort(function (a, b) {
      if (sort === 'gain') return b.s.gain - a.s.gain;
      if (sort === 'len') return b.s.len - a.s.len;
      return a.name.localeCompare(b.name, 'fr');
    });
    list.innerHTML = rows.length ? rows.map(function (z) {
      return '<div class="zone"><b>' + esc(z.name) + '</b><small>' + esc(z.region || '') + '</small>' +
        '<span>' + fr(z.s.len / 1000, 1) + ' km · +' + fr(Math.round(z.s.gain)) + ' m' + (z.s.n > 1 ? ' · ' + z.s.n + ' parcours' : '') + '</span>' +
        '<i style="--g:' + Math.max(4, Math.round(z.s.gain / maxGain * 100)) + '%"></i></div>';
    }).join('') : '<p class="none">Aucune zone ne correspond.</p>';
  }
  fetch('/worlds/index.json')
    .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
    .then(function (cat) {
      zones = (cat.zones || []).map(function (z) { z.s = stat(z); return z; });
      var n = zones.length;
      $('#zone-n').textContent = n;
      var sz = $('#stat-zones'); sz.dataset.count = n; sz.textContent = n;
      $('#ticker').innerHTML = [0, 1].map(function () {
        return zones.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'fr'); })
          .map(function (z) { return '<span>' + esc(z.name) + '</span>'; }).join('');
      }).join('');
      [['alpe-dhuez', 'g-alpe'], ['tourmalet', 'g-tourmalet'], ['etretat', 'g-etretat'], ['chevreuse', 'g-chevreuse']].forEach(function (p) {
        var z = zones.filter(function (x) { return x.id === p[0]; })[0];
        if (z) $('#' + p[1]).textContent = fr(z.s.len / 1000, 1) + ' km · +' + fr(Math.round(z.s.gain)) + ' m';
      });
      renderZones();
    })
    .catch(function () { $('#zone-list').innerHTML = '<p class="meta">La liste des zones est momentanément indisponible.</p>'; });
  $('#zone-q').addEventListener('input', function (e) { query = e.target.value; renderZones(); });
  $$('.sorts .chip').forEach(function (c) {
    c.addEventListener('click', function () {
      sort = c.dataset.sort;
      $$('.sorts .chip').forEach(function (o) { o.classList.toggle('on', o === c); });
      renderZones();
    });
  });
})();
