# PowerShell version. Usage: put this file and pdf_letters_to_download.txt in one folder, then run:
#   powershell -ExecutionPolicy Bypass -File download_letters.ps1
New-Item -ItemType Directory -Force -Path sec_letters | Out-Null
$ua = "Uniqus Consultech research sandipku1978@gmail.com"
Get-Content pdf_letters_to_download.txt | ForEach-Object {
  $f = Join-Path sec_letters (Split-Path $_ -Leaf)
  if (-not (Test-Path $f)) {
    try { Invoke-WebRequest -Uri $_ -UserAgent $ua -OutFile $f } catch { Write-Host "FAILED $_" }
    Start-Sleep -Milliseconds 500
  }
}
Compress-Archive -Force -Path sec_letters -DestinationPath sec_letters.zip
Write-Host "Done: upload sec_letters.zip"
