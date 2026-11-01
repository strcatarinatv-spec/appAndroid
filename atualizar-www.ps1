# Copia o app da Samsung (pasta acima, os mesmos arquivos do pacote: tizen_web_project.yaml) para www/,
# que é o que o APK leva. Rode depois de mudar o app e antes de publicar.
$raiz = Split-Path $PSScriptRoot
$www = Join-Path $PSScriptRoot 'www'
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
$arqs = Select-String -Path (Join-Path $raiz 'tizen_web_project.yaml') -Pattern '^\s+- ([\w./-]+\.\w+)$' |
  ForEach-Object { $_.Matches[0].Groups[1].Value } | Where-Object { $_ -notmatch '\.yaml$' -and (Test-Path (Join-Path $raiz $_)) }
foreach ($a in @($arqs) + 'config.xml') {
  $dest = Join-Path $www $a
  New-Item -ItemType Directory -Force (Split-Path $dest) | Out-Null
  Copy-Item (Join-Path $raiz $a) $dest
}
Write-Host "www: $(@(Get-ChildItem $www -Recurse -File).Count) arquivos"
