/* Utilitários, acesso ao servidor e estado sincronizado na nuvem.
 * ES5 de propósito: roda em TVs Samsung a partir de 2017. */

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function find(list, fn) {
  for (var i = 0; i < list.length; i++) if (fn(list[i], i)) return list[i];
  return null;
}

function pad2(n) { return n < 10 ? '0' + n : '' + n; }

// grava no localStorage sem derrubar nada se a cota (uns 5 MB) estiver cheia; false se não gravou
function store(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

function fmtTime(ms) {
  var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60);
}

var Api = (function () {
  var api = {};

  // baixa uma lista: do próprio pacote do app (lista padrão) ou de um link
  // onprog(baixado, total): total 0 quando o servidor não informa o tamanho
  api.getText = function (url, onprog) {
    // no PC o navegador bloqueia downloads de outros sites: quem baixa é o dev/serve.mjs
    var viaPc = !window.webapis && /^https?:\/\//i.test(url);
    if (viaPc) url = '/proxy?url=' + encodeURIComponent(url);
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest(), idle;
      // sem prazo para o total (lista com filmes e séries passa de 50 MB numa internet lenta): desiste só se ficar
      // 60 s sem chegar nada (3 min até o primeiro byte, o fornecedor pode demorar para montar a lista)
      var wait = function (ms) { clearTimeout(idle); idle = setTimeout(function () { x.abort(); fail('A lista parou de chegar (sem dados por ' + ms / 1000 + ' s)', 'lenta'); }, ms); };
      var fail = function (msg, tipo) { clearTimeout(idle); var e = new Error(msg); e.tipo = tipo; e.status = x.status; reject(e); };
      x.open('GET', url, true);
      x.onprogress = function (e) { wait(60000); if (onprog) onprog(e.loaded, e.lengthComputable ? e.total : 0); };
      x.onload = function () {
        clearTimeout(idle);
        var s = x.status;
        // arquivo do pacote na TV (file://) responde com status 0
        if ((s >= 200 && s < 300) || (s === 0 && x.responseText)) resolve(x.responseText);
        else if (viaPc && s === 502 && x.responseText) fail(x.responseText, 'rede');
        else if (viaPc && s === 404) fail('Rode o app no PC com: node dev/serve.mjs', 'rede');
        else if (s === 401) fail('O fornecedor recusou o usuário ou a senha (HTTP 401)', 'recusada');
        else if (s === 403) fail('O fornecedor recusou o acesso (HTTP 403): assinatura bloqueada, vencida ou aparelho não aceito', 'recusada');
        else if (s === 404) fail('O fornecedor não achou a lista (HTTP 404)', 'recusada');
        else if (s >= 500) fail('O fornecedor está com problema (HTTP ' + s + ')', 'fornecedor');
        else fail('A lista respondeu HTTP ' + s, 'fornecedor');
      };
      x.onerror = function () { fail(viaPc ? 'O servidor do PC (dev/serve.mjs) não está rodando' : 'Não consegui falar com o fornecedor. Confira a internet', 'rede'); };
      x.send(null);
      wait(180000);
    });
  };

  return api;
})();

/* Favoritos, histórico (com o ponto onde parou cada vídeo) e preferências.
 * Ficam no Firebase e numa cópia local, para abrir rápido e não perder nada se a
 * internet cair: o que mudou sem rede sobe quando ela volta.
 * Base: tvs/{uid} (TV sem cliente) ou clientes/{c}/perfis/{p} (perfil escolhido), ver cloud.use. */
var Cloud = (function () {
  var KEYS = ['favs', 'history', 'settings'];
  // o histórico muda a cada 15 s durante um vídeo: sobe no máximo 1 vez por minuto (e ao fechar)
  var DELAY = { favs: 2000, history: 60000, settings: 2000 };
  var cloud = { state: { favs: {}, history: [], settings: {} } }, timers = {}, pending;
  var base = '', stateKey = 'ctv.state', pendKey = 'ctv.pending'; // base '' = tvs/{uid}
  pending = readJSON(pendKey) || {};

  function readJSON(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }

  function local() {
    // versões anteriores guardavam o modo aberto à parte
    return readJSON(stateKey) || (base ? null : readJSON('ctv.state.open')) || {};
  }
  function keepLocal() {
    store(stateKey, JSON.stringify(cloud.state));
    store(pendKey, JSON.stringify(pending));
  }

  function apply(s) {
    cloud.state.favs = s.favs || {};
    cloud.state.history = s.history || [];
    cloud.state.settings = s.settings || {};
  }

  function path(key) { return (base || 'tvs/' + Fire.uid) + '/state/' + key; }

  cloud.load = function () {
    apply(local());
    if (!Fire.enabled) return Promise.resolve();
    return Fire.auth().then(function () {
      return Promise.all(KEYS.map(function (k) { return Fire.get(path(k)); }));
    }).then(function (docs) {
      KEYS.forEach(function (k, i) {
        var doc = docs[i], mine = cloud.state[k];
        var hasLocal = k === 'history' ? mine.length : Object.keys(mine).length;
        // o que mudou sem internet (ou nunca subiu) tem prioridade sobre a nuvem
        if (pending[k] || (!doc && hasLocal)) return cloud.save(k);
        if (doc && doc.v) cloud.state[k] = doc.v;
      });
      keepLocal();
    }, function () {}); // sem internet: segue com a cópia local
  };

  function push(key) {
    timers[key] = null;
    if (!Fire.enabled) return;
    // a resposta pode chegar depois de trocar de perfil: limpa a pendência da base em que foi gravado
    var myBase = base, myPending = pending, myPendKey = pendKey;
    Fire.set(path(key), { v: cloud.state[key], at: Date.now() }).then(function () {
      delete myPending[key];
      store(myPendKey, JSON.stringify(myPending));
    }, function () {
      if (base === myBase) timers[key] = setTimeout(function () { push(key); }, 60000); // tenta de novo
    });
  }

  // passa a usar outra base: o que estava pendente na anterior sobe antes; id separa a cópia local
  cloud.use = function (newBase, id) {
    cloud.flush();
    for (var k in timers) clearTimeout(timers[k]);
    timers = {};
    base = newBase || '';
    stateKey = id ? 'ctv.state.' + id : 'ctv.state';
    pendKey = id ? 'ctv.pending.' + id : 'ctv.pending';
    pending = readJSON(pendKey) || {};
    return cloud.load();
  };

  // grava o estado atual em outra base (ex.: o perfil "Principal" nasce com o que a TV já tinha)
  cloud.copyTo = function (otherBase) {
    return Promise.all(KEYS.map(function (k) {
      return Fire.set(otherBase + '/state/' + k, { v: cloud.state[k], at: Date.now() });
    }));
  };

  cloud.save = function (key) {
    pending[key] = 1;
    keepLocal();
    if (!timers[key]) timers[key] = setTimeout(function () { push(key); }, DELAY[key]);
  };

  cloud.flush = function () {
    for (var k in pending) { clearTimeout(timers[k]); push(k); }
  };

  return cloud;
})();
