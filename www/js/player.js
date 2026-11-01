/* Player: AVPlay (nativo Samsung: HLS, TS, MP4, MKV) com <video> como reserva no navegador.
 * Player.open({ url, title, sub, logo, live, start, osd, onprogress, onend, onzap, onfav, onduo, onquality, onstall, onclose, why,
 *              ontracks, oneps, onnext, keys })
 *   ontracks(): 🟡 em filme/episódio (menu de áudio e legendas); oneps(): 🟢 lista de episódios; onnext(±1): CH▲▼ episódio;
 *   keys: dicas do rodapé do filme/episódio. Player.tracks() / Player.setTrack(tipo, i, nome): faixas do que está tocando
 *   why(cb): não tocou; o app descobre o motivo, se der, e chama cb(texto)
 *   onstall(): o ao vivo travou ou caiu; true se o app trocou de qualidade (aí o player não mostra erro)
 *   osd(): HTML do rodapé do ao vivo (programa atual, a seguir), refeito a cada vez que ele aparece
 * Player.preview(url, rect, onstate) / Player.stopPreview(): vídeo pequeno num retângulo da tela
 * Player.duoPlay(i, url, rect, onstate) / duoAudio(i) / duoClose(): tela dupla, dois canais e o som de um */
var Player = (function () {
  var K = Nav.K;
  var p = { active: false };
  var o = null, gen = 0, pos = 0, dur = 0, paused = false;
  var seekTarget = null, seekTimer, osdTimer, lastSave = 0, lastStep = 0, step = 10000;
  var retries = 0, retryTimer, connectedAt = 0, MAX_RETRIES = 3;
  var hls = null; // só no navegador (testes): o Chrome não toca HLS nativamente

  function avplay() { return window.webapis && webapis.avplay; }
  function spin(on) { $('pSpin').classList.toggle('hidden', !on); }

  function message(text) {
    $('pMsg').textContent = text;
    $('pMsg').classList.toggle('hidden', !text);
  }

  function error(text) {
    spin(false);
    message(text);
    showOsd(true);
    // o app confere o motivo de verdade (ex.: a assinatura em uso em outro aparelho) e troca a mensagem
    var my = gen;
    if (o && o.why) o.why(function (t) { if (t && my === gen && p.active) message(t); });
  }

  // ao vivo: o sinal cai com frequência, então tenta reconectar antes de desistir
  function fail(my, text) {
    if (my !== gen) return;
    if (!o.live) return error(text);
    if (connectedAt && Date.now() - connectedAt > 30000) retries = 0; // estava tocando bem: queda nova
    if (retries >= MAX_RETRIES) return o.onstall && o.onstall() ? null : error(text); // antes do erro: qualidade menor
    if (retries === 1 && o.onstall && o.onstall()) return; // caiu 2× seguidas: tenta numa qualidade menor
    retries++;
    connectedAt = 0;
    stopMedia();
    spin(true);
    message('Sinal perdido, reconectando... (' + retries + '/' + MAX_RETRIES + ')');
    showOsd(true);
    var again = gen;
    retryTimer = setTimeout(function () { if (again === gen) start(); }, 2000 * retries);
  }

  // carregando de novo depois de já tocar: 3× em 1 min = internet não aguenta esta qualidade (o app desce uma)
  var stalls = [];
  function stalled(my) {
    if (my !== gen || !o.live || !connectedAt || !o.onstall) return;
    var now = Date.now();
    stalls = stalls.filter(function (t) { return now - t < 60000; });
    stalls.push(now);
    if (stalls.length >= 3) { stalls = []; o.onstall(); }
  }

  function connected(my) {
    if (my !== gen) return;
    connectedAt = Date.now();
    spin(false);
    message('');
  }

  function start() {
    if (avplay()) openAv(gen); else openVideo(gen);
  }

  function showOsd(keep) {
    if (o && o.live && o.osd) $('pLive').innerHTML = o.osd();
    $('player').classList.add('show');
    clearTimeout(osdTimer);
    if (!keep && !paused) osdTimer = setTimeout(function () { $('player').classList.remove('show'); }, 5000);
  }

  function update() {
    if (!o || o.live) return;
    var shown = seekTarget == null ? pos : seekTarget;
    $('pProg').style.width = dur ? Math.min(100, pos / dur * 100) + '%' : '0';
    $('pSeek').style.left = dur ? Math.min(100, shown / dur * 100) + '%' : '0';
    $('pSeek').classList.toggle('hidden', seekTarget == null);
    $('pCur').textContent = fmtTime(shown);
    $('pDur').textContent = dur ? fmtTime(dur) : '';
    $('pState').textContent = paused ? '❚❚  Pausado' : seekTarget != null ? (seekTarget > pos ? '▶▶  ' : '◀◀  ') + fmtTime(seekTarget) : '';
  }

  function tick() {
    if ($('player').classList.contains('show')) update();
    if (!o.live && o.onprogress && Date.now() - lastSave > 15000) {
      lastSave = Date.now();
      o.onprogress(pos, dur);
    }
  }

  function ended() {
    if (o.onprogress) o.onprogress(dur || pos, dur || pos);
    if (o.onend && o.onend()) return; // ex.: abriu o próximo episódio
    p.close();
  }

  function openAv(my) {
    var av = webapis.avplay;
    try {
      av.open(o.url);
      av.setDisplayRect(0, 0, 1920, 1080);
      av.setListener({
        onbufferingstart: function () { if (my === gen) { spin(true); stalled(my); } },
        onbufferingprogress: function () {},
        onbufferingcomplete: function () { if (my === gen) spin(false); },
        oncurrentplaytime: function (ms) { if (my === gen) { pos = ms; tick(); } },
        onstreamcompleted: function () {
          if (my !== gen) return;
          if (o.live) fail(my, 'A transmissão foi encerrada'); else ended();
        },
        onerror: function (e) { fail(my, 'Não foi possível reproduzir (' + e + ')'); },
        onevent: function () {},
        // legenda: a TV manda o texto e quanto tempo ele fica; o app escreve na tela (#pSubs)
        onsubtitlechange: function (duration, text) { if (my === gen && subOn) subText(text, duration); },
        ondrmevent: function () {}
      });
      av.prepareAsync(function () {
        if (my !== gen) return;
        dur = o.live ? 0 : av.getDuration() || 0;
        if (o.start && !o.live) { pos = o.start; av.seekTo(o.start, function () {}, function () {}); }
        av.play();
        if (!o.live) applyPref();
        connected(my);
        update();
      }, function () {
        fail(my, 'Não foi possível abrir este conteúdo');
      });
    } catch (e) {
      fail(my, 'Não foi possível abrir: ' + (e.message || e.name));
    }
  }

  function openVideo(my) {
    var v = $('vid');
    v.style.display = 'block';
    v.onwaiting = function () { if (my === gen) { spin(true); stalled(my); } };
    v.onplaying = function () { connected(my); };
    v.onloadedmetadata = function () { if (my === gen && o.start && !o.live) v.currentTime = o.start / 1000; };
    v.ontimeupdate = function () {
      if (my !== gen) return;
      pos = v.currentTime * 1000;
      dur = isFinite(v.duration) && !o.live ? v.duration * 1000 : 0;
      tick();
    };
    v.onended = function () {
      if (my !== gen) return;
      if (o.live) fail(my, 'A transmissão foi encerrada'); else ended();
    };
    // ignora o erro atrasado do vídeo anterior (liberado com src vazio)
    v.onerror = function () { if (v.currentSrc) fail(my, 'Formato não suportado no navegador (na TV usa o player nativo)'); };
    webPlay(v, o.url, o.live && !o.audio, function () { return my === gen; }, function (h) { hls = h; },
      function () { fail(my, 'Não foi possível reproduzir este stream'); });
  }

  /* ---------- Navegador (testes no PC) ---------- */

  // O vídeo passa pelo /proxy do servidor local, como as listas: o provedor não libera o navegador (CORS)
  // e alguns só aceitam o User-Agent do VLC. HLS pelo hls.js; MPEG-TS (o comum em IPTV: .ts, ou link sem
  // extensão no ao vivo) pelo mpegts.js; MP4/MKV direto no <video>. Na TV nada disso roda: é o AVPlay.
  var LIBS = { Hls: 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js', mpegts: 'https://cdn.jsdelivr.net/npm/mpegts.js@1.7.3/dist/mpegts.min.js' };

  function viaPc(url) { return /^https?:\/\//i.test(url) ? location.origin + '/proxy?url=' + encodeURIComponent(url) : url; }

  function lib(name, cb) {
    if (window[name]) return cb();
    var s = document.createElement('script');
    s.src = LIBS[name];
    s.onload = s.onerror = cb;
    document.head.appendChild(s);
  }
  // iPad/iPhone: o Safari só deixa o vídeo tocar com som se o play() vier junto com o toque. Carregar a biblioteca na
  // hora do toque atrasava o play() e o canal ficava carregando: no navegador, já carrega as duas ao abrir o app
  if (!window.webapis) { lib('Hls', function () {}); lib('mpegts', function () {}); }

  // liga o <video> ao stream; keep(h) guarda o hls/mpegts criado (para destroy); fatal() quando não toca
  function webPlay(v, url, live, alive, keep, fatal) {
    var play = function () { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); };
    var kind = /\.m3u8(\?|$)/i.test(url) ? 'Hls'
      : /\.ts(\?|$)/i.test(url) || (live && !/\.(mp4|mkv|webm|mov|avi)(\?|$)/i.test(url)) ? 'mpegts' : '';
    // rádio (MP3/AAC): direto do site dela, sem passar pelo PC (o <audio>/<video> não precisa de liberação do site); bem mais rápido
    if (!kind) { v.src = o && o.audio ? url : viaPc(url); return play(); }
    // Safari (iPad, iPhone, Mac) toca HLS sozinho: direto no <video>, sem esperar biblioteca
    if (kind === 'Hls' && v.canPlayType('application/vnd.apple.mpegurl')) { v.src = viaPc(url) + (url === viaPc(url) ? '' : '&hls=1'); return play(); }
    lib(kind, function () {
      if (!alive()) return;
      var h;
      if (kind === 'Hls' && window.Hls && Hls.isSupported()) {
        h = new Hls();
        h.on(Hls.Events.ERROR, function (ev, d) { if (d.fatal) fatal(); });
        h.loadSource(viaPc(url) + (url === viaPc(url) ? '' : '&hls=1')); // hls=1: o servidor reescreve os links do .m3u8 para o /proxy
        h.attachMedia(v);
      } else if (kind === 'mpegts' && window.mpegts && mpegts.isSupported()) {
        h = mpegts.createPlayer({ type: 'mpegts', isLive: live, url: viaPc(url) });
        h.on(mpegts.Events.ERROR, fatal);
        h.attachMediaElement(v);
        h.load();
      } else { v.src = viaPc(url); return play(); }
      keep(h);
      play();
    });
  }

  function stopMedia() {
    gen++;
    clearTimeout(seekTimer);
    clearTimeout(retryTimer);
    if (avplay()) {
      try { webapis.avplay.stop(); } catch (e) {}
      try { webapis.avplay.close(); } catch (e) {}
    }
    if (hls) { hls.destroy(); hls = null; }
    subText('');
    var v = $('vid');
    v.onerror = v.ontimeupdate = v.onended = v.onplaying = null;
    v.pause();
    v.removeAttribute('src');
    try { v.load(); } catch (e) {}
    v.style.display = 'none';
    v.style.left = v.style.top = v.style.width = v.style.height = ''; // volta a ocupar a tela (pode ter sido prévia)
    pv = null;
  }

  /* ---------- Prévia ---------- */

  var pv = null; // url da prévia tocando

  // rect = { x, y, w, h } em pixels da tela de 1920×1080; onstate(true|false) quando toca ou falha
  p.preview = function (url, rect, onstate) {
    if (p.active || duo.on || pv === url) return;
    stopMedia();
    pv = url;
    var my = gen, done = function (ok) { if (my === gen && onstate) onstate(ok); };
    if (avplay()) {
      var av = webapis.avplay;
      try {
        av.open(url);
        av.setDisplayRect(rect.x, rect.y, rect.w, rect.h);
        av.setListener({
          onbufferingstart: function () {}, onbufferingprogress: function () {},
          onbufferingcomplete: function () { done(true); },
          oncurrentplaytime: function () {}, onevent: function () {}, onsubtitlechange: function () {}, ondrmevent: function () {},
          onstreamcompleted: function () { done(false); },
          onerror: function () { done(false); }
        });
        av.prepareAsync(function () { if (my === gen) { av.play(); done(true); } }, function () { done(false); });
      } catch (e) { done(false); }
      return;
    }
    var v = $('vid');
    v.style.left = rect.x + 'px'; v.style.top = rect.y + 'px'; v.style.width = rect.w + 'px'; v.style.height = rect.h + 'px';
    v.style.display = 'block';
    v.onplaying = function () { done(true); };
    v.onerror = function () { if (v.currentSrc) done(false); };
    webPlay(v, url, true, function () { return my === gen; }, function (h) { hls = h; }, function () { done(false); });
  };

  p.stopPreview = function () {
    if (pv && !p.active) stopMedia();
  };

  /* ---------- Tela dupla (ao vivo) ---------- */

  // Na TV, dois players do AVPlayStore, como no exemplo da Samsung: o 2º no recurso de vídeo SUB e o som
  // com enable/disableAudioStream (Tizen 6.5+). Multiview oficial é do Tizen 7.0: se esta TV não der conta
  // do 2º vídeo, onstate(false) e a tela avisa. No navegador, dois <video> com "muted".
  var duo = { on: false, ps: [], gen: [0, 0], audio: 0, hls: [null, null] };

  function duoVideo(i) { return $(i ? 'vid2' : 'vid'); }

  function duoStop(i) {
    duo.gen[i]++;
    if (avplay()) {
      var av = duo.ps[i];
      if (av) { try { av.stop(); } catch (e) {} try { av.close(); } catch (e) {} }
      return;
    }
    if (duo.hls[i]) { duo.hls[i].destroy(); duo.hls[i] = null; }
    var v = duoVideo(i);
    v.onplaying = v.onerror = null;
    v.pause();
    v.removeAttribute('src');
    try { v.load(); } catch (e) {}
    v.style.display = 'none';
    v.style.left = v.style.top = v.style.width = v.style.height = '';
  }

  p.duoPlay = function (i, url, rect, onstate) {
    if (!duo.on) { stopMedia(); duo.on = true; } // sai do player e da prévia normais
    duoStop(i);
    var my = duo.gen[i], done = function (ok) { if (my === duo.gen[i] && onstate) onstate(ok); };
    if (avplay()) {
      try {
        var av = duo.ps[i] || (duo.ps[i] = webapis.avplaystore.getPlayer());
        av.open(url);
        av.setDisplayRect(rect.x, rect.y, rect.w, rect.h);
        av.setListener({
          onbufferingstart: function () {}, onbufferingprogress: function () {},
          onbufferingcomplete: function () { done(true); },
          oncurrentplaytime: function () {}, onevent: function () {}, onsubtitlechange: function () {}, ondrmevent: function () {},
          onstreamcompleted: function () { done(false); },
          onerror: function () { done(false); }
        });
        if (i !== duo.audio) { try { av.disableAudioStream(); } catch (e) {} }
        if (i === 1) { try { av.setStreamingProperty('IN_APP_MULTIVIEW', 'VIDEO_VIEW_RESOURCE_SUB'); } catch (e) {} }
        av.prepareAsync(function () {
          if (my !== duo.gen[i]) return;
          av.play();
          if (i === duo.audio) { try { av.enableAudioStream(); } catch (e) {} }
          done(true);
        }, function () { done(false); });
      } catch (e) { done(false); }
      return;
    }
    var v = duoVideo(i);
    v.style.left = rect.x + 'px'; v.style.top = rect.y + 'px'; v.style.width = rect.w + 'px'; v.style.height = rect.h + 'px';
    v.style.display = 'block';
    v.muted = i !== duo.audio;
    v.onplaying = function () { done(true); };
    v.onerror = function () { if (v.currentSrc) done(false); };
    webPlay(v, url, true, function () { return my === duo.gen[i]; }, function (h) { duo.hls[i] = h; }, function () { done(false); });
  };

  // o som passa para o lado i (enableAudioStream já tira o som do outro player)
  p.duoAudio = function (i) {
    duo.audio = i;
    if (avplay()) {
      try { duo.ps[1 - i].disableAudioStream(); } catch (e) {}
      try { duo.ps[i].enableAudioStream(); } catch (e) {}
      return;
    }
    duoVideo(0).muted = i !== 0;
    duoVideo(1).muted = i !== 1;
  };

  p.duoClose = function () {
    if (!duo.on) return;
    duoStop(0);
    duoStop(1);
    duo.on = false;
    duo.audio = 0;
  };

  function togglePause() {
    if (o.live) return;
    if (avplay()) { if (paused) webapis.avplay.play(); else webapis.avplay.pause(); }
    else if (paused) $('vid').play(); else $('vid').pause();
    paused = !paused;
    if (paused && o.onprogress) o.onprogress(pos, dur);
    update();
    showOsd(paused);
  }

  // cada toque seguido avança mais (10s, 15s, 22s...)
  function seek(dir) {
    if (o.live || !dur) return;
    var t = Date.now();
    step = t - lastStep < 700 ? Math.min(step * 1.5, 300000) : 10000;
    lastStep = t;
    seekTarget = Math.max(0, Math.min(dur - 3000, (seekTarget == null ? pos : seekTarget) + dir * step));
    update();
    clearTimeout(seekTimer);
    seekTimer = setTimeout(function () {
      var target = seekTarget;
      seekTarget = null;
      pos = target;
      if (avplay()) webapis.avplay.seekTo(target, function () {}, function () {});
      else $('vid').currentTime = target / 1000;
      update();
    }, 800);
  }

  p.open = function (opts) {
    stopMedia();
    o = opts;
    pos = 0; dur = 0; paused = false; seekTarget = null; lastSave = Date.now();
    retries = 0; connectedAt = 0; stalls = [];
    p.active = true;
    $('player').classList.remove('hidden');
    $('pTitle').textContent = o.title || '';
    $('pSub').textContent = o.sub || '';
    $('pLogo').style.display = o.logo ? '' : 'none';
    if (o.logo) $('pLogo').src = o.logo;
    $('pLive').classList.toggle('hidden', !o.live);
    $('pVodKeys').innerHTML = o.keys || '';
    // rádio: tela de áudio (logo grande no meio, rodapé sempre à mostra) e as teclas dela
    $('player').classList.toggle('audio', !!o.audio);
    $('pArt').innerHTML = o.audio ? (o.logo ? '<img src="' + esc(o.logo) + '" alt=""/>' : '<span>' + esc((o.title || '?').charAt(0)) + '</span>') : '';
    $('pLive').querySelector('.hint').innerHTML = o.audio ? '▲▼ trocar rádio &nbsp;·&nbsp; <i class="k red"></i> favoritar &nbsp;·&nbsp; <i class="k ok">Voltar</i> sai'
      : '▲▼ trocar canal &nbsp;·&nbsp; 0–9 número do canal &nbsp;·&nbsp; <i class="k red"></i> favoritar';
    $('pVod').classList.toggle('hidden', !!o.live);
    message('');
    spin(true);
    update();
    showOsd();
    start();
  };

  p.close = function () {
    if (!p.active) return;
    if (!o.live && o.onprogress && pos > 0) o.onprogress(pos, dur);
    stopMedia();
    p.active = false;
    $('player').classList.add('hidden');
    $('player').classList.remove('show');
    var cb = o.onclose;
    o = null;
    if (cb) cb();
  };

  /* ---------- Áudio e legendas ---------- */

  // nomes das faixas pelo idioma que vem nelas (por, pt, eng…)
  var LANG = { por: 'Português', pt: 'Português', eng: 'Inglês', en: 'Inglês', spa: 'Espanhol', es: 'Espanhol', jpn: 'Japonês', ja: 'Japonês',
               kor: 'Coreano', ko: 'Coreano', fre: 'Francês', fra: 'Francês', fr: 'Francês', ita: 'Italiano', it: 'Italiano', ger: 'Alemão', deu: 'Alemão', de: 'Alemão' };
  function langName(l, n) { l = String(l || '').toLowerCase(); return LANG[l] || LANG[l.slice(0, 2)] || (l && l !== 'und' ? l.toUpperCase() : 'Faixa ' + n); }
  // legenda ligada; pref: o último áudio e legenda escolhidos (vale para o próximo episódio e filme)
  var subOn = false, subTimer, pref = {};
  try { pref = JSON.parse(localStorage.getItem('ctv.faixas')) || {}; } catch (e) {}
  function subText(t, ms) {
    var el = $('pSubs');
    if (!el) return;
    clearTimeout(subTimer);
    el.textContent = t || '';
    if (t && ms) subTimer = setTimeout(function () { el.textContent = ''; }, ms);
  }

  // faixas do que está tocando: { audio: [{ i, t, on }], text: [...], subOn } — na TV pelo AVPlay; no navegador, hls.js ou o <video>
  p.tracks = function () {
    var out = { audio: [], text: [], subOn: subOn }, i;
    if (!p.active) return out;
    if (avplay()) {
      try {
        var av = webapis.avplay, curA = -1, curT = -1;
        av.getCurrentStreamInfo().forEach(function (c) { if (c.type === 'AUDIO') curA = c.index; if (c.type === 'TEXT') curT = c.index; });
        av.getTotalTrackInfo().forEach(function (t) {
          var x = {};
          try { x = JSON.parse(t.extra_info); } catch (e) {}
          if (t.type === 'AUDIO') out.audio.push({ i: t.index, t: langName(x.language, out.audio.length + 1), on: t.index === curA });
          if (t.type === 'TEXT') out.text.push({ i: t.index, t: langName(x.track_lang || x.language, out.text.length + 1), on: subOn && t.index === curT });
        });
      } catch (e) {}
      return out;
    }
    if (hls && hls.audioTracks) {
      hls.audioTracks.forEach(function (a, j) { out.audio.push({ i: j, t: a.name || langName(a.lang, j + 1), on: j === hls.audioTrack }); });
      (hls.subtitleTracks || []).forEach(function (a, j) { out.text.push({ i: j, t: a.name || langName(a.lang, j + 1), on: subOn && j === hls.subtitleTrack }); });
      return out;
    }
    var v = $('vid');
    if (v.audioTracks) for (i = 0; i < v.audioTracks.length; i++) out.audio.push({ i: i, t: v.audioTracks[i].label || langName(v.audioTracks[i].language, i + 1), on: v.audioTracks[i].enabled });
    for (i = 0; i < v.textTracks.length; i++) out.text.push({ i: i, t: v.textTracks[i].label || langName(v.textTracks[i].language, i + 1), on: v.textTracks[i].mode === 'showing' });
    return out;
  };

  // tipo 'audio' ou 'text'; i = -1 desliga a legenda; nome: guardado para escolher igual no próximo vídeo
  p.setTrack = function (kind, i, name) {
    var ok = false;
    try {
      if (avplay()) {
        var av = webapis.avplay;
        if (kind === 'audio') av.setSelectTrack('AUDIO', i);
        else if (i < 0) { av.setSilentSubtitle(true); subOn = false; subText(''); }
        else { av.setSelectTrack('TEXT', i); av.setSilentSubtitle(false); subOn = true; }
        ok = true;
      } else if (hls && hls.audioTracks) {
        if (kind === 'audio') hls.audioTrack = i; else { hls.subtitleTrack = i; hls.subtitleDisplay = i >= 0; subOn = i >= 0; }
        ok = true;
      } else {
        var v = $('vid'), j;
        if (kind === 'audio' && v.audioTracks) { for (j = 0; j < v.audioTracks.length; j++) v.audioTracks[j].enabled = j === i; ok = true; }
        if (kind === 'text') { for (j = 0; j < v.textTracks.length; j++) v.textTracks[j].mode = j === i ? 'showing' : 'disabled'; subOn = i >= 0; ok = true; }
      }
    } catch (e) { ok = false; }
    if (ok) {
      pref[kind === 'audio' ? 'a' : 't'] = i < 0 ? '' : name || '';
      try { localStorage.setItem('ctv.faixas', JSON.stringify(pref)); } catch (e) {}
    }
    return ok;
  };

  // vídeo novo (TV): o mesmo idioma de áudio e de legenda escolhido antes, se ele tiver
  function applyPref() {
    if (!pref.a && !pref.t) return;
    setTimeout(function () {
      var tr = p.tracks(), a = find(tr.audio, function (x) { return x.t === pref.a; }), t = find(tr.text, function (x) { return x.t === pref.t; });
      if (a && !a.on) p.setTrack('audio', a.i, a.t);
      if (t) p.setTrack('text', t.i, t.t);
    }, 800);
  }

  // o app redesenha o rodapé (barra de opções do ao vivo); keep: não some sozinho
  p.osd = function (keep) { if (p.active) showOsd(keep); };

  p.key = function (k) {
    if (!p.active) return false;
    showOsd(paused);
    if (k === K.BACK || k === K.ESC || k === K.BACKSPACE || k === K.STOP) p.close();
    else if (k === K.RED) { if (o.onfav) o.onfav(); }
    else if (k === K.YELLOW && !o.live) { if (o.ontracks) o.ontracks(); }
    else if (k === K.GREEN && !o.live) { if (o.oneps) o.oneps(); }
    else if ((k === K.CH_UP || k === K.CH_DOWN) && !o.live) { if (o.onnext) o.onnext(k === K.CH_UP ? 1 : -1); }
    else if (k === K.GREEN && o.live) { if (o.onduo) o.onduo(); }
    else if (k === K.YELLOW && o.live) { if (o.onquality) o.onquality(); }
    else if (o.live) {
      if (k === K.UP || k === K.CH_DOWN) { if (o.onzap) o.onzap(-1); }
      else if (k === K.DOWN || k === K.CH_UP) { if (o.onzap) o.onzap(1); }
    }
    else if (k === K.LEFT || k === K.RW) seek(-1);
    else if (k === K.RIGHT || k === K.FF) seek(1);
    else if (k === K.ENTER || k === K.PLAY_PAUSE) togglePause();
    else if ((k === K.PLAY && paused) || (k === K.PAUSE && !paused)) togglePause();
    return true;
  };

  return p;
})();
