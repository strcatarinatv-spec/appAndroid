/* Lista pela API Xtream (player_api.php) em vez do M3U inteiro: ao abrir vêm canais, filmes e a lista de séries,
 * sem episódios (numa lista real são 270 mil e era isso que derrubava a TV); os episódios de uma série vêm quando
 * ela é aberta. Os ids saem iguais aos do M3U (favoritos, histórico e "onde parou" continuam valendo): o link de
 * cada item é montado como o get.php do fornecedor monta. Sem a API (ou se ela falhar), o app usa o M3U de sempre.
 * ES5 de propósito. */
var Xtream = (function () {
  var x = {};

  // dados de acesso tirados do link da lista: http(s)://servidor/get.php?username=…&password=…&output=…
  x.creds = function (url) {
    var m = /^(https?:\/\/[^\/?#]+)\/get\.php\?([^#]*)$/i.exec(url || '');
    if (!m) return null;
    var q = {};
    m[2].split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) { try { q[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); } catch (e) {} }
    });
    if (!q.username || !q.password) return null;
    return { base: m[1], user: q.username, pass: q.password, out: q.output || 'ts', m3u: url };
  };

  function api(c, action, extra) {
    var url = c.base + '/player_api.php?username=' + encodeURIComponent(c.user) + '&password=' + encodeURIComponent(c.pass) +
      (action ? '&action=' + action : '') + (extra || '');
    return Api.getText(url).then(function (t) {
      var d;
      try { d = JSON.parse(t); } catch (e) { d = null; }
      if (!d || typeof d !== 'object') { var err = new Error('O fornecedor não respondeu pela API Xtream'); err.tipo = 'invalida'; throw err; }
      return d;
    });
  }

  // formato do link dos canais: varia de painel para painel (/live/u/s/123.m3u8, /u/s/123…). Lê só o começo do M3U
  // até o primeiro canal e para; sem isso, usa o formato padrão do Xtream
  // aprendido uma vez e guardado na TV por 30 dias (cada leitura conta como um acesso no painel do fornecedor)
  function liveFormat(c) {
    var fallback = { pre: c.base + '/live/' + c.user + '/' + c.pass + '/', ext: '.' + c.out }, key = 'ctv.xfmt.' + M3U.hash(c.m3u), saved = null;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch (e) {}
    if (saved && saved.pre && Date.now() - saved.at < 30 * 864e5) return Promise.resolve(saved);
    var keep = function (f) { try { localStorage.setItem(key, JSON.stringify({ pre: f.pre, ext: f.ext, at: Date.now() })); } catch (e) {} return f; };
    return new Promise(function (resolve) {
      var url = !window.webapis && /^https?:\/\//i.test(c.m3u) ? '/proxy?url=' + encodeURIComponent(c.m3u) : c.m3u;
      var r = new XMLHttpRequest(), done = false;
      var end = function (f) { if (done) return; done = true; clearTimeout(t); try { r.abort(); } catch (e) {} resolve(f || fallback); };
      var t = setTimeout(function () { end(); }, 25000);
      var look = function () {
        var txt = r.responseText || '', m = /#EXTINF[^\n]*\n(?:#[^\n]*\n)*([^#\s][^\r\n]*)\r?\n/.exec(txt);
        if (m) {
          var u = m[1].trim(), n = /^(.*?)(\d+)(\.\w+)?$/.exec(u);
          // o primeiro item precisa ser canal (lista começando por filme ou série: fica o padrão)
          return end(n && !/\/(movie|series)\//i.test(u) ? keep({ pre: n[1], ext: n[3] || '' }) : null);
        }
        if (txt.length > 512000) end();
      };
      r.open('GET', url, true);
      r.onprogress = look;
      r.onload = function () { look(); end(); };
      r.onerror = function () { end(); };
      r.send(null);
    });
  }

  // a assinatura no fornecedor: quantas telas ao mesmo tempo, quantas em uso agora e se está ativa
  x.info = function (c) {
    return api(c, '').then(function (d) {
      var u = d.user_info || {};
      return { telas: +u.max_connections || 0, ativas: +u.active_cons || 0, status: str(u.status) };
    });
  };

  function cats(list) { var o = {}; (list || []).forEach(function (k) { o[k.category_id] = k.category_name; }); return o; }
  var str = function (v) { return v == null ? '' : String(v); };

  // canais, filmes e séries (sem episódios), no mesmo formato do M3U.parse
  x.load = function (c, onprog) {
    var step = 0, tick = function () { step++; if (onprog) onprog(step / 7 * 95); };
    var got = {};
    var get = function (k, action) { return api(c, action).then(function (d) { got[k] = d; tick(); }); };
    // uma de cada vez: a TV tem pouca memória e cada resposta de filmes passa de 5 MB
    return x.info(c).then(function (i) { got.info = i; }, function () { got.info = {}; })
      .then(function () { return liveFormat(c); }).then(function (f) { got.fmt = f; tick(); })
      .then(function () { return get('lc', 'get_live_categories'); })
      .then(function () { return get('live', 'get_live_streams'); })
      .then(function () { return get('vc', 'get_vod_categories'); })
      .then(function () { return get('vod', 'get_vod_streams'); })
      .then(function () { return get('sc', 'get_series_categories'); })
      .then(function () { return get('ser', 'get_series'); })
      .then(function () { return build(c, got); });
  };

  function build(c, got) {
    var lc = cats(got.lc), vc = cats(got.vc), sc = cats(got.sc), f = got.fmt, live = [], movies = [], series = [];
    var vodBase = c.base + '/movie/' + c.user + '/' + c.pass + '/';
    (Array.isArray(got.live) ? got.live : []).forEach(function (s) {
      var n = str(s.name) || 'Sem nome', u = f.pre + s.stream_id + f.ext, qn = M3U.quality(n);
      live.push({ id: M3U.hash(n + '|' + u), k: M3U.key(u, n), n: qn.n, q: qn.q, e: str(s.epg_channel_id), l: str(s.stream_icon),
                  g: lc[s.category_id] || 'Sem grupo', u: u, num: live.length + 1 });
    });
    (Array.isArray(got.vod) ? got.vod : []).forEach(function (s) {
      var u = vodBase + s.stream_id + '.' + (s.container_extension || 'mp4');
      movies.push({ id: M3U.hash(u), n: str(s.name) || 'Sem nome', l: str(s.stream_icon), g: vc[s.category_id] || 'Sem grupo', u: u });
    });
    (Array.isArray(got.ser) ? got.ser : []).forEach(function (s) {
      var g = sc[s.category_id] || 'Sem grupo', n = str(s.name).trim() || 'Sem nome';
      // eps: null até a série ser aberta (Xtream.eps); mod: muda quando chega episódio ("episódios novos")
      series.push({ id: M3U.hash('s:' + g + '|' + n.toLowerCase()), n: n, l: str(s.cover), g: g, eps: null, xid: s.series_id, mod: +s.last_modified || 0 });
    });
    if (!live.length && !movies.length && !series.length) { var e = new Error('O fornecedor mandou uma lista vazia'); e.tipo = 'invalida'; throw e; }
    // guia que a própria lista indica (url-tvg do M3U): no Xtream é o xmltv.php
    var epg = c.base + '/xmltv.php?username=' + encodeURIComponent(c.user) + '&password=' + encodeURIComponent(c.pass);
    // telas: quantas ao mesmo tempo a assinatura aceita (1 = sem prévia dos canais, que gastaria a única)
    return { live: live, movies: movies, series: series, epg: epg, updated: Date.now(), fonte: 'xtream', telas: got.info.telas || 0 };
  }

  // episódios de uma série, no formato do M3U.parse ({ id, u, l, s, e, n }), em ordem
  x.eps = function (c, s) {
    return api(c, 'get_series_info', '&series_id=' + encodeURIComponent(s.xid)).then(function (d) {
      var out = [], base = c.base + '/series/' + c.user + '/' + c.pass + '/', all = d.episodes || {};
      Object.keys(all).forEach(function (k) {
        (Array.isArray(all[k]) ? all[k] : []).forEach(function (ep) {
          var u = base + ep.id + '.' + (ep.container_extension || 'mp4'), info = ep.info || {};
          // p: sinopse do episódio; dur: duração ("45 min"); d: data em que foi ao ar; r: nota; im: imagem do próprio
          // episódio (l cai na capa da série) — o que o fornecedor mandar, cada um com o nome que usar
          var hms = /^(\d+):(\d+):\d+$/.exec(str(info.duration)), secs = +info.duration_secs || 0;
          var dur = secs ? Math.round(secs / 60) + ' min' : hms ? (+hms[1] * 60 + +hms[2]) + ' min' : '';
          var im = str(info.movie_image || info.cover_big || info.still_path), nota = +info.rating || 0;
          out.push({ id: M3U.hash(u), u: u, l: im || s.l, im: /^https?:\/\//.test(im) ? im : '', s: +ep.season || +k || 1, e: +ep.episode_num || out.length + 1,
                     n: str(ep.title).replace(/^.*?S\d+\s*E\d+\s*[-–:]?\s*/i, ''), p: str(info.plot || info.description || info.overview).slice(0, 600), dur: dur,
                     d: str(info.releasedate || info.air_date || info.releaseDate).slice(0, 10), r: nota > 0 && nota <= 10 ? Math.round(nota * 10) / 10 : 0 });
        });
      });
      out.sort(function (a, b) { return a.s - b.s || a.e - b.e; });
      return out;
    });
  };

  return x;
})();
