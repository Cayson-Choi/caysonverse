#!/bin/sh
# usage: render.sh <html in mockup_src> <out.png> <w> <h>
cd "$(dirname "$0")"
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --user-data-dir="C:/Users/Clara/AppData/Local/Temp/claude/5f92a1b6f6839758/ef24711c-0265-4897-a42b-8d96da387195/scratchpad/chrome-prof" --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=2 --virtual-time-budget=3000 --window-size=$3,$4 \
  --screenshot="$(cygpath -m "$PWD")/$2" "file:///$(cygpath -m "$PWD")/mockup_src/$1" 2>&1 | grep -v -i extension | tail -3
