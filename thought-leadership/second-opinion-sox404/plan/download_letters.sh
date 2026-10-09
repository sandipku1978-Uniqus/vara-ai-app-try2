#!/usr/bin/env bash
# Downloads the S7-2026-18 comment-letter PDFs still needed for the coding re-read.
# Usage: bash download_letters.sh  (needs curl; run from any folder; takes ~3 minutes)
# SEC asks automated clients to identify themselves and stay under 10 requests a second.
set -e
mkdir -p sec_letters && cd sec_letters
while read -r url; do
  f=$(basename "$url")
  [ -s "$f" ] && continue
  curl -sSf -A "Uniqus Consultech research sandipku1978@gmail.com" -o "$f" "$url" || echo "FAILED $url"
  sleep 0.5
done < ../pdf_letters_to_download.txt
cd .. && zip -qr sec_letters.zip sec_letters && echo "Done: upload sec_letters.zip"
