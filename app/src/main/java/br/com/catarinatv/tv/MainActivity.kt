package br.com.catarinatv.tv

import android.app.Activity
import android.app.AlertDialog
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageInstaller
import android.graphics.Color
import android.net.Uri
import android.provider.Settings
import android.widget.Toast
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.TrackSelectionOverride
import androidx.media3.common.Tracks
import androidx.media3.common.text.CueGroup
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream
import kotlin.concurrent.thread

/* O app da Samsung (assets/www) num WebView transparente; os vídeos (ExoPlayer) ficam atrás dele, como o AVPlay na TV.
 * O JS fala com os players por window.AndroidAv (webapis-android.js faz dele o webapis.avplay). */
class MainActivity : Activity() {
    private lateinit var tela: FrameLayout
    private lateinit var web: WebView
    private val ui = Handler(Looper.getMainLooper())
    private val players = HashMap<Int, Av>()

    // teclas do controle que o WebView não entrega ao app, com os códigos da Samsung (js/nav.js)
    private val teclas = mapOf(
        KeyEvent.KEYCODE_BACK to 10009,
        KeyEvent.KEYCODE_PROG_RED to 403, KeyEvent.KEYCODE_PROG_GREEN to 404,
        KeyEvent.KEYCODE_PROG_YELLOW to 405, KeyEvent.KEYCODE_PROG_BLUE to 406,
        KeyEvent.KEYCODE_CHANNEL_UP to 427, KeyEvent.KEYCODE_CHANNEL_DOWN to 428,
        KeyEvent.KEYCODE_PAGE_UP to 427, KeyEvent.KEYCODE_PAGE_DOWN to 428,
        KeyEvent.KEYCODE_INFO to 457, KeyEvent.KEYCODE_LAST_CHANNEL to 10190,
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE to 10252, KeyEvent.KEYCODE_MEDIA_PLAY to 415,
        KeyEvent.KEYCODE_MEDIA_PAUSE to 19, KeyEvent.KEYCODE_MEDIA_STOP to 413,
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD to 417, KeyEvent.KEYCODE_MEDIA_REWIND to 412
    )

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        tela = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
        web = WebView(this).apply {
            setBackgroundColor(Color.TRANSPARENT)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = true
            // a página é file:// e busca a lista, o Firebase e o TMDb direto (como na TV, sem CORS)
            @Suppress("DEPRECATION")
            settings.allowUniversalAccessFromFileURLs = true
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
            settings.textZoom = 100 // a fonte grande da acessibilidade da TV não estoura o layout de 1920×1080
            // a página tem 1920 de largura (meta viewport, posta no build): o WebView encaixa ela na tela inteira
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.setSupportZoom(false)
            addJavascriptInterface(Ponte(), "AndroidAv")
            webViewClient = WebViewClient()
        }
        tela.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(tela)
        web.loadUrl(inicio())
        ui.post(relogio)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(instalou, IntentFilter(INSTALOU), Context.RECEIVER_NOT_EXPORTED)
        else registerReceiver(instalou, IntentFilter(INSTALOU))
        buscarVersao()
    }

    /* ---------- Versão nova sem reinstalar ----------
     * A cada envio ao GitHub, o Releases ganha o www.zip (o app: telas, menus, correções) e o APK. O app confere ao abrir
     * e a cada 6 h; se mudou, baixa em segundo plano e pergunta se atualiza agora (senão vale na próxima abertura).
     * O portal também pode mandar atualizar (Atualizar → App), com o link escolhido lá: aí atualiza sem perguntar.
     * Link: www.zip, .apk ou a página do Releases do GitHub (tag com versão maior que a do APK instalado = APK novo). */
    private val PADRAO = "https://github.com/strcatarinatv-spec/appAndroid/releases/latest"
    private val prefs by lazy { getSharedPreferences("ota", MODE_PRIVATE) }
    private val ota by lazy { File(filesDir, "ota") }
    private val pacote by lazy { packageManager.getPackageInfo(packageName, 0) }
    private val apk by lazy { pacote.lastUpdateTime } // muda a cada APK instalado
    private var buscouEm = 0L
    private var aviso = false // baixou e falta aplicar
    private var forcado = false // pedido do portal: aplica sem perguntar
    private var apkNovo: File? = null // APK baixado esperando a permissão de instalar

    // a versão baixada, se for deste APK (um APK novo traz a dele e descarta a antiga)
    private fun inicio() =
        if (prefs.getLong("apk", 0) == apk && File(ota, "www/index.html").exists()) "file://${ota.absolutePath}/www/index.html"
        else "file:///android_asset/www/index.html"

    private fun abrir(url: String) = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 15000; readTimeout = 30000
        setRequestProperty("Accept", "application/vnd.github+json, */*")
    }.inputStream

    private fun maior(a: String, b: String): Boolean {
        val x = a.split(".").map { it.toIntOrNull() ?: 0 }; val y = b.split(".").map { it.toIntOrNull() ?: 0 }
        for (i in 0 until maxOf(x.size, y.size)) if (x.getOrElse(i) { 0 } != y.getOrElse(i) { 0 }) return x.getOrElse(i) { 0 } > y.getOrElse(i) { 0 }
        return false
    }

    // o que baixar: (tipo "www" ou "apk", endereço, identidade para saber se já está instalado)
    private fun resolver(link: String): Triple<String, String, String>? {
        if (!link.startsWith("https://")) return null
        val caminho = URL(link).path.lowercase()
        if (caminho.endsWith(".apk")) return Triple("apk", link, link)
        if (caminho.endsWith(".zip")) return Triple("www", link, link)
        val m = Regex("""^https://github\.com/([^/]+)/([^/]+)/releases(?:/tag/([^/?#]+))?""").find(link) ?: return null
        val (dono, repo, tag) = m.destructured
        val rel = JSONObject(abrir("https://api.github.com/repos/$dono/$repo/releases/" + (if (tag.isEmpty()) "latest" else "tags/$tag")).bufferedReader().readText())
        val arqs = rel.getJSONArray("assets").let { a -> (0 until a.length()).map { a.getJSONObject(it) } }
        val apkDela = if (maior(rel.optString("tag_name").trimStart('v'), pacote.versionName ?: "0")) arqs.firstOrNull { it.getString("name").endsWith(".apk") } else null
        val a = apkDela ?: arqs.firstOrNull { it.getString("name") == "www.zip" } ?: return null
        return Triple(if (a === apkDela) "apk" else "www", a.getString("browser_download_url"), a.getLong("id").toString())
    }

    // resposta ao app (só quando o portal pediu): igual, nova, apk ou erro
    private fun fim(porPortal: Boolean, s: String, msg: String = "") {
        if (porPortal) ui.post { web.evaluateJavascript("window.__versao&&__versao('$s',${JSONObject.quote(msg)})", null) }
    }

    private fun buscarVersao(link: String = PADRAO, porPortal: Boolean = false) {
        if (!porPortal) {
            if (System.currentTimeMillis() - buscouEm < 6 * 3600_000) return
            buscouEm = System.currentTimeMillis()
        }
        thread {
            try {
                val (tipo, url, id) = resolver(link) ?: return@thread fim(porPortal, "erro", "link não reconhecido (use https: www.zip, .apk ou o Releases do GitHub)")
                if (tipo == "apk") {
                    val f = File(cacheDir, "novo.apk")
                    abrir(url).use { i -> f.outputStream().use { i.copyTo(it) } }
                    fim(porPortal, "apk")
                    ui.post { if (porPortal) instalar(f) else oferecerApk(f) }
                    return@thread
                }
                if (!porPortal && prefs.getLong("apk", 0) != apk) { // APK recém-instalado: já veio com o app desta versão
                    ota.deleteRecursively()
                    prefs.edit().putString("fonte", id).putLong("apk", apk).apply()
                    return@thread
                }
                if (id == prefs.getString("fonte", "") && prefs.getLong("apk", 0) == apk) return@thread fim(porPortal, "igual")
                val novo = File(filesDir, "ota-novo").apply { deleteRecursively(); mkdirs() }
                val base = novo.canonicalPath + File.separator
                ZipInputStream(abrir(url)).use { zip ->
                    generateSequence { zip.nextEntry }.forEach { e ->
                        val f = File(novo, e.name)
                        if (!f.canonicalPath.startsWith(base)) throw SecurityException(e.name) // nada fora da pasta
                        if (e.isDirectory) f.mkdirs() else { f.parentFile?.mkdirs(); f.outputStream().use { zip.copyTo(it) } }
                    }
                }
                if (!File(novo, "www/index.html").exists()) return@thread fim(porPortal, "erro", "o arquivo não tem o app (www/index.html)")
                ui.post {
                    ota.deleteRecursively()
                    if (!novo.renameTo(ota)) return@post fim(porPortal, "erro", "sem espaço para gravar")
                    prefs.edit().putString("fonte", id).putLong("apk", apk).apply()
                    fim(porPortal, "nova")
                    aviso = true
                    forcado = forcado || porPortal
                    perguntar()
                }
            } catch (e: Exception) { fim(porPortal, "erro", "não foi possível baixar (${e.javaClass.simpleName})") } // tenta de novo mais tarde
        }
    }

    // não interrompe o que está passando: com vídeo tocando, espera ele parar (o relógio confere)
    private fun perguntar() {
        if (!aviso || isFinishing || players.values.any { it.exo?.isPlaying == true }) return
        aviso = false
        val aplicar = { players.values.forEach { it.fechar() }; web.loadUrl(inicio()) }
        if (forcado) { forcado = false; ui.postDelayed({ aplicar() }, 2500); return } // dá tempo de avisar o portal
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Nova versão do app")
            .setMessage("Já está baixada. Atualizar agora?")
            .setPositiveButton("Atualizar") { _, _ -> aplicar() }
            .setNegativeButton("Depois", null) // abre com ela na próxima vez
            .show()
    }

    private fun oferecerApk(f: File) {
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Nova versão do app")
            .setMessage("Já está baixada. Instalar agora?")
            .setPositiveButton("Instalar") { _, _ -> instalar(f) }
            .setNegativeButton("Depois", null)
            .show()
    }

    // APK novo: o Android pede para confirmar na tela (e, na primeira vez, permitir que a Catarina TV instale apps)
    private val INSTALOU = "br.com.catarinatv.tv.INSTALOU"
    private fun instalar(f: File) {
        if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
            apkNovo = f // volta ao app com a permissão dada: instala (onStart)
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            return
        }
        apkNovo = null
        try {
            val pi = packageManager.packageInstaller
            val id = pi.createSession(PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL))
            pi.openSession(id).use { s ->
                f.inputStream().use { i -> s.openWrite("app", 0, f.length()).use { o -> i.copyTo(o); s.fsync(o) } }
                val it = Intent(INSTALOU).setPackage(packageName)
                s.commit(PendingIntent.getBroadcast(this, id, it, PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0)).intentSender)
            }
        } catch (e: Exception) { Toast.makeText(this, "Não foi possível instalar: ${e.javaClass.simpleName}", Toast.LENGTH_LONG).show() }
    }
    private val instalou = object : BroadcastReceiver() {
        override fun onReceive(c: Context, i: Intent) {
            @Suppress("DEPRECATION")
            if (i.getIntExtra(PackageInstaller.EXTRA_STATUS, -1) == PackageInstaller.STATUS_PENDING_USER_ACTION)
                i.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        }
    }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        val k = teclas[e.keyCode] ?: return super.dispatchKeyEvent(e)
        if (e.action == KeyEvent.ACTION_DOWN || e.action == KeyEvent.ACTION_UP)
            web.evaluateJavascript("window.__key&&__key($k,${e.action == KeyEvent.ACTION_DOWN})", null)
        return true
    }

    // saiu do app (Home): o som não continua tocando escondido
    private val pausados = HashSet<Av>()
    override fun onStop() {
        super.onStop()
        players.values.forEach { a -> if (a.exo?.playWhenReady == true) { pausados.add(a); a.exo?.playWhenReady = false } }
    }
    override fun onStart() {
        super.onStart()
        pausados.forEach { it.exo?.playWhenReady = true }
        pausados.clear()
        buscarVersao()
        perguntar()
        apkNovo?.let { if (Build.VERSION.SDK_INT < 26 || packageManager.canRequestPackageInstalls()) instalar(it) }
    }
    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        unregisterReceiver(instalou)
        players.values.forEach { it.fechar() }
        web.destroy()
        super.onDestroy()
    }

    private fun evento(id: Int, nome: String, a: Any? = null, b: Any? = null) {
        val js = "window.__av&&__av($id,'$nome',${js(a)},${js(b)})"
        web.evaluateJavascript(js, null)
    }
    private fun js(v: Any?) = when (v) { null -> "null"; is String -> JSONObject.quote(v); else -> v.toString() }

    // tempo do vídeo para a barra de progresso (o AVPlay manda sozinho, o ExoPlayer não)
    private val relogio = object : Runnable {
        override fun run() {
            players.values.forEach { a -> a.exo?.let { if (it.isPlaying) evento(a.id, "oncurrentplaytime", it.currentPosition) } }
            if (aviso) perguntar() // versão nova esperando o vídeo parar
            ui.postDelayed(this, 500)
        }
    }

    inner class Av(val id: Int) : Player.Listener {
        var exo: ExoPlayer? = null
        private var pronto = false
        private var volume = 1f
        private var mudo = true // legenda desligada até o app pedir (como no AVPlay)
        // respostas na hora para o JS (ele chama de outra thread; o ExoPlayer só se mexe na principal)
        @Volatile var duracao = 0L
        @Volatile var faixas = "[]"
        @Volatile var atuais = "[]"
        private var lista = listOf<Pair<Tracks.Group, Int>>()
        val view = PlayerView(this@MainActivity).apply {
            useController = false
            resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
            setShutterBackgroundColor(Color.TRANSPARENT)
            subtitleView?.visibility = View.GONE // a legenda é desenhada pelo app (#pSubs)
            visibility = View.GONE
        }.also { tela.addView(it, 0, FrameLayout.LayoutParams(-1, -1)) }

        fun abrir(url: String) {
            fechar()
            val http = DefaultHttpDataSource.Factory().setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15000).setReadTimeoutMs(20000)
            exo = ExoPlayer.Builder(this@MainActivity).setMediaSourceFactory(DefaultMediaSourceFactory(http)).build().also {
                it.addListener(this)
                it.volume = volume
                it.trackSelectionParameters = it.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, mudo).build()
                it.setMediaItem(MediaItem.fromUri(url))
            }
            pronto = false
            duracao = 0
            view.player = exo
            view.visibility = View.VISIBLE
        }

        fun fechar() {
            exo?.release()
            exo = null
            view.player = null
            view.visibility = View.GONE
            faixas = "[]"; atuais = "[]"; lista = emptyList()
        }

        // x, y, w, h no espaço de 1920×1080 da página
        fun retangulo(x: Int, y: Int, w: Int, h: Int) {
            val s = web.width / 1920f
            view.layoutParams = FrameLayout.LayoutParams((w * s).toInt(), (h * s).toInt()).apply {
                leftMargin = (x * s).toInt(); topMargin = (y * s).toInt()
            }
        }

        fun som(on: Boolean) { volume = if (on) 1f else 0f; exo?.volume = volume }

        fun legendaMuda(b: Boolean) {
            mudo = b
            exo?.let { it.trackSelectionParameters = it.trackSelectionParameters.buildUpon().setTrackTypeDisabled(C.TRACK_TYPE_TEXT, b).build() }
            if (b) evento(id, "onsubtitlechange", 0, "")
        }

        fun escolher(tipo: String, i: Int) {
            val (g, t) = lista.getOrNull(i) ?: return
            val p = exo ?: return
            val b = p.trackSelectionParameters.buildUpon().setOverrideForType(TrackSelectionOverride(g.mediaTrackGroup, t))
            if (tipo == "TEXT") b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, false)
            p.trackSelectionParameters = b.build()
        }

        override fun onPlaybackStateChanged(s: Int) {
            when (s) {
                Player.STATE_BUFFERING -> if (pronto) evento(id, "onbufferingstart")
                Player.STATE_READY -> if (!pronto) {
                    pronto = true
                    duracao = exo?.duration?.takeIf { it != C.TIME_UNSET } ?: 0
                    evento(id, "prepared")
                } else evento(id, "onbufferingcomplete")
                Player.STATE_ENDED -> evento(id, "onstreamcompleted")
            }
        }

        override fun onPlayerError(e: PlaybackException) {
            if (pronto) evento(id, "onerror", e.errorCodeName) else evento(id, "preparefail")
        }

        override fun onCues(c: CueGroup) {
            if (!mudo) evento(id, "onsubtitlechange", 0, c.cues.joinToString("\n") { it.text?.toString() ?: "" })
        }

        // faixas no formato do AVPlay: getTotalTrackInfo / getCurrentStreamInfo
        override fun onTracksChanged(tr: Tracks) {
            val todas = JSONArray(); val sel = JSONArray(); val l = ArrayList<Pair<Tracks.Group, Int>>()
            tr.groups.forEach { g ->
                val tipo = when (g.type) { C.TRACK_TYPE_AUDIO -> "AUDIO"; C.TRACK_TYPE_TEXT -> "TEXT"; C.TRACK_TYPE_VIDEO -> "VIDEO"; else -> return@forEach }
                for (t in 0 until g.length) {
                    val n = l.size
                    l.add(g to t)
                    val lang = g.getTrackFormat(t).language ?: ""
                    todas.put(JSONObject().put("index", n).put("type", tipo)
                        .put("extra_info", JSONObject().put("language", lang).put("track_lang", lang).toString()))
                    if (g.isTrackSelected(t)) sel.put(JSONObject().put("index", n).put("type", tipo))
                }
            }
            lista = l; faixas = todas.toString(); atuais = sel.toString()
        }
    }

    // o que o JS chama (webapis-android.js); roda fora da thread principal, então passa para ela
    inner class Ponte {
        private fun av(id: Int) = players.getOrPut(id) { Av(id) }
        private fun naTela(f: () -> Unit) = ui.post(f)

        @JavascriptInterface fun open(id: Int, url: String) = naTela { av(id).abrir(url) }
        @JavascriptInterface fun rect(id: Int, x: Int, y: Int, w: Int, h: Int) = naTela { av(id).retangulo(x, y, w, h) }
        @JavascriptInterface fun prepare(id: Int) = naTela { av(id).exo?.let { it.playWhenReady = false; it.prepare() } }
        @JavascriptInterface fun play(id: Int) = naTela { av(id).exo?.playWhenReady = true }
        @JavascriptInterface fun pause(id: Int) = naTela { av(id).exo?.playWhenReady = false }
        @JavascriptInterface fun stop(id: Int) = naTela { av(id).exo?.stop() }
        @JavascriptInterface fun close(id: Int) = naTela { av(id).fechar() }
        @JavascriptInterface fun seek(id: Int, ms: Long) = naTela { av(id).exo?.seekTo(ms) }
        @JavascriptInterface fun select(id: Int, tipo: String, i: Int) = naTela { av(id).escolher(tipo, i) }
        @JavascriptInterface fun silentSub(id: Int, b: Boolean) = naTela { av(id).legendaMuda(b) }
        @JavascriptInterface fun sound(id: Int, on: Boolean) = naTela { av(id).som(on) }
        @JavascriptInterface fun duration(id: Int): Long = players[id]?.duracao ?: 0
        @JavascriptInterface fun tracks(id: Int): String = players[id]?.faixas ?: "[]"
        @JavascriptInterface fun current(id: Int): String = players[id]?.atuais ?: "[]"
        @JavascriptInterface fun model(): String = "Android · ${Build.MANUFACTURER} ${Build.MODEL}"
        @JavascriptInterface fun exit() = naTela { finish() }
        @JavascriptInterface fun versao(): String = pacote.versionName ?: ""
        @JavascriptInterface fun atualizar(link: String) = naTela { buscarVersao(link.trim().ifEmpty { PADRAO }, true) }
    }
}
