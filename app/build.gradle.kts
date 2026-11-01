plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// www/: cópia do app da Samsung (atualizar-www.ps1); versão: a mesma do config.xml dele
val web = rootDir.resolve("www")
val versao = Regex("""version="([\d.]+)"""").find(web.resolve("config.xml").readText())?.groupValues?.get(1) ?: "1.0.0"

android {
    namespace = "br.com.catarinatv.tv"
    compileSdk = 34
    defaultConfig {
        applicationId = "br.com.catarinatv.tv"
        minSdk = 21
        targetSdk = 34
        versionName = versao
        versionCode = versao.split(".").fold(0) { acc, s -> acc * 100 + (s.toIntOrNull() ?: 0) }
    }
    // chave do app: no GitHub vem dos segredos KEYSTORE_B64/KEYSTORE_PASS (a mesma sempre, para o APK novo atualizar o
    // instalado); sem eles, a de depuração
    val chave = System.getenv("KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (chave != null) create("catarina") {
            storeFile = chave
            storePassword = System.getenv("KEYSTORE_PASS")
            keyAlias = "catarinatv"
            keyPassword = System.getenv("KEYSTORE_PASS")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("catarina") ?: signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("app-web"))
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.3.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.3.1")
    implementation("androidx.media3:media3-ui:1.3.1")
}

// o app vai para assets/www a cada build; no lugar do webapis.js da TV, o do Android (assets/webapis-android.js)
val copiarApp by tasks.registering(Copy::class) {
    from(web) { exclude("config.xml") }
    filesMatching("index.html") { filter { it.replace("\$WEBAPIS/webapis/webapis.js", "../webapis-android.js") } }
    into(layout.buildDirectory.dir("app-web/www"))
}
tasks.named("preBuild") { dependsOn(copiarApp) }
