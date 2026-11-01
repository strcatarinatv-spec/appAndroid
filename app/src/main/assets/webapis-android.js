/* No Android TV o app é o mesmo da Samsung: este arquivo faz o papel do webapis.js da TV.
 * webapis.avplay (e avplaystore.getPlayer, da tela dupla) viram players ExoPlayer do lado Android (window.AndroidAv),
 * que mandam os eventos de volta por window.__av(id, evento, a, b). Teclas do controle que o WebView não entrega
 * (Voltar, cores, CH, mídia) chegam por window.__key(codigo, desceu) com os códigos da Samsung. */
(function () {
  var A = window.AndroidAv;
  if (!A) return;
  var ps = [];

  function player() {
    var id = ps.length, s = { l: {}, ok: null, fail: null };
    ps.push(s);
    var nada = function () {};
    return {
      open: function (url) { A.open(id, url); },
      setDisplayRect: function (x, y, w, h) { A.rect(id, x, y, w, h); },
      setListener: function (l) { s.l = l || {}; },
      prepareAsync: function (ok, fail) { s.ok = ok; s.fail = fail; A.prepare(id); },
      play: function () { A.play(id); },
      pause: function () { A.pause(id); },
      stop: function () { A.stop(id); },
      close: function () { s.ok = s.fail = null; A.close(id); },
      seekTo: function (ms, ok) { A.seek(id, ms); if (ok) setTimeout(ok, 0); },
      getDuration: function () { return A.duration(id); },
      getTotalTrackInfo: function () { return JSON.parse(A.tracks(id)); },
      getCurrentStreamInfo: function () { return JSON.parse(A.current(id)); },
      setSelectTrack: function (type, i) { A.select(id, type, i); },
      setSilentSubtitle: function (b) { A.silentSub(id, !!b); },
      enableAudioStream: function () { A.sound(id, true); },
      disableAudioStream: function () { A.sound(id, false); },
      setStreamingProperty: nada
    };
  }

  window.__av = function (id, ev, a, b) {
    var s = ps[id];
    if (!s) return;
    if (ev === 'prepared' || ev === 'preparefail') {
      var cb = ev === 'prepared' ? s.ok : s.fail;
      s.ok = s.fail = null;
      if (cb) cb();
      return;
    }
    if (s.l[ev]) s.l[ev](a, b);
  };

  // tecla como se viesse do controle da Samsung (o app olha só o keyCode)
  window.__key = function (code, down) {
    var e = document.createEvent('Event');
    e.initEvent(down ? 'keydown' : 'keyup', true, true);
    e.keyCode = e.which = code;
    (document.activeElement || document).dispatchEvent(e);
  };

  // a página é desenhada em 1920×1080: escala para o tamanho da tela (o player nativo usa a mesma conta).
  // Ao abrir, o WebView ainda pode estar sem tamanho (largura 0): o Android chama __zoom de novo quando ele aparece
  window.__zoom = function () {
    var w = window.innerWidth;
    if (w > 0) document.documentElement.style.zoom = w / 1920;
  };
  __zoom();
  window.addEventListener('resize', __zoom);
  document.addEventListener('DOMContentLoaded', __zoom);

  var principal = player();
  window.webapis = {
    avplay: principal,
    avplaystore: { getPlayer: player },
    productinfo: { getRealModel: function () { return A.model(); } },
    network: { getMac: function () { return ''; } }
  };
  window.tizen = {
    tvinputdevice: { registerKey: function () {} },
    application: { getCurrentApplication: function () { return { exit: function () { A.exit(); } }; } }
  };
})();
