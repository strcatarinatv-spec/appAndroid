/* Firebase pela API REST: a TV entra como usuário anônimo e lê/grava os próprios dados no Firestore.
 * Sem o SDK oficial, que não roda nos navegadores das TVs Samsung mais antigas. ES5 de propósito. */
var Fire = (function () {
  // mesma configuração de firebase/painel/config.js (não é segredo: quem protege são as regras)
  var CFG = { apiKey: 'AIzaSyCAB5Bo1W0gdnts6JCvpoq_-VsPcUbjcU8', projectId: 'catarinatv-9f7a3' };
  var DOCS = 'https://firestore.googleapis.com/v1/projects/' + CFG.projectId + '/databases/(default)/documents/';

  var fire = { uid: localStorage.getItem('ctv.fb.uid') || '' };
  var refreshToken = localStorage.getItem('ctv.fb.refresh') || '';
  var idToken = '', idExpires = 0, signing = null;

  // teste no navegador com ?lista= (fornecedor de mentira): sem portal, para não criar uma "TV" nova a cada endereço testado
  fire.enabled = CFG.apiKey !== 'PREENCHER' && !(!window.webapis && /[?&]lista=/.test(location.search));

  function request(method, url, body, token, form) {
    return new Promise(function (resolve, reject) {
      var x = new XMLHttpRequest();
      x.open(method, url, true);
      x.timeout = 20000;
      if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
      x.setRequestHeader('Content-Type', form ? 'application/x-www-form-urlencoded' : 'application/json');
      x.onload = function () {
        var data = null;
        try { data = JSON.parse(x.responseText); } catch (e) {}
        if (x.status >= 200 && x.status < 300) return resolve(data);
        var err = new Error((data && data.error && data.error.message) || 'Firebase HTTP ' + x.status);
        err.status = x.status;
        reject(err);
      };
      x.onerror = x.ontimeout = function () { var err = new Error('Sem conexão'); err.status = 0; reject(err); };
      x.send(form || (body === undefined ? null : JSON.stringify(body)));
    });
  }

  function keep(r) {
    idToken = r.idToken || r.id_token;
    idExpires = Date.now() + (+(r.expiresIn || r.expires_in) - 120) * 1000;
    refreshToken = r.refreshToken || r.refresh_token;
    fire.uid = r.localId || r.user_id;
    // localStorage cheio não pode travar o login (a exceção deixaria a promessa do token presa)
    try { localStorage.setItem('ctv.fb.uid', fire.uid); localStorage.setItem('ctv.fb.refresh', refreshToken); } catch (e) {}
  }

  // token válido; na primeira vez cria o usuário anônimo da TV (o uid fica salvo e não muda)
  fire.auth = function () {
    if (!fire.enabled) return Promise.reject(new Error('Firebase não configurado'));
    if (idToken && Date.now() < idExpires) return Promise.resolve(idToken);
    if (signing) return signing;
    var p = refreshToken
      ? request('POST', 'https://securetoken.googleapis.com/v1/token?key=' + CFG.apiKey, undefined, null,
          'grant_type=refresh_token&refresh_token=' + encodeURIComponent(refreshToken))
      : request('POST', 'https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + CFG.apiKey, { returnSecureToken: true });
    signing = p.then(function (r) { keep(r); signing = null; return idToken; }, function (e) {
      signing = null;
      // usuário apagado no Firebase: começa de novo como uma TV nova
      if (refreshToken && (e.status === 400 || e.status === 403)) { refreshToken = ''; return fire.auth(); }
      throw e;
    });
    return signing;
  };

  /* valores do Firestore ↔ JavaScript */

  function enc(v) {
    if (v === null || v === undefined) return { nullValue: null };
    if (typeof v === 'boolean') return { booleanValue: v };
    if (typeof v === 'number') return v % 1 === 0 ? { integerValue: String(v) } : { doubleValue: v };
    if (typeof v === 'string') return { stringValue: v };
    if (v instanceof Array) return { arrayValue: { values: v.map(enc) } };
    var fields = {};
    for (var k in v) if (v.hasOwnProperty(k) && v[k] !== undefined) fields[k] = enc(v[k]);
    return { mapValue: { fields: fields } };
  }

  function dec(v) {
    if ('stringValue' in v) return v.stringValue;
    if ('integerValue' in v) return +v.integerValue;
    if ('doubleValue' in v) return v.doubleValue;
    if ('booleanValue' in v) return v.booleanValue;
    if ('timestampValue' in v) return Date.parse(v.timestampValue);
    if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
    if ('mapValue' in v) return decFields(v.mapValue.fields || {});
    return null;
  }

  function decFields(f) {
    var o = {};
    for (var k in f) o[k] = dec(f[k]);
    return o;
  }

  // documento como objeto, ou null se não existe
  fire.get = function (path) {
    return fire.auth().then(function (t) { return request('GET', DOCS + path, undefined, t); })
      .then(function (d) { return decFields(d.fields || {}); }, function (e) { if (e.status === 404) return null; throw e; });
  };

  // documentos de uma coleção: [{ id, ...campos }] (vazia: [])
  fire.list = function (path) {
    return fire.auth().then(function (t) { return request('GET', DOCS + path + '?pageSize=100', undefined, t); })
      .then(function (r) {
        return ((r && r.documents) || []).map(function (d) {
          var o = decFields(d.fields || {});
          o.id = d.name.split('/').pop();
          return o;
        });
      });
  };

  // grava só os campos passados (os outros continuam como estão; cria o documento se não existir)
  fire.set = function (path, data) {
    var mask = [], fields = {};
    for (var k in data) { mask.push('updateMask.fieldPaths=' + encodeURIComponent(k)); fields[k] = enc(data[k]); }
    return fire.auth().then(function (t) { return request('PATCH', DOCS + path + '?' + mask.join('&'), { fields: fields }, t); });
  };

  // código curto que aparece na TV e no painel para saber qual TV é qual
  fire.code = function () {
    var s = fire.uid.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/[0O1I]/g, '');
    return s ? s.slice(0, 3) + '-' + s.slice(3, 6) : '';
  };

  return fire;
})();
