/* QR Code feito na própria TV, sem serviço de fora (o link leva o MAC da TV).
 * Modo byte, correção M, versões 1–10 (até 213 bytes). QR.svg(texto, px) → '<svg …>' ou '' se não couber.
 * QR.matrix(texto) → linhas de 0/1 (para testes). ES5 de propósito. */
var QR = (function () {
  // por versão (nível M): [blocos do grupo 1, dados por bloco, blocos do grupo 2, dados por bloco, correção por bloco]
  var BLOCKS = [null, [1, 16, 0, 0, 10], [1, 28, 0, 0, 16], [1, 44, 0, 0, 26], [2, 32, 0, 0, 18], [2, 43, 0, 0, 24],
    [4, 27, 0, 0, 16], [4, 31, 0, 0, 18], [2, 38, 2, 39, 22], [3, 36, 2, 37, 22], [4, 43, 1, 44, 26]];
  var ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // aritmética do campo GF(256) usada pela correção de erros (Reed-Solomon)
  var EXP = [], LOG = [];
  (function () {
    for (var i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }

  function rsGen(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = [];
      for (var j = 0; j <= g.length; j++) ng[j] = (j < g.length ? g[j] : 0) ^ (j > 0 ? mul(g[j - 1], EXP[i]) : 0);
      g = ng;
    }
    return g;
  }

  function rsRem(data, n) {
    var g = rsGen(n), r = [], i, j;
    for (i = 0; i < n; i++) r.push(0);
    for (i = 0; i < data.length; i++) {
      var f = data[i] ^ r.shift();
      r.push(0);
      for (j = 0; j < n; j++) r[j] ^= mul(g[j + 1], f);
    }
    return r;
  }

  function utf8(s) {
    var u = unescape(encodeURIComponent(s)), out = [];
    for (var i = 0; i < u.length; i++) out.push(u.charCodeAt(i));
    return out;
  }

  // dados + correção, já intercalados por bloco
  function codewords(text) {
    var bytes = utf8(text), v, b, cap;
    for (v = 1; v <= 10; v++) {
      b = BLOCKS[v];
      cap = b[0] * b[1] + b[2] * b[3];
      if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= cap * 8) break;
    }
    if (v > 10) return null;
    var bits = [], i, j;
    function put(val, len) { for (var k = len - 1; k >= 0; k--) bits.push((val >>> k) & 1); }
    put(4, 4); // modo byte
    put(bytes.length, v < 10 ? 8 : 16);
    for (i = 0; i < bytes.length; i++) put(bytes[i], 8);
    put(0, Math.min(4, cap * 8 - bits.length));
    while (bits.length % 8) bits.push(0);
    var data = [];
    for (i = 0; i < bits.length; i += 8) { var x = 0; for (j = 0; j < 8; j++) x = x << 1 | bits[i + j]; data.push(x); }
    for (i = 0; data.length < cap; i++) data.push(i % 2 ? 0x11 : 0xEC);

    var blocks = [], ecs = [], at = 0, n = b[4];
    for (var g = 0; g < 2; g++) {
      for (var c = 0; c < b[g * 2]; c++) {
        var blk = data.slice(at, at + b[g * 2 + 1]);
        at += blk.length;
        blocks.push(blk);
        ecs.push(rsRem(blk, n));
      }
    }
    var out = [], longest = b[3] || b[1];
    for (i = 0; i < longest; i++) for (j = 0; j < blocks.length; j++) if (i < blocks[j].length) out.push(blocks[j][i]);
    for (i = 0; i < n; i++) for (j = 0; j < ecs.length; j++) out.push(ecs[j][i]);
    return { v: v, cw: out };
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function build(v, cw, mask) {
    var size = v * 4 + 17, m = [], fn = [], x, y, i, dx, dy;
    for (y = 0; y < size; y++) { m.push([]); fn.push([]); for (x = 0; x < size; x++) { m[y].push(0); fn[y].push(false); } }
    function set(px, py, dark) { m[py][px] = dark ? 1 : 0; fn[py][px] = true; }

    // localizadores (com a margem clara), linhas de sincronia e padrões de alinhamento
    function finder(cx, cy) {
      for (dy = -4; dy <= 4; dy++) for (dx = -4; dx <= 4; dx++) {
        x = cx + dx; y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
    for (i = 8; i < size - 8; i++) { set(i, 6, i % 2 === 0); set(6, i, i % 2 === 0); }
    var al = ALIGN[v], last = al.length - 1;
    for (var a = 0; a < al.length; a++) for (var c = 0; c < al.length; c++) {
      if ((a === 0 && c === 0) || (a === 0 && c === last) || (a === last && c === 0)) continue;
      for (dy = -2; dy <= 2; dy++) for (dx = -2; dx <= 2; dx++) set(al[a] + dx, al[c] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    // formato (nível M + máscara) nas duas cópias, e o módulo escuro fixo
    var fdata = mask, rem = fdata; // nível M = 00
    for (i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var f = (fdata << 10 | rem) ^ 0x5412, bit = function (k) { return (f >>> k) & 1; };
    for (i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
    for (i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, 1);

    // número da versão (a partir da 7)
    if (v >= 7) {
      var r = v;
      for (i = 0; i < 12; i++) r = (r << 1) ^ ((r >>> 11) * 0x1F25);
      var vb = v << 12 | r;
      for (i = 0; i < 18; i++) {
        var on = (vb >>> i) & 1, p = size - 11 + i % 3, q = Math.floor(i / 3);
        set(p, q, on); set(q, p, on);
      }
    }

    // dados em zigue-zague de baixo para cima, pulando a coluna de sincronia
    var idx = 0, total = cw.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) for (var j = 0; j < 2; j++) {
        x = right - j;
        y = ((right + 1) & 2) === 0 ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        if (idx < total) { m[y][x] = (cw[idx >>> 3] >>> (7 - (idx & 7))) & 1; idx++; }
        if (MASKS[mask](x, y)) m[y][x] ^= 1;
      }
    }
    return m;
  }

  // nota de "dificuldade de leitura" da norma: a máscara com a menor nota vence
  function penalty(m) {
    var size = m.length, score = 0, dark = 0, x, y;
    function lines(get) {
      for (var a = 0; a < size; a++) {
        var run = 1, seq = '';
        for (var b = 0; b < size; b++) {
          var c = get(a, b);
          seq += c;
          if (b > 0 && c === get(a, b - 1)) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
        }
        var re = /(?=10111010000|00001011101)/g;
        while (re.exec(seq)) { score += 40; re.lastIndex++; }
      }
    }
    lines(function (a, b) { return m[a][b]; });
    lines(function (a, b) { return m[b][a]; });
    for (y = 0; y < size - 1; y++) for (x = 0; x < size - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
    }
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) dark += m[y][x];
    var total = size * size;
    score += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return score;
  }

  function matrix(text) {
    var e = codewords(text);
    if (!e) return null;
    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      var m = build(e.v, e.cw, mask), s = penalty(m);
      if (s < bestScore) { bestScore = s; best = m; }
    }
    return best;
  }

  function svg(text, px) {
    var m = matrix(text);
    if (!m) return '';
    var n = m.length, q = 4, d = '';
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) if (m[y][x]) d += 'M' + (x + q) + ' ' + (y + q) + 'h1v1h-1z';
    return '<svg class="qr" width="' + px + '" height="' + px + '" viewBox="0 0 ' + (n + 2 * q) + ' ' + (n + 2 * q) +
      '" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
  }

  return { svg: svg, matrix: matrix };
})();
