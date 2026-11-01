/* Controle pelo celular: a página firebase/painel/controle (aberta pelo QR dos Ajustes ou pelo portal) manda
 * as teclas pelo Realtime Database do Firebase e a TV recebe na hora (EventSource), como se viessem do controle.
 * O QR leva uma chave secreta (ctv.rc): quem tem a chave controla esta TV; "Gerar novo código" corta os celulares antigos.
 * /controle/{chave} = { tv: uid, nome: código da TV, ev: [[n, tecla, 1 apertou | 0 soltou], …] (os últimos 20),
 *   s: hora em que o servidor mudou algo desta TV (a TV lê o portal na hora: modo de baixo custo) }. ES5 de propósito. */
var Controle = (function () {
  var DB = 'https://catarinatv-9f7a3-default-rtdb.firebaseio.com';
  var PAGE = 'https://catarinatv-9f7a3.firebaseapp.com/controle/';
  // teste sem internet no PC/iPad: abrir o app com ?local=1 usa o banco de mentira do dev/serve.mjs e a página dele
  var DEV = !window.webapis && /[?&]local=1/.test(location.search);
  if (DEV) { DB = location.origin + '/rtdb'; PAGE = (window.CTV_LAN || location.origin) + '/controle/'; }

  var c = { key: localStorage.getItem('ctv.rc') || '' }, es = null, seen = {}, rep = null;

  function rnd() {
    var a = new Uint8Array(15), s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += ('0' + a[i].toString(16)).slice(-2);
    return s;
  }
  function url(path, t) { return DB + path + '.json' + (t ? '?auth=' + encodeURIComponent(t) : ''); }
  function token() { return DEV ? Promise.resolve('') : Fire.auth(); }
  function put(path, v, t) {
    return new Promise(function (ok, no) {
      var x = new XMLHttpRequest();
      x.open('PUT', url(path, t), true);
      x.onload = function () { if (x.status < 300) ok(); else no(new Error('Controle HTTP ' + x.status)); };
      x.onerror = function () { no(new Error('Sem conexão')); };
      x.send(JSON.stringify(v));
    });
  }

  // a tecla entra como se viesse do controle (js/nav.js lê e.keyCode no document)
  function send(type, k) {
    var e = document.createEvent('Event');
    e.initEvent(type, true, true);
    e.keyCode = k;
    (document.activeElement || document).dispatchEvent(e);
  }
  function stop() { if (rep) { clearTimeout(rep.t); clearInterval(rep.i); rep = null; } }
  function key(k, down) {
    stop();
    send(down ? 'keydown' : 'keyup', k);
    // seta apertada: repete como o controle de verdade até soltar (no máximo 5 s, se o "soltou" se perder)
    if (down && k >= 37 && k <= 40) {
      var r = rep = { n: 0 };
      r.t = setTimeout(function () { r.i = setInterval(function () { if (++r.n > 45) stop(); else send('keydown', k); }, 110); }, 400);
    }
  }
  // só os eventos ainda não vistos, na ordem; ao conectar, os que já estavam lá ficam como vistos
  function take(ev, first) {
    var now = {};
    (ev || []).forEach(function (e) {
      if (!e) return;
      now[e[0]] = 1;
      if (!first && !seen[e[0]]) key(+e[1], +e[2] === 1);
    });
    seen = now;
  }

  function listen() {
    if (es) es.close();
    es = null;
    token().then(function (t) {
      var first = true, s = es = new EventSource(url('/controle/' + c.key, t));
      s.onopen = function () { first = true; };
      var on = function (m) {
        var d; try { d = JSON.parse(m.data); } catch (err) { return; }
        if (!d) return;
        if (d.path === '/') take(d.data && d.data.ev, first);
        else if (d.path === '/ev') take(d.data, false);
        // s: o servidor avisa que algo desta TV mudou no portal (modo de baixo custo: a TV só lê o Firestore aí)
        else if (d.path === '/s' && c.onsinal) c.onsinal();
        first = false;
      };
      s.addEventListener('put', on);
      s.addEventListener('patch', on);
      // o login vence em 1 h: o banco corta a conexão e ela volta com um token novo
      s.addEventListener('auth_revoked', listen);
      s.addEventListener('cancel', function () { s.close(); setTimeout(listen, 60000); });
    }, function () { setTimeout(listen, 60000); });
  }

  // registra a chave desta TV no banco (e no portal, que abre o controle pelo cartão da TV) e começa a ouvir
  c.start = function () {
    if (!window.EventSource || !Fire.enabled) return;
    if (!c.key) { c.key = rnd(); localStorage.setItem('ctv.rc', c.key); }
    Fire.auth().then(token).then(function (t) {
      return put('/controle/' + c.key + '/tv', Fire.uid, t).then(function () { return put('/controle/' + c.key + '/nome', Fire.code(), t); });
    }).then(function () { Fire.set('tvs/' + Fire.uid, { rc: c.key }).catch(function () {}); listen(); },
      function () { setTimeout(c.start, 60000); });
  };

  // chave nova: os celulares pareados antes deixam de controlar esta TV
  c.novo = function () {
    var old = c.key;
    if (es) es.close();
    c.key = rnd();
    localStorage.setItem('ctv.rc', c.key);
    token().then(function (t) { return put('/controle/' + old, null, t); }).catch(function () {});
    c.start();
  };

  c.link = function () { return PAGE + '#' + c.key; };
  return c;
})();
