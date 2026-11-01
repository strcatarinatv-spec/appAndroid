// Catarina TV para Android TV: o mesmo app da Samsung (HTML/JS da pasta acima) dentro de um WebView,
// com o player do Android (ExoPlayer) no lugar do AVPlay da Samsung
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositories { google(); mavenCentral() }
}
rootProject.name = "CatarinaTV"
include(":app")
