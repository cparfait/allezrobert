/*
 * Allez Robert ! — utilitaires communs aux compositions HyperFrames (window.AR).
 *
 * Chargé par chaque composition (balise script vers assets/ar-seq.js, copié par
 * scripts/sync-assets.ts) ou injecté en ligne par l'assembleur du lecteur en jeu.
 * Aucune horloge, aucun hasard non semé, aucun accès réseau : tout est déterministe.
 */
(function () {
  'use strict';
  var W = window;

  function parseJson(text, fallback) {
    if (text === null || text === undefined || text === '') return fallback;
    if (typeof text !== 'string') return text;
    try {
      return JSON.parse(text);
    } catch (e) {
      return fallback;
    }
  }

  /** Valeurs des variables : défauts déclarés sur <html>, puis surcharges (CLI / lecteur). */
  function vars() {
    var out = {};
    var decls = parseJson(document.documentElement.getAttribute('data-composition-variables'), []);
    for (var i = 0; i < decls.length; i++) out[decls[i].id] = decls[i]['default'];
    var o = null;
    try {
      o = W.__hyperframes && W.__hyperframes.getVariables ? W.__hyperframes.getVariables() : null;
    } catch (e) {
      o = null;
    }
    var src = o && typeof o === 'object' ? o : W.__hfVariables || {};
    for (var k in src) if (Object.prototype.hasOwnProperty.call(src, k)) out[k] = src[k];
    return out;
  }

  var state = { lang: 'fr' };

  function setLang(lang) {
    state.lang = lang === 'en' ? 'en' : 'fr';
    document.documentElement.setAttribute('lang', state.lang);
    return state.lang;
  }

  function t(key) {
    var all = W.__AR_STRINGS || {};
    var table = all[state.lang] || {};
    if (table[key] !== undefined) return table[key];
    var fr = all.fr || {};
    return fr[key] !== undefined ? fr[key] : key;
  }

  /** Libellé : clé connue (ex. « tv.peloton ») ou texte libre. */
  function label(text) {
    if (!text) return '';
    var all = W.__AR_STRINGS || {};
    var fr = all.fr || {};
    return fr[text] !== undefined ? t(text) : String(text);
  }

  function locale() {
    return state.lang === 'en' ? 'en-GB' : 'fr-FR';
  }

  function num(n, decimals) {
    var d = decimals || 0;
    var v = Number(n) || 0;
    return new Intl.NumberFormat(locale(), { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  /** 3725 → « 1:02:05 », 95 → « 1:35 ». */
  function duration(sec) {
    var s = Math.max(0, Math.round(Number(sec) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var r = s % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
  }

  /** Temps de segment au dixième : 263.4 → « 4:23.4 ». */
  function segTime(sec) {
    var v = Math.max(0, Number(sec) || 0);
    var m = Math.floor(v / 60);
    var r = v - m * 60;
    var whole = Math.floor(r);
    var tenth = Math.floor((r - whole) * 10 + 1e-6);
    return m + ':' + pad2(whole) + (state.lang === 'en' ? '.' : ',') + tenth;
  }

  /** Écart : 42 → « +0:42 », 0 → « — ». */
  function gap(sec) {
    var v = Number(sec) || 0;
    if (v <= 0) return '—';
    return '+' + duration(v);
  }

  function ordinal(n) {
    var v = Math.round(Number(n) || 0);
    if (state.lang === 'en') {
      var m100 = v % 100;
      var m10 = v % 10;
      var suf = m100 >= 11 && m100 <= 13 ? 'th' : m10 === 1 ? 'st' : m10 === 2 ? 'nd' : m10 === 3 ? 'rd' : 'th';
      return v + suf;
    }
    return v === 1 ? '1er' : v + 'e';
  }

  /** PRNG semé (mulberry32) pour les décors « aléatoires » reproductibles. */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var x = a;
      x = Math.imul(x ^ (x >>> 15), x | 1);
      x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  function downsample(arr, max) {
    if (!arr || arr.length <= max) return arr || [];
    var out = [];
    var step = (arr.length - 1) / (max - 1);
    for (var i = 0; i < max; i++) out.push(arr[Math.round(i * step)]);
    return out;
  }

  /**
   * Profil d'altitude → chemins SVG { line, area, points } dans une boîte w × h.
   * `elev` : altitudes (m) régulièrement espacées en distance.
   */
  function profile(elev, w, h, opts) {
    var o = opts || {};
    var padTop = o.padTop || 4;
    var pts = downsample((elev || []).map(Number), o.maxPoints || 240);
    if (pts.length < 2) pts = [0, 0];
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      if (pts[i] < min) min = pts[i];
      if (pts[i] > max) max = pts[i];
    }
    var range = Math.max(max - min, o.minRange || 30);
    var xy = [];
    for (var j = 0; j < pts.length; j++) {
      var x = (j / (pts.length - 1)) * w;
      var y = padTop + (1 - (pts[j] - min) / range) * (h - padTop);
      xy.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    }
    var line = 'M' + xy.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L');
    var area = line + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    return { line: line, area: area, points: xy, min: min, max: max };
  }

  /**
   * Tracé du parcours → { d, points, length } dans une boîte w × h (marge `pad`).
   * `coords` : [[lat, lon], …] (projection « latlon ») ou [[x, y], …] (« xy », y vers le bas).
   */
  function trace(coords, w, h, opts) {
    var o = opts || {};
    var pad = o.pad === undefined ? 24 : o.pad;
    var src = downsample(coords || [], o.maxPoints || 400);
    if (src.length < 2) src = [[0, 0], [1, 1]];
    var pts = [];
    var latlon = (o.projection || 'latlon') === 'latlon';
    var lat0 = 0;
    if (latlon) {
      for (var a = 0; a < src.length; a++) lat0 += Number(src[a][0]);
      lat0 = (lat0 / src.length) * (Math.PI / 180);
    }
    for (var i = 0; i < src.length; i++) {
      var p = src[i];
      // lat/lon → plan équirectangulaire (x = est, y = sud), suffisant à l'échelle d'une sortie.
      pts.push(latlon ? [Number(p[1]) * Math.cos(lat0), -Number(p[0])] : [Number(p[0]), Number(p[1])]);
    }
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var k = 0; k < pts.length; k++) {
      if (pts[k][0] < minX) minX = pts[k][0];
      if (pts[k][0] > maxX) maxX = pts[k][0];
      if (pts[k][1] < minY) minY = pts[k][1];
      if (pts[k][1] > maxY) maxY = pts[k][1];
    }
    var sx = (w - 2 * pad) / Math.max(maxX - minX, 1e-9);
    var sy = (h - 2 * pad) / Math.max(maxY - minY, 1e-9);
    var s = Math.min(sx, sy);
    var ox = (w - (maxX - minX) * s) / 2;
    var oy = (h - (maxY - minY) * s) / 2;
    var out = [];
    var length = 0;
    for (var n = 0; n < pts.length; n++) {
      var x = Math.round((ox + (pts[n][0] - minX) * s) * 10) / 10;
      var y = Math.round((oy + (pts[n][1] - minY) * s) * 10) / 10;
      if (n > 0) length += Math.hypot(x - out[n - 1][0], y - out[n - 1][1]);
      out.push([x, y]);
    }
    var d = 'M' + out.map(function (q) { return q[0] + ' ' + q[1]; }).join(' L');
    return { d: d, points: out, length: length };
  }

  /** Point à la fraction `f` (0…1) de la longueur d'une polyligne. */
  function pointAt(points, f) {
    if (!points.length) return [0, 0];
    var total = 0;
    var seg = [];
    for (var i = 1; i < points.length; i++) {
      var l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
      seg.push(l);
      total += l;
    }
    var target = Math.max(0, Math.min(1, f)) * total;
    for (var j = 0; j < seg.length; j++) {
      if (target <= seg[j] || j === seg.length - 1) {
        var r = seg[j] > 0 ? target / seg[j] : 0;
        return [
          points[j][0] + (points[j + 1][0] - points[j][0]) * r,
          points[j][1] + (points[j + 1][1] - points[j][1]) * r,
        ];
      }
      target -= seg[j];
    }
    return points[points.length - 1];
  }

  /** Réduit la taille de police d'un élément pour tenir dans `maxWidth` (mesure à l'initialisation). */
  function fit(el, maxWidth, minPx) {
    if (!el) return;
    var size = parseFloat(W.getComputedStyle(el).fontSize) || 16;
    var min = minPx || 12;
    var guard = 40;
    while (el.scrollWidth > maxWidth && size > min && guard-- > 0) {
      size = Math.max(min, size * 0.92);
      el.style.fontSize = size + 'px';
    }
  }

  function text(id, value) {
    var el = typeof id === 'string' ? document.getElementById(id) : id;
    if (el) el.textContent = value;
    return el;
  }

  function el(tag, cls, content) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (content !== undefined) n.textContent = content;
    return n;
  }

  /** Couleur d'accent de la saison (ART_DIRECTION.md). */
  function seasonColor(season) {
    var map = { printemps: '#a9cf6a', ete: '#d8b86a', automne: '#e0a33a', hiver: '#c9d1d6' };
    return map[season] || '#ffd23f';
  }

  /**
   * Habillages de prévisualisation (désactivés en jeu) :
   *  - preview_backdrop : faux décor 3D derrière l'overlay, pour juger la lisibilité en rendu MP4 ;
   *  - show_safe_zones : contours des zones vitales du HUD (puissance, profil, mini-carte…).
   */
  function decorate(root, v) {
    if (v.preview_backdrop) {
      var bd = el('div', 'ar-backdrop');
      bd.setAttribute('data-layout-ignore', '');
      root.insertBefore(bd, root.firstChild);
    }
    if (v.show_safe_zones) {
      var zones = [
        ['ar-sz-top', 'Puissance · FC · cadence'],
        ['ar-sz-left', 'Infos'],
        ['ar-sz-map', 'Mini-carte'],
        ['ar-sz-riders', 'Coureurs proches'],
        ['ar-sz-gears', 'Vitesses'],
        ['ar-sz-profile', 'Profil'],
      ];
      var layer = el('div', 'ar-safe-zones');
      layer.setAttribute('data-layout-ignore', '');
      for (var i = 0; i < zones.length; i++) {
        var z = el('div', 'ar-sz ' + zones[i][0]);
        z.setAttribute('data-layout-ignore', '');
        z.appendChild(el('span', '', zones[i][1]));
        layer.appendChild(z);
      }
      root.appendChild(layer);
    }
  }

  /** Données « en direct » poussées par le jeu (SequencePlayer.update) — sans effet en rendu. */
  function onLive(channel, handler) {
    try {
      if (W.__hyperframes && typeof W.__hyperframes.registerRuntimeDataHandler === 'function') {
        W.__hyperframes.registerRuntimeDataHandler(channel, handler);
      }
    } catch (e) {
      /* runtime sans canal de données : on ignore */
    }
  }

  /** Construit après chargement des polices (mesures fiables), puis enregistre la timeline. */
  function ready(fn) {
    var fonts = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fonts.then(fn, fn);
  }

  W.AR = {
    vars: vars,
    json: parseJson,
    setLang: setLang,
    t: t,
    label: label,
    num: num,
    duration: duration,
    segTime: segTime,
    gap: gap,
    ordinal: ordinal,
    rng: rng,
    downsample: downsample,
    profile: profile,
    trace: trace,
    pointAt: pointAt,
    fit: fit,
    text: text,
    el: el,
    seasonColor: seasonColor,
    decorate: decorate,
    onLive: onLive,
    ready: ready,
  };
})();
