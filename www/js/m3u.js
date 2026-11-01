/* Leitura de listas M3U na própria TV (modo aberto, sem servidor).
 * Mesmas regras de server/m3u.js, em ES5. */
var M3U = (function () {
  var VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm)(\?|$)/i;
  var EPISODE = /^(.*?)[\s._\-–|]*S(\d{1,2})[\s._]*E(\d{1,4})\b[\s._\-–|]*(.*)$/i;

  // id curto e estável (FNV-1a), para favoritos/histórico sobreviverem a atualizações da lista
  function id(s) {
    var a = 0x811c9dc5, b = 0x01000193;
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193); // Math.imul existe desde o Chromium 28
      b = Math.imul(b ^ c, 0x811c9dc5);
    }
    return (a >>> 0).toString(36) + (b >>> 0).toString(36);
  }

  function attr(line, name) {
    var m = line.match(new RegExp(name + '="([^"]*)"'));
    return m ? m[1] : '';
  }

  // "Globo SP FHD" → nome "Globo SP" e qualidade "FHD" (só no fim do nome)
  var QUALITY = /[\s\-–|]*[\[(]?\b(4K|UHD|FHD|FULL\s?HD|HD|SD)\b[\])]?\s*$/i;
  var Q_LABEL = { '4K': '4K', UHD: '4K', FHD: 'FHD', HD: 'HD', SD: 'SD' };

  function quality(name) {
    var m = name.match(QUALITY), clean = m ? name.slice(0, m.index).trim() : '';
    if (!m || !clean) return { n: name, q: '' };
    return { n: clean, q: Q_LABEL[m[1].toUpperCase().replace(/\s/g, '')] || 'FHD' }; // FULL HD → FHD
  }

  // identidade do canal no provedor, igual para todos os clientes: o número no fim do link do Xtream
  // (".../12345" ou ".../12345.ts"); sem número, o nome. Só o número sai daqui, nunca o link
  function provKey(url, name) {
    var m = url.match(/\/(\d+)(?:\.[a-z0-9]{1,5})?(?:[?#].*)?$/i);
    return m ? 's' + m[1] : 'n:' + norm(name);
  }

  function norm(s) {
    s = String(s).toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }

  // canais com o mesmo nome no mesmo grupo são versões (SD/HD/FHD) de um canal só (TV e catálogo do portal)
  function mergeKey(c) { return c.g + '|' + norm(c.n); }

  function classify(url, group, name, epg) {
    // tvg-id é o id do guia de programação: é canal, mesmo num grupo chamado "Filmes"
    if (epg && !VOD_EXT.test(url) && !/\/(movie|series)\//i.test(url)) return 'live';
    if (/\/series\//i.test(url) || /s[ée]ries?|novelas?|animes?/i.test(group)) return 'series';
    if (EPISODE.test(name) && VOD_EXT.test(url)) return 'series';
    if (/\/movie\//i.test(url) || VOD_EXT.test(url) || /filmes?|movies?|vod|cinema/i.test(group)) return 'movie';
    return 'live';
  }

  // lê a lista linha a linha sem montar um array com todas (lista de dezenas de MB dobraria a memória na TV);
  // step(n) lê até n linhas e devolve true no fim; parseAsync lê em partes para a tela e o controle não travarem
  function parser(text) {
    var live = [], movies = [], series = [], byKey = {}, epg = '';
    var cur = null, grp = '', pos = 0, len = text.length;

    function line(l) {
      l = l.trim();
      if (!l) return;
      if (l.indexOf('#EXTM3U') === 0) {
        epg = attr(l, 'url-tvg') || attr(l, 'x-tvg-url'); // guia de programação que a própria lista indica
      } else if (l.indexOf('#EXTINF') === 0) {
        // o nome vem após a primeira vírgula fora das aspas dos atributos (e pode ter vírgulas e aspas)
        var head = (l.match(/^#EXTINF:[^,"]*(?:"[^"]*"[^,"]*)*,/) || [l + ','])[0];
        cur = {
          n: l.slice(head.length).trim() || attr(head, 'tvg-name') || 'Sem nome',
          l: attr(head, 'tvg-logo'),
          g: attr(head, 'group-title'),
          e: attr(head, 'tvg-id')
        };
      } else if (l.indexOf('#EXTGRP:') === 0) {
        grp = l.slice(8).trim();
      } else if (l.charAt(0) !== '#') {
        var c = cur || { n: l.split('/').pop(), l: '', g: '' };
        c.g = c.g || grp || 'Sem grupo';
        c.u = l;
        var type = classify(l, c.g, c.n, c.e);

        if (type === 'live') {
          var qn = quality(c.n);  // o id segue com o nome original: favoritos e histórico não mudam
          live.push({ id: id(c.n + '|' + l), k: provKey(l, c.n), n: qn.n, q: qn.q, e: c.e, l: c.l, g: c.g, u: l, num: live.length + 1 });
        } else if (type === 'movie') {
          movies.push({ id: id(l), n: c.n, l: c.l, g: c.g, u: l });
        } else {
          var m = c.n.match(EPISODE);
          var name = (m ? m[1] : c.n).trim() || c.n;
          var key = c.g + '|' + name.toLowerCase();
          var s = byKey[key];
          if (!s) { s = byKey[key] = { id: id('s:' + key), n: name, l: c.l, g: c.g, eps: [] }; series.push(s); }
          s.eps.push({ id: id(l), u: l, l: c.l, s: m ? +m[2] : 1, e: m ? +m[3] : s.eps.length + 1, n: m ? m[4].trim() : '' });
        }
        cur = null; grp = '';
      }
    }

    return {
      step: function (n) {
        while (n-- > 0 && pos < len) {
          var end = text.indexOf('\n', pos);
          if (end < 0) end = len;
          line(text.slice(pos, end));
          pos = end + 1;
        }
        return pos >= len;
      },
      frac: function () { return len ? Math.min(1, pos / len) : 1; },
      done: function () {
        series.forEach(function (s) { s.eps.sort(function (a, b) { return a.s - b.s || a.e - b.e; }); });
        return { live: live, movies: movies, series: series, epg: epg, updated: Date.now() };
      }
    };
  }

  function parse(text) { var p = parser(text); p.step(Infinity); return p.done(); }

  // em partes de 4000 linhas, devolvendo a vez à tela entre elas; onfrac(0–1)
  function parseAsync(text, onfrac) {
    var p = parser(text);
    return new Promise(function (resolve, reject) {
      (function next() {
        try {
          if (p.step(4000)) return resolve(p.done());
          if (onfrac) onfrac(p.frac());
          setTimeout(next, 0);
        } catch (e) { reject(e); }
      })();
    });
  }

  return { parse: parse, parseAsync: parseAsync, hash: id, quality: quality, key: provKey, norm: norm, mergeKey: mergeKey };
})();
