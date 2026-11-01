package br.com.catarinatv.tv

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Color
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
            addJavascriptInterface(Ponte(), "AndroidAv")
            addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> evaluateJavascript("window.__zoom&&__zoom()", null) }
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(v: WebView, url: String) = v.evaluateJavascript("window.__zoom&&__zoom()", null)
            }
        }
        tela.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(tela)
        web.loadUrl(inicio())
        ui.post(relogio)
        buscarVersao()
    }

    /* ---------- Versão nova sem reinstalar ----------
     * A cada envio ao GitHub, o Releases ganha o www.zip (o app: telas, menus, correções). O app confere ao abrir e a cada
     * 6 h; se mudou, baixa em segundo plano para files/ota e pergunta se atualiza agora (senão vale na próxima abertura).
     * Mudança na parte Android (player, teclas) ainda pede o APK novo. */
    private val prefs by lazy { getSharedPreferences("ota", MODE_PRIVATE) }
    private val ota by lazy { File(filesDir, "ota") }
    private val apk by lazy { packageManager.getPackageInfo(packageName, 0).lastUpdateTime } // muda a cada APK instalado
    private var buscouEm = 0L
    private var aviso = false // baixou e falta perguntar

    // a versão baixada, se for deste APK (um APK novo traz a dele e descarta a antiga)
    private fun inicio() =
        if (prefs.getLong("apk", 0) == apk && File(ota, "www/index.html").exists()) "file://${ota.absolutePath}/www/index.html"
        else "file:///android_asset/www/index.html"

    private fun buscarVersao() {
        if (System.currentTimeMillis() - buscouEm < 6 * 3600_000) return
        buscouEm = System.currentTimeMillis()
        thread {
            try {
                val c = URL("https://api.github.com/repos/strcatarinatv-spec/appAndroid/releases/latest").openConnection() as HttpURLConnection
                c.connectTimeout = 15000; c.readTimeout = 15000
                c.setRequestProperty("Accept", "application/vnd.github+json")
                val assets = JSONObject(c.inputStream.bufferedReader().readText()).getJSONArray("assets")
                val z = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.getString("name") == "www.zip" } ?: return@thread
                val id = z.getLong("id")
                if (prefs.getLong("apk", 0) != apk) { // APK recém-instalado: já veio com o app desta versão
                    ota.deleteRecursively()
                    prefs.edit().putLong("id", id).putLong("apk", apk).apply()
                    return@thread
                }
                if (id == prefs.getLong("id", 0)) return@thread
                val novo = File(filesDir, "ota-novo").apply { deleteRecursively(); mkdirs() }
                val base = novo.canonicalPath + File.separator
                ZipInputStream(URL(z.getString("browser_download_url")).openStream()).use { zip ->
                    generateSequence { zip.nextEntry }.forEach { e ->
                        val f = File(novo, e.name)
                        if (!f.canonicalPath.startsWith(base)) throw SecurityException(e.name) // nada fora da pasta
                        if (e.isDirectory) f.mkdirs() else { f.parentFile?.mkdirs(); f.outputStream().use { zip.copyTo(it) } }
                    }
                }
                if (!File(novo, "www/index.html").exists()) return@thread
                ui.post {
                    ota.deleteRecursively()
                    if (!novo.renameTo(ota)) return@post
                    prefs.edit().putLong("id", id).putLong("apk", apk).apply()
                    aviso = true
                    perguntar()
                }
            } catch (_: Exception) { } // sem internet ou GitHub fora: confere de novo mais tarde
        }
    }

    // não interrompe o que está passando: com vídeo tocando, pergunta quando voltar ao app
    private fun perguntar() {
        if (!aviso || isFinishing || players.values.any { it.exo?.isPlaying == true }) return
        aviso = false
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Nova versão do app")
            .setMessage("Já está baixada. Atualizar agora?")
            .setPositiveButton("Atualizar") { _, _ ->
                players.values.forEach { it.fechar() }
                web.loadUrl(inicio())
            }
            .setNegativeButton("Depois", null) // abre com ela na próxima vez
            .show()
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
    }
    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
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
        @JavascriptInterface fun model(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
        @JavascriptInterface fun exit() = naTela { finish() }
    }
}
