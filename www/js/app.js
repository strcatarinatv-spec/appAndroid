/* cTV — telas, catálogo e integração com a nuvem */
var App = (function () {
  var K = Nav.K;
  var VERSION = '1.9.0'; // a mesma de config.xml; aparece no painel
  var ROW_MAX = 30, GRID_PAGE = 60, LIST_ROWS = 11;
  // modo aberto: o app já vem com esta lista (dentro do pacote) e não precisa de servidor nem conta.
  // Só sinais que as próprias emissoras publicam abertamente; ver lista-padrao.m3u
  var OPEN_LIST = { id: 'aberta', name: 'Canais abertos', url: 'lista-padrao.m3u' };
  var DAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  var MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  var app = {
    playlists: [],
    cat: { live: [], movies: [], series: [] }, idx: {}, groups: { live: [], movies: [], series: [] },
    view: null, arg: null, stack: [], dirty: {}
  };

  /* ---------- Ícones e marca ---------- */

  var ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    live: '<rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="m16.5 2.5-4.5 4.5-4.5-4.5"/>',
    movies: '<rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M7.5 3v18M16.5 3v18M3 7.5h4.5M3 16.5h4.5M16.5 7.5H21M16.5 16.5H21M3 12h18"/>',
    series: '<rect x="2" y="7" width="16" height="14" rx="2.5"/><path d="M6 3h13a3 3 0 0 1 3 3v11"/><path d="m8.5 11 4.5 3-4.5 3z"/>',
    favs: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    guide: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18M8 9v11M3 14.5h18"/>',

  };
  var MENU = [
    ['home', 'Início'], ['live', 'Ao vivo'], ['guide', 'Guia'], ['movies', 'Filmes'], ['series', 'Séries'],
    ['favs', 'Minha lista'], ['search', 'Buscar'], ['settings', 'Ajustes']
  ];

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONS[name] + '</svg>';
  }

  // mesmo desenho de server/public/logo.svg: play com ondas de transmissão
  var LOGO = '<svg class="mark" viewBox="0 0 64 64"><defs><linearGradient id="lg" x1="0" y1="1" x2="1" y2="0">' +
    '<stop offset="0" stop-color="#134C92"/><stop offset=".28" stop-color="#1E88CF"/><stop offset=".48" stop-color="#2DAA5E"/>' +
    '<stop offset=".62" stop-color="#3AA94F"/><stop offset=".8" stop-color="#F5902A"/><stop offset="1" stop-color="#FF8A22"/></linearGradient></defs>' +
    '<rect x="2" y="2" width="60" height="60" rx="7" fill="url(#lg)"/>' +
    '<path d="M13.5 18 34 32 13.5 46z" fill="#fff" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M38.1 24.9a10 10 0 0 1 0 14.2M42.3 20.7a16 16 0 0 1 0 22.6M46.6 16.4a22 22 0 0 1 0 31.2" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/>' +
    '</svg><span class="word">Catarina <b>TV</b></span>';

  /* ---------- Utilidades de UI ---------- */

  var toastTimer;
  function toast(text) {
    $('toast').textContent = text;
    $('toast').classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { $('toast').classList.add('hidden'); }, 2500);
  }

  function loading(text) {
    $('loading').classList.toggle('hidden', !text);
    $('loadingText').textContent = text || '';
    $('stepBoot').style.visibility = text ? 'hidden' : ''; // na abertura, uma roda só (a com o %), não uma sobre a outra
  }

  function clock() {
    var d = new Date(), t = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
    var date = DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
    var times = document.querySelectorAll('.time'), dates = document.querySelectorAll('.date');
    for (var i = 0; i < times.length; i++) times[i].textContent = t;
    for (i = 0; i < dates.length; i++) dates[i].textContent = date;
    var h = d.getHours();
    $('hello').textContent = (h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite') +
      (remote && remote.name ? ', ' + remote.name : '') + '!';
  }

  /* ---------- Tempo na Home: cidade pelo IP e previsão do Open-Meteo, sem chave ---------- */

  // códigos WMO: o primeiro limite que o código não passa decide o ícone
  var SKY = [[0, 'sun'], [2, 'partly'], [3, 'cloud'], [48, 'fog'], [67, 'rain'], [77, 'snow'], [82, 'rain'], [86, 'snow'], [99, 'storm']];
  var WX = {
    sun: '<circle cx="24" cy="24" r="9" fill="#ffd34d"/><path d="M24 5v5M24 38v5M5 24h5M38 24h5M10.6 10.6l3.5 3.5M33.9 33.9l3.5 3.5M10.6 37.4l3.5-3.5M33.9 14.1l3.5-3.5" stroke="#ffd34d" stroke-width="3" stroke-linecap="round"/>',
    moon: '<path d="M30 8a16 16 0 1 0 10 26A14 14 0 0 1 30 8z" fill="#dfe6ff"/>',
    partly: '<circle cx="18" cy="17" r="8" fill="#ffd34d"/><path d="M15 38h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0 1 13z" fill="#eef2fb"/>',
    cloud: '<path d="M13 37h22a9 9 0 0 0 0-18 12 12 0 0 0-23 3.5A7.3 7.3 0 0 0 13 37z" fill="#dfe5f2"/>',
    fog: '<path d="M13 28h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z" fill="#dfe5f2"/><path d="M10 34h28M14 40h20" stroke="#c9d1e3" stroke-width="3" stroke-linecap="round"/>',
    rain: '<path d="M13 30h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z" fill="#dfe5f2"/><path d="M17 35l-2 6M25 35l-2 6M33 35l-2 6" stroke="#6ab0ff" stroke-width="3" stroke-linecap="round"/>',
    snow: '<path d="M13 30h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z" fill="#dfe5f2"/><circle cx="17" cy="38" r="2.5" fill="#fff"/><circle cx="25" cy="41" r="2.5" fill="#fff"/><circle cx="33" cy="38" r="2.5" fill="#fff"/>',
    storm: '<path d="M13 28h22a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0-1 13z" fill="#c9d1e3"/><path d="M26 29l-7 10h6l-3 8 9-12h-6l3-6z" fill="#ffd34d"/>'
  };

  function getJSON(url, done) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 15000;
    x.onload = function () { var r = null; try { r = JSON.parse(x.responseText); } catch (e) {} done(r); };
    x.onerror = x.ontimeout = function () { done(null); };
    x.send();
  }

  function stored(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  function weather() {
    var loc = stored('ctv.loc');
    if (loc && Date.now() - loc.at < 24 * 3600e3) return forecast(loc);
    getJSON('https://ipwho.is/', function (r) {
      if (!r || !r.latitude) return;   // sem rede: fica o último tempo mostrado
      loc = { at: Date.now(), city: r.city, lat: r.latitude, lon: r.longitude };
      localStorage.setItem('ctv.loc', JSON.stringify(loc));
      forecast(loc);
    });
  }

  function forecast(loc) {
    getJSON('https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&current=temperature_2m,weather_code,is_day&daily=precipitation_probability_max&timezone=auto&forecast_days=1', function (r) {
      if (!r || !r.current) return;
      var w = { city: loc.city, t: Math.round(r.current.temperature_2m), code: r.current.weather_code, day: r.current.is_day,
                rain: r.daily ? r.daily.precipitation_probability_max[0] : null };
      localStorage.setItem('ctv.wx', JSON.stringify(w));
      showWeather(w);
    });
  }

  function showWeather(w) {
    if (!w) return;
    var i = 0;
    while (i < SKY.length - 1 && w.code > SKY[i][0]) i++;
    var ic = SKY[i][1];
    if (!w.day && (ic === 'sun' || ic === 'partly')) ic = 'moon';
    $('wx').innerHTML = '<svg viewBox="0 0 48 48">' + WX[ic] + '</svg>' + w.t + '° ' + esc(w.city) +
      (w.rain != null ? '<i>' + w.rain + '% chuva</i>' : '');
  }

  function norm(s) {
    s = String(s).toLowerCase();
    return s.normalize ? s.normalize('NFD').replace(/[̀-ͯ]/g, '') : s;
  }

  /* ---------- Catálogo ---------- */

  function groupBy(list) {
    var map = {}, out = [];
    list.forEach(function (x) {
      if (!map[x.g]) { map[x.g] = { name: x.g, items: [] }; out.push(map[x.g]); }
      map[x.g].items.push(x);
    });
    return out;
  }

  /* ---------- Canal em várias qualidades: um canal só ---------- */

  var Q_RANK = { '4K': 4, FHD: 3, HD: 2, SD: 1 };

  // "Cazé TV 1 SD / HD / FHD" do mesmo grupo viram um canal com as versões em vs (melhor primeiro; nome
  // repetido sem qualidade também entra, como reserva). Fica o id da 1ª versão; a numeração é refeita sem buracos
  function mergeQualities(list) {
    var byKey = {}, out = [];
    list.forEach(function (x) {
      var k = M3U.mergeKey(x), ch = byKey[k], v = { q: x.q, u: x.u, id: x.id };
      if (!ch) { byKey[k] = x; x.vs = [v]; x.ks = [x.k]; out.push(x); return; }
      ch.vs.push(v);
      ch.ks.push(x.k); // números do canal no provedor (organização do portal), de todas as versões
      if (!ch.e && x.e) ch.e = x.e;
      if (!ch.l && x.l) ch.l = x.l;
    });
    out.forEach(function (ch, i) {
      ch.num = i + 1;
      if (ch.vs.length < 2) { delete ch.vs; return; }
      ch.vs.sort(function (a, b) { return (Q_RANK[b.q] || 0) - (Q_RANK[a.q] || 0); });
      pickQ(ch);
    });
    return out;
  }

  /* ---------- Qualidade pela internet ---------- */

  // velocidade de internet que cada qualidade pede (Mbps, com folga); sem rótulo conta como HD
  var Q_NEED = { '4K': 20, FHD: 8, HD: 4, SD: 1.5 };
  function qNeed(q) { return Q_NEED[q] || 4; }

  // velocidade medida (Mbps) e quando; mede de novo a cada 30 min, ao abrir e quando o vídeo trava
  var band = stored('ctv.banda') || { mbps: 0, at: 0 }, banding = false;
  function measureBand(force) {
    if (banding || (!force && band.at && Date.now() - band.at < 30 * 60000)) return Promise.resolve(band);
    banding = true;
    return new Promise(function (resolve) {
      var x = new XMLHttpRequest(), t0 = Date.now(), BYTES = 3000000;
      x.open('GET', 'https://speed.cloudflare.com/__down?bytes=' + BYTES + '&r=' + t0, true);
      x.responseType = 'arraybuffer';
      x.timeout = 20000;
      x.onload = function () {
        var secs = Math.max(0.05, (Date.now() - t0) / 1000), got = x.response ? x.response.byteLength : 0;
        if (x.status === 200 && got > BYTES / 2) {
          band = { mbps: Math.round(got * 8 / secs / 1e5) / 10, at: Date.now() };
          try { localStorage.setItem('ctv.banda', JSON.stringify(band)); } catch (e) {}
        }
        done();
      };
      x.onerror = x.ontimeout = done;
      function done() { banding = false; app.cat.live.forEach(pickQ); resolve(band); }
      x.send();
    });
  }

  function agoTxt(t) {
    var m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'agora' : m < 60 ? 'há ' + m + ' min' : m < 1440 ? 'há ' + Math.round(m / 60) + ' h' : 'há ' + Math.round(m / 1440) + ' dias';
  }

  // automática: a melhor versão que a internet medida aguenta (80% dela); sem medida, a melhor
  function autoIndex(ch) {
    if (!band.mbps) return 0;
    for (var j = 0; j < ch.vs.length; j++) if (qNeed(ch.vs[j].q) <= band.mbps * 0.8) return j;
    return ch.vs.length - 1;
  }

  // a versão escolhida no canal (por perfil, em settings.q); sem escolha, a automática pela internet
  function pickQ(ch) {
    if (!ch.vs) return;
    var want = (Cloud.state.settings.q || {})[ch.id], i = -1;
    for (var j = 0; j < ch.vs.length; j++) if (ch.vs[j].id === want) i = j;
    ch.auto = i < 0;
    if (i < 0) i = autoIndex(ch);
    ch.vi = i;
    ch.u = ch.vs[i].u;
    ch.q = ch.vs[i].q;
  }

  function qName(ch, i) { return ch.vs[i].q || 'Opção ' + (i + 1); }

  // escolhe a qualidade do canal: -1 = automática pela internet (apaga a escolha); senão a versão i
  function setQ(ch, i) {
    var s = Cloud.state.settings;
    s.q = s.q || {};
    if (i < 0) delete s.q[ch.id]; else s.q[ch.id] = ch.vs[i].id;
    Cloud.save('settings');
    pickQ(ch);
  }

  /* menu de qualidade do canal (tecla amarela ou o selo ⚙ na tela): Automática + cada versão */
  var qm = { ch: null, sel: 0, onpick: null };

  function openQMenu(ch, onpick) {
    if (!ch || !ch.vs) return toast('Este canal tem uma qualidade só');
    qm = { ch: ch, sel: ch.auto ? 0 : ch.vi + 1, onpick: onpick };
    renderQMenu();
    $('qmenu').classList.remove('hidden');
  }

  function renderQMenu() {
    var ch = qm.ch, net = band.mbps ? 'internet ' + band.mbps + ' Mbps' : 'internet ainda não medida';
    var items = [{ t: 'Automática', s: 'Agora em ' + qName(ch, ch.auto ? ch.vi : autoIndex(ch)) + ' · ' + net, on: ch.auto }]
      .concat(ch.vs.map(function (v, i) { return { t: qName(ch, i), s: 'Precisa de uns ' + qNeed(v.q) + ' Mbps', on: !ch.auto && ch.vi === i }; }));
    $('qmenu').innerHTML = '<h3>Qualidade · ' + esc(ch.n) + '</h3>' + items.map(function (x, i) {
      return '<div class="qo' + (i === qm.sel ? ' sel' : '') + '"><b>' + (x.on ? '✓ ' : '') + esc(x.t) + '</b><small>' + esc(x.s) + '</small></div>';
    }).join('') + '<p class="hint">▲▼ escolher &nbsp;·&nbsp; <i class="k ok">OK</i> usar &nbsp;·&nbsp; <i class="k ok">Voltar</i> fechar</p>';
  }

  function closeQMenu() { qm.ch = null; $('qmenu').classList.add('hidden'); }

  // menu do player (áudio e legendas, episódios): a mesma caixa do menu de qualidade.
  // items: [{ t, s, on, head (título de seção), fn }]; mostra 9 linhas em volta da escolhida
  var mn = null;
  function openMenu(title, items, hint) {
    var sel = -1, first = -1; // começa na primeira marcada (o áudio ou o episódio de agora)
    items.forEach(function (x, i) { if (x.head) return; if (first < 0) first = i; if (x.on && sel < 0) sel = i; });
    sel = sel < 0 ? first : sel;
    mn = { title: title, items: items, sel: sel, hint: hint || '▲▼ escolher &nbsp;·&nbsp; <i class="k ok">OK</i> usar &nbsp;·&nbsp; <i class="k ok">Voltar</i> fechar' };
    renderMenu();
    $('qmenu').classList.remove('hidden');
  }
  function renderMenu() {
    var a = Math.max(0, Math.min(mn.sel - 4, mn.items.length - 9));
    $('qmenu').innerHTML = '<h3>' + esc(mn.title) + '</h3>' + mn.items.slice(a, a + 9).map(function (x, j) {
      return x.head ? '<div class="qh">' + esc(x.t) + '</div>'
        : '<div class="qo' + (a + j === mn.sel ? ' sel' : '') + '"><b>' + (x.on ? '✓ ' : '') + esc(x.t) + '</b>' + (x.s ? '<small>' + esc(x.s) + '</small>' : '') + '</div>';
    }).join('') + '<p class="hint">' + mn.hint + '</p>';
  }
  function closeMenu() { mn = null; $('qmenu').classList.add('hidden'); }
  function menuKey(k) {
    if (!mn) return false;
    if (k === K.UP || k === K.DOWN) {
      var i = mn.sel, d = k === K.UP ? -1 : 1;
      do { i += d; } while (mn.items[i] && mn.items[i].head);
      if (mn.items[i]) { mn.sel = i; renderMenu(); }
    } else if (k === K.ENTER) {
      var it = mn.items[mn.sel];
      closeMenu();
      if (it && it.fn) it.fn();
    } else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE || k === K.YELLOW || k === K.GREEN) closeMenu();
    return true;
  }

  // 🟡 no filme/episódio: as faixas que o vídeo tiver (áudio dublado/original, legendas)
  function openTracks() {
    var tr = Player.tracks(), items = [];
    if (!tr.audio.length && !tr.text.length) return toast('Este vídeo não informa outras faixas de áudio nem legendas');
    if (tr.audio.length) {
      items.push({ head: true, t: 'Áudio' });
      tr.audio.forEach(function (a) { items.push({ t: a.t, on: a.on, fn: function () { if (Player.setTrack('audio', a.i, a.t)) toast('Áudio: ' + a.t); } }); });
    }
    items.push({ head: true, t: 'Legendas' });
    items.push({ t: 'Desligadas', on: !tr.subOn, fn: function () { if (Player.setTrack('text', -1)) toast('Legendas desligadas'); } });
    if (!tr.text.length) items.push({ t: 'Este vídeo não tem legendas', s: '' });
    tr.text.forEach(function (x) { items.push({ t: x.t, on: x.on, fn: function () { if (Player.setTrack('text', x.i, x.t)) toast('Legendas: ' + x.t); } }); });
    openMenu('Áudio e legendas', items);
  }

  // 🟢 no episódio: todos os episódios da série, por temporada; OK abre (de onde parou)
  function openEpisodes(cur) {
    var s = cur.series, items = [], last = null;
    s.eps.forEach(function (ep) {
      if (ep.s !== last) { last = ep.s; items.push({ head: true, t: 'Temporada ' + ep.s }); }
      var h = histFor(ep.id);
      items.push({ t: 'E' + ep.e + (ep.n ? ' · ' + ep.n : ''), on: ep === cur,
        s: ep === cur ? 'Assistindo agora' : h ? (resumable(h) ? 'Parou em ' + fmtTime(h.pos) : '✓ visto') : '',
        fn: function () { if (ep !== cur) { var hh = histFor(ep.id); playVod(ep, resumable(hh) ? hh.pos : 0); } } });
    });
    openMenu('Episódios · ' + s.n, items);
  }

  // com o menu aberto, ele fica com as teclas
  function qmenuKey(k) {
    if (!qm.ch) return false;
    var n = qm.ch.vs.length + 1;
    if (k === K.UP || k === K.DOWN) { qm.sel = (qm.sel + (k === K.UP ? -1 : 1) + n) % n; renderQMenu(); }
    else if (k === K.ENTER) {
      var ch = qm.ch, cb = qm.onpick;
      setQ(ch, qm.sel - 1);
      closeQMenu();
      toast('Qualidade: ' + (ch.auto ? 'automática (' + qName(ch, ch.vi) + ')' : qName(ch, ch.vi)));
      if (cb) cb(ch);
    } else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE || k === K.YELLOW) closeQMenu();
    return true;
  }

  /* ---------- Grupos: os da lista, juntados pelo portal e pelo perfil, menos os ocultos ---------- */

  // cada { nome, de: [grupos] } junta os grupos de origem num só, no lugar do primeiro (também serve para renomear)
  function joinGroups(groups, joins) {
    (joins || []).forEach(function (j) {
      if (!j || !j.nome || !j.de || !j.de.length) return;
      var want = {}, at = -1, items = [], seen = {};
      j.de.forEach(function (n) { want[norm(n)] = 1; });
      groups = groups.filter(function (g, i) {
        if (!want[norm(g.name)]) return true;
        if (at < 0) at = i;
        g.items.forEach(function (x) { if (!seen[x.id]) { seen[x.id] = 1; items.push(x); } });
        return false;
      });
      if (at >= 0) groups.splice(at, 0, { name: j.nome, items: items, joined: true });
    });
    return groups;
  }

  function hiddenSet() {
    var h = {};
    (Cloud.state.settings.ocultos || []).forEach(function (k) { h[k] = 1; });
    return h;
  }

  // organização do portal (aba Canais): os grupos dele, na ordem dele, com os canais achados pelo número no
  // provedor de qualquer versão; o que não está em nenhum segue no grupo da lista, depois
  function orgGroups(list, grupos) {
    var at = {}, out = grupos.map(function (g) { return { name: g.nome, items: [] }; }), rest = [];
    grupos.forEach(function (g, i) { (g.ks || []).forEach(function (k) { if (!at.hasOwnProperty(k)) at[k] = i; }); });
    list.forEach(function (c) {
      var ks = c.ks || [c.k], gi = -1;
      for (var j = 0; j < ks.length && gi < 0; j++) if (at.hasOwnProperty(ks[j])) gi = at[ks[j]];
      if (gi >= 0) out[gi].items.push(c); else rest.push(c);
    });
    return out.filter(function (g) { return g.items.length; }).concat(groupBy(rest));
  }

  // refaz app.groups (e "Todos os canais" sem os ocultos); chamada ao carregar a lista, quando o portal manda
  // organização ou grupos novos e quando o perfil muda grupos, ocultos ou de perfil
  function regroup() {
    var hid = hiddenSet(), any = false, org = remote.org || {}, off = {};
    // canais ocultos pelo portal somem da TV (Todos, grupos, número, busca)
    (org.ocultos || []).forEach(function (k) { off[k] = 1; });
    app.cat.live = (app.allLive || app.cat.live).filter(function (c) { return !(c.ks || [c.k]).some(function (k) { return off[k]; }); });
    app.cat.live.forEach(pickQ);
    var base = (org.grupos || []).length ? orgGroups(app.cat.live, org.grupos) : joinGroups(groupBy(app.cat.live), remote.grupos);
    // Filmes e Séries (aba "Filmes e séries" do portal, por grupo da lista): ocultos somem de tudo, os outros se juntam
    var vod = org.vod || {}, vodGroups = function (list, o) {
      o = o || {};
      var hid = {};
      (o.ocultos || []).forEach(function (g) { hid[g] = 1; });
      list.forEach(function (x) { x.hide = !!hid[x.g]; });
      return joinGroups(groupBy(list.filter(function (x) { return !x.hide; })), o.grupos);
    };
    app.allGroups = {
      live: joinGroups(base, Cloud.state.settings.grupos),
      movies: vodGroups(app.cat.movies, vod.movie), series: vodGroups(app.cat.series, vod.series)
    };
    var vis = function (type) { return function (g) { var ok = !hid[type + ':' + g.name]; if (!ok) any = true; return ok; }; };
    app.groups = { live: app.allGroups.live.filter(vis('live')), movies: app.allGroups.movies.filter(vis('movie')), series: app.allGroups.series.filter(vis('series')) };
    markLocks(org);
    var shown = {};
    app.groups.live.forEach(function (g) { g.items.forEach(function (x) { shown[x.id] = 1; }); });
    app.visibleLive = any || !adultOk ? app.cat.live.filter(function (x) { return shown[x.id]; }) : app.cat.live;
    live.groups = null;
    markDirty();
  }

  /* ---------- Conteúdo +18: só o adulto pede senha ---------- */

  // só conteúdo adulto (pornô: adulto, xxx, erótico, +18…) pede senha sozinho; terror e o resto, não (mesma regra do
  // portal, em painel.js → adultText); o portal
  // pode marcar mais canais (org.senha). A senha vale para a TV toda (padrão 0000) e, digitada, até fechar o app
  var ADULT = /\b(adult\w*|xxx|eroti\w*|porn\w*|hentai|playboy)\b|\+ ?18\b|\b18 ?\+/;
  function adultText(s) { return ADULT.test(norm(s || '')); }
  var adultOk = false, lockedGroups = { live: [], movies: [], series: [] };

  // hide: grupo de Filmes/Séries oculto pelo portal (some de tudo, com ou sem senha)
  function okItem(x) {
    var s = x && (x.series || x);
    if (s && s.hide) return false;
    return adultOk || !(x && (x.lock || (x.series && x.series.lock)));
  }

  // marca o que pede senha e, sem a senha, tira dos grupos (os grupos inteiros ficam guardados, com cadeado)
  function markLocks(org) {
    var pin = {};
    (org.senha || []).forEach(function (k) { pin[k] = 1; });
    app.cat.live.forEach(function (c) { c.lock = adultText(c.n) || adultText(c.g) || (c.ks || [c.k]).some(function (k) { return pin[k]; }); });
    // grupos de Filmes e Séries que o portal marcou para pedir senha
    var vo = org.vod || {}, pinG = function (o) { var h = {}; ((o || {}).senha || []).forEach(function (g) { h[g] = 1; }); return h; };
    var pm = pinG(vo.movie), psr = pinG(vo.series);
    app.cat.movies.forEach(function (m) { m.lock = adultText(m.g) || adultText(m.n) || !!pm[m.g]; });
    app.cat.series.forEach(function (s) { s.lock = adultText(s.g) || adultText(s.n) || !!psr[s.g]; });
    ['live', 'movies', 'series'].forEach(function (t) {
      var keep = [];
      lockedGroups[t] = [];
      app.groups[t].forEach(function (g) {
        if (adultText(g.name)) { g.items.forEach(function (x) { x.lock = true; }); lockedGroups[t].push(g); }
        else keep.push(g);
      });
      if (adultOk) return;
      app.groups[t] = keep.map(function (g) {
        var items = g.items.filter(function (x) { return !x.lock; });
        return items.length === g.items.length ? g : { name: g.name, items: items };
      }).filter(function (g) { return g.items.length; });
    });
  }

  // pede a senha (se ainda não foi digitada) e depois segue com then()
  var pinFlow = { mode: '', then: null, fresh: '' }, pinFails = 0, pinWait = 0;
  function pinHash(v) { return M3U.hash('ctv-pin:' + v); }
  function pinOk(v) { return pinHash(v) === (localStorage.getItem('ctv.pin') || pinHash('0000')); }

  function askPin(then) {
    if (adultOk) return then && then();
    pinStep('unlock', then);
  }

  function pinStep(mode, then) {
    pinFlow.mode = mode;
    if (then !== undefined) pinFlow.then = then;
    showSetup('stepPin');
    $('pinTitle').textContent = mode === 'unlock' ? 'Conteúdo protegido' : 'Trocar a senha';
    $('pinMsg').textContent = mode === 'unlock' ? 'Conteúdo adulto: digite a senha (a de fábrica é 0000)'
      : mode === 'old' ? 'Digite a senha atual' : mode === 'new' ? 'Digite a senha nova (4 a 8 números)' : 'Digite a senha nova de novo';
    $('pinErr').textContent = '';
    $('pinInput').value = '';
    Nav.focus($('pinInput'));
  }

  function submitPin() {
    var v = $('pinInput').value.trim(), m = pinFlow.mode;
    $('pinInput').value = '';
    if (Date.now() < pinWait) { $('pinErr').textContent = 'Muitas tentativas. Aguarde um minuto.'; return; }
    if (m === 'unlock' || m === 'old') {
      if (!pinOk(v)) {
        pinWait = ++pinFails % 5 === 0 ? Date.now() + 60000 : 0; // a cada 5 erros, 1 minuto de espera
        $('pinErr').textContent = 'Senha incorreta';
        return Nav.focus($('pinInput'));
      }
      pinFails = 0;
      if (m === 'old') return pinStep('new');
      adultOk = true;
      regroup();
      var then = pinFlow.then;
      pinFlow.then = null;
      leavePin();
      toast('🔓 Liberado até fechar o app');
      if (then) then();
    } else if (m === 'new') {
      if (!/^\d{4,8}$/.test(v)) { $('pinErr').textContent = 'Use de 4 a 8 números'; return Nav.focus($('pinInput')); }
      pinFlow.fresh = v;
      pinStep('confirm');
    } else if (m === 'confirm') {
      if (v !== pinFlow.fresh) { $('pinErr').textContent = 'Não confere: digite a senha nova de novo'; pinFlow.mode = 'new'; return pinStep('new'); }
      localStorage.setItem('ctv.pin', pinHash(v));
      leavePin();
      toast('Senha trocada');
    }
  }

  function leavePin() {
    pinFlow.mode = '';
    if (app.view) { leaveSetup(); if (app.view === 'settings') refreshView(); } else enterShell();
  }

  function lockAgain() {
    adultOk = false;
    regroup();
    toast('🔒 Conteúdo +18 protegido de novo');
  }

  function setCatalog(c) {
    c.live = mergeQualities(c.live);
    app.allLive = c.live; // a lista inteira; app.cat.live fica sem os ocultos pelo portal (regroup)
    app.cat = c;
    app.idx = {};
    c.live.forEach(function (x) {
      x.t = 'live';
      app.idx[x.id] = x;
      if (x.vs) x.vs.forEach(function (v) { app.idx[v.id] = x; }); // favorito e histórico de qualquer versão
    });
    c.movies.forEach(function (x) { x.t = 'movie'; app.idx[x.id] = x; });
    c.series.forEach(function (s) {
      s.t = 'series';
      app.idx[s.id] = s;
      if (s.eps) s.eps.forEach(function (ep) { ep.t = 'ep'; ep.series = s; app.idx[ep.id] = ep; });
    });
    titleIdx = null;
    regroup();
    trackNew(c);
    // o resto vem depois de a tela aparecer: índice dos títulos (TMDB) e o guia
    setTimeout(afterCatalog, 300);
    setTimeout(loadEpg, 2000); // a lista pode indicar o próprio guia (url-tvg)
    setTimeout(historyEps, 1000); // API Xtream: episódios das séries do "Continuar assistindo"
    setTimeout(checkTelas, 500);
  }

  // quantas telas a assinatura aceita (1 desliga a prévia). Uma pergunta por dia: cada uma é um acesso no painel do fornecedor
  function checkTelas() {
    var c = activePlaylist() && Xtream.creds(activePlaylist().url), cat = app.cat, u = c && M3U.hash(c.m3u), t = stored('ctv.telas');
    if (!c) return;
    var use = function (n) { if (app.cat !== cat || !n) return; cat.telas = n; if (!previewOn()) { stopPreview(); markDirty(); } };
    if (t && t.u === u && Date.now() - t.at < 864e5) return use(t.telas);
    // lista recém-baixada pela API já trouxe a resposta: não pergunta de novo
    if (cat.telas && Date.now() - (cat.updated || 0) < 864e5) { store('ctv.telas', JSON.stringify({ u: u, at: Date.now(), telas: cat.telas })); return use(cat.telas); }
    Xtream.info(c).then(function (i) {
      if (i.telas) store('ctv.telas', JSON.stringify({ u: u, at: Date.now(), telas: i.telas }));
      use(i.telas);
    }, function () {});
  }

  /* ---------- Episódios sob demanda (lista pela API Xtream, js/xtream.js) ---------- */

  // a série vem sem episódios (eps: null); busca os dela uma vez e liga ao índice (favoritos, histórico, player)
  function ensureEps(s) {
    if (s.eps) return Promise.resolve(s);
    if (s._eps) return s._eps;
    var c = Xtream.creds(activePlaylist().url);
    if (!c) return Promise.reject(new Error('Sem acesso aos episódios'));
    s._eps = Xtream.eps(c, s).then(function (eps) {
      s.eps = eps;
      eps.forEach(function (ep) { ep.t = 'ep'; ep.series = s; app.idx[ep.id] = ep; });
      delete s._eps;
      return s;
    }, function (e) { delete s._eps; throw e; });
    return s._eps;
  }

  // episódios vistos (histórico) de séries ainda sem episódios: acha a série pelo nome guardado no histórico
  // ("Nome T1E2") e busca os dela, para o "Continuar assistindo" e o "onde parou" aparecerem
  function historyEps() {
    var want = [], byName = {};
    app.cat.series.forEach(function (s) { if (!s.eps) byName[s.n.toLowerCase()] = s; });
    Cloud.state.history.forEach(function (h) {
      if (h.t !== 'ep' || app.idx[h.id]) return;
      var s = byName[String(h.n || '').replace(/\s+T\d+E\d+$/, '').toLowerCase()];
      if (s && want.indexOf(s) < 0 && want.length < 8) want.push(s);
    });
    if (!want.length) return;
    // uma de cada vez, sem segurar nada; no fim, o Início se refaz com o que entrou
    want.reduce(function (p, s) { return p.then(function () { return ensureEps(s).then(null, function () {}); }); }, Promise.resolve())
      .then(function () { markDirty(); if (app.view === 'home' && !Player.active && $('setup').classList.contains('hidden')) { delete app.dirty.home; refreshView(); } });
  }

  // títulos indexados pelo nome (Top 10 e gêneros do TMDB): a TV leva alguns segundos com uma lista
  // grande, então é montado logo depois de a tela aparecer, e a tela se refaz com o que entrou
  function afterCatalog() {
    ensureTitleIdx(); // pode já ter sido montado (Filmes aberto antes)
    vodDirty();
    // o começo de cada título (sagas) fica guardado no item: calcula já, para Filmes e Séries abrirem rápido
    setTimeout(function () { sagas('movie'); sagas('series'); }, 1500);
    setTimeout(loadCollections, 8000); // coleções do TMDB (uma vez por semana), depois de a tela aparecer
  }

  // primeira vez que cada filme apareceu nesta TV (ou que a série ganhou episódio): base de
  // "Recém-chegados" e "Séries com episódios novos", sem depender de dados de fora
  function trackNew(c) {
    var pl = activePlaylist(), key = 'ctv.seen.' + (pl ? pl.id : 'x'), old = stored(key), now = Date.now();
    var src = c.fonte || 'm3u', first = !old || (old.v || 'm3u') !== src, seen = { m: {}, s: {}, v: src };
    old = old && !first ? old : { m: {}, s: {} };
    c.movies.forEach(function (x) {
      seen.m[x.id] = x.id in old.m ? old.m[x.id] : first ? 0 : now;
      x.added = seen.m[x.id];
    });
    c.series.forEach(function (x) {
      var o = old.s[x.id], n = x.eps ? x.eps.length : x.mod || 0;
      seen.s[x.id] = !o ? [n, first ? 0 : now] : n > o[0] ? [n, now] : o;
      x.added = seen.s[x.id][1];
    });
    // ponytail: guarda um id por título; lista gigante pode não caber e aí "novos" não persiste.
    // Grava depois de a tela aparecer (são milhares de ids)
    setTimeout(function () { try { localStorage.setItem(key, JSON.stringify(seen)); } catch (e) {} }, 4000);
  }

  // a lista desta TV (o app não deixa escolher: quem decide é o portal)
  function activePlaylist() { return app.playlists[0]; }

  // quiet: atualização por trás (pedida pelo portal): sem a tela de carregando. onprog(0–100): andamento.
  // Uma carga por vez (abertura, portal, Ajustes, OK 8× no logo): quem pede no meio espera a que já está rodando
  var catBusy = null;
  function loadCatalog(force, quiet, onprog) {
    if (catBusy) return catBusy;
    var pl = activePlaylist();
    if (!pl) { setCatalog({ live: [], movies: [], series: [] }); return Promise.resolve(); }
    var msg = force ? 'Atualizando a lista... ' : 'Carregando os canais... ';
    if (!quiet) { loading(msg); onprog = onprog || function (p) { loading(msg + Math.floor(p) + '%'); }; }
    var p = catBusy = openCatalog(pl, force, onprog).then(function (c) {
      if (!quiet) loading(false);
      setCatalog(c);
      syncErr.lista = '';
      reportSync();
      setTimeout(function () { reportChannels(force).then(null, function () {}); }, 6000); // depois de a tela aparecer
    }, function (e) {
      if (!quiet) loading(false);
      syncErr.lista = e.message;
      reportSync();
      throw e;
    });
    p.then(function () { catBusy = null; }, function () { catBusy = null; });
    return p;
  }

  // A TV manda ao portal os canais que recebe (state/canais): é daí que sai o catálogo da aba Canais, porque o
  // provedor só deixa a TV baixar a lista. Lido só pelo portal; grava quando a lista muda, ou na hora quando a
  // atualização foi pedida (portal ou OK 8× no logo)
  function reportChannels(force) {
    if (!Fire.enabled || !Fire.uid) return Promise.reject(new Error('Sem conexão com o portal'));
    var all = app.allLive || app.cat.live; // inclusive os ocultos pelo portal, para ele poder mostrar de novo
    // só quando a lista mudou (antes reenviava todo dia, até 800 KB por TV)
    var sig = Fire.uid + '|' + all.length + '|' + M3U.hash(all.map(function (c) { return c.n; }).join('|'));
    if (!force && localStorage.getItem('ctv.canaisSig') === sig) return Promise.resolve(all.length);
    var count = function (l) { return groupBy(l).map(function (g) { return { n: g.name, q: g.items.length }; }); };
    // um item por canal: número no provedor (de cada versão), nome, grupo da lista, qualidades e logo.
    // Nunca o link do canal: ele leva o endereço, o usuário e a senha do provedor
    var cat = all.map(function (c) {
      return { k: (c.ks || [c.k])[0], ks: c.ks || [c.k], n: c.n.slice(0, 80), g: c.g.slice(0, 60), e: String(c.e || '').slice(0, 60), // e: tvg-id (casa com o guia)
               q: c.vs ? c.vs.map(function (v) { return v.q; }).filter(Boolean) : c.q ? [c.q] : [], l: c.l && c.l.length <= 200 ? c.l : '' };
    });
    // o documento tem limite de 1 MB: lista enorme vai sem logos e, se ainda não couber, cortada (o portal avisa)
    var size = function () { return JSON.stringify(cat).length; }, cortado = false;
    if (size() > 800000) cat.forEach(function (e) { e.l = ''; });
    while (size() > 800000) { cat = cat.slice(0, Math.floor(cat.length * 0.9)); cortado = true; }
    return Fire.set('tvs/' + Fire.uid + '/state/canais', {
      at: Date.now(), lista: plName(activePlaylist()), total: all.length, cat: cat, cortado: cortado,
      filmes: count(app.cat.movies).slice(0, 400), series: count(app.cat.series).slice(0, 400)
    }).then(function () {
      localStorage.setItem('ctv.canaisSig', sig);
      localStorage.setItem('ctv.canaisAt', Date.now()); // o portal vê pelo sync que chegaram canais novos
      reportSync();
      return all.length;
    });
  }

  // O portal mostra quando esta TV atualizou a lista de canais, o TMDB e o guia (e o erro, se houve).
  // Gravação à parte do "estou ligada", só quando algo muda; junta o que muda em seguida (ao abrir, os três)
  var syncErr = { lista: '', tmdb: '', guia: '', app: '' }, syncTimer;
  function reportSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () {
      if (!Fire.enabled || !Fire.uid) return;
      var pl = activePlaylist(), hide = function (s) { return String(s || '').replace(/[a-z]+:\/\/\S+/gi, '').slice(0, 120); };
      Fire.set('tvs/' + Fire.uid, { sync: {
        lista: pl && pl.sub ? 'assinatura' : 'padrao', listaAt: catAt, listaErro: hide(syncErr.lista),
        canais: app.cat.live.length, filmes: app.cat.movies.length, series: app.cat.series.length,
        tmdbAt: remote.tmdb && tmLists ? tmLists.at || 0 : 0, tmdbErro: hide(syncErr.tmdb),
        canaisAt: +localStorage.getItem('ctv.canaisAt') || 0,
        guiaAt: epg.at || 0, guiaCanais: Object.keys(epg.progs || {}).length, guiaErro: hide(syncErr.guia),
        appErro: hide(syncErr.app), appErroAt: syncErr.appAt || 0, // erro de JavaScript (abertura, telas)
        // nomes dos grupos de canais como vêm na lista: o portal usa para montar os grupos dele
        grupos: groupBy(app.cat.live).slice(0, 300).map(function (g) { return g.name.slice(0, 60); })
      } }).then(null, function () {});
    }, 3000);
  }

  // só aceita M3U: página de erro (HTML) ou resposta em outro formato (JSON) do fornecedor nunca vira "canais"
  function checkList(text) {
    var head = String(text).slice(0, 300).replace(/^﻿/, '').replace(/^\s+/, '');
    if (head.indexOf('#EXTM3U') === 0) return;
    var e = new Error(head.charAt(0) === '<' ? 'O fornecedor respondeu uma página em vez da lista'
      : head.charAt(0) === '{' || head.charAt(0) === '[' ? 'O fornecedor respondeu em outro formato (não é uma lista M3U)'
      : !head ? 'O fornecedor mandou uma lista vazia' : 'O fornecedor mandou algo que não é uma lista M3U');
    e.tipo = 'invalida';
    throw e;
  }
  function emptyCheck(c) {
    if (!c.live.length && !c.movies.length && !c.series.length) { var e = new Error('Lista vazia ou inválida'); e.tipo = 'invalida'; throw e; }
    return c;
  }
  function parseList(text) { checkList(text); return emptyCheck(M3U.parse(text)); }
  // em partes (lista grande travava a TV); onfrac(0–1)
  function parseListAsync(text, onfrac) {
    try { checkList(text); } catch (e) { return Promise.reject(e); }
    return M3U.parseAsync(text, onfrac).then(emptyCheck);
  }
  // a cópia guardada já vem organizada (json: abre umas 6× mais rápido que ler o texto da lista de novo);
  // as de antes da 1.6.0 guardavam o texto
  function fromSaved(saved) {
    if (saved.json) { try { return JSON.parse(saved.json); } catch (e) {} }
    return parseList(saved.text);
  }

  // Lista da assinatura: guarda a cópia no IndexedDB (lista com filmes e séries passa de dezenas de MB, não cabe
  // no localStorage) e abre sempre por ela; baixa de novo só quando pedido (Ajustes, portal, OK 8× no logo) ou
  // quando o link muda. Sem cópia, ou com force, espera baixar.
  // baixar é quase todo o tempo (até 85%); sem o tamanho informado pelo servidor, o % sobe devagar até 85
  function dlProg(onprog) {
    return onprog && function (got, total) { onprog(total ? got / total * 85 : 85 * (1 - Math.exp(-got / 2e7))); };
  }
  // baixa e lê a lista; falha de rede, lentidão ou erro do fornecedor: tenta mais uma vez depois de 5 s
  function download(pl, onprog, again) {
    return Api.getText(pl.url, dlProg(onprog)).then(function (text) {
      if (onprog) onprog(85);
      return parseListAsync(text, onprog && function (f) { onprog(85 + f * 10); });
    }).then(null, function (e) {
      if (again || ['rede', 'lenta', 'fornecedor'].indexOf(e.tipo) < 0) throw e;
      return new Promise(function (r) { setTimeout(r, 5000); }).then(function () { return download(pl, onprog, true); });
    });
  }
  // lista da assinatura: pela API Xtream (canais, filmes e séries sem episódios, bem mais leve); fornecedor sem a
  // API ou que falhou nela: o M3U inteiro, como sempre
  function fetchList(pl, onprog) {
    var c = Xtream.creds(pl.url);
    if (!c) return download(pl, onprog);
    return Xtream.load(c, onprog).then(null, function () { return download(pl, onprog); });
  }
  function openCatalog(pl, force, onprog) {
    if (pl === OPEN_LIST) return download(pl, onprog).then(function (c) { catAt = Date.now(); return c; }); // vem dentro do app
    // ao ligar, a cópia já começou a ser lida junto com as consultas ao portal (boot → earlyList).
    // Atualizando (force) não lê a cópia: ela já está na tela, e ler de novo dobraria a memória
    var got = early && early.id === pl.id ? early.p : force ? Promise.resolve(null) : listCache.get(pl.id).then(function (s) { return { saved: s }; });
    early = null;
    return got.then(function (r) {
      var saved = r && r.saved;
      if (saved && !force) { catDay = saved.day; catAt = saved.at; return r.c || fromSaved(saved); }
      // falhou: o erro sobe e a lista que está na tela (e a cópia guardada) continuam valendo
      return fetchList(pl, onprog).then(function (c) {
        if (onprog) onprog(95);
        catDay = today(); catAt = Date.now();
        // guarda organizada, antes do setCatalog (que liga cada episódio à série e não daria para gravar)
        listCache.put(pl.id, { json: JSON.stringify(c), day: catDay, at: catAt });
        return c;
      });
    });
  }
  var catDay = '', catAt = 0; // dia e hora da lista que está na tela

  // ao ligar: lê a cópia da lista de sempre enquanto o portal e o perfil respondem (cada um pode levar até 6 s)
  var early = null;
  function earlyList() {
    var pl = openPlaylists()[0];
    if (pl === OPEN_LIST) return;
    early = { id: pl.id, p: listCache.get(pl.id).then(function (s) {
      var c = null;
      try { c = s && fromSaved(s); } catch (e) {}
      return { saved: s, c: c };
    }) };
  }

  // uma cópia só (a lista atual): ao guardar, apaga as outras. Sem IndexedDB, segue sem cópia.
  // Com prazo: um IndexedDB que não responde (bloqueado, disco cheio) não pode deixar a TV carregando para sempre
  var listCache = (function () {
    var dbp = null;
    function db() {
      if (!dbp) dbp = new Promise(function (resolve) {
        setTimeout(function () { resolve(null); }, 8000);
        try {
          var r = indexedDB.open('ctv', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('lists'); };
          r.onsuccess = function () { resolve(r.result); };
          r.onerror = r.onblocked = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    function run(mode, fn) {
      return db().then(function (d) {
        if (!d) return null;
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(null); }, mode === 'readwrite' ? 60000 : 20000);
          try {
            var tx = d.transaction('lists', mode), req = fn(tx.objectStore('lists'));
            tx.oncomplete = function () { resolve(req && req.result); };
            tx.onerror = tx.onabort = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    }
    return {
      get: function (id) { return run('readonly', function (s) { return s.get(id); }); },
      put: function (id, v) { return run('readwrite', function (s) { s.clear(); return s.put(v, id); }); }
    };
  })();

  /* ---------- Lista: a do cliente, montada pelo portal ---------- */

  // cópias antigas no localStorage (até 0.7.x) e listas adicionadas na própria TV (até 0.6.1)
  Object.keys(localStorage).forEach(function (k) {
    if (k.indexOf('ctv.list.') === 0 || k === 'ctv.lists' || k === 'ctv.unlocked') localStorage.removeItem(k);
  });

  // Cliente com plano em dia: a lista da assinatura (até o dia "until"; o portal só limpa com alguém aberto nele).
  // Qualquer outro caso (não cliente, plano vencido ou bloqueado): os canais abertos que vêm no app
  function openPlaylists() {
    var test = !window.webapis && /[?&]lista=([^&]+)/.exec(location.search); // só no navegador (testes)
    if (test) { var tu = decodeURIComponent(test[1]); return [{ id: 'p' + M3U.hash(tu), name: 'Teste', url: tu, sub: 'teste' }]; }
    var ps = planState();
    var sub = remote.cliente && ps !== 'vencido' && ps !== 'bloqueado' &&
      find(remote.lists, function (l) { return l.sub && (!l.until || l.until >= today()); });
    return [sub || OPEN_LIST];
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // '' sem plano · 'ativo' · 'vencido' (também quando "ate" já passou na data da TV) · 'bloqueado'
  function planState() {
    var p = remote.plano;
    if (!p) return '';
    if (p.status === 'bloqueado') return 'bloqueado';
    if (p.status === 'vencido' || (p.ate && p.ate < today())) return 'vencido';
    return 'ativo';
  }

  // a lista da assinatura nunca mostra nome nem link
  function plName(pl) { return pl.sub ? 'Assinatura' : pl.name; }

  // nome pelo endereço, sem usuário/senha que costumam vir no link
  function listName(url) {
    return url.replace(/^https?:\/\/([^@\/]*@)?/i, '').split(/[\/:?#]/)[0] || 'Minha lista';
  }

  /* ---------- Favoritos e histórico (nuvem) ---------- */

  function favKey(item) { return item.t === 'ep' ? item.series.id : item.id; }
  // canal com várias qualidades: favorito feito em qualquer versão vale
  function isFav(item) {
    var f = Cloud.state.favs;
    return !!f[favKey(item)] || !!(item.vs && item.vs.some(function (v) { return f[v.id]; }));
  }

  function markDirty() { app.dirty = { home: 1, favs: 1, live: 1, search: 1, movies: 1, series: 1 }; }

  function toggleFav(item) {
    if (item && item.t === 'ev') item = item.ch; // jogo ou luta: favorita o canal
    if (!item || !item.t || item.more) return;
    var key = favKey(item), favs = Cloud.state.favs;
    if (isFav(item)) {
      delete favs[key];
      if (item.vs) item.vs.forEach(function (v) { delete favs[v.id]; });
    } else favs[key] = item.t === 'ep' ? item.series.n : item.n;
    Cloud.save('favs');
    markDirty();
    toast(favs[key] ? '★  Adicionado à Minha lista' : 'Removido da Minha lista');
    var cards = document.querySelectorAll('[data-fav="' + key + '"]');
    for (var i = 0; i < cards.length; i++) cards[i].classList.toggle('is-fav', !!favs[key]);
    if (app.view === 'live') renderLive();
    if (app.view === 'guide') renderGuide();
  }

  function histFor(id) {
    return find(Cloud.state.history, function (h) { return h.id === id; });
  }

  function pushHistory(entry) {
    var h = Cloud.state.history.filter(function (x) { return x.id !== entry.id; });
    h.unshift(entry);
    // limita canais ao vivo para não empurrar o "continuar assistindo" para fora
    var lives = 0;
    Cloud.state.history = h.filter(function (x) { return x.t !== 'live' || ++lives <= 20; }).slice(0, 200);
    Cloud.save('history');
    markDirty();
  }

  function resumable(h) { return h && h.pos > 30000 && (!h.dur || h.pos < h.dur * 0.95); }

  function continueItems() {
    var seen = {}, out = [];
    Cloud.state.history.forEach(function (h) {
      var item = app.idx[h.id];
      if (!item || (h.t !== 'movie' && h.t !== 'ep') || !resumable(h) || !okItem(item)) return;
      var key = favKey(item);
      if (seen[key]) return; // um card por série
      seen[key] = 1;
      out.push(item);
    });
    return out;
  }

  function favItems() {
    var r = { live: [], movies: [], series: [] }, seen = {};
    for (var id in Cloud.state.favs) {
      var item = app.idx[id];
      if (!item || seen[item.id] || !okItem(item)) continue; // duas versões do mesmo canal: um só; +18 só com a senha
      seen[item.id] = 1;
      if (item.t === 'live') r.live.push(item);
      else if (item && item.t === 'movie') r.movies.push(item);
      else if (item && item.t === 'series') r.series.push(item);
    }
    return r;
  }

  /* ---------- Cards e fileiras ---------- */

  function progressOf(item) {
    var h = histFor(item.id);
    return resumable(h) && h.dur ? Math.round(h.pos / h.dur * 100) : 0;
  }

  function cardHtml(item, kind, r, i) {
    var attrs = ' data-r="' + r + '" data-i="' + i + '"';
    if (item.more) {
      return '<div class="card ' + kind + ' more f"' + attrs + '><span>Ver todos</span><b>' + item.more.items.length + '</b></div>';
    }
    var key = favKey(item), fav = isFav(item) ? ' is-fav' : '';
    attrs += ' data-fav="' + key + '"';
    // jogo ou luta de hoje: logo do canal, horário (ou AO VIVO), título e canal
    if (kind === 'ev') {
      var ec = item.ch, on = item.p.s <= Date.now(), n = item.alt.length;
      return '<div class="card wide ev f has-prg"' + attrs + '>' +
        '<div class="logo">' + (ec.l ? '<img src="' + esc(ec.l) + '"/>' : '<span class="ph">' + esc(ec.n.charAt(0)) + '</span>') + '</div>' +
        '<div class="cap"><i class="' + (on ? 'evl' : '') + '">' + (on ? '● AO VIVO' : hhmm(item.p.s)) + '</i>' + esc(item.p.t) + '</div>' +
        '<div class="prg">' + esc(ec.n) + (n ? ' · +' + n + (n > 1 ? ' canais' : ' canal') : '') + '</div>' + (on ? barHtml(item.p) : '') + '</div>';
    }
    if (kind === 'wide') {
      var nn = nowNext(item), p = nn && nn.now;
      return '<div class="card wide f' + fav + (p ? ' has-prg' : '') + '"' + attrs + '>' +
        '<div class="logo">' + (item.l ? '<img src="' + esc(item.l) + '"/>' : '<span class="ph">' + esc(item.n.charAt(0)) + '</span>') + '</div>' +
        '<div class="cap"><i>' + item.num + '</i>' + esc(item.n) + qBadge(item) + '</div>' +
        (p ? '<div class="prg">' + esc(p.t) + '</div>' + barHtml(p) : '') +
        '<span class="star">★</span></div>';
    }
    var show = item.t === 'ep' ? item.series : item, pct = progressOf(item);
    var img = show.l || show.tp || (metaCache[show.id] && metaCache[show.id].poster); // sem capa na lista: a do TMDB, se já veio
    // Top 10: o número grande fica ao lado da capa (fora do card, que não recebe foco)
    return (kind === 'top' ? '<span class="rank">' + (i + 1) + '</span>' : '') + '<div class="card poster f' + (kind === 'top' ? ' top' : '') + fav + '"' + attrs + '>' +
      '<span class="ph">' + esc(show.n) + '</span>' +
      (img ? '<img src="' + esc(img) + '"/>' : '') +
      (item.t === 'ep' ? '<span class="tagline">T' + item.s + ' · E' + item.e + '</span>' : '') +
      (pct ? '<div class="prog"><i style="width:' + pct + '%"></i></div>' : '') +
      '<span class="star">★</span></div>';
  }

  // rows: [{ title, items, kind: 'poster' | 'wide' }] — renderizadas aos poucos
  function renderRows(vs, rows, empty) {
    vs.innerHTML = rows.length ? '' : '<div class="empty">' + empty + '</div>';
    vs.scrollTop = 0;
    vs._rows = rows;
    vs._n = 0;
    appendRows(vs, 5);
  }

  function appendRows(vs, n) {
    var html = '', end = Math.min(vs._rows.length, vs._n + n);
    for (; vs._n < end; vs._n++) {
      var row = vs._rows[vs._n], items = row.items;
      // fileira de botões (destaque e gêneros de Filmes / Séries)
      if (row.btns) { row.shown = []; html += '<div class="row btns vod"><div class="track" data-group="b">' + row.btns + '</div></div>'; continue; }
      if (items.length > ROW_MAX && !row.noMore) {
        items = items.slice(0, ROW_MAX).concat([{ more: row }]);
      }
      row.shown = items;
      html += '<div class="row" data-row="' + esc(row.title) + '"><h3>' + esc(row.title) +
        (row.count ? ' <small>' + row.items.length + '</small>' : '') + '</h3>' +
        '<div class="track ' + row.kind + '" data-group="r">' +
        items.map(function (it, i) { return cardHtml(it, row.kind, vs._n, i); }).join('') + '</div></div>';
    }
    vs.insertAdjacentHTML('beforeend', html);
  }

  function itemOf(el) {
    var vs = el.closest('.vscroll');
    if (!vs || !vs._rows || !el.hasAttribute('data-r')) return null;
    var row = vs._rows[+el.getAttribute('data-r')];
    return row && { item: row.shown[+el.getAttribute('data-i')], row: row };
  }

  /* ---------- Hero (destaque no topo) ---------- */

  var heroItem = null, heroTimer;


  // baixa a imagem escondida e só mostra inteira (nada de imagem aparecendo aos pedaços), se o item ainda está em destaque
  function showBackdrop(item, url, kind) {
    if (!url) return;
    var img = new Image();
    img.onload = function () { if (heroItem === item) setBackdrop(url, kind); };
    img.src = url;
  }

  function setBackdrop(url, kind) {
    var bd = $('bdImg');
    bd.className = kind || '';
    bd.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : 'none';
  }

  // Filme · 2016 · 1h 35min · Drama · ★ 9,0 (o que vier do TMDB entra quando chega)
  function metaLine(item, m) {
    var parts = [];
    if (item.t === 'radio') {
      parts.push('<span class="kind">Rádio</span>', esc(item.g));
    } else if (item.t === 'live') {
      parts.push('<span class="badge-live">● AO VIVO</span>', 'Canal ' + item.num + qBadge(item), esc(item.g));
    } else {
      parts.push('<span class="kind">' + (item.t === 'series' ? 'Série' : 'Filme') + '</span>');
      if (m && m.year) parts.push(m.year);
      if (m && m.runtime) parts.push(Math.floor(m.runtime / 60) ? Math.floor(m.runtime / 60) + 'h ' + pad2(m.runtime % 60) + 'min' : m.runtime + 'min');
      if (item.t === 'series' && item.eps) parts.push(item.eps.length + (item.eps.length > 1 ? ' episódios' : ' episódio'));
      parts.push(esc(m && m.genre || item.g));
      if (m && m.rating) parts.push('<span class="rating">★ ' + String(m.rating).replace('.', ',') + '</span>');
    }
    return parts.join('<i class="dot">·</i>');
  }

  function heroKeys(item) {
    var ok = item.t === 'radio' ? 'ouvir' : item.t === 'live' ? 'tela cheia' : 'ver detalhes', hold = item.t === 'live' || item.t === 'radio' ? 'favoritar' : 'Minha lista';
    return '<span><i class="k ok">OK</i> ' + ok + '</span><span><i class="k ok">Segure OK</i> ' + hold + '</span><span><i class="k blue"></i> buscar</span>';
  }

  /* ---------- Jogos e lutas de hoje (do guia) ---------- */

  // o guia do servidor já marca (k: 1 jogo, 2 luta); com outro guia, pelo título num canal de esporte
  var SPORT_CH = /esporte|sport|premiere|combate|espn|ufc|futebol|dazn|tnt|xsports|band ?sports/;
  var GAME_T = /\s(x|vs\.?|versus)\s/i, FIGHT_T = /\b(ufc|mma|boxe|boxing|luta|lutas|combate|wrestling|jiu.?jitsu|bellator|pfl|wwe)\b/;
  function evKind(p, ch) {
    if (p.k) return p.k;
    if (!SPORT_CH.test(norm(ch.g + ' ' + ch.n))) return 0;
    return FIGHT_T.test(norm(p.t)) ? 2 : GAME_T.test(p.t) ? 1 : 0;
  }

  // de agora até a meia-noite: ao vivo primeiro, depois pelo horário; o mesmo jogo em vários canais aparece uma vez
  var evCache = { at: 0 };
  function todayEvents() {
    var now = Date.now();
    if (now - evCache.at < 60e3 && evCache.epg === epg && evCache.cat === app.cat) return evCache.list;
    var end = new Date(); end.setHours(23, 59, 59, 999); end = +end;
    var by = {}, out = [];
    (app.visibleLive || app.cat.live).forEach(function (ch) {
      if (!okItem(ch)) return;
      (progsOf(ch) || []).forEach(function (p) {
        if (p.e <= now || p.s > end) return;
        var k = evKind(p, ch);
        if (!k) return;
        var key = norm(p.t).replace(/[^a-z0-9]/g, '') + '|' + p.s;
        if (by[key]) return by[key].alt.push(ch);
        out.push(by[key] = { t: 'ev', id: 'ev:' + ch.id + ':' + p.s, n: p.t, ch: ch, p: p, k: k, alt: [] });
      });
    });
    out.sort(function (a, b) { return ((b.p.s <= now) - (a.p.s <= now)) || a.p.s - b.p.s; });
    evCache = { at: now, epg: epg, cat: app.cat, list: out };
    return out;
  }

  // destaque do jogo: o título dele, horário e canal; ao vivo, a prévia do canal como fundo
  function heroEvent(ev) {
    var on = ev.p.s <= Date.now();
    $('heroTitle').textContent = ev.p.t;
    $('heroTitle').className = ev.p.t.length > 14 ? 'long' : ''; // "Time A x Time B" quebra em duas linhas: letra menor
    $('heroMeta').innerHTML = [on ? '<span class="badge-live">● AO VIVO</span>' : 'Hoje às ' + hhmm(ev.p.s), esc(ev.ch.n), ev.k === 2 ? 'Luta' : 'Jogo']
      .join('<i class="dot">·</i>') + (ev.alt.length ? '<i class="dot">·</i>+' + ev.alt.length + ' canal(is)' : '');
    $('heroDesc').textContent = on ? '' : ev.p.d || ''; // ao vivo: no lugar da descrição, o horário e a barra
    $('heroLive').innerHTML = on ? '<span class="when">' + hhmm(ev.p.s) + ' – ' + hhmm(ev.p.e) + ' · ' + timeLeft(ev.p) + '</span>' + barHtml(ev.p) : '';
    $('heroKeys').innerHTML = '<span><i class="k ok">OK</i> ' + (on ? 'assistir' : 'abrir o canal') + '</span><span><i class="k ok">Segure OK</i> favoritar o canal</span>';
    setBackdrop('');
    $('heroSide').className = 'hlive';
    $('heroSide').innerHTML = pvBox(ev.ch);
    schedulePreview(ev.ch);
  }

  // canal: o programa no ar, com horário e barra
  function liveDesc(ch) {
    var nn = nowNext(ch), p = nn && nn.now;
    if (!p) return '';
    return '<b>' + esc(p.t) + '</b><span class="when">' + hhmm(p.s) + ' – ' + hhmm(p.e) + ' · ' + timeLeft(p) + '</span>' + barHtml(p);
  }

  function setHero(item, isStatic) {
    if (!item || item.more) return;
    if (item.t === 'ep' && !isStatic) item = item.series;
    if (item === heroItem) return;
    heroItem = item;
    clearTimeout(heroTimer);
    if (item.t === 'ev') return heroEvent(item);
    $('heroTitle').textContent = item.n;
    $('heroTitle').className = item.n.length > 28 ? 'long' : '';
    $('heroMeta').innerHTML = metaLine(item);
    $('heroDesc').textContent = '';
    $('heroLive').innerHTML = item.t === 'live' ? liveDesc(item) : '';
    $('heroKeys').innerHTML = isStatic ? '' : heroKeys(item);
    setBackdrop('');
    clearTimeout(heroTimer);
    // canal: a prévia toca à direita do destaque (como no Ao vivo); filme e série: a imagem no mesmo lugar (setBackdrop)
    $('heroSide').className = item.t === 'live' ? 'hlive' : ''; // canal: a prévia é o fundo do destaque
    if (item.t === 'live') {
      $('heroSide').innerHTML = pvBox(item);
      return schedulePreview(item);
    }
    if (pv.ch) stopPreview();
    // a imagem fica sempre à direita: fundo preto até a cena do TMDB chegar inteira (já guardada: aparece logo)
    var mc = metaCache[item.id];
    if (mc && mc.backdrop) showBackdrop(item, mc.backdrop, 'wide');
    heroTimer = setTimeout(function () {
      getMeta(item).then(function (m) {
        if (!m || heroItem !== item) return;
        $('heroMeta').innerHTML = metaLine(item, m);
        $('heroDesc').textContent = m.overview || '';
        // sem cena no TMDB: a capa, no mesmo lugar (também só depois de baixada inteira)
        if (m.backdrop) showBackdrop(item, m.backdrop, 'wide');
        else showBackdrop(item, item.l || item.tp || m.poster, 'poster');
      });
    }, isStatic ? 0 : 350);
  }

  function clearHero() {
    heroItem = null;
    $('heroTitle').textContent = $('heroMeta').innerHTML = $('heroDesc').textContent = $('heroLive').innerHTML = $('heroKeys').innerHTML = '';
    $('heroSide').innerHTML = '';
    setBackdrop('');
  }

  /* ---------- Navegação entre telas ---------- */

  var render = {};

  function showView(name, arg) {
    app.view = name;
    app.arg = arg;
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) views[i].classList.toggle('active', views[i].id === 'v-' + name);
    $('shell').classList.toggle('browse', $('v-' + name).classList.contains('browse'));
    $('shell').classList.toggle('home', name === 'home'); // saudação e tempo só na Home
    $('shell').classList.toggle('guide', name === 'guide'); // no Guia a prévia ocupa o canto do relógio
    stopPreview(); // cada tela tem a prévia num lugar: recomeça onde for preciso
    var items = $('menu').children, top = name === 'detail' || name === 'grid' ? null : name;
    for (i = 0; i < items.length; i++) {
      var on = items[i].getAttribute('data-view') === top;
      items[i].classList.toggle('active', on);
      if (on) $('side')._last = items[i];
    }
  }

  function go(name, arg, push) {
    if (push) app.stack.push({ name: app.view, arg: app.arg, focus: Nav.cur, dirty: false });
    else app.stack = [];
    showView(name, arg);
    clearHero();
    delete app.dirty[name];
    var el = render[name](arg);
    Nav.focus(el || Nav.first($('v-' + name)) || $('side')._last);
  }

  // re-renderiza tentando manter o foco no mesmo item
  function refreshView() {
    var cur = Nav.cur, info = cur && itemOf(cur), rowTitle = info && info.row.title, id = info && info.item.id;
    clearHero();
    var el = render[app.view](app.arg);
    if (rowTitle) {
      var rows = $('v-' + app.view).querySelectorAll('.row');
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].getAttribute('data-row') !== rowTitle) continue;
        var cards = rows[i].querySelectorAll('.card');
        el = cards[0] || el;
        for (var j = 0; j < cards.length; j++) {
          var it = itemOf(cards[j]);
          if (it && it.item.id === id) { el = cards[j]; break; }
        }
        break;
      }
    }
    Nav.focus(el || Nav.first($('v-' + app.view)));
  }

  function inSide() { return Nav.cur && $('side').contains(Nav.cur); }

  function back() {
    if (!$('setup').classList.contains('hidden')) {
      if (!$('stepNotice').classList.contains('hidden')) return closeNotice();
      if (!$('stepNewProfile').classList.contains('hidden')) { showSetup('stepProfiles'); return renderProfiles(); }
      if (!$('stepEditProfile').classList.contains('hidden')) return editDone();
      if (!$('stepPin').classList.contains('hidden')) { pinFlow.then = null; return leavePin(); }
      if (!$('stepPlan').classList.contains('hidden')) return planOk();
      if (app.view && $('stepBoot').classList.contains('hidden')) return leaveSetup(); // veio de dentro do app
      return exitApp();
    }
    if (app.stack.length) {
      var s = app.stack.pop();
      showView(s.name, s.arg);
      clearHero();
      if (app.dirty[s.name] || !s.focus || !$('v-' + s.name).contains(s.focus)) {
        delete app.dirty[s.name];
        Nav.focus(s.focus);
        refreshView();
      } else {
        Nav.focus(s.focus);
      }
      return;
    }
    if (app.view === 'live' && Nav.cur === $('liveChannels')) return Nav.focus($('liveGroups'));
    if (!inSide()) return Nav.focus($('side')._last);
    if (app.view !== 'home') return go('home');
    openExit();
  }

  // "Sair do Catarina TV?": o foco começa em "Continuar aqui" (Voltar sem querer não fecha o app)
  var exitSel = -1;
  function openExit() { exitSel = 0; renderExit(); $('exitAsk').classList.remove('hidden'); }
  function renderExit() {
    $('exitAsk').innerHTML = '<div class="box"><h3>Sair do Catarina TV?</h3><div class="bt">' +
      ['Continuar aqui', '⏻&nbsp; Sair'].map(function (t, i) { return '<span class="btn' + (i === exitSel ? ' focus' : '') + '">' + t + '</span>'; }).join('') + '</div></div>';
  }
  function exitKey(k) {
    if (exitSel < 0) return false;
    if (k === K.LEFT || k === K.RIGHT) { exitSel = 1 - exitSel; renderExit(); }
    else if (k === K.ENTER) { var out = exitSel === 1; closeExit(); if (out) exitApp(); }
    else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) closeExit();
    return true;
  }
  function closeExit() { exitSel = -1; $('exitAsk').classList.add('hidden'); }

  function exitApp() {
    Player.close();
    Cloud.flush();
    setTimeout(function () {
      try { tizen.application.getCurrentApplication().exit(); } catch (e) { window.close(); }
    }, 300);
  }

  /* ---------- Telas de navegação ---------- */

  function vs(name) { return $('v-' + name).querySelector('.vscroll'); }

  function firstCard(name) { return $('v-' + name).querySelector('.card'); }

  function groupRows(groups, kind, limit) {
    return groups.slice(0, limit || groups.length).map(function (g) {
      return { title: g.name, items: g.items, kind: kind, count: true };
    });
  }

  var NEW_DAYS = 14;

  // chegou nos últimos dias (ver trackNew), mais novo primeiro
  function newest(list) {
    var since = Date.now() - NEW_DAYS * 864e5;
    return list.filter(function (x) { return x.added > since && okItem(x); }).sort(function (a, b) { return b.added - a.added; });
  }

  // duas listas intercaladas (filmes e séries numa fileira só), sem repetir
  function mix(a, b, max) {
    var out = [], seen = {};
    for (var i = 0; out.length < (max || 1e9) && (i < a.length || i < b.length); i++) {
      [a[i], b[i]].forEach(function (x) { if (x && !seen[x.id] && out.length < (max || 1e9)) { seen[x.id] = 1; out.push(x); } });
    }
    return out;
  }

  // Início (com o que era a aba "Hoje"): menos fileiras, sem repetir o mesmo conteúdo em duas
  render.home = function () {
    var rows = [], now = Date.now(), favs = favItems(), cont = continueItems(), top = tmdbRows();
    // canais: favoritos e os vistos por último, com o programa no ar
    var seen = {}, tv = favs.live.concat(recentLive()).filter(function (c) { return !seen[c.id] && (seen[c.id] = 1); }).slice(0, 20);
    var tvRow = tv.length && { title: 'Na TV agora', items: tv, kind: 'wide' };
    var vodRow = cont.length && { title: 'Continuar assistindo', items: cont, kind: 'poster', noMore: true };
    // o que foi usado por último vem primeiro
    var last = Cloud.state.history[0];
    rows = (last && last.t === 'live' ? [tvRow, vodRow] : [vodRow, tvRow]).filter(Boolean);
    var evs = todayEvents(), onNow = evs.filter(function (e) { return e.p.s <= now; }), later = evs.filter(function (e) { return e.p.s > now; });
    if (onNow.length) rows.push({ title: 'Jogos e lutas agora', items: onNow, kind: 'ev', count: true });
    if (later.length) rows.push({ title: 'Mais tarde hoje', items: later, kind: 'ev', count: true });
    if (favs.movies.length + favs.series.length) rows.push({ title: 'Minha lista', items: favs.movies.concat(favs.series), kind: 'poster' });
    // Top 10 do dia (filmes e séries juntos); sem ele, o da semana
    var t10 = mix(pickT(tmLists && tmLists.trendM, 'movie'), pickT(tmLists && tmLists.trendS, 'series'), 10);
    if (!t10.length) t10 = top.trend.slice(0, 10);
    if (t10.length) rows.push({ title: 'Top 10 de hoje', items: t10, kind: 'top', noMore: true });
    var nov = mix(newest(app.cat.movies), newest(app.cat.series)); // os que chegaram hoje vêm primeiro
    if (nov.length) rows.push({ title: 'Novidades', items: nov, kind: 'poster' });
    var pop = mix(top.popMovies, top.popSeries), best = mix(top.movies, top.series);
    if (pop.length) rows.push({ title: 'Populares', items: pop, kind: 'poster' });
    if (best.length) rows.push({ title: 'Mais bem avaliados', items: best, kind: 'poster' });

    var mv = groupRows(app.groups.movies, 'poster', 3), sr = groupRows(app.groups.series, 'poster', 3);
    for (var i = 0; i < Math.max(mv.length, sr.length); i++) {
      if (mv[i]) rows.push(mv[i]);
      if (sr[i]) rows.push(sr[i]);
    }
    if (rows.length < 6) rows = rows.concat(groupRows(app.groups.live, 'wide', 6));

    renderRows(vs('home'), rows, 'Sua lista está vazia.');
    return firstCard('home');
  };

  render.movies = function () {
    renderRows(vs('movies'), app.cat.movies.length ? vodRows('movie') : [], 'Sua lista não tem filmes.');
    return vs('movies').querySelector('.btn, .card');
  };

  render.series = function () {
    renderRows(vs('series'), app.cat.series.length ? vodRows('series') : [], 'Sua lista não tem séries.');
    return vs('series').querySelector('.btn, .card');
  };

  render.favs = function () {
    var f = favItems(), rows = [];
    if (f.live.length) rows.push({ title: 'Canais', items: f.live, kind: 'wide', count: true });
    if (f.movies.length) rows.push({ title: 'Filmes', items: f.movies, kind: 'poster', count: true });
    if (f.series.length) rows.push({ title: 'Séries', items: f.series, kind: 'poster', count: true });
    renderRows(vs('favs'), rows, 'Nada aqui ainda.<br/>Pressione <i class="k red"></i> em qualquer canal, filme ou série para guardar aqui.');
    return firstCard('favs');
  };

  // "Ver todos": grade paginada
  render.grid = function (row) {
    $('v-grid').querySelector('.vtitle').innerHTML = esc(row.title) + ' <small>' + row.items.length + '</small>';
    var v = vs('grid');
    v.scrollTop = 0;
    v.innerHTML = '<div class="grid ' + row.kind + '"></div>';
    v._rows = [{ title: row.title, items: row.items, kind: row.kind, shown: row.items }];
    v._n = 0;
    appendGrid(v);
    return v.querySelector('.card');
  };

  function appendGrid(v) {
    var row = v._rows[0], end = Math.min(row.items.length, v._n + GRID_PAGE), html = '';
    for (; v._n < end; v._n++) html += cardHtml(row.items[v._n], row.kind, 0, v._n);
    v.firstChild.insertAdjacentHTML('beforeend', html);
  }

  /* ---------- Detalhes de filme / série ---------- */

  var detail = { season: 0 };

  function nextEp(ep) {
    var eps = ep.series.eps, i = eps.indexOf(ep);
    return eps[i + 1] || null;
  }

  // episódio para o botão principal: o último visto (ou o seguinte, se terminou)
  function seriesTarget(s) {
    var h = find(Cloud.state.history, function (x) { return x.t === 'ep' && app.idx[x.id] && app.idx[x.id].series === s; });
    if (!h) return { ep: s.eps[0], resume: false };
    var ep = app.idx[h.id];
    if (resumable(h)) return { ep: ep, resume: true, pos: h.pos };
    return { ep: nextEp(ep) || ep, resume: false };
  }

  function btn(act, label, cls) {
    return '<div class="btn f ' + (cls || '') + '" data-act="' + act + '">' + label + '</div>';
  }

  render.detail = function (item) {
    setHero(item, true);
    var html = '', main;
    if (item.t === 'movie') {
      var h = histFor(item.id);
      html += resumable(h)
        ? btn('play', '▶&nbsp; Continuar · ' + fmtTime(h.pos), 'primary') + btn('restart', '↺&nbsp; Do início')
        : btn('play', '▶&nbsp; Assistir', 'primary');
    } else if (!item.eps) {
      // série da API Xtream: os episódios chegam agora e a tela se refaz
      html += btn('wait', 'Carregando episódios…', 'primary');
      ensureEps(item).then(function () {
        if (app.view === 'detail' && app.arg === item && !Player.active) Nav.focus(render.detail(item));
      }, function (e) { if (app.view === 'detail' && app.arg === item) toast('Não foi possível abrir os episódios: ' + e.message); });
    } else if (!item.eps.length) {
      html += btn('wait', 'Esta série ainda não tem episódios', 'primary');
    } else {
      var t = seriesTarget(item), label = 'T' + t.ep.s + ' · E' + t.ep.e;
      html += btn('play', '▶&nbsp; ' + (t.resume ? 'Continuar ' : 'Assistir ') + label, 'primary');
      if (t.resume) html += btn('restart', '↺&nbsp; Do início');
      detail.season = t.ep.s;
    }
    html += btn('fav', isFav(item) ? '✓&nbsp; Na minha lista' : '+&nbsp; Minha lista');

    var out = '<div class="row btns"><div class="track" data-group="b">' + html + '</div></div><div class="d-info" id="dInfo"></div>';
    // ficha do TMDB (gêneros, classificação, elenco, direção) entra quando chega
    getMeta(item).then(function (m) {
      if (m && app.view === 'detail' && app.arg === item && $('dInfo')) $('dInfo').innerHTML = detailInfo(m);
    });
    trailerOf(item).then(function (key) {
      var track = app.view === 'detail' && app.arg === item && $('v-detail').querySelector('.row.btns .track');
      if (key && track && !track.querySelector('[data-act="trailer"]')) track.insertAdjacentHTML('beforeend', btn('trailer', '▷&nbsp; Trailer')); // o último, à direita
    });
    // Onde assistir (JustWatch): só informativo, com o crédito que o JustWatch pede
    ondeOf(item).then(function (l) {
      var box = app.view === 'detail' && app.arg === item && $('dInfo');
      if (l.length && box && !box.querySelector('.onde'))
        box.insertAdjacentHTML('beforeend', '<p class="onde"><b>Também em</b>' + l.map(esc).join(' · ') + ' <small>dados JustWatch</small></p>');
    });
    if (item.t === 'series' && item.eps && item.eps.length) {
      var seasons = [];
      item.eps.forEach(function (ep) { if (seasons.indexOf(ep.s) < 0) seasons.push(ep.s); });
      if (seasons.length > 1) {
        out += '<div class="row seasons"><div class="track" data-group="s">' + seasons.map(function (s) {
          return '<div class="tab f' + (s === detail.season ? ' sel' : '') + '" data-act="season" data-s="' + s + '">Temporada ' + s + '</div>';
        }).join('') + '</div></div>';
      }
      out += '<div class="row eps"><h3>Episódios</h3><div class="track" data-group="e" id="epTrack"></div></div>';
    }
    var v = vs('detail');
    v.innerHTML = out;
    v.scrollTop = 0;
    v._rows = null;
    if (item.t === 'series' && item.eps && item.eps.length) renderEpisodes(item);
    main = v.querySelector('.btn');
    return main;
  };

  function detailInfo(m) {
    var top = [];
    if (m.cert) top.push('<span class="cert c' + esc(String(m.cert).replace(/\W/g, '')) + '">' + esc(m.cert) + '</span>');
    if (m.genres) top.push(esc(m.genres));
    return (m.tagline ? '<p class="tl">“' + esc(m.tagline) + '”</p>' : '') +
      (top.length ? '<p>' + top.join('<i class="dot">·</i>') + '</p>' : '') +
      (m.cast ? '<p><b>Elenco</b>' + esc(m.cast) + '</p>' : '') +
      (m.crew ? '<p><b>' + m.crew[0] + '</b>' + esc(m.crew[1]) + '</p>' : '') +
      (m.onde && m.onde.length ? '<p class="onde"><b>Também em</b>' + m.onde.map(esc).join(' · ') + ' <small>dados JustWatch</small></p>' : '');
  }

  function renderEpisodes(s) {
    var track = $('epTrack');
    track.innerHTML = s.eps.filter(function (ep) { return ep.s === detail.season; }).map(function (ep) {
      var pct = progressOf(ep), h = histFor(ep.id);
      return '<div class="card ep f" data-act="ep" data-id="' + ep.id + '">' +
        '<b>E' + ep.e + '</b><span>' + esc(ep.n || s.n) + '</span>' +
        (h && !resumable(h) ? '<em>✓ visto</em>' : '') +
        (pct ? '<div class="prog"><i style="width:' + pct + '%"></i></div>' : '') + '</div>';
    }).join('');
    track.scrollLeft = 0;
    track._last = null;
  }

  function detailAction(el) {
    var item = app.arg, act = el.getAttribute('data-act');
    if (act === 'fav') {
      toggleFav(item);
      el.innerHTML = isFav(item) ? '✓&nbsp; Na minha lista' : '+&nbsp; Minha lista';
    } else if (act === 'play' || act === 'restart') {
      if (item.t === 'movie') {
        var h = histFor(item.id);
        playVod(item, act === 'play' && resumable(h) ? h.pos : 0);
      } else {
        var t = seriesTarget(item);
        playVod(t.ep, act === 'play' && t.resume ? t.pos : 0);
      }
    } else if (act === 'ep') {
      var ep = app.idx[el.getAttribute('data-id')], he = histFor(ep.id);
      playVod(ep, resumable(he) ? he.pos : 0);
    } else if (act === 'trailer') {
      trailerOf(item).then(function (key) { if (key) openTrailer(key, item.n); });
    }
  }

  /* ---------- Rádios (Radio Browser: rádios do Brasil, grátis, sem chave) ---------- */

  // As mais ouvidas e por gênero, buscadas uma vez por dia e guardadas na TV; segure OK favorita (fileira própria).
  // Toca no mesmo player dos canais (na TV, o AVPlay toca MP3, AAC e HLS); rádio fora do ar: o player avisa
  var RB = ['https://de1.api.radio-browser.info', 'https://nl1.api.radio-browser.info', 'https://at1.api.radio-browser.info'];
  var RGEN = [['Sertanejo', 'sertanejo'], ['Gospel', 'gospel'], ['Pop', 'pop'], ['Rock', 'rock'], ['Notícias', 'news'], ['MPB', 'mpb'],
              ['Funk', 'funk'], ['Pagode', 'pagode'], ['Eletrônica', 'electronic'], ['Esportes', 'sports']];
  var radios = stored('ctv.radios'), radioLoading = false;

  function rbGet(path, i) {
    i = i || 0;
    return Api.getText(RB[i] + path).then(function (t) { return JSON.parse(t); })
      .then(null, function (e) { if (i + 1 < RB.length) return rbGet(path, i + 1); throw e; });
  }
  function radioItem(x) {
    var tags = String(x.tags || '').split(',').filter(Boolean).slice(0, 2).join(' · ');
    return { id: 'r' + x.stationuuid, t: 'radio', n: String(x.name || 'Rádio').trim().slice(0, 60), l: /^https?:\/\//.test(x.favicon || '') ? x.favicon : '',
             u: x.url_resolved || x.url, g: [tags, x.state].filter(Boolean).join(' · '), num: '' };
  }
  function loadRadios() {
    if (radioLoading || (radios && Date.now() - radios.at < 864e5)) return;
    radioLoading = true;
    var q = '/json/stations/search?countrycode=BR&hidebroken=true&order=clickcount&reverse=true&limit=';
    var out = { at: Date.now(), top: [], gen: [] };
    rbGet(q + '60').then(function (l) { out.top = l.map(radioItem); })
      .then(function () {
        return RGEN.reduce(function (p, g) {
          return p.then(function () { return rbGet(q + '30&tag=' + encodeURIComponent(g[1])); })
            .then(function (l) { if (l.length >= 3) out.gen.push([g[0], l.map(radioItem)]); }, function () {});
        }, Promise.resolve());
      })
      .then(function () {
        radioLoading = false;
        if (!out.top.length) return;
        radios = out;
        store('ctv.radios', JSON.stringify(radios));
        if (app.view === 'live' && live.mode === 'audio' && !Player.active) renderLive();
      }, function () { radioLoading = false; if (app.view === 'live' && live.mode === 'audio') toast('As rádios não responderam agora'); });
  }

  // grupos da aba Áudio do Ao vivo: favoritas, as mais ouvidas e os gêneros (no mesmo formato dos grupos de canais)
  function radioGroups() {
    loadRadios();
    var all = radios ? radios.top.concat.apply(radios.top, radios.gen.map(function (g) { return g[1]; })) : [];
    all.forEach(function (x) { if (!app.idx[x.id]) app.idx[x.id] = x; }); // favoritos e "segure OK"
    var pick = function (l) { return l.map(function (x) { return app.idx[x.id]; }); };
    var favs = Object.keys(Cloud.state.favs).map(function (k) { return app.idx[k]; }).filter(function (x) { return x && x.t === 'radio'; });
    return [{ name: '★  Favoritas', items: favs }, { name: 'Mais ouvidas no Brasil', items: radios ? pick(radios.top) : [] }]
      .concat(radios ? radios.gen.map(function (g) { return { name: g[0], items: pick(g[1]) }; }) : []);
  }

  // tela própria (o player de áudio: logo grande no meio), como os canais: esconde o que está atrás, Voltar devolve à lista.
  // ▲▼ troca de rádio na mesma fileira; vermelho favorita
  function playRadio(r, list) {
    list = list && list.length ? list : [r];
    Player.open({ url: r.u, live: true, audio: true, title: r.n, sub: 'Rádio' + (r.g ? '  ·  ' + r.g : ''), logo: r.l,
      onzap: function (d) { var i = list.indexOf(r); playRadio(list[(i + d + list.length) % list.length], list); },
      onfav: function () { toggleFav(r); },
      onclose: leavePlayer
    });
    enterPlayer();
  }

  /* ---------- Trailer (YouTube) ---------- */

  // tela cheia por cima de tudo; OK pausa/continua, Voltar fecha. O foco fica no app (o iframe não recebe o controle).
  // Alguns YouTube recusam vídeo dentro de app de TV: o QR no canto abre o trailer no celular
  var trailer = { el: null, paused: false };
  function openTrailer(key, title) {
    stopPreview();
    if (!trailer.el) {
      trailer.el = document.createElement('div');
      trailer.el.id = 'trailer';
      document.body.appendChild(trailer.el);
    }
    trailer.paused = false;
    trailer.el.innerHTML = '<iframe tabindex="-1" allow="autoplay; encrypted-media" src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(key) +
      '?autoplay=1&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&enablejsapi=1"></iframe>' +
      '<div class="tr-bar"><b>' + esc(title) + '</b><span><i class="k ok">OK</i> pausa &nbsp;·&nbsp; <i class="k ok">Voltar</i> fecha</span></div>' +
      '<div class="tr-qr">' + QR.svg('https://youtu.be/' + key, 150) + '<small>Não abriu? Veja no celular</small></div>';
    trailer.el.className = 'on';
  }
  function closeTrailer() {
    if (!trailer.el || trailer.el.className !== 'on') return;
    trailer.el.className = '';
    trailer.el.innerHTML = ''; // para o vídeo e o som
  }
  // o player do YouTube aceita comandos por mensagem (enablejsapi=1), sem carregar a biblioteca dele
  function trailerKey(k) {
    if (!trailer.el || trailer.el.className !== 'on') return false;
    if (k === K.BACK || k === K.ESC || k === K.BACKSPACE || k === K.STOP) closeTrailer();
    else if (k === K.ENTER || k === K.PLAY_PAUSE || k === K.PLAY || k === K.PAUSE) {
      trailer.paused = !trailer.paused;
      var f = trailer.el.querySelector('iframe');
      try { f.contentWindow.postMessage(JSON.stringify({ event: 'command', func: trailer.paused ? 'pauseVideo' : 'playVideo', args: [] }), '*'); } catch (e) {}
    }
    return true; // com o trailer aberto, nenhuma outra tecla mexe no app por trás
  }

  /* ---------- Ao vivo: grupos + canais ---------- */

  var ALL = 2; // posição de "Todos os canais"
  // mode: aba Vídeo (canais) ou Áudio (rádios); pos: onde cada aba estava, para voltar no mesmo lugar
  var live = { groups: null, gi: ALL, ci: 0, list: null, mode: 'video', pos: { video: { gi: ALL, ci: 0 }, audio: { gi: 1, ci: 0 } } };
  function setMode(m, quiet) {
    if (m === live.mode) { if (!quiet) Nav.focus($('liveChannels')); return; } // OK na aba que já está: desce para a lista
    live.pos[live.mode] = { gi: live.gi, ci: live.ci };
    live.mode = m;
    live.gi = live.pos[m].gi; live.ci = live.pos[m].ci;
    if (m === 'audio') stopPreview();
    if (quiet) return;
    renderLive();
    Nav.focus($('liveChannels'));
  }

  function recentLive() {
    var seen = {};
    return Cloud.state.history.filter(function (h) { return h.t === 'live'; })
      .map(function (h) { return app.idx[h.id]; })
      .filter(function (c) { return c && okItem(c) && !seen[c.id] && (seen[c.id] = 1); }); // versões do mesmo canal: um só
  }

  function liveGroups() {
    if (live.mode === 'audio' && app.view === 'live') {
      live.groups = radioGroups();
      if (live.gi >= live.groups.length) live.gi = 1;
      return live.groups;
    }
    live.groups = videoGroups();
    if (live.gi >= live.groups.length) live.gi = ALL;
    return live.groups;
  }
  function videoGroups() {
    return [{ name: '◷  Vistos por último', items: recentLive() }, { name: '★  Favoritos', items: favItems().live },
      { name: 'Todos os canais', items: app.visibleLive || app.cat.live }].concat(app.groups.live,
      // sem a senha, os grupos +18 aparecem só com o cadeado (OK pede a senha)
      adultOk ? [] : lockedGroups.live.map(function (g) { return { name: '🔒  ' + g.name, items: [], locked: true }; }));
  }

  /* ---------- Lista de canais por cima do vídeo ---------- */

  // ◀ com o canal aberto: a lista aparece à esquerda, em vidro, e o vídeo continua. ▲▼ canais, ◀ ▶ grupos, OK assiste,
  // Voltar fecha a lista (outro Voltar sai do vídeo, para o menu)
  var zp = { on: false, groups: null, gi: ALL, ci: 0 }, ZP_ROWS = 9;
  function zapOpen() {
    var ch = app.idx[Player.liveId];
    zp.groups = videoGroups();
    zp.gi = ALL;
    zp.groups.forEach(function (g, i) { if (g.items === zapList && g.items.indexOf(ch) >= 0) zp.gi = i; });
    zp.ci = Math.max(0, zp.groups[zp.gi].items.indexOf(ch));
    zp.on = true;
    lb.on = false;
    $('player').classList.remove('show');
    renderZap();
  }
  function zapClose() { zp.on = false; $('zap').classList.add('hidden'); }
  function renderZap() {
    var g = zp.groups[zp.gi], items = g.items, s = Math.max(0, Math.min(zp.ci - Math.floor(ZP_ROWS / 2), items.length - ZP_ROWS)), html = '';
    for (var i = s; i < Math.min(items.length, s + ZP_ROWS); i++) {
      var c = items[i], nn = nowNext(c), p = nn && nn.now;
      html += '<div class="zr' + (i === zp.ci ? ' sel' : '') + (c.id === Player.liveId ? ' tocando' : '') + '"><span class="zn">' + c.num + '</span>' +
        (c.l ? '<img src="' + esc(c.l) + '" alt=""/>' : '<span class="zi">' + esc(c.n.charAt(0)) + '</span>') +
        '<div><b>' + esc(c.n) + '</b>' + (p ? '<small>' + esc(p.t) + '</small>' : '') + '</div></div>';
    }
    $('zapG').textContent = g.name + ' · ' + items.length;
    $('zapL').innerHTML = html || '<p class="zv">' + (g.locked ? 'Grupo com senha: abra pelo Ao vivo' : 'Nenhum canal neste grupo') + '</p>';
    $('zap').classList.remove('hidden');
  }
  function zapKey(k) {
    if (!zp.on) {
      if (Player.active && Player.liveId && !lb.on && !mn && !qm.ch && k === K.LEFT) { zapOpen(); return true; }
      return false;
    }
    if (!Player.active) { zapClose(); return false; }
    var items = zp.groups[zp.gi].items;
    if (k === K.UP || k === K.DOWN) { if (items.length) zp.ci = (zp.ci + (k === K.UP ? -1 : 1) + items.length) % items.length; renderZap(); }
    else if (k === K.LEFT || k === K.RIGHT) { zp.gi = (zp.gi + (k === K.LEFT ? -1 : 1) + zp.groups.length) % zp.groups.length; zp.ci = 0; renderZap(); }
    else if (k === K.ENTER) {
      var c = items[zp.ci];
      zapClose();
      if (c && c.id !== Player.liveId) playLive(c, items);
    }
    else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) zapClose();
    else return false; // números, cores: seguem para o player
    return true;
  }

  // qualidade em uso e, se o canal tem outras, "+N" (tecla amarela troca)
  function qBadge(ch) {
    return (ch.q ? ' <em class="q">' + ch.q + '</em>' : '') + (ch.vs ? ' <em class="q more">+' + (ch.vs.length - 1) + '</em>' : '');
  }

  // selo da qualidade: "⚙ FHD · automática" (o ponteiro do controle clica; a tecla amarela abre as opções)
  function qChip(ch) {
    if (!ch.vs) return '';
    return '<span class="qchip" data-ch="' + esc(ch.id) + '">⚙ ' + esc(qName(ch, ch.vi)) + (ch.auto ? ' · automática' : '') + '</span>';
  }

  function qChoices(ch) {
    if (!ch.vs) return '';
    return '<p class="qs">' + qChip(ch) + ' &nbsp;<i class="k yellow"></i> opções (' + ch.vs.map(function (v, i) { return esc(qName(ch, i)); }).join(', ') + ')</p>';
  }

  function windowStart(sel, total) {
    return Math.max(0, Math.min(sel - Math.floor(LIST_ROWS / 2), total - LIST_ROWS));
  }

  function renderLive() {
    var groups = liveGroups(), g = groups[live.gi], items = g.items;
    live.ci = Math.max(0, Math.min(live.ci, items.length - 1));
    var playing = Player.active && Player.liveId;

    var gs = windowStart(live.gi, groups.length), html = '';
    for (var i = gs; i < Math.min(groups.length, gs + LIST_ROWS); i++) {
      html += '<li class="' + (i === live.gi ? 'sel' : '') + '"><span class="t">' + esc(groups[i].name) + '</span><span class="n">' + groups[i].items.length + '</span></li>';
    }
    $('liveGroups').innerHTML = html;

    var cs = windowStart(live.ci, items.length);
    html = '';
    for (i = cs; i < Math.min(items.length, cs + LIST_ROWS); i++) {
      var c = items[i], nn = nowNext(c);
      html += '<li class="' + (i === live.ci ? 'sel' : '') + (c.id === playing ? ' playing' : '') + '">' +
        '<span class="n">' + (c.num || i + 1) + '</span><span class="lg">' + (c.l ? '<img src="' + esc(c.l) + '"/>' : '') + '</span>' +
        '<span class="t"><span class="cn">' + esc(c.n) + qBadge(c) + '</span>' +
        (nn && nn.now ? '<small>' + esc(nn.now.t) + '</small>' + barHtml(nn.now) : '') + '</span>' +
        (isFav(c) ? '<span class="star">★</span>' : '') + '</li>';
    }
    $('liveChannels').innerHTML = html || '<li class="empty">' +
      (g.locked ? '🔒 Conteúdo protegido · <i class="k ok">OK</i> para digitar a senha'
        : live.mode === 'audio' ? (live.gi === 0 ? 'Segure <i class="k ok">OK</i> em uma rádio para favoritar' : radioLoading ? 'Carregando as rádios…' : 'Nenhuma rádio agora')
        : live.gi === 1 ? 'Segure <i class="k ok">OK</i> em um canal para favoritar' : 'Nenhum canal') + '</li>';
    $('modeVideo').classList.toggle('sel', live.mode === 'video');
    $('modeAudio').classList.toggle('sel', live.mode === 'audio');

    var ch = items[live.ci];
    if (live.mode === 'audio') {
      $('liveInfo').innerHTML = ch ? radioInfo(ch) : '';
      return stopPreview();
    }
    $('liveInfo').innerHTML = ch ? pvBox(ch) + chInfo(ch) +
      '<div class="keys"><span><i class="k ok">OK</i> tela cheia</span><span><i class="k ok">Segure OK</i> ' +
      (isFav(ch) ? 'tirar dos favoritos' : 'favoritar') + '</span><span><i class="k ok">0–9</i> ir ao canal</span>' +
      '<span><i class="k green"></i> tela dupla</span><span><i class="k blue"></i> buscar</span></div>' : '';
    schedulePreview(ch);
  }

  // aba Áudio: o logo grande no lugar da prévia, o nome, o estilo e a cidade
  function radioInfo(r) {
    return '<div class="pv-box">' + (r.l ? '<img src="' + esc(r.l) + '"/>' : '<span>' + esc(r.n.charAt(0)) + '</span>') + '</div>' +
      '<div class="num">Rádio</div><h2>' + esc(r.n) + '</h2>' + (r.g ? '<p>' + esc(r.g) + '</p>' : '') +
      '<div class="keys"><span><i class="k ok">OK</i> ouvir</span><span><i class="k ok">Segure OK</i> ' + (isFav(r) ? 'tirar das favoritas' : 'favoritar') + '</span></div>';
  }

  // número, nome e, com guia, o programa atual e o seguinte
  function chInfo(ch) {
    var nn = nowNext(ch), p = nn && nn.now;
    var html = '<div class="num">' + ch.num + ' <b>' + esc(ch.n) + '</b>' + qBadge(ch) + '</div>' + qChoices(ch);
    if (!p) return html + '<h2>' + esc(ch.n) + '</h2><p>' + esc(ch.g) + '</p>';
    html += '<h2>' + esc(p.t) + '</h2><p class="when">' + hhmm(p.s) + ' – ' + hhmm(p.e) + ' · ' + timeLeft(p) + '</p>' + barHtml(p);
    if (p.d) html += '<p class="desc">' + esc(p.d) + '</p>';
    if (nn.next) html += '<p class="nx"><b>A seguir · ' + hhmm(nn.next.s) + '</b>' + esc(nn.next.t) + '</p>';
    return html;
  }

  render.live = function () {
    renderLive();
    return live.groups[live.gi].items.length && live.gi !== ALL ? $('liveChannels') : $('liveGroups');
  };

  function listKeys(get, set, count, onChange) {
    return function (k) {
      var i = get(), n = count();
      if (k === K.UP && i === 0) { Nav.focus($(live.mode === 'audio' ? 'modeAudio' : 'modeVideo')); return true; }
      if (k === K.UP) i--;
      else if (k === K.DOWN) i++;
      else if (k === K.CH_UP) i -= LIST_ROWS;
      else if (k === K.CH_DOWN) i += LIST_ROWS;
      else return false;
      set(Math.max(0, Math.min(n - 1, i)));
      if (onChange) onChange();
      renderLive();
      return true;
    };
  }

  function initLive() {
    var gl = $('liveGroups'), cl = $('liveChannels');
    gl._key = listKeys(function () { return live.gi; }, function (i) { live.gi = i; },
      function () { return live.groups.length; }, function () { live.ci = 0; });
    gl._enter = function () {
      var g = live.groups[live.gi];
      // grupo com cadeado: depois da senha, o mesmo grupo (agora aberto) fica selecionado
      if (g.locked) return askPin(function () {
        var n = g.name.replace(/^🔒\s+/, ''), x;
        go('live');
        x = find(live.groups, function (y) { return y.name === n; });
        live.gi = x ? live.groups.indexOf(x) : ALL;
        renderLive();
        Nav.focus($('liveGroups'));
      });
      if (g.items.length) Nav.focus(cl);
    };
    cl._key = listKeys(function () { return live.ci; }, function (i) { live.ci = i; },
      function () { return live.groups[live.gi].items.length; });
    cl._enter = function () {
      var items = live.groups[live.gi].items, it = items[live.ci];
      if (it) return it.t === 'radio' ? playRadio(it, items) : playLive(it, items);
    };
    // abas Vídeo e Áudio no topo; ▲ no começo das listas sobe até elas
    $('modeVideo')._enter = function () { setMode('video'); };
    $('modeAudio')._enter = function () { setMode('audio'); };
  }

  /* ---------- TMDB (opcional, chave enviada pelo painel): sinopse, nota, gênero, listas ---------- */

  var IMG = 'https://image.tmdb.org/t/p/', META_MAX = 400;
  var metaCache = stored('ctv.meta') || {}, metaKeys = Object.keys(metaCache);
  var tmLists = stored('ctv.tmdb.lists'), tmLoading = false, titleIdx = null;

  // tmCount: atualização do TMDB em andamento (conta as consultas que voltaram, para o %)
  var tmCount = null;
  function tmdb(path, params) {
    var key = remote.tmdb;
    return new Promise(function (res) {
      var resolve = function (r) { if (tmCount) { tmCount.n++; tmCount.f(Math.min(1, tmCount.n / tmCount.total)); } res(r); };
      if (!key) return resolve(null);
      var q = ['language=pt-BR'], k;
      params = params || {};
      if (key.length <= 40) params.api_key = key; // chave v3; a v4 (token longo) vai no cabeçalho
      for (k in params) q.push(k + '=' + encodeURIComponent(params[k]));
      var x = new XMLHttpRequest();
      x.open('GET', 'https://api.themoviedb.org/3' + path + '?' + q.join('&'), true);
      if (key.length > 40) x.setRequestHeader('Authorization', 'Bearer ' + key);
      x.timeout = 10000;
      x.onload = function () { var r = null; try { if (x.status === 200) r = JSON.parse(x.responseText); } catch (e) {} resolve(r); };
      x.onerror = x.ontimeout = function () { resolve(null); };
      x.send();
    });
  }

  // "Duna Parte Dois (2024) [4K] Dublado" → { title: 'Duna Parte Dois', year: '2024' }
  function cleanTitle(s) {
    var year = (s.match(/\b(19[2-9]\d|20[0-4]\d)\b/) || [])[1];
    var title = s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\b(19[2-9]\d|20[0-4]\d)\b/g, ' ')
      .replace(/\b(4k|uhd|fhd|hd|sd|h\.?26[45]|hevc|dublado|legendado|dual|dub|leg|nacional|cinema)\b/gi, ' ')
      .replace(/[|_.\-–:]+/g, ' ').replace(/\s+/g, ' ').trim();
    return { title: title || s.trim(), year: year };
  }

  function names(l, n) { return (l || []).slice(0, n).map(function (x) { return x.name; }).join(', '); }

  // classificação indicativa do Brasil (filme: release_dates; série: content_ratings)
  function certBR(d) {
    var r = (d.release_dates && d.release_dates.results) || [], c = (d.content_ratings && d.content_ratings.results) || [], i, j;
    for (i = 0; i < r.length; i++) if (r[i].iso_3166_1 === 'BR') for (j = 0; j < r[i].release_dates.length; j++) if (r[i].release_dates[j].certification) return r[i].release_dates[j].certification;
    for (i = 0; i < c.length; i++) if (c[i].iso_3166_1 === 'BR' && c[i].rating) return c[i].rating;
    return '';
  }

  function toMeta(h, d) {
    var crew = (d.credits && d.credits.crew) || [], dir = crew.filter(function (c) { return c.job === 'Director'; });
    return {
      at: Date.now(),
      tid: h.id || 0, // id no TMDB ("Porque você assistiu")
      year: (h.release_date || h.first_air_date || '').slice(0, 4),
      rating: h.vote_average ? Math.round(h.vote_average * 10) / 10 : null,
      overview: h.overview || d.overview || '',
      tagline: d.tagline || '',
      runtime: d.runtime || (d.episode_run_time && d.episode_run_time[0]) || 0,
      genre: d.genres && d.genres[0] ? d.genres[0].name : '',
      genres: names(d.genres, 3),
      cast: names(d.credits && d.credits.cast, 5),
      crew: dir.length ? ['Direção', names(dir, 2)] : d.created_by && d.created_by.length ? ['Criação', names(d.created_by, 2)] : null,
      cert: certBR(d),
      poster: h.poster_path ? IMG + 'w342' + h.poster_path : '',
      trailer: pickTrailer(d.videos),
      onde: pickOnde(d['watch/providers']),
      backdrop: h.backdrop_path ? IMG + 'w1280' + h.backdrop_path : ''
    };
  }

  // trailer do YouTube: dublado/português primeiro, depois o original; trailer antes de teaser, oficial antes do resto
  function pickTrailer(v) {
    var best = '', score = -1;
    ((v && v.results) || []).forEach(function (x) {
      if (x.site !== 'YouTube' || !/^(Trailer|Teaser)$/.test(x.type) || !x.key) return;
      var sc = (x.iso_639_1 === 'pt' ? 8 : x.iso_639_1 === 'en' ? 4 : 0) + (x.type === 'Trailer' ? 2 : 0) + (x.official ? 1 : 0);
      if (sc > score) { score = sc; best = x.key; }
    });
    return best;
  }
  // Onde assistir no Brasil (dados do JustWatch pelo TMDB): os streamings de assinatura, e senão os de aluguel/compra
  function pickOnde(w) {
    var br = w && w.results && w.results.BR;
    if (!br) return [];
    var l = (br.flatrate || []).concat(br.free || [], br.ads || []);
    if (!l.length) l = (br.rent || []).concat(br.buy || []);
    var seen = {};
    return l.filter(function (x) { return x.provider_name && !seen[x.provider_name] && (seen[x.provider_name] = 1); })
      .slice(0, 5).map(function (x) { return x.provider_name; });
  }
  // fichas guardadas antes disso: busca só os provedores (uma vez)
  function ondeOf(item) {
    return getMeta(item).then(function (m) {
      if (!m || !m.tid) return [];
      if ('onde' in m) return m.onde;
      return tmdb('/' + (item.t === 'series' ? 'tv' : 'movie') + '/' + m.tid + '/watch/providers').then(function (w) {
        if (!w) return [];
        m.onde = pickOnde({ results: w.results });
        remember(item.id, m);
        return m.onde;
      });
    });
  }

  // fichas guardadas antes do trailer: busca só os vídeos (uma vez)
  function trailerOf(item) {
    return getMeta(item).then(function (m) {
      if (!m || !m.tid) return '';
      if ('trailer' in m) return m.trailer;
      return tmdb('/' + (item.t === 'series' ? 'tv' : 'movie') + '/' + m.tid + '/videos', { include_video_language: 'pt,en,null' }).then(function (v) {
        if (!v) return '';
        m.trailer = pickTrailer(v);
        remember(item.id, m);
        return m.trailer;
      });
    });
  }

  function remember(id, m) {
    if (!(id in metaCache)) metaKeys.push(id);
    metaCache[id] = m;
    while (metaKeys.length > META_MAX) delete metaCache[metaKeys.shift()];
    try { localStorage.setItem('ctv.meta', JSON.stringify(metaCache)); } catch (e) {}
  }

  // sem chave (ou sem rede) devolve null; título não encontrado fica guardado como { at }.
  // Cada título vale 7 dias (nota e sinopse mudam pouco); OK 8× no logo apaga tudo e busca de novo
  var META_TTL = 7 * 864e5;
  function getMeta(item) {
    if (!remote.tmdb || (item.t !== 'movie' && item.t !== 'series')) return Promise.resolve(null);
    var have = metaCache[item.id];
    if (have && have.at && Date.now() - have.at < META_TTL) return Promise.resolve(have);
    var type = item.t === 'series' ? 'tv' : 'movie', c = cleanTitle(item.n), params = { query: c.title, include_adult: 'false' };
    if (c.year) params[type === 'tv' ? 'first_air_date_year' : 'year'] = c.year;
    return tmdb('/search/' + type, params).then(function (r) {
      if (!r) return have || null;
      var hit = r.results && r.results[0];
      if (!hit) return { at: Date.now(), tid: 0 };
      return tmdb('/' + type + '/' + hit.id, { append_to_response: type === 'tv' ? 'credits,content_ratings,videos,watch/providers' : 'credits,release_dates,videos,watch/providers', include_video_language: 'pt,en,null' })
        .then(function (d) { return toMeta(hit, d || {}); });
    }).then(function (m) {
      if (m) remember(item.id, m);
      if (m && m.poster && !item.l && !item.tp) fillPoster(item, m.poster);
      return m;
    });
  }

  // a capa chegou depois do cartão desenhado: põe nos cartões dele que estão sem imagem
  function fillPoster(item, src) {
    var cards = document.querySelectorAll('.card.poster[data-fav="' + favKey(item) + '"]');
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].querySelector('img')) continue;
      var img = document.createElement('img');
      img.src = src;
      cards[i].insertBefore(img, cards[i].querySelector('.tagline, .prog, .star'));
    }
  }

  function titleKey(s) { return norm(cleanTitle(s).title).replace(/[^a-z0-9]/g, ''); }

  // em alta, populares e mais bem avaliados no TMDB: uma vez por dia, como a lista de canais (force: OK 8× no logo)
  // [título, título original, capa] de uma ou duas páginas de resultado do TMDB
  function tmTitles(a, b) {
    return (a && a.results || []).concat(b && b.results || []).map(function (x) {
      return [x.title || x.name || '', x.original_title || x.original_name || '', x.poster_path ? IMG + 'w342' + x.poster_path : ''];
    });
  }

  function tmFresh() { return !!tmLists && Date.now() - (tmLists.at || 0) < 7 * 864e5; }
  function loadTmdbLists(force) {
    // listas do TMDB (em alta, populares): uma vez por semana basta (eram todo dia, ~75 consultas por TV)
    if (!remote.tmdb || tmLoading || (!force && tmFresh())) return Promise.resolve();
    tmLoading = true;
    var titles = tmTitles;
    var two = function (path) { return [tmdb(path), tmdb(path, { page: 2 })]; };
    return Promise.all([tmdb('/trending/all/week')].concat(two('/movie/popular'), two('/tv/popular'), two('/movie/top_rated'), two('/tv/top_rated'))).then(function (r) {
      tmLoading = false;
      if (!r[0] && !r[1]) { syncErr.tmdb = 'O TMDB não respondeu (confira o token)'; return reportSync(); }
      syncErr.tmdb = '';
      reportSync();
      tmLists = { day: today(), at: Date.now(), trend: titles(r[0]), popMovies: titles(r[1], r[2]), popSeries: titles(r[3], r[4]),
                  movies: titles(r[5], r[6]), series: titles(r[7], r[8]) };
      try { localStorage.setItem('ctv.tmdb.lists', JSON.stringify(tmLists)); } catch (e) {}
      app.dirty.home = 1;
      if (app.view === 'home' && !Player.active && $('setup').classList.contains('hidden')) { delete app.dirty.home; refreshView(); }
      return loadVodLists();
    });
  }

  /* ---------- Filmes e Séries no estilo Netflix ---------- */

  // gêneros: [nome, gênero no TMDB (ou 'BR' = nacionais), palavras no nome do grupo da lista ou nos gêneros do TMDB]
  var GEN = {
    movie: [['Ação', 28, /\bacao\b/], ['Aventura', 12, /aventura/], ['Comédia', 35, /comedia/], ['Drama', 18, /drama/],
      ['Animação', 16, /animac|desenho|infantil|kids/], ['Suspense', 53, /suspense|thriller/], ['Terror', 27, /terror|horror/],
      ['Romance', 10749, /romanc|romant/], ['Ficção científica', 878, /ficcao|sci.?fi/], ['Crime', 80, /crime|policia/],
      ['Documentário', 99, /document/], ['Família', 10751, /familia/], ['Nacionais', 'BR', /nacion|brasil/]],
    series: [['Ação e aventura', 10759, /acao|aventura|action/], ['Comédia', 35, /comedia|sitcom/], ['Drama', 18, /drama/],
      ['Crime', 80, /crime|policia/], ['Infantil', 10762, /infantil|kids|desenho|anima/], ['Mistério', 9648, /misterio|suspense/],
      ['Reality', 10764, /reality/], ['Novelas', 10766, /novela|soap/], ['Documentário', 99, /document/], ['Terror', 0, /terror|horror/],
      ['Nacionais', 'BR', /nacion|brasil/]]
  };
  // serviços de streaming: [nome, id do serviço no TMDB (Brasil), palavras no nome do grupo da lista ("Séries | Netflix")]
  var SVC = [['Netflix', 8, /netflix/], ['Prime Video', 119, /prime|amazon/], ['Disney+', 337, /disney/], ['Max', 1899, /\bhbo\b|\bmax\b/],
    ['Globoplay', 307, /globoplay/], ['Apple TV+', 350, /apple/], ['Paramount+', 531, /paramount/]];

  // Top 10 do dia, lançamentos, os populares de cada gênero (2 páginas) e de cada serviço (1 página): ~65 consultas,
  // uma vez por dia, depois das listas principais (o Início não espera)
  function vodJobs() {
    var jobs = [['trendM', '/trending/movie/day'], ['trendS', '/trending/tv/day'], ['nowM', '/movie/now_playing'], ['nowS', '/tv/on_the_air']];
    ['movie', 'series'].forEach(function (type) {
      GEN[type].forEach(function (g, i) {
        if (!g[1]) return;
        [1, 2].forEach(function (page) {
          var q = { sort_by: 'popularity.desc', include_adult: 'false', page: page };
          if (g[1] === 'BR') q.with_origin_country = 'BR'; else q.with_genres = g[1];
          jobs.push(['g:' + type + ':' + i, '/discover/' + (type === 'movie' ? 'movie' : 'tv'), q]);
        });
      });
      SVC.forEach(function (s, i) {
        jobs.push(['s:' + type + ':' + i, '/discover/' + (type === 'movie' ? 'movie' : 'tv'), { sort_by: 'popularity.desc', include_adult: 'false', with_watch_providers: s[1], watch_region: 'BR' }]);
      });
    });
    return jobs;
  }
  function loadVodLists() {
    var jobs = vodJobs();
    return Promise.all(jobs.map(function (j) { return tmdb(j[1], j[2]); })).then(function (r) {
      if (!tmLists) return;
      var gen = { movie: {}, series: {} }, svc = { movie: {}, series: {} };
      jobs.forEach(function (j, n) {
        var t = tmTitles(r[n]), s = j[0].split(':'), to = s[0] === 'g' ? gen : svc;
        if (s.length > 1) to[s[1]][s[2]] = (to[s[1]][s[2]] || []).concat(t);
        else tmLists[j[0]] = t;
      });
      tmLists.gen = gen; tmLists.svc = svc;
      try { localStorage.setItem('ctv.tmdb.lists', JSON.stringify(tmLists)); } catch (e) {}
      vodDirty();
    });
  }

  // Filmes / Séries (e o Início) mudaram por trás: refaz se estiver na tela
  function vodDirty() {
    app.dirty.movies = app.dirty.series = app.dirty.home = 1;
    if ((app.view === 'movies' || app.view === 'series' || app.view === 'home') && !Player.active && $('setup').classList.contains('hidden')) { delete app.dirty[app.view]; refreshView(); }
  }

  // titleIdx: o primeiro título com cada nome; titleAll: todos (dublado, legendado…), para a senha valer em todos
  var titleAll = {};
  function ensureTitleIdx() {
    if (titleIdx) return;
    titleIdx = {}; titleAll = {};
    app.cat.movies.concat(app.cat.series).forEach(function (x) {
      var k = titleKey(x.n);
      if (!k) return;
      if (!titleIdx[k]) titleIdx[k] = x;
      (titleAll[k] || (titleAll[k] = [])).push(x);
    });
  }

  // títulos do TMDB → o que a lista da TV tem (pelo título); raw: inclui os que pedem senha
  function pickT(list, type, raw) {
    ensureTitleIdx();
    var seen = {}, res = [];
    (list || []).forEach(function (t) {
      var x = titleIdx[titleKey(t[0])] || titleIdx[titleKey(t[1])];
      if (x && (raw || okItem(x)) && (!type || x.t === type) && !seen[x.id]) { seen[x.id] = 1; if (t[2]) x.tp = t[2]; res.push(x); } // tp: capa do TMDB
    });
    return res;
  }

  // gêneros (ou serviços) da aba: nome do grupo da lista + populares do TMDB + fichas já abertas (só gêneros).
  // all: todos (para o chip e a senha); items: só os liberados
  // ponytail: título desconhecido no TMDB e de grupo sem nome de gênero fica só nos grupos da lista
  function vodGenres(type) { return vodBuckets(type, GEN[type], 'gen', true); }
  function vodServices(type) { return vodBuckets(type, SVC, 'svc', false); }
  function vodBuckets(type, defs, from, useMeta) {
    var list = app.cat[type === 'movie' ? 'movies' : 'series'], byGroup = {}, out = [];
    var gen = tmLists && tmLists[from] && tmLists[from][type] || {};
    var buckets = defs.map(function (d, i) { return { name: d[0], all: pickT(gen[i], type, true), seen: {} }; });
    buckets.forEach(function (b) { b.all.forEach(function (x) { b.seen[x.id] = 1; }); });
    function add(b, x) { if (!b.seen[x.id]) { b.seen[x.id] = 1; b.all.push(x); } }
    list.forEach(function (x) {
      var g = x.g || '', hit = byGroup[g];
      if (!hit) { var n = norm(g); hit = byGroup[g] = defs.map(function (d) { return d[2].test(n); }); }
      hit.forEach(function (on, i) { if (on) add(buckets[i], x); });
    });
    for (var id in useMeta ? metaCache : {}) {
      var it = app.idx[id], m = metaCache[id];
      if (!it || it.t !== type || !m.genres) continue;
      var mg = norm(m.genres);
      defs.forEach(function (d, i) { if (d[2].test(mg)) add(buckets[i], it); });
    }
    // chip com 3 ou mais títulos; a fileira do gênero só com 6 ou mais (em vodRows)
    buckets.forEach(function (b, i) {
      if (b.all.length < 3) return;
      // cadeado no gênero só se nada nele é livre: um título adulto no meio de Comédia não tranca a Comédia (ele some sem a senha)
      var free = b.all.filter(function (x) { return !x.lock; });
      out.push({ name: b.name, all: b.all, items: b.all.filter(okItem), locked: !free.length, i: i });
    });
    return out;
  }

  function yearOf(x) { if (x._y === undefined) x._y = +(cleanTitle(x.n).year || (metaCache[x.id] && metaCache[x.id].year) || 0); return x._y; }

  function uniq(l) { var seen = {}; return l.filter(function (x) { return x && !seen[x.id] && (seen[x.id] = 1); }); }

  // filmes: em cartaz no TMDB + os do ano (e do anterior) pelo título; séries: episódios novos + no ar no TMDB
  function releases(type) {
    if (type === 'series') return uniq(newest(app.cat.series).concat(pickT(tmLists && tmLists.nowS, 'series')));
    var y = new Date().getFullYear();
    var byYear = app.cat.movies.filter(function (x) { return yearOf(x) >= y - 1 && okItem(x); })
      .sort(function (a, b) { return yearOf(b) - yearOf(a) || (b.added || 0) - (a.added || 0); });
    return uniq(pickT(tmLists && tmLists.nowM, 'movie').concat(byYear));
  }

  // Sagas: coleções do TMDB (filmes): nome certo, filmes em ordem de lançamento e até títulos com nomes diferentes da
  // mesma saga. O que o TMDB não conhece (e as séries) continua pelo nome: títulos com o mesmo começo, 3 ou mais
  var SAGA_STOP = /^(e|de|do|da|dos|das|o|a|os|as|the|and|of|um|uma)$/;
  function sagaInfo(x) {
    if (x._sk) return x._sk;
    var t = norm(cleanTitle(x.n).title).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    var m = /^(.+?) (\d{1,2}|parte|part|capitulo)\b/.exec(t), w = (m ? m[1] : t).split(' ');
    if (!m) w = w.length >= 4 ? w.slice(0, 3) : [];
    w = w.slice(0, 3);
    while (w.length && SAGA_STOP.test(w[w.length - 1])) w.pop();
    var key = w.join(' ');
    return (x._sk = { key: key.length >= 4 ? key : '', full: t, n: m && /\d/.test(m[2]) ? +m[2] : 1, words: w.length });
  }
  function sagas(type) {
    var out = [], used = {};
    if (type === 'movie') colSagas().forEach(function (s) { out.push(s); s.items.forEach(function (x) { used[x.id] = 1; }); });
    nameSagas(type, 3).forEach(function (s) { if (!s.items.some(function (x) { return used[x.id]; })) out.push(s); });
    return out.sort(function (a, b) { return b.items.length - a.items.length; }).slice(0, 8);
  }

  // pelo nome: min títulos com o mesmo começo; q: o nome sem "Saga " (para buscar a coleção no TMDB)
  function nameSagas(type, min) {
    var list = app.cat[type === 'movie' ? 'movies' : 'series'].filter(okItem), by = {}, out = [];
    list.forEach(function (x) { var s = sagaInfo(x); if (s.key) (by[s.key] = by[s.key] || []).push(x); });
    // o primeiro da saga costuma vir sem número ("Toy Story", "Shrek"): entra pelo título inteiro
    list.forEach(function (x) { var s = sagaInfo(x); if (!s.key && by[s.full]) by[s.full].push(x); });
    for (var k in by) {
      var seen = {}, items = by[k].filter(function (x) { var tk = titleKey(x.n); return !seen[tk] && (seen[tk] = 1); });
      if (items.length < min) continue;
      items.sort(function (a, b) { return (yearOf(a) || 9999) - (yearOf(b) || 9999) || sagaInfo(a).n - sagaInfo(b).n || a.n.localeCompare(b.n); });
      var name = cleanTitle(items[0].n).title.split(/[\s:]+/).slice(0, sagaInfo(items[0]).words || k.split(' ').length).join(' ').replace(/[\s,:–-]+$/, '');
      out.push({ name: 'Saga ' + name, q: name, items: items });
    }
    return out.sort(function (a, b) { return b.items.length - a.items.length; });
  }

  // coleções do TMDB guardadas na TV (uma busca por semana): [{ id, name, parts: [[título, original, capa]] em ordem }]
  var colData = stored('ctv.colecoes') || { at: 0, list: [] }, colLoading = false;
  function colSagas() {
    return colData.list.map(function (c) {
      var items = pickT(c.parts, 'movie'); // só os que a lista tem (e liberados); a capa do TMDB vem junto
      return items.length >= 2 && { name: 'Saga ' + c.name, items: items };
    }).filter(Boolean);
  }
  // "Harry Potter: Coleção", "Coleção Toy Story" → "Harry Potter", "Toy Story"
  function colName(n) { return String(n || '').replace(/^\s*cole[cç][aã]o\s+(de\s+|do\s+|da\s+)?/i, '').replace(/[\s:–-]*(cole[cç][aã]o|collection)\s*$/i, '').trim(); }
  // as sagas achadas pelo nome (2 ou mais filmes, as 30 maiores) viram buscas de coleção no TMDB: ~60 consultas por semana
  function loadCollections() {
    if (!remote.tmdb || colLoading || Date.now() - colData.at < 7 * 864e5) return;
    colLoading = true;
    var list = [], seen = {};
    nameSagas('movie', 2).slice(0, 30).reduce(function (p, sg) {
      return p.then(function () {
        return tmdb('/search/collection', { query: sg.q }).then(function (r) {
          var hit = r && r.results && r.results[0];
          if (!hit || seen[hit.id]) return;
          seen[hit.id] = 1;
          return tmdb('/collection/' + hit.id).then(function (d) {
            if (!d || !d.parts) return;
            var parts = d.parts.filter(function (x) { return x.release_date; })
              .sort(function (a, b) { return a.release_date < b.release_date ? -1 : 1; })
              .map(function (x) { return [x.title || '', x.original_title || '', x.poster_path ? IMG + 'w342' + x.poster_path : '']; });
            if (parts.length >= 2) list.push({ id: hit.id, name: colName(d.name || hit.name) || sg.q, parts: parts });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      colLoading = false;
      colData = { at: Date.now(), list: list };
      store('ctv.colecoes', JSON.stringify(colData));
      vodDirty();
    }, function () { colLoading = false; });
  }

  // "Porque você assistiu": recomendações do TMDB do último filme (ou série) visto; busca uma vez por sessão
  var recs = {};
  function metaTid(item) {
    var m = metaCache[item.id];
    if (m && 'tid' in m) return Promise.resolve(m.tid);
    delete metaCache[item.id]; // ficha de antes da 1.6.0 (sem o id do TMDB): busca de novo
    return getMeta(item).then(function (r) { return r && r.tid; });
  }
  function recFor(type) {
    if (!remote.tmdb) return null;
    var h = find(Cloud.state.history, function (x) { return app.idx[x.id] && x.t === (type === 'movie' ? 'movie' : 'ep'); });
    if (!h) return null;
    var src = app.idx[h.id];
    if (src.t === 'ep') src = src.series;
    var r = recs[type];
    if (r && r.src === src) return r.list && { src: src, items: pickT(r.list, type).filter(function (x) { return x !== src; }) };
    r = recs[type] = { src: src, list: null };
    metaTid(src).then(function (id) {
      return id ? tmdb('/' + (type === 'movie' ? 'movie' : 'tv') + '/' + id + '/recommendations') : null;
    }).then(function (res) {
      if (recs[type] !== r || !res) return;
      r.list = tmTitles(res);
      if (pickT(r.list, type).length) vodDirty();
    });
    return null;
  }

  // as fileiras de Filmes / Séries, de cima para baixo (sem TMDB ficam: Continuar, Lançamentos pelo ano,
  // gêneros pelos grupos, sagas e os grupos da lista)
  function vodRows(type) {
    var cat = type === 'movie' ? 'movies' : 'series', top = tmdbRows(), rows = [];
    var cont = continueItems().filter(function (x) { return (x.t === 'ep' ? 'series' : 'movie') === type; });
    var top10 = pickT(tmLists && tmLists[type === 'movie' ? 'trendM' : 'trendS'], type);
    if (!top10.length) top10 = top.trend.filter(function (x) { return x.t === type; });
    top10 = top10.slice(0, 10);
    var pop = type === 'movie' ? top.popMovies : top.popSeries, best = type === 'movie' ? top.movies : top.series;
    var gens = vodGenres(type), rel = releases(type), rec = recFor(type);
    var feat = top10[0] || pop[0] || rel[0] || app.cat[cat].filter(okItem)[0];
    vodState[type] = { feat: feat, gens: gens };
    if (feat) rows.push({ title: '', btns: vodButtons(feat, gens) });
    if (cont.length) rows.push({ title: 'Continuar assistindo', items: cont, kind: 'poster', noMore: true });
    if (top10.length) rows.push({ title: 'Top 10 ' + (type === 'movie' ? 'filmes' : 'séries') + ' hoje', items: top10, kind: 'top', noMore: true });
    if (rel.length) rows.push({ title: type === 'movie' ? 'Lançamentos' : 'Episódios novos e no ar', items: rel, kind: 'poster' });
    if (rec && rec.items.length) rows.push({ title: 'Porque você assistiu ' + cleanTitle(rec.src.n).title, items: rec.items, kind: 'poster' });
    if (pop.length) rows.push({ title: 'Populares', items: pop, kind: 'poster' });
    // por serviço de streaming (Netflix, Prime Video…), como no Max IPTV: só com 6 ou mais títulos
    vodServices(type).forEach(function (s) { if (s.items.length >= 6) rows.push({ title: s.name, items: s.items, kind: 'poster', count: true }); });
    var genRows = gens.filter(function (g) { return g.items.length >= 6; }).map(function (g) { return { title: g.name, items: g.items, kind: 'poster', count: true }; });
    rows = rows.concat(genRows.slice(0, 4));
    if (best.length) rows.push({ title: 'Mais bem avaliados', items: best, kind: 'poster' });
    sagas(type).forEach(function (s) { rows.push({ title: s.name, items: s.items, kind: 'poster', noMore: true }); });
    rows = rows.concat(genRows.slice(4), groupRows(app.groups[cat], 'poster'));
    return rows;
  }

  // primeira fileira: assistir / detalhes do destaque e os chips de gênero (adulto com cadeado)
  var vodState = {};
  function vodButtons(feat, gens) {
    return btn('fplay', '▶&nbsp; Assistir', 'primary') + btn('finfo', 'ⓘ&nbsp; Detalhes') +
      gens.map(function (g, i) { return '<div class="btn chip f" data-act="genre" data-g="' + i + '">' + esc(g.name) + (g.locked && !adultOk ? '&nbsp; 🔒' : '') + '</div>'; }).join('');
  }

  function vodAction(el) {
    var st = vodState[app.view === 'movies' ? 'movie' : 'series'], act = el.getAttribute('data-act');
    if (!st) return;
    var feat = st.feat;
    if (act === 'genre') {
      var g = st.gens[+el.getAttribute('data-g')];
      var open = function () { go('grid', { title: g.name, items: g.all.filter(okItem), kind: 'poster' }, true); };
      return g.locked && !adultOk ? askPin(open) : open();
    }
    if (!feat) return;
    if (!okItem(feat)) return askPin(function () { vodAction(el); });
    if (act === 'finfo') return go('detail', feat, true);
    if (feat.t === 'movie') { var h = histFor(feat.id); return playVod(feat, resumable(h) ? h.pos : 0); }
    var t = seriesTarget(feat);
    playVod(t.ep, t.resume ? t.pos : 0);
  }

  // as listas do TMDB cruzadas com o que a lista da TV tem (pelo título)
  function tmdbRows() {
    var out = { trend: [], movies: [], series: [], popMovies: [], popSeries: [] };
    if (!remote.tmdb) return out;
    loadTmdbLists();
    if (!tmLists || !titleIdx) return out; // sem o índice ainda: entra quando ele ficar pronto (afterCatalog)
    var pick = function (list, type) { return pickT(list, type); };
    out.trend = pick(tmLists.trend);
    out.movies = pick(tmLists.movies, 'movie');
    out.series = pick(tmLists.series, 'series');
    out.popMovies = pick(tmLists.popMovies || [], 'movie');
    out.popSeries = pick(tmLists.popSeries || [], 'series');
    return out;
  }

  /* ---------- Guia de programação (XMLTV) ---------- */

  // fonte: link do painel; senão, o que a própria lista indica (url-tvg).
  // Guarda só de 6 h atrás a 24 h à frente, já separado por canal do guia.
  var EPG_TTL = 4 * 3600e3;
  var epg = stored('ctv.epg') || { url: '', at: 0, progs: {}, names: {} }, epgLoading = false;

  // o guia montado no servidor (remote.guia) vem antes do link do portal e do que a lista indica
  function epgUrl() { return (remote.guia ? 'guia:' + remote.guia.v : '') || remote.epg || app.cat.epg || window.PREVIEW_EPG || ''; }

  // devolve uma promessa com true (guia novo ou ainda em dia) / false (falhou: motivo em syncErr.guia).
  // onprog(0–100): baixar vai até 60%, ler o guia o resto
  var epgRun = null;
  function loadEpg(force, onprog) {
    var url = epgUrl();
    if (epgLoading) return epgRun;
    if (url.indexOf('guia:') === 0) return loadGuia(url, force, onprog);
    if (!url || (!force && url === epg.url && Date.now() - epg.at < EPG_TTL)) return Promise.resolve(!!url);
    epgLoading = true;
    epgRun = new Promise(function (resolve) {
      Api.getText(url, onprog && function (got, total) { onprog(total ? got / total * 60 : 60 * (1 - Math.exp(-got / 2e7))); }).then(function (xml) {
        parseEpg(xml, function (data) { epgDone(url, data); resolve(true); }, onprog && function (f) { onprog(60 + f * 40); });
      }, function (e) { epgLoading = false; syncErr.guia = e.message; reportSync(); resolve(false); });
    });
    return epgRun;
  }
  function epgDone(url, data) {
    epgLoading = false;
    data.url = url;
    data.at = Date.now();
    epg = data;
    app.cat.live.forEach(function (c) { delete c._x; });
    try { localStorage.setItem('ctv.epg', JSON.stringify(epg)); } catch (e) {} // guia grande: fica só na memória
    epgChanged();
    syncErr.guia = '';
    reportSync();
  }

  /* guia montado no servidor toda noite (função montarGuia): canais.json e um arquivo por dia, de hoje em diante.
     A TV baixa hoje e amanhã; o Guia baixa os outros dias quando chega neles. Tudo vira o mesmo epg.progs */
  function guiaUrl(path) { return remote.guia.base + encodeURIComponent(path) + '?alt=media'; }
  function dayStr(t) { var d = new Date(t); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

  // [[início, fim, título, descrição, k]] de um dia → epg.progs (sem repetir o programa que cruza a meia-noite)
  function mergeDay(data, f) {
    data.days[f.d] = 1;
    for (var id in f.p || {}) {
      var arr = data.progs[id] || (data.progs[id] = []), seen = {};
      arr.forEach(function (p) { seen[p.s] = 1; });
      f.p[id].forEach(function (x) { if (!seen[x[0]]) { seen[x[0]] = 1; arr.push({ s: x[0], e: x[1], t: x[2] || '', d: x[3] || '', k: x[4] || 0 }); } });
      arr.sort(function (a, b) { return a.s - b.s; });
    }
  }

  function loadGuia(url, force, onprog) {
    var d0 = today();
    if (!force && epg.url === url && epg.day === d0) return Promise.resolve(true);
    epgLoading = true;
    var files = ['epg/canais.json', 'epg/dias/' + d0 + '.json', 'epg/dias/' + dayStr(Date.now() + 864e5) + '.json'], got = 0;
    epgRun = Promise.all(files.map(function (f, i) {
      return Api.getText(guiaUrl(f)).then(function (t) {
        if (onprog) onprog(++got / files.length * 100);
        return JSON.parse(t);
      }, function (e) { if (i < 2) throw e; return null; }); // amanhã pode ainda não ter
    })).then(function (r) {
      var data = { progs: {}, names: {}, days: {}, day: d0 };
      (r[0] || []).forEach(function (c) {
        (c.nomes || []).forEach(function (n) { var k = nameKey(n); if (k && !data.names[k]) data.names[k] = c.id; });
      });
      if (r[1]) mergeDay(data, r[1]);
      if (r[2]) mergeDay(data, r[2]);
      epgDone(url, data);
      return true;
    }, function (e) { epgLoading = false; syncErr.guia = e.message; reportSync(); return false; });
    return epgRun;
  }

  // o Guia chegou num dia que não está na memória: baixa só ele
  // ponytail: os dias visitados ficam na memória até a próxima atualização do guia
  var dayLoading = {};
  function ensureDay(d) {
    if (!remote.guia || !epg.days || epg.days[d] || dayLoading[d] || d < today()) return;
    dayLoading[d] = 1;
    Api.getText(guiaUrl('epg/dias/' + d + '.json')).then(function (t) {
      delete dayLoading[d];
      mergeDay(epg, JSON.parse(t));
      if (app.view === 'guide' && !Player.active) renderGuide();
    }, function () { delete dayLoading[d]; epg.days[d] = 1; }); // dia sem guia: não tenta de novo
  }

  function xmlText(s) {
    return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&').trim();
  }
  function xmlTag(body, name) {
    var m = body.match(new RegExp('<' + name + '\\b[^>]*>([\\s\\S]*?)</' + name + '>'));
    return m ? xmlText(m[1]) : '';
  }
  function xmlAttr(head, name) {
    var m = head.match(new RegExp('\\b' + name + '="([^"]*)"'));
    return m ? xmlText(m[1]) : '';
  }

  // "20261024132500 -0300" → ms
  function xmltvTime(s) {
    var m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?\s*([+-])?(\d\d)?(\d\d)?/.exec(s);
    if (!m) return 0;
    var t = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    if (m[7]) t -= (m[7] === '-' ? -1 : 1) * ((+m[8] || 0) * 60 + (+m[9] || 0)) * 60000;
    return t;
  }

  // canal sem tvg-id: casa pelo nome (sem acento, espaço nem qualidade)
  function nameKey(s) { return norm(M3U.quality(s).n).replace(/[^a-z0-9]/g, ''); }

  function parseEpg(xml, done, onfrac) {
    var from = Date.now() - 6 * 3600e3, to = Date.now() + 24 * 3600e3, out = { progs: {}, names: {} }, m;
    var chRe = /<channel\b([^>]*)>([\s\S]*?)<\/channel>/g;
    while ((m = chRe.exec(xml))) {
      var cid = xmlAttr(m[1], 'id');
      (m[2].match(/<display-name\b[^>]*>[\s\S]*?<\/display-name>/g) || []).forEach(function (d) {
        var k = nameKey(xmlText(d));
        if (k && !out.names[k]) out.names[k] = cid;
      });
    }
    var re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
    (function step() {
      // ponytail: tudo na TV, em partes de 3000; guia de milhares de canais pede pré-processar fora (painel/Cloud Function)
      for (var n = 0; n < 3000 && (m = re.exec(xml)); n++) {
        var s = xmltvTime(xmlAttr(m[1], 'start')), e = xmltvTime(xmlAttr(m[1], 'stop'));
        if (!s || !e || e < from || s > to) continue;
        var ch = xmlAttr(m[1], 'channel');
        (out.progs[ch] || (out.progs[ch] = [])).push({ s: s, e: e, t: xmlTag(m[2], 'title'), d: xmlTag(m[2], 'desc').slice(0, 300) });
      }
      if (m) { if (onfrac) onfrac(re.lastIndex / xml.length); return setTimeout(step, 0); } // devolve a vez para a tela não travar
      for (var k in out.progs) out.progs[k].sort(function (a, b) { return a.s - b.s; });
      done(out);
    })();
  }

  function progsOf(ch) {
    if (!ch || ch.t !== 'live') return null;
    // canal do guia: o escolhido no portal (mapa), o tvg-id ou o nome
    if (ch._x === undefined) {
      var mapa = remote.guia && remote.guia.mapa, m = mapa && mapa[(ch.ks || [ch.k])[0]];
      ch._x = m && epg.progs[m] ? m : ch.e && epg.progs[ch.e] ? ch.e : epg.names[nameKey(ch.n)] || null;
    }
    return ch._x ? epg.progs[ch._x] || null : null;
  }

  // { now, next } do canal; null sem guia
  function nowNext(ch) {
    var p = progsOf(ch), t = Date.now();
    if (!p) return null;
    for (var i = 0; i < p.length; i++) {
      if (p[i].e > t) return p[i].s <= t ? { now: p[i], next: p[i + 1] || null } : { now: null, next: p[i] };
    }
    return null;
  }

  function hhmm(t) { var d = new Date(t); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function dur(ms) { var m = Math.max(1, Math.round(ms / 60000)); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + pad2(m % 60); }
  function timeLeft(p) { return 'faltam ' + dur(p.e - Date.now()); }
  function barHtml(p) {
    var pct = Math.max(0, Math.min(100, (Date.now() - p.s) / (p.e - p.s) * 100));
    return '<span class="ebar"><i style="width:' + pct.toFixed(1) + '%"></i></span>';
  }

  // guia novo (ou o minuto virou): refaz o que está na tela
  function epgChanged() {
    markDirty();
    if (Player.active || !$('setup').classList.contains('hidden')) return;
    if (app.view === 'live') renderLive();
    else if (app.view === 'guide') renderGuide();
    else if (app.view === 'home') { delete app.dirty[app.view]; refreshView(); }
  }

  /* ---------- Prévia ao vivo (Ao vivo e Guia) ---------- */

  // o vídeo da TV fica atrás da página: com a prévia, #pvHole "fura" a tela só no retângulo dela
  var pv = { ch: null, timer: null, ok: false, err: false };

  function pvBox(ch) {
    var mine = pv.ch === ch;
    return '<div class="pv-box' + (mine && pv.ok ? ' on' : '') + '">' +
      (ch.l ? '<img src="' + esc(ch.l) + '"/>' : '<span>' + esc(ch.n.charAt(0)) + '</span>') +
      '<em>' + (!previewOn() ? 'Aperte OK para assistir' : mine && pv.err ? 'Sem prévia deste canal' : 'Sintonizando…') + '</em></div>';
  }

  // assinatura de 1 tela: sem prévia nem tela dupla (cada canal em foco abriria uma conexão, e o fornecedor recusa o de verdade)
  function duoOk() { return !(app.cat && app.cat.telas === 1); }
  // prévia: só com internet medida que aguenta com folga (abrir um canal a cada foco travava as mais fracas); sem medida, mede
  var PV_MBPS = 15;
  function previewOn() {
    if (!duoOk()) return false;
    if (!band.at) { measureBand(); return false; }
    return band.mbps >= PV_MBPS;
  }

  // não tocou: pergunta ao fornecedor (API Xtream) se a assinatura está ativa e se as telas dela estão todas em uso.
  // Só diz o motivo quando ele é confirmado; senão fica a mensagem do player
  // a resposta vale 2 min: as tentativas seguidas e a troca de canal não perguntam de novo ao fornecedor
  var why = { at: 0, msg: '' };
  function whyFail(cb) {
    var c = activePlaylist() && Xtream.creds(activePlaylist().url);
    if (!c) return cb('');
    if (Date.now() - why.at < 120000) return cb(why.msg);
    var done = cb;
    cb = function (m) { why = { at: Date.now(), msg: m }; done(m); };
    Xtream.info(c).then(function (i) {
      if (i.status && !/^active$/i.test(i.status)) return cb('O fornecedor diz que a assinatura está ' + (/expired/i.test(i.status) ? 'vencida' : 'bloqueada') + '. Fale com o atendimento.');
      if (i.telas && i.ativas >= i.telas) return cb('A assinatura já está em uso em ' + (i.telas > 1 ? i.ativas + ' aparelhos' : 'outro aparelho') +
        ' (o plano permite ' + i.telas + (i.telas > 1 ? ' telas' : ' tela') + ' ao mesmo tempo). Feche no outro aparelho ou espere 1 minuto e tente de novo.');
      cb('');
    }, function () { cb(''); });
  }

  function schedulePreview(ch) {
    clearTimeout(pv.timer);
    if (!ch || !previewOn()) return stopPreview();
    if (pv.ch === ch) return;
    pv.timer = setTimeout(function () { startPreview(ch); }, 1500); // só depois de parar de navegar (rolando a lista, não abre nada)
  }

  function rectOf(el) {
    var x = 0, y = 0, n = el;
    while (n && n !== $('shell')) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
    return { x: x, y: y, w: el.offsetWidth, h: el.offsetHeight };
  }

  // a caixa da prévia: na tela (Ao vivo, Guia) ou no destaque (Início e outras fileiras de canais)
  function pvEl() { return $('v-' + app.view).querySelector('.pv-box') || $('heroSide').querySelector('.pv-box'); }

  function startPreview(ch) {
    var box = pvEl();
    if (!box || Player.active) return;
    var r = rectOf(box), hole = $('pvHole');
    pv.ch = ch; pv.ok = pv.err = false;
    hole.style.borderRadius = $('heroSide').contains(box) ? '0' : ''; // no destaque, encosta na borda da tela
    hole.style.left = r.x + 'px'; hole.style.top = r.y + 'px'; hole.style.width = r.w + 'px'; hole.style.height = r.h + 'px';
    $('shell').classList.add('pv');
    Player.preview(ch.u, r, function (ok) {
      if (pv.ch !== ch) return;
      pv.ok = ok; pv.err = !ok;
      if (!ok) $('shell').classList.remove('pv');
      var b = pvEl();
      if (!b) return;
      b.classList.toggle('on', ok);
      b.querySelector('em').textContent = ok ? '' : 'Sem prévia deste canal';
    });
  }

  function stopPreview() {
    clearTimeout(pv.timer);
    pv.ch = null; pv.ok = pv.err = false;
    $('shell').classList.remove('pv');
    Player.stopPreview();
  }

  /* ---------- Guia (grade de horários) ---------- */

  var G_ROWS = 6, G_SPAN = 3 * 3600e3, G_W = 1384, G_PX = G_W / G_SPAN, HALF = 1800e3;
  var guide = { gi: ALL, ci: 0, t: 0, t0: 0 }; // t: horário do cursor; t0: começo da janela de 3 h

  function guideItems() { return (live.groups || liveGroups())[guide.gi].items; }
  function guideCh() { return guideItems()[guide.ci] || null; }

  // programa no horário t (ou o próximo, ou o último)
  function progAt(ch, t) {
    var p = progsOf(ch);
    if (!p || !p.length) return null;
    for (var i = 0; i < p.length; i++) if (p[i].e > t) return p[i];
    return p[p.length - 1];
  }

  render.guide = function () {
    liveGroups();
    if (guide.gi >= live.groups.length) guide.gi = ALL;
    guide.t = Date.now();
    guide.t0 = guide.t - guide.t % HALF - HALF;
    renderGuide();
    return $('gGrid');
  };

  // "Hoje", "Amanhã" ou "qui, 30 out"
  function dayName(t) {
    var d = dayStr(t), d0 = today(), x = new Date(t);
    return d === d0 ? 'Hoje' : d === dayStr(Date.now() + 864e5) ? 'Amanhã' : DAYS[x.getDay()] + ', ' + x.getDate() + ' ' + MONTHS[x.getMonth()];
  }

  function guideInfo(ch, p) {
    var html = '<div class="num">' + ch.num + ' <b>' + esc(ch.n) + '</b>' + qBadge(ch) + '</div>';
    if (!p) {
      return html + '<h2>' + esc(ch.n) + '</h2><p class="when">' +
        (epgUrl() ? 'Sem programação para este canal' : 'O guia de programação ainda não foi configurado no portal') + '</p>';
    }
    var now = Date.now(), d = new Date(p.s);
    var st = p.e <= now ? 'já exibido' : p.s <= now ? '<span class="badge-now">● AGORA</span> ' + timeLeft(p) : 'começa em ' + dur(p.s - now);
    return html + '<h2>' + esc(p.t) + '</h2><p class="when">' + DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] +
      ' · ' + hhmm(p.s) + ' – ' + hhmm(p.e) + ' · ' + st + '</p>' + (p.d ? '<p class="desc">' + esc(p.d) + '</p>' : '');
  }

  function renderGuide() {
    var groups = live.groups || liveGroups(), items = guideItems(), now = Date.now();
    guide.ci = Math.max(0, Math.min(guide.ci, items.length - 1));
    var ch = items[guide.ci], sel = ch && progAt(ch, guide.t);
    // a janela de 3 h acompanha o cursor
    if (guide.t < guide.t0) guide.t0 = guide.t - guide.t % HALF;
    if (guide.t > guide.t0 + G_SPAN - HALF) guide.t0 = guide.t - guide.t % HALF - G_SPAN + 2 * HALF;
    var t0 = guide.t0, t1 = t0 + G_SPAN, px = function (t) { return Math.round((t - t0) * G_PX); };

    $('gInfo').innerHTML = ch ? guideInfo(ch, sel) : '';
    $('gPv').innerHTML = ch ? pvBox(ch) : '';
    $('gGroup').innerHTML = '<b>‹</b>' + esc(groups[guide.gi].name) + '<b>›</b><span>' + items.length + ' canais</span><em class="g-day">' + dayName(guide.t) + '</em>';
    if (remote.guia) { ensureDay(dayStr(t0)); ensureDay(dayStr(t1)); } // a janela cruzou a meia-noite

    var rs = Math.max(0, Math.min(guide.ci - 2, items.length - G_ROWS)), shown = Math.min(G_ROWS, items.length - rs);
    var html = '<div class="g-hours">';
    for (var h = t0; h < t1; h += HALF) html += '<span style="left:' + px(h) + 'px">' + hhmm(h) + '</span>';
    // a linha do "agora" desce só até a última linha visível (46 px de horas + 92 px por canal)
    if (now >= t0 && now < t1) html += '<i class="g-now" style="left:' + px(now) + 'px;height:' + (46 + shown * 92) + 'px"><b>' + hhmm(now) + '</b></i>';
    html += '</div>';

    for (var i = rs; i < Math.min(items.length, rs + G_ROWS); i++) {
      var c = items[i], ps = progsOf(c) || [], cells = '';
      for (var j = 0; j < ps.length; j++) {
        var p = ps[j];
        if (p.e <= t0 || p.s >= t1) continue;
        var x = Math.max(p.s, t0);
        cells += '<div class="g-p' + (p.e <= now ? ' past' : p.s <= now ? ' now' : '') + (i === guide.ci && p === sel ? ' sel' : '') +
          '" style="left:' + px(x) + 'px;width:' + Math.max(4, px(Math.min(p.e, t1)) - px(x) - 6) + 'px"><b>' + esc(p.t) + '</b><span>' + hhmm(p.s) + '</span>' +
          (p.s <= now && p.e > now ? barHtml(p) : '') + '</div>';
      }
      if (!cells) cells = '<div class="g-p empty' + (i === guide.ci ? ' sel' : '') + '" style="left:0;width:' + (G_W - 6) + 'px"><b>Sem programação</b></div>';
      html += '<div class="g-row' + (i === guide.ci ? ' cur' : '') + '"><div class="g-ch"><span class="lg">' + (c.l ? '<img src="' + esc(c.l) + '"/>' : '') +
        '</span><span class="cn"><i>' + c.num + '</i>' + esc(c.n) + '</span></div><div class="g-line">' + cells + '</div></div>';
    }
    if (!items.length) html += '<div class="empty">Nenhum canal neste grupo</div>';
    $('gGrid').innerHTML = html;
    schedulePreview(ch);
  }

  function initGuide() {
    var gg = $('gGrid'), gb = $('gGroup');
    gg._key = function (k) {
      var items = guideItems(), ch = items[guide.ci], ps = progsOf(ch), sel = ch && progAt(ch, guide.t);
      if (k === K.LEFT || k === K.RIGHT) {
        var i = ps && sel ? ps.indexOf(sel) + (k === K.LEFT ? -1 : 1) : -1;
        // no fim do que está na memória: baixa o dia seguinte (guia do servidor)
        if (k === K.RIGHT && ps && sel && i >= ps.length) { ensureDay(dayStr(sel.e + 60e3)); return true; }
        if (i < 0 || !ps || i >= ps.length) return k === K.LEFT ? false : true; // no começo: ← vai para o menu
        var now = Date.now(), p = ps[i];
        guide.t = p.s <= now && p.e > now ? now : p.s; // no programa no ar, o cursor fica em "agora"
      } else if (k === K.FF || k === K.RW) {
        // ▶▶ / ◀◀: um dia para frente ou para trás (de agora até +30 dias)
        var t = guide.t + (k === K.FF ? 864e5 : -864e5);
        guide.t = Math.max(Date.now(), Math.min(t, Date.now() + 30 * 864e5));
        ensureDay(dayStr(guide.t));
      } else if (k === K.UP || k === K.DOWN || k === K.CH_UP || k === K.CH_DOWN) {
        var d = k === K.UP ? -1 : k === K.DOWN ? 1 : k === K.CH_UP ? -G_ROWS : G_ROWS;
        if (guide.ci === 0 && d < 0) { Nav.focus(gb); return true; }
        guide.ci = Math.max(0, Math.min(items.length - 1, guide.ci + d));
      } else return false;
      renderGuide();
      return true;
    };
    gg._enter = function () {
      var items = guideItems();
      if (items[guide.ci]) playLive(items[guide.ci], items);
    };
    gb._key = function (k) {
      if (k === K.LEFT || k === K.RIGHT) {
        var n = live.groups.length;
        guide.gi = (guide.gi + (k === K.LEFT ? -1 : 1) + n) % n;
        guide.ci = 0;
        renderGuide();
        return true;
      }
      if (k === K.DOWN) { Nav.focus(gg); return true; }
      return false;
    };
    gb._enter = function () { Nav.focus(gg); };
  }

  /* ---------- Busca ---------- */

  // Buscar no menu procura em tudo. A tecla azul, de qualquer tela, abre a busca daquela tela: Filmes, Séries, Minha lista,
  // Ao vivo e Guia só no que mostram (Início e o resto, em tudo). Voltar devolve à tela de onde veio; o texto fica guardado por tela
  var searchTimer, busca = { scope: 'home', txt: {} };
  var SCOPE = { home: 'Buscar canais, filmes e séries', movies: 'Buscar filmes', series: 'Buscar séries',
                favs: 'Buscar na minha lista', live: 'Buscar canais', guide: 'Buscar canais' };

  function openSearch(scope) {
    if (Player.active) return;
    go('search', SCOPE[scope] ? scope : 'home', true);
  }

  render.search = function (scope) {
    busca.scope = SCOPE[scope] ? scope : 'home'; // pelo menu (sem tela): em tudo
    $('q').placeholder = SCOPE[busca.scope];
    $('q').value = busca.txt[busca.scope] || '';
    runSearch();
    return $('q');
  };

  function runSearch() {
    var q = norm($('q').value.trim()), rows = [], sc = busca.scope;
    busca.txt[sc] = $('q').value;
    if (q.length >= 2) {
      var match = function (x) { return okItem(x) && (x._s || (x._s = norm(x.n))).indexOf(q) >= 0; };
      var fav = sc === 'favs' && favItems(), has = function (t) { return sc === 'home' || sc === 'favs' || sc === t; };
      var l = has('live') || sc === 'guide' ? (fav ? fav.live : app.cat.live).filter(match) : [];
      var m = has('movies') ? (fav ? fav.movies : app.cat.movies).filter(match) : [];
      var s = has('series') ? (fav ? fav.series : app.cat.series).filter(match) : [];
      if (l.length) rows.push({ title: 'Canais', items: l, kind: 'wide', count: true });
      if (m.length) rows.push({ title: 'Filmes', items: m, kind: 'poster', count: true });
      if (s.length) rows.push({ title: 'Séries', items: s, kind: 'poster', count: true });
    }
    renderRows(vs('search'), rows, q.length >= 2 ? 'Nada encontrado para “' + esc($('q').value) + '”' : 'Digite pelo menos 2 letras');
  }

  /* ---------- Ajustes ---------- */

  render.settings = function (arg) {
    if (arg === 'hide') return settingsHide();
    if (arg && arg.edit) return settingsGroup(arg);
    var html = ''; // a lista não aparece aqui: vem sozinha do portal (OK 8× no logo força a atualização)
    // o celular vira controle: o QR abre a página do controle já pareada com esta TV (primeiro dos Ajustes)
    if (Controle.key) {
      html += '<div class="row"><h3>Controle pelo celular</h3><div class="support">' + QR.svg(Controle.link(), 260) +
        '<p>Aponte a câmera do celular para o código e use a tela como controle. Quem tiver este código controla a TV: ' +
        'para cortar os celulares que já usaram, gere um novo.</p></div>' +
        '<div class="track" data-group="rc">' + btn('rcnew', '↻&nbsp; Gerar novo código') + '</div></div>';
    }
    if (remote.plano) {
      var ps = planState(), ate = remote.plano.ate ? remote.plano.ate.split('-').reverse().join('/') : '';
      html += '<div class="row"><h3>Plano</h3><p class="info">' + esc(remote.plano.nome || 'Assinatura') + ' · ' +
        (ps === 'bloqueado' ? '<b class="bad">bloqueado</b>' : ps === 'vencido' ? '<b class="bad">vencido' + (ate ? ' em ' + ate : '') + '</b>' : 'ativo' + (ate ? ' até ' + ate : '')) + '</p></div>';
    }
    if (remote.cliente && profile.cur) {
      html += '<div class="row"><h3>Perfil</h3><p class="info">Assistindo como <b>' + esc(profile.cur.nome) + '</b></p>' +
        '<div class="track" data-group="pf">' + btn('profiles', 'Trocar perfil') + btn('editpf', '✎&nbsp; Editar perfil') + '</div></div>';
    }
    html += '<div class="row"><h3>Qualidade dos canais</h3><p class="info">' +
      (band.mbps ? 'Sua internet: <b>' + String(band.mbps).replace('.', ',') + ' Mbps</b> · medida ' + agoTxt(band.at) : 'A internet ainda não foi medida') +
      '. Canal com SD, HD, FHD e 4K abre na melhor que ela aguenta e desce sozinho se travar. Para escolher num canal: <i class="k yellow"></i> no Ao vivo ou no vídeo.</p>' +
      '<div class="track" data-group="bd">' + btn('band', '↻&nbsp; Medir a internet agora') + '</div></div>';
    html += '<div class="row"><h3>Conteúdo adulto</h3><p class="info">Só o conteúdo adulto (+18) pede senha' +
      (localStorage.getItem('ctv.pin') ? '' : ' (a de fábrica é 0000)') + '. ' + (adultOk ? '<b>Liberado até fechar o app.</b>' : 'Protegido agora.') + '</p>' +
      '<div class="track" data-group="pin">' + (adultOk ? btn('lock18', '🔒&nbsp; Proteger de novo') : btn('open18', '🔓&nbsp; Liberar')) + btn('pin18', 'Trocar a senha') + '</div></div>';
    // atualizar na hora: tudo ou uma parte (o % aparece no canto, como quando o portal pede)
    var when = function (t) { return t ? agoTxt(t) : 'nunca'; };
    html += '<div class="row"><h3>Atualizar agora</h3><p class="info">Lista de canais ' + when(catAt) +
      ' · guia ' + (epgUrl() ? when(epg.at) : 'não configurado') + ' · capas e sinopses ' + (remote.tmdb ? when(tmLists && tmLists.at) : 'não configuradas') +
      (updating ? ' · <b>atualizando ' + UPD[updating][0] + '…</b>' : '') + '</p>' +
      '<div class="track" data-group="up">' + [['tudo', '⟳&nbsp; Tudo'], ['canais', 'Lista de canais'], ['guia', 'Guia de programação'], ['tmdb', 'Capas e sinopses']]
        .map(function (b) { return '<div class="btn f" data-act="upd" data-o="' + b[0] + '">' + b[1] + '</div>'; }).join('') + '</div></div>';
    if (remote.cliente) {
      var sent = +localStorage.getItem('ctv.canaisAt') || 0;
      html += '<div class="row"><h3>Canais no portal</h3><p class="info">Manda a lista de canais desta TV para o portal montar os grupos; ' +
        'os grupos voltam sozinhos em até 10 min.' + (sent ? ' Última vez ' + agoTxt(sent) + '.' : '') + '</p>' +
        '<div class="track" data-group="sc">' + btn('sendch', '⇪&nbsp; Enviar canais ao portal') + '</div></div>';
    }
    var mine = Cloud.state.settings.grupos || [], nHid = (Cloud.state.settings.ocultos || []).length;
    html += '<div class="row"><h3>Grupos</h3><div class="track" data-group="gr">' + btn('hide', 'Ocultar grupos') + btn('newgrp', '+&nbsp; Criar grupo') +
      mine.map(function (g, i) { return '<div class="btn f" data-act="editgrp" data-i="' + i + '">' + esc(g.nome) + '</div>'; }).join('') + '</div>' +
      '<p class="info">' + (nHid ? nHid + (nHid > 1 ? ' grupos ocultos' : ' grupo oculto') + ' · ' : '') + 'Os grupos criados e ocultos aqui valem só para ' +
      (profile.cur ? 'o perfil ' + esc(profile.cur.nome) : 'esta TV') + '</p></div>';
    // o painel identifica cada TV por este código
    var mac = tvMac();
    html += '<div class="row"><h3>Esta TV</h3><p class="info">' +
      (Fire.uid ? 'Código da TV: <b>' + esc(Fire.code()) + '</b>' : 'Sem conexão com o portal') + (mac ? ' · MAC: <b>' + esc(mac) + '</b>' : '') + '</p>';
    // sem cliente: o QR abre o WhatsApp do atendimento já com o MAC (o portal liga a TV ao cliente por ele)
    if (!remote.cliente && remote.suporte && mac) {
      html += '<div class="support">' + QR.svg('https://wa.me/' + remote.suporte + '?text=' + encodeURIComponent('Meu MAC é ' + mac), 260) +
        '<p>Para liberar seus canais, aponte a câmera do celular para o código e envie a mensagem pelo WhatsApp.</p></div>';
    }
    html += '</div>';
    var v = vs('settings');
    v.innerHTML = html;
    v._rows = null;
    return v.querySelector('.btn.sel') || v.querySelector('.btn');
  };

  function settingsAction(el) {
    var act = el.getAttribute('data-act');
    if (act === 'profiles') profilesFromSettings();
    else if (act === 'band') {
      toast('Medindo a internet…');
      measureBand(true).then(function () { toast(band.mbps ? 'Internet: ' + String(band.mbps).replace('.', ',') + ' Mbps' : 'Não foi possível medir agora'); if (app.view === 'settings') refreshView(); });
    }
    else if (act === 'open18') askPin(function () { if (app.view === 'settings') refreshView(); });
    else if (act === 'lock18') { lockAgain(); refreshView(); }
    else if (act === 'pin18') pinStep('old', null);
    else if (act === 'upd') runUpdate(el.getAttribute('data-o'));
    else if (act === 'sendch') {
      toast('Enviando os canais ao portal…');
      reportChannels(true).then(function (n) { toast('⇪ ' + n + ' canais enviados ao portal'); if (app.view === 'settings') refreshView(); },
        function (e) { toast('Não foi possível enviar: ' + e.message); });
    }
    else if (act === 'editpf') editProfile(profile.cur, function () { leaveSetup(); go('settings'); });
    else if (act === 'hide') go('settings', 'hide', true);
    else if (act === 'newgrp') go('settings', { edit: true, i: -1 }, true);
    else if (act === 'editgrp') go('settings', { edit: true, i: +el.getAttribute('data-i') }, true);
    else if (act === 'tog') toggleHidden(el);
    else if (act === 'pick') pickSource(el);
    else if (act === 'grpsave') saveGroup();
    else if (act === 'grpdel') deleteGroup();
    else if (act === 'rcnew') {
      // o foco abre os Ajustes neste botão (para o QR aparecer inteiro): um OK sem querer só pede confirmação
      if (!el._armed) {
        el._armed = true;
        el.innerHTML = 'OK de novo para confirmar';
        setTimeout(function () { el._armed = false; el.innerHTML = '↻&nbsp; Gerar novo código'; }, 4000);
        return;
      }
      Controle.novo(); toast('Código novo: os celulares de antes não controlam mais esta TV'); refreshView();
    }
  }

  /* ---------- Ajustes → grupos ocultos e grupos do perfil ---------- */

  function optHtml(act, key, on, name, info) {
    return '<div class="row opt"><div class="track" data-group="o"><div class="btn f opt' + (on ? (act === 'pick' ? ' sel' : ' on') : '') + '" data-act="' + act + '" data-k="' + esc(key) + '">' +
      '<span>' + esc(name) + '</span><small>' + info + '</small></div></div></div>';
  }

  // uma linha por grupo (canais, filmes, séries): OK mostra ou oculta, sem sair da tela
  function settingsHide() {
    var hid = hiddenSet(), html = '<div class="row"><h3>Grupos ocultos</h3><p class="info"><i class="k ok">OK</i> mostra ou oculta · <i class="k ok">Voltar</i> sai</p></div>';
    [['live', 'live', 'Canais', 'canais'], ['movie', 'movies', 'Filmes', 'filmes'], ['series', 'series', 'Séries', 'séries']].forEach(function (t) {
      var gs = app.allGroups[t[1]];
      if (!gs.length) return;
      html += '<div class="row"><h3 class="sub">' + t[2] + '</h3></div>';
      gs.forEach(function (g) {
        var k = t[0] + ':' + g.name;
        html += optHtml('tog', k, hid[k], g.name, g.items.length + ' ' + t[3] + ' · <b>' + (hid[k] ? 'Oculto' : 'Visível') + '</b>');
      });
    });
    return settingsSub(html);
  }

  function toggleHidden(el) {
    var s = Cloud.state.settings, k = el.getAttribute('data-k'), list = s.ocultos || [], i = list.indexOf(k);
    if (i >= 0) list.splice(i, 1); else list.push(k);
    s.ocultos = list;
    Cloud.save('settings');
    regroup();
    el.classList.toggle('on', i < 0);
    el.querySelector('b').textContent = i < 0 ? 'Oculto' : 'Visível';
  }

  // criar/editar um grupo do perfil: nome + os grupos da lista (já com os do portal) que entram nele
  var grpDraft = null;
  function settingsGroup(arg) {
    var mine = Cloud.state.settings.grupos || [], g = arg.i >= 0 && mine[arg.i] || { nome: '', de: [] };
    grpDraft = { i: arg.i >= 0 && mine[arg.i] ? arg.i : -1, de: g.de.slice() };
    var pick = {};
    grpDraft.de.forEach(function (n) { pick[norm(n)] = 1; });
    var html = '<div class="row"><h3>' + (grpDraft.i >= 0 ? 'Editar grupo' : 'Criar grupo') + '</h3><div class="track" data-group="gn">' +
      '<input id="grpName" class="f field grp-name" type="text" maxlength="30" placeholder="Nome do grupo" value="' + esc(g.nome) + '"/>' +
      btn('grpsave', '✓&nbsp; Salvar', 'primary') + (grpDraft.i >= 0 ? btn('grpdel', 'Excluir') : '') + '</div>' +
      '<p class="info">Marque os grupos que entram neste: eles deixam de aparecer soltos</p></div>';
    joinGroups(groupBy(app.cat.live), remote.grupos).forEach(function (s) {
      html += optHtml('pick', s.name, pick[norm(s.name)], (pick[norm(s.name)] ? '✓  ' : '') + s.name, s.items.length + ' canais');
    });
    return settingsSub(html);
  }

  function settingsSub(html) {
    var v = vs('settings');
    v.innerHTML = html;
    v.scrollTop = 0;
    v._rows = null;
    return v.querySelector('.f');
  }

  function pickSource(el) {
    var n = el.getAttribute('data-k'), i = -1;
    grpDraft.de.forEach(function (x, j) { if (norm(x) === norm(n)) i = j; });
    if (i >= 0) grpDraft.de.splice(i, 1); else grpDraft.de.push(n);
    el.classList.toggle('sel', i < 0);
    el.querySelector('span').textContent = (i < 0 ? '✓  ' : '') + n;
  }

  function saveGroup() {
    var nome = $('grpName').value.trim(), s = Cloud.state.settings, list = (s.grupos || []).slice();
    if (!nome) { toast('Dê um nome ao grupo'); return Nav.focus($('grpName')); }
    if (!grpDraft.de.length) return toast('Marque pelo menos um grupo');
    var g = { nome: nome, de: grpDraft.de };
    if (grpDraft.i >= 0) list[grpDraft.i] = g; else list.push(g);
    s.grupos = list;
    Cloud.save('settings');
    regroup();
    toast('Grupo "' + nome + '" salvo');
    back();
  }

  function deleteGroup() {
    var s = Cloud.state.settings, list = (s.grupos || []).slice(), g = list.splice(grpDraft.i, 1)[0];
    s.grupos = list;
    Cloud.save('settings');
    regroup();
    toast('Grupo "' + g.nome + '" excluído');
    back();
  }

  /* ---------- Reprodução ---------- */

  function enterPlayer() {
    stopPreview();
    $('shell').classList.add('hidden');
  }

  function leavePlayer() {
    lb.on = false;
    zapClose();
    $('shell').classList.remove('hidden');
    Player.liveId = null;
    if (app.view === 'detail') {
      Nav.focus(render.detail(app.arg));
    } else if (app.view === 'live') {
      renderLive();
    } else if (app.view === 'guide') {
      renderGuide();
    } else if (app.dirty[app.view]) {
      delete app.dirty[app.view];
      refreshView();
    }
  }

  function playVod(item, start) {
    if (!okItem(item)) return askPin(function () { playVod(item, start); }); // +18: senha antes
    var isEp = item.t === 'ep';
    var next = isEp ? function (d) {
      var eps = item.series.eps, nx = eps[eps.indexOf(item) + d];
      if (!nx) return toast(d > 0 ? 'Este é o último episódio' : 'Este é o primeiro episódio');
      toast((d > 0 ? 'Próximo: ' : 'Anterior: ') + 'T' + nx.s + ' · E' + nx.e);
      var h = histFor(nx.id);
      playVod(nx, resumable(h) ? h.pos : 0);
    } : null;
    vb = { on: false, i: 0, item: item, next: next,
      keys: semCores() ? '▼ opções: áudio e legendas' + (isEp ? ', episódios e próximo' : '')
        : (isEp ? 'CH▲▼ episódio &nbsp;·&nbsp; <i class="k green"></i> episódios &nbsp;·&nbsp; ' : '') + '<i class="k yellow"></i> áudio e legendas &nbsp;·&nbsp; ▼ opções' };
    Player.open({
      url: item.u, why: whyFail,
      title: isEp ? item.series.n : item.n,
      sub: isEp ? 'Temporada ' + item.s + ' · Episódio ' + item.e + (item.n ? ' — ' + item.n : '') : item.g,
      start: start,
      onprogress: function (pos, dur) {
        pushHistory({ id: item.id, t: item.t, n: isEp ? item.series.n + ' T' + item.s + 'E' + item.e : item.n, pos: Math.round(pos), dur: Math.round(dur), at: Date.now() });
      },
      onend: function () {
        var nx = isEp && nextEp(item);
        if (!nx) return false;
        toast('Próximo: T' + nx.s + ' · E' + nx.e);
        playVod(nx, 0);
        return true;
      },
      onfav: function () { toggleFav(item); },
      ontracks: openTracks,
      // série: 🟢 lista de episódios e CH▲▼ próximo/anterior, sem sair do vídeo
      oneps: isEp ? function () { openEpisodes(item); } : null,
      onnext: next,
      keys: vb.keys,
      onclose: leavePlayer
    });
    enterPlayer();
  }

  // Barra de opções do filme/episódio (para controles sem teclas coloridas, como o do Chromecast): ▼ abre;
  // ◀ ▶ andam, OK usa, ▲ ou Voltar fecham. Com ela fechada, ◀ ▶ continuam voltando e avançando o vídeo
  var vb = { on: false, i: 0, item: null, next: null, keys: '' };
  function vodOpts() {
    var it = vb.item, o = [{ t: 'Áudio e legendas', fn: openTracks }];
    if (it.t === 'ep') {
      o.push({ t: 'Episódios', fn: function () { openEpisodes(it); } });
      o.push({ t: 'Próximo ▶', fn: function () { vb.next(1); } });
    }
    o.push({ t: '♥', fav: true, on: isFav(it), fn: function () { toggleFav(it); } });
    return o;
  }
  function renderVodBar() {
    var o = vodOpts();
    $('pVodKeys').innerHTML = vb.on ? '<span class="o-opts">' + o.map(function (x, i) {
      return '<span class="o-opt' + (x.on ? ' on' : '') + (x.fav ? ' fav' : '') + (i === vb.i ? ' focus' : '') + '">' + esc(x.t) + '</span>';
    }).join('') + '</span> ◀ ▶ escolher &nbsp;·&nbsp; <i class="k ok">OK</i> usar &nbsp;·&nbsp; ▲ fechar' : vb.keys;
  }
  function vodBarKey(k) {
    if (!Player.active || Player.liveId || !vb.item || mn) return false;
    if (!vb.on) {
      if (k !== K.DOWN) return false;
      vb.on = true; vb.i = 0;
    } else if (k === K.LEFT || k === K.RIGHT) vb.i = Math.max(0, Math.min(vodOpts().length - 1, vb.i + (k === K.LEFT ? -1 : 1)));
    else if (k === K.ENTER) { var fn = vodOpts()[vb.i].fn; vb.on = false; renderVodBar(); fn(); return true; }
    else if (k === K.UP || k === K.BACK || k === K.ESC || k === K.BACKSPACE) vb.on = false;
    else { vb.on = false; renderVodBar(); return false; }
    renderVodBar();
    Player.osd(vb.on);
    return true;
  }

  // controle sem as teclas coloridas (Chromecast, Google TV): as funções delas ficam nas barras de opções
  // (OK no canal ao vivo, ▼ no filme). Basta apertar uma tecla colorida uma vez para o app voltar a mostrá-las
  function semCores() { return !!window.AndroidAv && !localStorage.getItem('ctv.cores'); }

  var zapList = null;

  // troca: texto de quando é o mesmo canal em outra qualidade ("Trocando para HD…"): o player tenta com calma, sem "sinal perdido"
  function playLive(ch, list, troca) {
    if (!okItem(ch)) return askPin(function () { playLive(ch, list); }); // +18: senha antes
    list = list && list.length ? list : [ch];
    zapList = list;
    Player.open({
      url: ch.u, live: true, title: ch.n, sub: ch.num + '  ·  ' + ch.g + (ch.q ? '  ·  ' + ch.q : ''), logo: ch.l, why: whyFail, troca: troca || '',
      osd: function () { return liveOsd(ch); },
      onduo: function () { openDuo(ch, list); },
      onquality: function () { openQMenu(ch, function () { playLive(ch, list, 'Trocando para ' + qName(ch, ch.vi) + '…'); }); },
      // travando (ou caiu) na automática: desce uma qualidade e anota a internet mais fraca para os outros canais
      onstall: function () {
        if (!ch.vs || !ch.auto || ch.vi >= ch.vs.length - 1) return false;
        var lower = ch.vs[ch.vi + 1];
        band = { mbps: Math.round(qNeed(lower.q) / 0.8 * 10) / 10, at: Date.now() };
        try { localStorage.setItem('ctv.banda', JSON.stringify(band)); } catch (e) {}
        app.cat.live.forEach(pickQ);
        playLive(ch, list, 'Internet lenta: mudando para ' + qName(ch, ch.vi) + '…');
        return true;
      },
      onzap: function (d) {
        var i = list.indexOf(ch);
        lb.on = false;
        playLive(list[(i + d + list.length) % list.length], list);
      },
      onfav: function () { toggleFav(ch); },
      onclose: leavePlayer
    });
    Player.liveId = ch.id;
    pushHistory({ id: ch.id, t: 'live', n: ch.n, at: Date.now() });
    if (app.view === 'live' && live.groups[live.gi].items === list) live.ci = list.indexOf(ch);
    if (app.view === 'guide' && guideItems() === list) guide.ci = list.indexOf(ch);
    enterPlayer();
  }

  // rodapé do player ao vivo: programa no ar, barra com horários e o próximo
  function liveOsd(ch) {
    var nn = nowNext(ch), p = nn && nn.now, html = '';
    if (p) {
      html += '<div class="o-prg">' + esc(p.t) + '</div><div class="o-time"><span>' + hhmm(p.s) + '</span>' + barHtml(p) +
        '<span>' + hhmm(p.e) + ' · ' + timeLeft(p) + '</span></div>';
    }
    if (nn && nn.next) html += '<div class="o-next">A seguir · ' + hhmm(nn.next.s) + '  <b>' + esc(nn.next.t) + '</b></div>';
    var opts = liveOpts(ch);
    return html + '<div class="o-keys"><span class="badge-live">● AO VIVO</span><span class="o-opts">' + opts.map(function (x, i) {
      return '<span class="o-opt' + (x.on ? ' on' : '') + (x.fav ? ' fav' : '') + (lb.on && i === lb.i ? ' focus' : '') + '">' + (x.html ? x.t : esc(x.t)) + '</span>';
    }).join('') + '</span><span class="hint">' + (lb.on ? '◀ ▶ escolher &nbsp;·&nbsp; <i class="k ok">OK</i> usar &nbsp;·&nbsp; ▲ fechar'
      : '<i class="k ok">OK</i> opções &nbsp;·&nbsp; ◀ lista de canais &nbsp;·&nbsp; ▲▼ trocar canal &nbsp;·&nbsp; 0–9 número') + '</span></div>';
  }

  // Barra de opções do canal ao vivo (como nos apps de IPTV): qualidades (Auto, SD, HD, FHD…), ♥ favoritar e ⚙ mais opções.
  // OK foca a barra (na qualidade em uso); ◀ ▶ andam, OK escolhe, ▲ ou Voltar fecham. Sem a barra focada, ◀ volta à lista
  var lb = { on: false, i: 0 };
  function liveOpts(ch) {
    var o = [];
    // mesma versão de antes: não abre de novo (cada troca derruba e refaz a conexão com o fornecedor)
    var trocar = function (i) {
      var antes = ch.vs[ch.vi].u;
      setQ(ch, i);
      if (ch.vs[ch.vi].u !== antes) playLive(ch, zapList, 'Trocando para ' + qName(ch, ch.vi) + '…'); else Player.osd(true);
    };
    if (ch.vs) {
      o.push({ t: 'Auto', on: ch.auto, fn: function () { trocar(-1); } });
      ch.vs.forEach(function (v, i) { o.push({ t: qName(ch, i), on: !ch.auto && ch.vi === i, fn: function () { trocar(i); } }); });
    }
    o.push({ t: '♥', fav: true, on: isFav(ch), fn: function () { toggleFav(ch); } });
    if (duoOk()) o.push({ t: '◫ Duas telas', fn: function () { lb.on = false; openDuo(ch, zapList); } });
    o.push({ t: icon('settings'), html: true, fn: function () { liveMore(ch); } });
    return o;
  }
  // ⚙ mais opções do canal
  function liveMore(ch) {
    var items = [{ t: 'Tela dupla', s: 'Dois canais ao mesmo tempo', fn: function () { openDuo(ch, zapList); } },
                 { t: 'Áudio e legendas', s: 'As faixas que o canal tiver', fn: openTracks }];
    if (ch.vs) items.push({ t: 'Qualidade em detalhes', s: 'Automática e a velocidade da internet', fn: function () { openQMenu(ch, function () { playLive(ch, zapList, 'Trocando para ' + qName(ch, ch.vi) + '…'); }); } });
    lb.on = false;
    openMenu('Mais opções · ' + ch.n, items);
  }
  function liveBarKey(k) {
    if (!Player.active || !Player.liveId || mn || qm.ch) return false;
    var ch = app.idx[Player.liveId];
    if (!ch) return false;
    var opts = liveOpts(ch);
    if (!lb.on) {
      if (k === K.ENTER) {
        lb.on = true;
        lb.i = 0;
        opts.forEach(function (x, i) { if (x.on && !x.fav && !lb.i) lb.i = i; });
        Player.osd(true);
        return true;
      }
      return false; // ◀ abre a lista de canais por cima do vídeo (zapKey)
    }
    if (k === K.LEFT || k === K.RIGHT) { lb.i = Math.max(0, Math.min(opts.length - 1, lb.i + (k === K.LEFT ? -1 : 1))); Player.osd(true); return true; }
    if (k === K.ENTER) { opts[lb.i].fn(); if (Player.active) Player.osd(lb.on); return true; }
    if (k === K.UP || k === K.BACK || k === K.ESC || k === K.BACKSPACE) { lb.on = false; Player.osd(); return true; }
    lb.on = false; // outra tecla (▼ troca de canal…): fecha a barra e segue
    return false;
  }

  /* ---------- Tela dupla: dois canais ao vivo, o som de um ---------- */

  // pick: posição na lista enquanto escolhe o canal do lado selecionado (-1 = fechada)
  var duo = { on: false, chs: [null, null], list: null, sel: 0, pick: -1, ok: [false, false], err: [false, false] };
  var DUO_CARDS = 6;
  var DUO_RECT = [{ x: 32, y: 196, w: 912, h: 513 }, { x: 976, y: 196, w: 912, h: 513 }];

  // o outro lado começa com o último canal visto (ou o próximo da lista)
  function otherChannel(ch, list) {
    var h = find(Cloud.state.history, function (x) { return x.t === 'live' && app.idx[x.id] && app.idx[x.id] !== ch; });
    return h && okItem(app.idx[h.id]) ? app.idx[h.id] : list[(list.indexOf(ch) + 1) % list.length];
  }

  function openDuo(ch, list) {
    list = list && list.length >= DUO_CARDS ? list : app.cat.live; // listas curtas (Continuar, favoritos) dão pouca escolha
    if (list.length < 2) return toast('É preciso ter pelo menos dois canais');
    if (!duoOk()) return toast('A tela dupla precisa de um plano com 2 telas: esta assinatura permite 1');
    Player.close();
    stopPreview();
    duo.on = true;
    duo.list = list;
    duo.chs = [ch, otherChannel(ch, list)];
    duo.sel = 0;
    duo.pick = -1;
    $('shell').classList.add('hidden');
    $('duo').classList.remove('hidden');
    duoTune(0);
    duoTune(1);
    renderDuo();
  }

  function duoTune(i) {
    var ch = duo.chs[i];
    duo.ok[i] = duo.err[i] = false;
    pushHistory({ id: ch.id, t: 'live', n: ch.n, at: Date.now() });
    Player.duoPlay(i, ch.u, DUO_RECT[i], function (ok) {
      if (duo.chs[i] !== ch) return;
      duo.ok[i] = ok;
      duo.err[i] = !ok;
      renderDuo();
    });
  }

  function renderDuo() {
    var html = '';
    for (var i = 0; i < 2; i++) {
      var c = duo.chs[i], nn = nowNext(c), p = nn && nn.now, r = DUO_RECT[i], sel = i === duo.sel;
      var msg = duo.ok[i] ? '' : duo.err[i]
        ? (i === 1 && !duo.err[0] ? 'Esta TV não conseguiu abrir o segundo canal ao mesmo tempo' : 'Não foi possível abrir este canal')
        : 'Sintonizando…';
      html += '<div class="duo-pane' + (sel ? ' sel' : '') + '" style="left:' + r.x + 'px;top:' + r.y + 'px;width:' + r.w + 'px;height:' + r.h + 'px">' +
        (msg ? '<div class="duo-msg">' + (c.l ? '<img src="' + esc(c.l) + '"/>' : '') + '<span>' + msg + '</span></div>' : '') +
        (duo.pick >= 0 ? '<div class="duo-tag">' + (sel ? 'TROCANDO ESTE LADO' : 'FIXO') + '</div>' : '') + '</div>';
      if (duo.pick < 0) html += '<div class="duo-cap' + (sel ? ' sel' : '') + '" style="left:' + r.x + 'px;top:' + (r.y + r.h + 22) + 'px;width:' + r.w + 'px">' +
        '<span class="snd">' + (sel ? '● COM SOM' : 'sem som') + '</span><b>' + c.num + '&nbsp; ' + esc(c.n) + '</b>' + qBadge(c) +
        (p ? '<small>' + esc(p.t) + ' · ' + timeLeft(p) + '</small>' + barHtml(p) : '<small>' + esc(c.g) + '</small>') + '</div>';
    }
    if (duo.pick >= 0) html += duoStrip();
    $('duoPanes').innerHTML = html;
    $('duoKeys').innerHTML = duo.pick >= 0
      ? '◀ ▶ escolhe o canal &nbsp;·&nbsp; <i class="k ok">OK</i> coloca no lado ' + (duo.sel ? 'direito' : 'esquerdo') + ' &nbsp;·&nbsp; <i class="k ok">Voltar</i> cancela'
      : '◀ ▶ escolhe o lado (o som vai junto) &nbsp;·&nbsp; <i class="k ok">OK</i> escolher canal desse lado &nbsp;·&nbsp; ▲▼ próximo canal &nbsp;·&nbsp; <i class="k green"></i> tela cheia &nbsp;·&nbsp; <i class="k ok">Voltar</i> sai';
  }

  // faixa de canais embaixo dos vídeos: os dois continuam visíveis enquanto escolhe
  function duoStrip() {
    var l = duo.list, start = Math.max(0, Math.min(duo.pick - 2, l.length - DUO_CARDS)), html = '<div class="duo-strip">';
    for (var i = start; i < Math.min(l.length, start + DUO_CARDS); i++) {
      var c = l[i], nn = nowNext(c), p = nn && nn.now;
      var tag = c === duo.chs[duo.sel] ? 'neste lado' : c === duo.chs[1 - duo.sel] ? 'no outro lado' : '';
      html += '<div class="duo-card' + (i === duo.pick ? ' cur' : '') + (c === duo.chs[1 - duo.sel] ? ' off' : '') + '">' +
        '<div class="logo">' + (c.l ? '<img src="' + esc(c.l) + '"/>' : '<span class="ph">' + esc(c.n.charAt(0)) + '</span>') + '</div>' +
        '<b>' + c.num + '&nbsp; ' + esc(c.n) + '</b>' +
        '<small>' + (tag ? '<em>' + tag + '</em>' : p ? esc(p.t) : esc(c.g)) + '</small></div>';
    }
    return html + '</div>';
  }

  function duoPickMove(d) {
    var l = duo.list, n = duo.pick;
    do n = (n + d + l.length) % l.length; while (l[n] === duo.chs[1 - duo.sel]); // o canal do outro lado não entra
    duo.pick = n;
    renderDuo();
  }

  function duoSet(n) {
    duo.chs[duo.sel] = n;
    duoTune(duo.sel);
    renderDuo();
  }

  // ◀ ▶ escolhe o lado (o som vai junto) · OK abre a faixa de canais desse lado · ▲▼ próximo canal · verde/Voltar: tela cheia
  function duoKey(k) {
    if (!duo.on) return false;
    var back = k === K.BACK || k === K.ESC || k === K.BACKSPACE;
    if (duo.pick >= 0) {
      if (k === K.LEFT || k === K.RIGHT || k === K.UP || k === K.DOWN) duoPickMove(k === K.LEFT || k === K.UP ? -1 : 1);
      else if (k === K.ENTER) { var n = duo.list[duo.pick]; duo.pick = -1; n === duo.chs[duo.sel] ? renderDuo() : duoSet(n); }
      else if (back) { duo.pick = -1; renderDuo(); }
      return true;
    }
    if (k === K.LEFT || k === K.RIGHT) {
      var s = k === K.LEFT ? 0 : 1;
      if (s !== duo.sel) { duo.sel = s; Player.duoAudio(s); renderDuo(); }
    } else if (k === K.ENTER) {
      duo.pick = Math.max(0, duo.list.indexOf(duo.chs[duo.sel]));
      renderDuo();
    } else if (k === K.UP || k === K.DOWN || k === K.CH_UP || k === K.CH_DOWN) {
      var d = k === K.UP || k === K.CH_DOWN ? -1 : 1, l = duo.list, c = duo.chs[duo.sel];
      do c = l[(l.indexOf(c) + d + l.length) % l.length]; while (c === duo.chs[1 - duo.sel] || (!okItem(c) && c !== duo.chs[duo.sel])); // nunca o mesmo dos dois lados nem +18 sem senha
      duoSet(c);
    } else if (k === K.GREEN || back) {
      closeDuo(true);
    }
    return true;
  }

  // full: segue em tela cheia no canal com som; sem full, volta para as telas do app
  function closeDuo(full) {
    if (!duo.on) return;
    var ch = duo.chs[duo.sel], list = duo.list;
    duo.on = false;
    Player.duoClose();
    $('duo').classList.add('hidden');
    if (full) playLive(ch, list);
    else leavePlayer();
  }

  /* ---------- Número do canal e canal anterior ---------- */

  var chNum = { digits: '', timer: null };

  // o número do canal é a posição na lista inteira (canal oculto pelo portal deixa o número vago)
  function chByNum(n) { return find(app.cat.live, function (c) { return c.num === n; }) || null; }

  // continua zapeando na mesma lista, se o canal estiver nela
  function tuneTo(ch) {
    playLive(ch, Player.active && zapList && zapList.indexOf(ch) >= 0 ? zapList : app.cat.live);
  }

  function typeDigit(d) {
    chNum.digits += d;
    var n = +chNum.digits, ch = chByNum(n);
    $('chNum').innerHTML = '<b>' + chNum.digits + '</b><span>' + (ch ? esc(ch.n) : '') + '</span>';
    $('chNum').classList.remove('hidden');
    clearTimeout(chNum.timer);
    // nenhum canal tem mais dígitos: troca na hora
    if (n * 10 > app.cat.live.length) return commitNum();
    chNum.timer = setTimeout(commitNum, 2000);
  }

  function cancelNum() {
    clearTimeout(chNum.timer);
    chNum.digits = '';
    $('chNum').classList.add('hidden');
  }

  function commitNum() {
    var n = +chNum.digits, ch = chByNum(n);
    cancelNum();
    if (ch) tuneTo(ch);
    else if (n) toast('Canal ' + n + ' não existe');
  }

  function prevChannel() {
    var cur = Player.active ? Player.liveId : null;
    var h = find(Cloud.state.history, function (x) { return x.t === 'live' && app.idx[x.id] && app.idx[x.id].id !== cur; });
    if (h) tuneTo(app.idx[h.id]);
    else toast('Nenhum canal anterior');
  }

  // números e PRE-CH valem no app todo e no player ao vivo, mas não durante filmes e séries
  function channelKey(k) {
    if (!$('setup').classList.contains('hidden') || (Player.active && !Player.liveId)) return false;
    if (app.view === 'live' && live.mode === 'audio' && !Player.active) return false; // número de canal não vale na aba Áudio
    if (k >= 48 && k <= 57) { typeDigit(k - 48); return true; }
    if (chNum.digits) {
      if (k === K.ENTER) { commitNum(); return true; }
      if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) { cancelNum(); return true; }
    }
    if (k === K.PRE_CH) { prevChannel(); return true; }
    return false;
  }

  /* ---------- Eventos de foco / OK / cores ---------- */

  function onFocus(el) {
    var open = $('side').contains(el);
    $('shell').classList.toggle('side-open', open);

    var v = el.closest('.vscroll');
    if (v && v._rows) {
      if (v.firstChild && v.firstChild.classList && v.firstChild.classList.contains('grid')) {
        if (+el.getAttribute('data-i') > v._n - 18 && v._n < v._rows[0].items.length) appendGrid(v);
      } else if (+el.getAttribute('data-r') >= v._n - 2 && v._n < v._rows.length) {
        appendRows(v, 4);
      }
    }

    if (app.view === 'detail' && el.getAttribute('data-act') === 'season') {
      var s = +el.getAttribute('data-s');
      if (s !== detail.season) {
        detail.season = s;
        var tabs = el.parentNode.children;
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('sel', tabs[i] === el);
        renderEpisodes(app.arg);
      }
    }

    var info = itemOf(el);
    if (info && $('shell').classList.contains('browse') && app.view !== 'detail') setHero(info.item);
    // Filmes / Séries: nos botões do topo, o hero volta para o destaque
    var st = vodState[app.view === 'movies' ? 'movie' : app.view === 'series' ? 'series' : ''];
    if (st && st.feat && el.closest('.row.vod')) setHero(st.feat, true);
  }

  function onEnter(el) {
    var view = el.getAttribute('data-view');
    if (view === 'settings') pollRemote(); // abrir Ajustes busca na hora o que o portal mandou
    if (view === 'live') setMode('video', true); // o Ao vivo sempre abre na aba Vídeo
    if (view) return go(view);
    if (el.getAttribute('data-act') === 'busca') return openSearch(app.view);
    if (app.view === 'detail' && el.getAttribute('data-act')) return detailAction(el);
    if (app.view === 'settings' && el.getAttribute('data-act')) return settingsAction(el);
    if ((app.view === 'movies' || app.view === 'series') && el.getAttribute('data-act')) return vodAction(el);
    var info = itemOf(el);
    if (!info) return;
    var item = info.item;
    if (item.more) return go('grid', item.more, true);
    if (item.t === 'live') return playLive(item, info.row.items);
    if (item.t === 'radio') return playRadio(item, info.row.items);
    // jogo ou luta: abre o canal (▲▼ troca entre os canais da lista); se ainda não começou, avisa a hora
    if (item.t === 'ev') {
      if (item.p.s > Date.now()) toast(item.p.t + ' começa às ' + hhmm(item.p.s));
      return playLive(item.ch, app.visibleLive || app.cat.live);
    }
    if (item.t === 'ep') {
      var h = histFor(item.id);
      return playVod(item, resumable(h) ? h.pos : 0);
    }
    if (!okItem(item)) return askPin(function () { go('detail', item, true); });
    go('detail', item, true);
  }

  function onOther(k, el) {
    if (k === K.BLUE) return app.view === 'search' ? Nav.focus($('q')) : openSearch(app.view);
    if (k === K.GREEN && app.view === 'live' && el === $('liveChannels') && live.mode === 'video') {
      var g = live.groups[live.gi];
      return openDuo(g.items[live.ci], g.items);
    }
    if (k === K.YELLOW && app.view === 'live' && el === $('liveChannels') && live.mode === 'video') {
      openQMenu(live.groups[live.gi].items[live.ci], renderLive); // a prévia troca junto
      return;
    }
    if (k === K.RED) {
      if (app.view === 'live' && el === $('liveChannels')) return toggleFav(live.groups[live.gi].items[live.ci]);
      if (app.view === 'detail') return toggleFav(app.arg);
      var info = el && itemOf(el);
      if (info) toggleFav(info.item);
    }
  }

  /* ---------- Camada de configuração: inicialização, código e aviso ---------- */

  function showSetup(step) {
    Player.close();
    stopPreview();
    $('shell').classList.add('hidden');
    $('setup').classList.remove('hidden');
    if (step !== 'stepEditProfile') $('setup').classList.remove('edit');
    ['stepBoot', 'stepNotice', 'stepProfiles', 'stepNewProfile', 'stepEditProfile', 'stepPin', 'stepPlan']
      .forEach(function (s) { $(s).classList.toggle('hidden', s !== step); });
    Nav.scope = $('setup');
  }

  // volta para a tela em que estava, sem recarregar nada
  function leaveSetup() {
    $('setup').classList.add('hidden');
    $('shell').classList.remove('hidden');
    Nav.scope = $('shell');
    Nav.focus($('side')._last || Nav.first($('shell')));
  }

  /* ---------- Portal (Firebase): listas, plano e avisos à distância ---------- */

  // última resposta do portal, guardada para funcionar sem internet
  // epg: link do guia (XMLTV) e tmdb: chave do TMDB (sinopse, nota, gênero) — os dois opcionais, vindos do portal.
  // cliente: id do cliente ligado pelo MAC (ativa os perfis); plano: { status, ate, nome } da assinatura desta TV
  // suporte: WhatsApp do atendimento (só dígitos, com 55); a TV sem cliente mostra um QR para mandar o MAC
  var remote = { lists: [], notice: null, epg: '', tmdb: '', cliente: '', plano: null, suporte: '' };
  try { var saved = JSON.parse(localStorage.getItem('ctv.remote')); if (saved) remote = saved; } catch (e) {}

  function tvMac() {
    try { return webapis.network.getMac() || ''; } catch (e) { return window.PREVIEW_MAC || ''; }
  }

  function tvInfo() {
    var info = { code: Fire.code(), appVersion: VERSION, lastSeen: Date.now() };
    try { info.model = webapis.productinfo.getRealModel(); } catch (e) { info.model = window.webapis ? 'Samsung TV' : 'Navegador'; }
    var mac = tvMac();
    if (mac && window.webapis) info.mac = mac;
    return info;
  }

  function vodOrg(o) {
    o = o && typeof o === 'object' ? o : {};
    return {
      grupos: (o.grupos || []).filter(function (g) { return g && typeof g.nome === 'string' && g.de && g.de.length; })
        .map(function (g) { return { nome: g.nome.slice(0, 40), de: g.de.map(String) }; }),
      ocultos: (o.ocultos || []).map(String), senha: (o.senha || []).map(String)
    };
  }

  // avisa ao portal que a TV está ligada e busca o que ele mandou; true se as listas ou o plano mudaram
  function syncRemote() {
    if (!Fire.enabled) return Promise.resolve(false);
    var path;
    return Fire.auth().then(function () {
      path = 'tvs/' + Fire.uid;
      return Fire.get(path);
    }).then(function (doc) {
      // "estou ligada" (lastSeen, versão): no máximo a cada 25 min (com a consulta de 30 min, uma gravação por consulta);
      // o portal mostra "ligada" até 35 min depois
      var info = tvInfo();
      if (!doc) info.created = Date.now();
      if (!doc || info.lastSeen - infoAt > 25 * 60e3) { infoAt = info.lastSeen; Fire.set(path, info).then(null, function () {}); }
      doc = doc || {};
      var p = doc.plano && typeof doc.plano === 'object' ? doc.plano : null;
      var next = {
        // sub: lista da assinatura (montada pelo sistema, nunca mostrada); until: último dia em que vale
        lists: (doc.lists || []).filter(function (l) { return l && /^https?:\/\/\S+$/i.test(l.url || ''); })
          .map(function (l) {
            return { id: 'p' + M3U.hash(l.url), name: l.name || listName(l.url), url: l.url, remote: true,
                     sub: l.sub ? String(l.sub) : '', until: l.until ? String(l.until) : '' };
          }),
        cliente: typeof doc.cliente === 'string' ? doc.cliente : '',
        suporte: String(doc.suporte || '').replace(/\D/g, ''),
        plano: p ? { status: String(p.status || ''), ate: String(p.ate || ''), nome: String(p.nome || '') } : null,
        notice: doc.notice && doc.notice.text ? doc.notice : null,
        epg: typeof doc.epg === 'string' && /^https?:\/\/\S+$/i.test(doc.epg.trim()) ? doc.epg.trim() : '',
        tmdb: typeof doc.tmdb === 'string' ? doc.tmdb.trim() : '',
        refresh: +doc.refresh || 0, // hora do último "Atualizar tudo" pedido no portal
        // e de cada parte pedida sozinha
        parte: doc.refreshParte && typeof doc.refreshParte === 'object'
          ? { canais: +doc.refreshParte.canais || 0, guia: +doc.refreshParte.guia || 0, tmdb: +doc.refreshParte.tmdb || 0, app: +doc.refreshParte.app || 0 } : {},
        appLink: typeof doc.appLink === 'string' ? doc.appLink.trim() : '', // de onde baixar a versão nova (TV Android)
        // grupos criados no portal: { nome, de: [grupos da lista] }
        grupos: (doc.grupos || []).filter(function (g) { return g && typeof g.nome === 'string' && g.de && g.de.length; })
          .map(function (g) { return { nome: g.nome.slice(0, 40), de: g.de.map(String) }; }),
        // organização dos canais (aba Canais do portal): grupos com os números dos canais no provedor, e os ocultos
        org: doc.org && typeof doc.org === 'object' ? {
          grupos: (doc.org.grupos || []).filter(function (g) { return g && typeof g.nome === 'string'; })
            .map(function (g) { return { nome: g.nome.slice(0, 40), ks: (g.ks || []).map(String) }; }),
          ocultos: (doc.org.ocultos || []).map(String),
          senha: (doc.org.senha || []).map(String), // canais que o portal marcou para pedir senha
          // Filmes e Séries por grupo (aba "Filmes e séries"): grupos juntados, ocultos e com senha
          vod: doc.org.vod && typeof doc.org.vod === 'object' ? { movie: vodOrg(doc.org.vod.movie), series: vodOrg(doc.org.vod.series) } : null
        } : null,
        // guia montado no servidor: endereço dos arquivos, versão (muda toda noite) e canais escolhidos no portal
        guia: doc.guia && typeof doc.guia === 'object' && /^(https:\/\/|http:\/\/localhost[:\/])\S+$/.test(doc.guia.base || '') // localhost: prévia no PC
          ? { base: doc.guia.base, v: +doc.guia.v || 0, mapa: doc.guia.mapa && typeof doc.guia.mapa === 'object' ? doc.guia.mapa : {} } : null
      };
      if (JSON.stringify([next.grupos, next.org]) !== JSON.stringify([remote.grupos || [], remote.org || null])) groupsChanged = true;
      // guia e chave do TMDB novos (não na primeira vez): baixa já e avisa no canto
      if (remote.at) {
        if (next.epg !== remote.epg || JSON.stringify(next.guia) !== JSON.stringify(remote.guia || null)) epgChanged2 = true;
        if (next.tmdb !== remote.tmdb) tmdbChanged = true;
      }
      next.at = Date.now();
      var changed = JSON.stringify([next.lists, next.plano]) !== JSON.stringify([remote.lists, remote.plano]);
      if (next.cliente !== remote.cliente) profileChanged = true;
      remote = next;
      store('ctv.remote', JSON.stringify(remote));
      return changed;
    });
  }

  var listStale = false, tmdbStale = false, groupsChanged = false, epgChanged2 = false, tmdbChanged = false, infoAt = 0;
  function refreshSeen() { return +localStorage.getItem('ctv.refreshAt') || 0; }

  // aviso pequeno no canto de cima, à direita, por cima de tudo (até do vídeo). Tudo o que chega do portal passa
  // por aqui: "⟳ Atualizando…" fica até terminar (work), "✓ …" some sozinho
  var cornerTimer;
  function corner(text, bad, work) {
    var el = $('corner');
    el.textContent = text;
    el.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(cornerTimer);
    cornerTimer = setTimeout(function () { el.className = ''; }, work ? 180000 : 4000);
  }

  // Atualizar tudo, ou só a lista de canais / o guia / o TMDB, pedido pelo portal ou pelos Ajustes. Uma coisa de cada
  // vez (pedido no meio entra na fila), com o % no canto da tela e no portal (tvs/{uid}.prog: a barra no cartão da TV)
  var UPD = {
    tudo: ['tudo', '✓ Tudo atualizado'], canais: ['a lista de canais', '✓ Lista de canais atualizada'],
    guia: ['o guia de programação', '✓ Guia de programação atualizado'], tmdb: ['capas e sinopses', '✓ Capas e sinopses atualizadas'],
    app: ['o app', '✓ App atualizado']
  };

  // "Atualizar → App" no portal: a TV Android baixa a versão nova do link escolhido lá e se atualiza sozinha
  // (o Android responde por __versao: igual, nova, apk ou erro). A Samsung atualiza pelo pacote, não por aqui
  function updApp() {
    var A = window.AndroidAv;
    if (!A || !A.atualizar) return progress('app', 0, true, A ? 'instale o APK novo uma vez: este ainda não atualiza pelo portal' : 'na Samsung o app é atualizado pelo pacote novo');
    progress('app', 10);
    window.__versao = function (s, msg) {
      if (s === 'erro') return progress('app', 0, true, msg || 'não foi possível baixar');
      progress('app', 100, true);
      if (s === 'igual') corner('✓ O app já está na versão mais nova');
      if (s === 'apk') corner('⟳ Confirme a instalação na tela', false, true);
    };
    A.atualizar(remote.appLink || '');
  }
  var updating = '', updQueue = [], progLast = { p: -1, at: 0 };
  function progress(o, p, end, err) {
    p = end && !err ? 100 : Math.max(0, Math.min(99, Math.floor(p)));
    corner(end ? (err ? 'Não foi possível atualizar ' + UPD[o][0] + ': ' + err : UPD[o][1]) : '⟳ Atualizando ' + UPD[o][0] + '… ' + p + '%', !!err, !end);
    // ao portal: no começo, no fim e a cada 10% (ou 3 s), para não gravar à toa
    var now = Date.now();
    if (!Fire.enabled || !Fire.uid || (!end && p - progLast.p < 10 && now - progLast.at < 3000)) return;
    progLast = { p: p, at: now };
    Fire.set('tvs/' + Fire.uid, { prog: { o: o, p: p, at: now, fim: !!end,
      erro: err ? String(err).replace(/[a-z]+:\/\/\S+/gi, '').slice(0, 120) : '' } }).then(null, function () {}); // nunca o link
  }

  function runUpdate(o) {
    if (updating) { if (o !== updating && updQueue.indexOf(o) < 0) updQueue.push(o); return; }
    updating = o;
    var steps = o === 'tudo' ? ['canais', 'guia', 'tmdb'] : [o], W = { canais: 60, guia: 25, tmdb: 15 }, total = 0, base = 0;
    steps.forEach(function (s) { total += W[s]; });
    progLast = { p: -1, at: 0 };
    progress(o, 0);
    var chain = Promise.resolve();
    steps.forEach(function (s) {
      chain = chain.then(function () {
        var start = base, w = W[s] / total * 100;
        base += w;
        // com prazo: uma parte que nunca termina deixaria todas as atualizações seguintes presas na fila
        return Promise.race([updPart(s, o === 'tudo', function (p) { progress(o, start + p * w / 100); }),
          new Promise(function (r, no) { setTimeout(function () { no(new Error('demorou demais (15 min)')); }, 15 * 60000); })]);
      });
    });
    chain.then(function () { markDirty(); progress(o, 100, true); }, function (e) { progress(o, 0, true, (e && e.message) || 'erro'); })
      .then(function () {
        updating = '';
        if (app.view === 'settings' && !Player.active && $('setup').classList.contains('hidden')) refreshView(); // horários dos Ajustes
        var n = updQueue.shift();
        if (n) runUpdate(n);
      });
  }

  // uma parte (step: 0–100 dela). Em "tudo", guia e TMDB não configurados são pulados; pedidos sozinhos, viram erro
  function updPart(s, inAll, step) {
    if (s === 'canais') return loadCatalog(true, true, step);
    if (s === 'guia') {
      if (!epgUrl()) { if (inAll) return; throw new Error('o guia não foi configurado no portal'); }
      return loadEpg(true, step).then(function (ok) { if (!ok) throw new Error(syncErr.guia || 'o guia não respondeu'); });
    }
    if (!remote.tmdb) { if (inAll) return; throw new Error('o TMDB não foi configurado no portal'); }
    // fichas (sinopse, nota) também: são buscadas de novo ao aparecer
    metaCache = {}; metaKeys = [];
    try { localStorage.removeItem('ctv.meta'); } catch (e) {}
    tmCount = { n: 0, total: 9 + vodJobs().length, f: function (f) { step(f * 100); } };
    return loadTmdbLists(true).then(function () {
      tmCount = null;
      if (syncErr.tmdb) throw new Error(syncErr.tmdb);
    }, function (e) { tmCount = null; throw e; });
  }

  function pollRemote() {
    syncRemote().then(function (changed) {
      // a TV foi ligada a um cliente (ou desligada): recomeça para escolher o perfil certo
      if (profileChanged && !Player.active) return location.reload();
      if (changed) {
        var before = activePlaylist();
        app.playlists = openPlaylists();
        markDirty();
        if (activePlaylist().id !== before.id) listStale = true;
        else if (app.view === 'settings' && $('setup').classList.contains('hidden') && !Player.active) go('settings');
        if (!Player.active && $('setup').classList.contains('hidden')) planBlockedStep();
      }
      // a lista não baixa mais sozinha na virada do dia (custo e o "carregando" que não acabava): só quando o link
      // muda, o usuário pede (Ajustes, OK 8× no logo) ou o portal manda atualizar
      // chave do TMDB nova no portal: capas e sinopses de novo, com aviso; senão só se o dia virou
      if (tmdbChanged) { tmdbChanged = false; if (remote.tmdb) runUpdate('tmdb'); }
      else if (!Player.active) loadTmdbLists();
      // grupos novos no portal: refaz na hora (com a lista na tela, sem baixar nada)
      if (groupsChanged) {
        groupsChanged = false;
        regroup();
        epgChanged(); // refaz o que está na tela (Ao vivo, Guia ou Início)
        corner('✓ Canais e grupos atualizados');
      }
      // pedidos do portal: tudo (refresh) ou uma parte (refreshParte.canais / guia / tmdb). A TV não grava esses
      // campos: compara com o último pedido que já atendeu
      if (remote.refresh > refreshSeen()) { store('ctv.refreshAt', remote.refresh); listStale = tmdbStale = true; }
      ['canais', 'guia', 'tmdb', 'app'].forEach(function (k) {
        var at = (remote.parte || {})[k] || 0;
        if (at <= (+localStorage.getItem('ctv.refresh.' + k) || 0)) return;
        store('ctv.refresh.' + k, at);
        if (k === 'canais') listStale = true; else if (k === 'app') updApp(); else runUpdate(k);
      });
      // lista nova, dia novo ou pedido do portal: baixa por trás, sem mexer na tela (com vídeo aberto, espera ele
      // fechar); o que mudou aparece ao navegar, e no canto fica o %
      if (listStale && !Player.active && !duo.on) {
        var all = tmdbStale;
        listStale = tmdbStale = false;
        runUpdate(all ? 'tudo' : 'canais');
      }
      // guia novo (link, montagem da noite) baixa com o % no canto; só o mapa de canais mudou: casa de novo
      if (epgChanged2) {
        epgChanged2 = false;
        if (epgUrl() && epg.url !== epgUrl()) runUpdate('guia');
        else { app.cat.live.forEach(function (c) { delete c._x; }); epgChanged(); }
      }
      loadEpg(); // baixa de novo se o link mudou ou o guia ficou velho
      if (!Player.active) measureBand(); // velocidade da internet: de novo a cada 30 min (fora do vídeo, para não atrapalhar)
      showNotice();
    }, function () {});
  }

  /* ---------- OK 8× no logo do menu: atualiza a lista na hora e mostra o resumo ---------- */

  var logoTaps = [], noticeInfo = false; // noticeInfo: a tela de aviso está mostrando o resumo (não um aviso do portal)

  // segurar OK também conta (o controle repete a tecla)
  function logoTap() {
    var now = Date.now();
    logoTaps = logoTaps.filter(function (t) { return now - t < 4000; });
    logoTaps.push(now);
    if (logoTaps.length < 8) return;
    logoTaps = [];
    forceUpdate();
  }

  function forceUpdate() {
    loading('Atualizando a lista...');
    upTo6s(syncRemote()).then(function () {
      if (profileChanged) return location.reload(); // o portal ligou (ou desligou) esta TV de um cliente
      app.playlists = openPlaylists();
      // TMDB também: listas do dia e fichas dos títulos (são buscadas de novo ao aparecer)
      metaCache = {}; metaKeys = [];
      try { localStorage.removeItem('ctv.meta'); } catch (e) {}
      return loadCatalog(true).then(function () { loadEpg(true); return loadTmdbLists(true); }).then(function () {
        markDirty();
        listInfo('Lista atualizada', listSummary());
      });
    }).then(null, function (e) {
      loading(false);
      listInfo('Não foi possível atualizar', e.message + '\n\n' + listSummary());
    });
  }

  function listSummary() {
    var pl = activePlaylist(), g = app.groups.live.length + app.groups.movies.length + app.groups.series.length;
    return (pl.sub ? 'Lista da assinatura' + (remote.plano && remote.plano.nome ? ' · plano ' + remote.plano.nome : '') : 'Canais abertos (vêm com o app)') + '\n' +
      app.cat.live.length + ' canais · ' + app.cat.movies.length + ' filmes · ' + app.cat.series.length + ' séries · ' + g + ' grupos' +
      (pl.sub && catAt ? '\nBaixada às ' + hhmm(catAt) + (catDay !== today() ? ' de ' + catDay.split('-').reverse().join('/') : '') : '') +
      '\n' + tmdbSummary();
  }

  function tmdbSummary() {
    if (!remote.tmdb) return 'TMDB: sem chave (cadastre o token nos Ajustes do portal)';
    if (!tmFresh()) return 'TMDB: não respondeu (confira o token nos Ajustes do portal)';
    var t = tmdbRows();
    return 'TMDB: ' + t.trend.length + ' em alta · ' + (t.popMovies.length + t.popSeries.length) + ' populares · ' +
      (t.movies.length + t.series.length) + ' mais bem avaliados encontrados na sua lista';
  }

  function listInfo(title, text) {
    noticeInfo = true;
    showSetup('stepNotice');
    $('stepNotice').querySelector('h2').textContent = title;
    $('noticeText').textContent = text;
    Nav.focus($('noticeOk'));
  }

  // aviso do painel: aparece uma vez, fora do player (espera o vídeo fechar)
  function showNotice() {
    var n = remote.notice;
    if (!n || localStorage.getItem('ctv.noticeSeen') === n.id || Player.active || duo.on || !$('setup').classList.contains('hidden')) return;
    showSetup('stepNotice');
    $('noticeText').textContent = n.text;
    Nav.focus($('noticeOk'));
  }

  function closeNotice() {
    if (noticeInfo) {
      noticeInfo = false; $('stepNotice').querySelector('h2').textContent = 'Aviso'; leaveSetup();
      var fn = infoThen; infoThen = null;
      return fn && fn();
    }
    if (remote.notice) localStorage.setItem('ctv.noticeSeen', remote.notice.id);
    leaveSetup();
  }

  /* ---------- Perfis do cliente ---------- */

  // TV ligada a um cliente pelo MAC (remote.cliente): cada pessoa tem favoritos, histórico e lista ativa próprios,
  // em clientes/{c}/perfis/{p}/state. Sem cliente, tudo fica por TV (tvs/{uid}/state), como sempre foi.
  var profile = { list: [], cur: null }, profileChanged = false, pickDone = null;
  var AV_COLORS = ['#1673B9', '#3BAA4A', '#F39323', '#8b5cf6', '#e53935', '#14b8a6'];

  // o painel tem até 6 s para responder; sem internet, segue com o que estiver guardado
  function upTo6s(p) { return Promise.race([p.then(null, function () {}), new Promise(function (r) { setTimeout(r, 6000); })]); }

  function profilesPath() { return 'clientes/' + remote.cliente + '/perfis'; }
  function profileBase(p) { return profilesPath() + '/' + p.id; }

  function useProfile(p) {
    profile.cur = p;
    localStorage.setItem('ctv.profile', JSON.stringify({ c: remote.cliente, id: p.id, nome: p.nome, avatar: p.avatar || '' }));
    return Cloud.use(profileBase(p), p.id);
  }

  function createProfile(nome, withCurrentState, id) {
    var p = { id: id || 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36), nome: nome, avatar: '', criado: Date.now() };
    return Fire.set(profileBase(p), { nome: p.nome, avatar: p.avatar, criado: p.criado })
      .then(function () { return withCurrentState ? Cloud.copyTo(profileBase(p)) : null; })
      .then(function () { profile.list.push(p); return p; });
  }

  // sem nenhum perfil ainda: nasce o "Principal" com o que a TV já tinha, para não perder nada.
  // Id fixo: duas TVs do mesmo cliente abrindo juntas pela 1ª vez gravam o mesmo perfil, sem duplicar
  function loadProfiles() {
    return Fire.list(profilesPath()).then(function (list) {
      profile.list = list.sort(function (a, b) { return (a.criado || 0) - (b.criado || 0); });
      if (list.length) return profile.list;
      var main = { id: 'principal', nome: 'Principal', avatar: '' };
      return Fire.get(profileBase(main)).then(function (doc) {
        if (!doc) return createProfile('Principal', true, 'principal');
        main.nome = doc.nome || main.nome; // a outra TV acabou de criar: só usa
        profile.list.push(main);
      }).then(function () { return profile.list; });
    });
  }

  // avatar: '' (inicial numa cor do nome) · '#rrggbb' (inicial nessa cor) · figura da DiceBear (só esse endereço) · até 4 letras/emoji
  function avatarHtml(p) {
    var s = p.nome || '?', h = 0, a = p.avatar || '';
    if (/^https:\/\/api\.dicebear\.com\/[\w.\/?=&%,-]+$/.test(a)) return '<i class="av pic"><img src="' + esc(a) + '" alt=""/></i>';
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    var color = /^#[0-9a-f]{6}$/i.test(a) ? a : AV_COLORS[Math.abs(h) % AV_COLORS.length];
    var t = a && a.length <= 4 && a.charAt(0) !== '#' ? a : s.charAt(0).toUpperCase();
    return '<i class="av" style="background:' + color + '">' + esc(t) + '</i>';
  }

  /* ---------- Editar perfil: nome e imagem ---------- */

  // figuras feitas a partir do nome (DiceBear: o mesmo nome dá sempre as mesmas), em vários estilos, e a inicial
  // nas cores da marca. "Mais opções" troca as figuras
  var AV_STYLES = ['adventurer', 'avataaars', 'big-smile', 'fun-emoji', 'lorelei', 'micah', 'notionists', 'personas', 'pixel-art', 'bottts', 'thumbs', 'big-ears'];
  var edit = { p: null, avatar: '', round: 0, back: null };

  function avatarOptions(nome, round) {
    var seed = function (j) { return encodeURIComponent((nome || 'perfil') + (round * 2 + j ? ' ' + (round * 2 + j) : '')); };
    var out = AV_COLORS.map(function (c) { return c; });
    for (var j = 0; j < 2; j++) AV_STYLES.forEach(function (st) {
      out.push('https://api.dicebear.com/9.x/' + st + '/svg?seed=' + seed(j) + '&backgroundColor=1673b9,3baa4a,f39323,8b5cf6,e53935,14b8a6');
    });
    return out;
  }

  function editProfile(p, back) {
    edit = { p: p, avatar: p.avatar || '', round: 0, back: back };
    showSetup('stepEditProfile');
    $('setup').classList.add('edit');
    $('peName').value = p.nome;
    $('peErr').textContent = '';
    renderAvatarGrid();
    Nav.focus($('peGrid').querySelector('.sel') || $('peName'));
  }

  function renderAvatarGrid() {
    var nome = $('peName').value.trim() || edit.p.nome;
    $('peAv').innerHTML = avatarHtml({ nome: nome, avatar: edit.avatar });
    $('peGrid').innerHTML = avatarOptions(nome, edit.round).map(function (a) {
      return '<div class="pe-opt f' + (a === edit.avatar ? ' sel' : '') + '" data-a="' + esc(a) + '">' + avatarHtml({ nome: nome, avatar: a }) + '</div>';
    }).join('');
    var tiles = $('peGrid').children;
    for (var i = 0; i < tiles.length; i++) tiles[i]._enter = pickAvatar;
  }

  function pickAvatar() {
    edit.avatar = this.getAttribute('data-a');
    var tiles = $('peGrid').children;
    for (var i = 0; i < tiles.length; i++) tiles[i].classList.toggle('sel', tiles[i] === this);
    $('peAv').innerHTML = avatarHtml({ nome: $('peName').value.trim() || edit.p.nome, avatar: edit.avatar });
  }

  function editDone() {
    $('setup').classList.remove('edit');
    var back = edit.back;
    edit.back = null;
    if (back) back();
  }

  function saveProfileEdit() {
    var p = edit.p, nome = $('peName').value.trim().slice(0, 20);
    if (!nome) { $('peErr').textContent = 'Digite um nome'; return Nav.focus($('peName')); }
    $('peErr').textContent = 'Salvando...';
    Fire.set(profileBase(p), { nome: nome, avatar: edit.avatar }).then(function () {
      p.nome = nome;
      p.avatar = edit.avatar;
      if (profile.cur && profile.cur.id === p.id) {
        profile.cur.nome = nome;
        profile.cur.avatar = edit.avatar;
        localStorage.setItem('ctv.profile', JSON.stringify({ c: remote.cliente, id: p.id, nome: nome, avatar: edit.avatar }));
      }
      toast('Perfil salvo');
      editDone();
    }, function () { $('peErr').textContent = 'Não foi possível salvar. Confira a internet.'; });
  }

  // "Quem está assistindo?": resolve true se trocou de perfil
  function chooseProfile() {
    return new Promise(function (resolve) {
      pickDone = resolve;
      showSetup('stepProfiles');
      renderProfiles();
    });
  }

  function renderProfiles() {
    var last = (profile.cur || stored('ctv.profile') || {}).id, el = null;
    // cada perfil com um lápis embaixo (▼ do perfil chega nele) que abre a edição
    $('profileList').innerHTML = profile.list.map(function (p) {
      return '<div class="pf-col"><div class="pf f" data-pid="' + esc(p.id) + '">' + avatarHtml(p) + '<span>' + esc(p.nome) + '</span></div>' +
        '<div class="pf-edit f" data-edit="' + esc(p.id) + '" title="Editar">✎</div></div>';
    }).join('') + '<div class="pf-col"><div class="pf add f" data-pid="+"><i class="av">+</i><span>Perfil</span></div></div>';
    var tiles = $('profileList').querySelectorAll('.pf'), pens = $('profileList').querySelectorAll('.pf-edit');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i]._enter = pickProfile;
      if (tiles[i].getAttribute('data-pid') === last) el = tiles[i];
    }
    for (i = 0; i < pens.length; i++) pens[i]._enter = editFromPicker;
    Nav.focus(el || tiles[0]);
  }

  function editFromPicker() {
    var id = this.getAttribute('data-edit'), p = find(profile.list, function (x) { return x.id === id; });
    editProfile(p, function () { showSetup('stepProfiles'); renderProfiles(); });
  }

  function pickProfile() {
    var id = this.getAttribute('data-pid');
    if (id === '+') return newProfileStep();
    var p = find(profile.list, function (x) { return x.id === id; });
    var changed = !profile.cur || profile.cur.id !== p.id, done = pickDone;
    pickDone = null;
    showSetup('stepBoot');
    (changed ? useProfile(p) : Promise.resolve()).then(function () { if (done) done(changed); });
  }

  function newProfileStep() {
    showSetup('stepNewProfile');
    $('pfName').value = '';
    $('pfErr').textContent = '';
    Nav.focus($('pfName'));
  }

  function submitProfile() {
    var nome = $('pfName').value.trim().slice(0, 20);
    if (!nome) { $('pfErr').textContent = 'Digite um nome'; return Nav.focus($('pfName')); }
    $('pfErr').textContent = 'Criando...';
    createProfile(nome, false).then(function () { showSetup('stepProfiles'); renderProfiles(); },
      function () { $('pfErr').textContent = 'Não foi possível criar o perfil. Confira a internet.'; });
  }

  // na abertura: lista os perfis e pergunta; sem rede (ou sem permissão), usa o último desta TV
  function pickAtBoot() {
    function offline() {
      var l = stored('ctv.profile');
      if (l && l.c === remote.cliente) return useProfile({ id: l.id, nome: l.nome, avatar: l.avatar });
    }
    return upTo6s(loadProfiles()).then(function (list) {
      return list && list.length ? chooseProfile() : offline();
    });
  }

  function profilesFromSettings() {
    upTo6s(loadProfiles()).then(chooseProfile).then(function (changed) {
      leaveSetup();
      if (changed) { regroup(); go('settings'); } // favoritos, grupos, ocultos e qualidades são do perfil
    });
  }

  /* ---------- Plano da assinatura ---------- */

  // vencido ou bloqueado: avisa no lugar dos canais da assinatura; os canais abertos continuam
  function planBlockedStep() {
    var ps = planState();
    if (ps !== 'vencido' && ps !== 'bloqueado') return false;
    var p = remote.plano, ate = p.ate ? p.ate.split('-').reverse().join('/') : '';
    $('planTitle').textContent = ps === 'bloqueado' ? 'Acesso bloqueado' : 'Plano vencido';
    $('planText').textContent = ps === 'bloqueado'
      ? 'O acesso aos canais da sua assinatura foi bloqueado. Fale com quem vendeu a assinatura.'
      : 'Seu plano' + (p.nome ? ' ' + p.nome : '') + ' venceu' + (ate ? ' em ' + ate : '') + '. Renove com quem vendeu a assinatura para voltar a assistir.';
    showSetup('stepPlan');
    Nav.focus($('planOk'));
    return true;
  }

  function planOk() {
    if (app.view) leaveSetup(); else enterShell();
    showNotice();
  }

  function boot() {
    showSetup('stepBoot');
    // vigia: a abertura não pode ficar no "carregando" para sempre (escolha de perfil não conta: é a tela dela)
    var guard = setTimeout(function () {
      if ($('stepBoot').classList.contains('hidden')) return;
      appError(new Error('A abertura passou de 2 min'));
      askRetry('Está demorando mais que o normal', 'A Catarina TV não terminou de abrir.', function () { location.reload(); });
    }, 120000);
    earlyList();
    upTo6s(syncRemote())
      // ao abrir, tudo é carregado de qualquer jeito: sem aviso de "mudou" no canto
      .then(function () { profileChanged = groupsChanged = epgChanged2 = tmdbChanged = false; return upTo6s(Cloud.load()); })
      // cada perfil guarda a sua lista ativa: escolhe antes de carregar a lista
      .then(function () { return remote.cliente ? pickAtBoot() : null; })
      .then(function () {
        app.playlists = openPlaylists();
        // pedido de "Atualizar listas" feito com a TV desligada: abre com a cópia e atualiza tudo por trás
        if (remote.refresh > refreshSeen()) { store('ctv.refreshAt', remote.refresh); listStale = tmdbStale = true; }
        return loadCatalog(false);
      })
      .then(afterBoot, function (e) { afterBoot(); listFailed(e); })
      .then(null, appError) // erro ao montar a tela: vai para o portal (antes ficava só o "carregando")
      // pedido do portal pendente: a lista baixa logo depois, sem segurar a tela
      .then(function () { clearTimeout(guard); setTimeout(pollRemote, 1500); pollLoop(); });
  }

  // Modo de baixo custo: a TV lê o portal ao abrir, ao voltar do segundo plano, ao abrir Ajustes, a cada 30 min e
  // quando o servidor avisa pelo Realtime Database que algo desta TV mudou (js/controle.js → onsinal): 48 leituras
  // por dia em vez de 1.440. Sem o sinal, o que o portal manda chega em até 30 min
  var POLL_MS = 30 * 60000, pollTimer = null;
  function pollLoop() {
    clearInterval(pollTimer);
    pollTimer = setInterval(pollRemote, POLL_MS);
    Controle.onsinal = function () { clearTimeout(pollLoop.t); pollLoop.t = setTimeout(pollRemote, 1500); }; // junta sinais seguidos
  }

  // a primeira lista não veio (sem cópia guardada): diz o porquê e deixa tentar de novo
  function listFailed(e) {
    askRetry('Não foi possível carregar os canais', e.message, function () {
      loadCatalog(false).then(function () { markDirty(); go('home'); }, listFailed);
    });
  }

  // tela de aviso com "OK = tentar de novo"
  var infoThen = null;
  function askRetry(title, text, fn) {
    listInfo(title, text + '\n\nAperte OK para tentar de novo.');
    infoThen = fn;
  }

  // erro de JavaScript que ninguém tratou: vai ao portal em tvs/{uid}.sync.appErro (sem links), para dar para investigar
  function appError(e) {
    syncErr.app = String((e && (e.message || e.reason)) || e || 'erro').slice(0, 160);
    syncErr.appAt = Date.now();
    reportSync();
  }
  window.addEventListener('error', function (e) { appError(e.error || e.message); });
  window.addEventListener('unhandledrejection', function (e) { appError(e.reason); });

  function afterBoot() {
    measureBand(); // velocidade da internet para a qualidade automática dos canais
    if (!planBlockedStep()) { enterShell(); showNotice(); }
  }

  function enterShell() {
    $('setup').classList.add('hidden');
    $('shell').classList.remove('hidden');
    Nav.scope = $('shell');
    go('home');
  }

  /* ---------- Início ---------- */

  function registerKeys() {
    // uma por vez: tecla que o modelo não tem não impede as outras
    ['ChannelUp', 'ChannelDown', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue', 'Info',
      'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
      'PreviousChannel', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9']
      .forEach(function (n) { try { tizen.tvinputdevice.registerKey(n); } catch (e) {} });
  }

  app.start = function () {
    if (window.webapis) document.documentElement.className = 'tv';
    else {
      // navegador: encaixa a tela de 1920×1080 na janela
      var fit = function () {
        var sc = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
        document.body.style.transformOrigin = '0 0';
        document.body.style.transform = 'scale(' + sc + ')';
      };
      fit();
      window.addEventListener('resize', fit);
    }
    var brands = document.querySelectorAll('.brand');
    // ids de gradiente únicos: um <svg> escondido não pode "roubar" o gradiente dos outros
    for (var i = 0; i < brands.length; i++) brands[i].innerHTML = LOGO.replace(/\blg\b/g, 'lg' + i);
    // o grande (abertura, perfis, avisos) é a imagem do logo com o nome
    var big = document.querySelectorAll('.brand.big');
    for (i = 0; i < big.length; i++) big[i].innerHTML = '<img class="logo-nome" src="img/logo-nome.png" alt="Catarina TV"/>';
    // logo do menu: OK 8× força a atualização da lista; grupo próprio para não virar o "último item" do menu
    var logo = $('side').querySelector('.brand');
    logo.className += ' f';
    logo.setAttribute('data-group', 'logo');
    logo._enter = logoTap;
    $('menu').innerHTML = MENU.map(function (m) {
      return '<div class="mi f" data-view="' + m[0] + '">' + icon(m[0]) + '<span>' + m[1] + '</span></div>';
    }).join('');

    clock();
    setInterval(clock, 10000);
    showWeather(stored('ctv.wx'));
    weather();
    setInterval(weather, 30 * 60000);
    registerKeys();
    Controle.start(); // teclas que chegam do celular (js/controle.js)
    initLive();
    initGuide();
    // a cada minuto: barras de progresso e "faltam X min" andam
    setInterval(function () {
      if (duo.on) return renderDuo();
      if (Player.active || !$('setup').classList.contains('hidden')) return;
      if (app.view === 'live') renderLive();
      else if (app.view === 'guide') renderGuide();
    }, 60000);

    // imagem quebrada: esconde e deixa o nome aparecer
    document.addEventListener('error', function (e) {
      if (e.target.tagName !== 'IMG') return;
      e.target.style.visibility = 'hidden';
      var opt = e.target.closest && e.target.closest('.pe-opt');
      if (opt) opt.style.display = 'none'; // figura que não carregou sai das opções
    }, true);

    $('noticeOk')._enter = closeNotice;
    $('planOk')._enter = planOk;
    $('pfName')._done = submitProfile;
    $('pfCreate')._enter = submitProfile;
    $('pfCancel')._enter = function () { showSetup('stepProfiles'); renderProfiles(); };
    $('peName')._done = renderAvatarGrid; // nome novo: figuras novas
    $('peSave')._enter = saveProfileEdit;
    $('peCancel')._enter = editDone;
    $('peMore')._enter = function () { edit.round++; renderAvatarGrid(); };
    $('pinInput')._done = submitPin;
    $('pinGo')._enter = submitPin;
    $('pinCancel')._enter = function () { pinFlow.then = null; leavePin(); };
    $('q')._done = runSearch;
    $('q').addEventListener('input', function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runSearch, 400);
    });

    Nav.onkey = function (k) {
      if (k >= K.RED && k <= K.BLUE && semCores()) store('ctv.cores', 1); // este controle tem as teclas coloridas
      return trailerKey(k) || exitKey(k) || qmenuKey(k) || menuKey(k) || duoKey(k) || zapKey(k) || channelKey(k) || liveBarKey(k) || vodBarKey(k) || Player.key(k); };
    // o selo ⚙ da qualidade abre o menu com o ponteiro do controle (ou o mouse, no PC)
    document.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.qchip'), ch = chip && app.idx[chip.getAttribute('data-ch')];
      if (!ch) return;
      e.stopPropagation();
      if (Player.active) openQMenu(ch, function () { playLive(ch, zapList); });
      else openQMenu(ch, function () { if (app.view === 'live') renderLive(); });
    }, true);
    Nav.onback = back;
    Nav.onenter = onEnter;
    Nav.onfocus = onFocus;
    Nav.onother = onOther;
    // segurar OK favorita: cards, lista de canais e guia (o toque continua abrindo)
    Nav.canHold = function (el) {
      if (el === $('liveChannels') || el === $('gGrid')) return true;
      var info = itemOf(el);
      return !!(info && info.item && info.item.t);
    };
    Nav.onhold = function (el) {
      if (el === $('liveChannels')) return toggleFav(live.groups[live.gi].items[live.ci]);
      if (el === $('gGrid')) return toggleFav(guideCh());
      var info = itemOf(el);
      if (info) toggleFav(info.item);
    };

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { closeDuo(false); Player.close(); stopPreview(); closeTrailer(); Cloud.flush(); } else pollRemote();
    });

    boot();
  };

  return app;
})();

window.onload = App.start;
