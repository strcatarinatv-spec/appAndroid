/* Navegação pelo controle remoto: foco espacial entre elementos .f
 * - o foco vai para o vizinho mais próximo na direção da seta
 * - [data-group] lembra o último item focado (fileiras, menu lateral)
 * - el._key(k) permite que um componente trate as teclas antes (listas)
 * - OK segurado: onde nav.canHold(el) diz que dá, o toque só vale ao soltar e segurar chama nav.onhold */
var Nav = (function () {
  var K = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27, BACKSPACE: 8,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406, CH_UP: 427, CH_DOWN: 428, INFO: 457,
    PLAY: 415, PAUSE: 19, PLAY_PAUSE: 10252, STOP: 413, FF: 417, RW: 412, PRE_CH: 10190,
    DONE: 65376, CANCEL: 65385
  };
  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  // teclado do PC fazendo as vezes do controle (testes no navegador)
  var PC_KEYS = window.webapis ? {} : { 82: K.RED, 71: K.GREEN, 89: K.YELLOW, 66: K.BLUE, 33: K.CH_UP, 34: K.CH_DOWN, 32: K.PLAY_PAUSE, 73: K.INFO, 80: K.PRE_CH }; // R G Y B = cores
  var nav = { K: K, cur: null, scope: document.body };
  var hold = null, HOLD_MS = 600; // { el, timer, fired }

  function usable(el) { return nav.scope.contains(el) && el.offsetParent !== null; }
  function group(el) { return el.closest('[data-group]'); }

  function reveal(el) {
    var track = el.closest('.track');
    if (track) {
      var pad = track._pad || (track._pad = parseInt(getComputedStyle(track).paddingLeft, 10) || 0);
      var x = el.offsetLeft, w = el.offsetWidth, sl = track.scrollLeft, vw = track.clientWidth;
      if (x - pad < sl) track.scrollLeft = x - pad;
      else if (x + w + 60 > sl + vw) track.scrollLeft = x + w + 60 - vw;
    }
    var vs = el.closest('.vscroll');
    if (vs) {
      var row = el.closest('.row') || el;
      vs.scrollTop = Math.max(0, row.offsetTop - (parseInt(vs.getAttribute('data-pad'), 10) || 0));
    }
  }

  nav.focus = function (el) {
    if (!el) return;
    if (nav.cur) nav.cur.classList.remove('focus');
    nav.cur = el;
    el.classList.add('focus');
    var g = group(el);
    if (g) g._last = el;
    if (nav.onfocus) nav.onfocus(el); // antes de rolar: pode carregar mais fileiras
    reveal(el);
  };

  nav.first = function (root) {
    var list = (root || nav.scope).querySelectorAll('.f');
    for (var i = 0; i < list.length; i++) if (usable(list[i])) return list[i];
    return null;
  };

  nav.move = function (dir) {
    var cur = nav.cur;
    if (!cur || !usable(cur)) { nav.focus(nav.first()); return; }
    var a = cur.getBoundingClientRect(), best = null, bestScore = Infinity;
    var list = nav.scope.querySelectorAll('.f');

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur || !usable(el)) continue;
      var b = el.getBoundingClientRect(), main, cross;
      if (dir === 'left' || dir === 'right') {
        main = dir === 'left' ? a.left - b.right : b.left - a.right;
        cross = Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom)) +
          Math.abs(a.top + a.bottom - b.top - b.bottom) / 20;
      } else {
        main = dir === 'up' ? a.top - b.bottom : b.top - a.bottom;
        cross = Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right)) +
          Math.abs(a.left + a.right - b.left - b.right) / 4;
      }
      if (main < -20) continue; // tolera a sobreposição do item focado (escala)
      var score = Math.max(main, 0) + cross * 3;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return;

    // entrando em outro grupo: volta para onde estava nele
    var g = group(best);
    if (g && g !== group(cur) && g._last && g.contains(g._last) && usable(g._last)) best = g._last;
    nav.focus(best);
  };

  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, ae = document.activeElement;

    // campo de texto com o teclado virtual aberto
    if (ae && ae.tagName === 'INPUT') {
      if (k === K.UP || k === K.DOWN) { ae.blur(); nav.move(DIRS[k]); e.preventDefault(); }
      else if (k === K.DONE || k === K.ENTER) { ae.blur(); if (ae._done) ae._done(); e.preventDefault(); }
      else if (k === K.CANCEL || k === K.BACK || k === K.ESC) { ae.blur(); e.preventDefault(); }
      return;
    }

    if (k >= 112 && k <= 123) return; // F1–F12 (DevTools/recarregar no navegador)
    k = PC_KEYS[k] || k;
    e.preventDefault();
    if (nav.onkey && nav.onkey(k)) return;
    var cur = nav.cur && usable(nav.cur) ? nav.cur : null;
    if (cur && cur._key && cur._key(k)) return;

    if (k === K.ENTER && hold) return; // o controle repete a tecla enquanto ela está apertada
    if (DIRS[k]) nav.move(DIRS[k]);
    else if (k === K.ENTER && cur) {
      if (cur.tagName === 'INPUT') cur.focus();
      else if (nav.onhold && nav.canHold && nav.canHold(cur)) {
        hold = { el: cur, fired: false };
        hold.timer = setTimeout(function () { hold.fired = true; nav.onhold(hold.el); }, HOLD_MS);
      }
      else enter(cur);
    }
    else if (k === K.BACK || k === K.ESC || k === K.BACKSPACE) { if (nav.onback) nav.onback(); }
    else if (nav.onother) nav.onother(k, cur);
  });

  function enter(el) {
    if (el._enter) el._enter();
    else if (nav.onenter) nav.onenter(el);
  }

  // soltou o OK antes do tempo de segurar: foi um toque
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== K.ENTER || !hold) return;
    var h = hold;
    hold = null;
    clearTimeout(h.timer);
    if (!h.fired) enter(h.el);
  });

  // ponteiro (Smart Remote) e mouse para testes no navegador
  document.addEventListener('click', function (e) {
    var el = e.target.closest && e.target.closest('.f');
    if (!el || !usable(el)) return;
    nav.focus(el);
    if (el.tagName === 'INPUT') el.focus();
    else enter(el);
  });

  return nav;
})();
