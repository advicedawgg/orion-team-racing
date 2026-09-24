#!/bin/bash
# Run a bash script inside WSL (Ubuntu-24.04) on the 4090 box, with no PowerShell quoting.
# Usage: wslrun.sh <script.sh> [args...]   — the script is copied over first.
# Env: MAXPOWA (ssh target, default xam88@maxpowa)
set -euo pipefail
MAXPOWA="${MAXPOWA:-xam88@maxpowa}"
script="$1"; shift
name="charfab-$(basename "$script" .sh)-$$.sh"
scp -q -o BatchMode=yes "$script" "$MAXPOWA:C:/Users/xam88/$name"
# WSL sees C:\Users\xam88 as /mnt/c/Users/xam88
ssh -o BatchMode=yes "$MAXPOWA" "wsl -d Ubuntu-24.04 -e bash /mnt/c/Users/xam88/$name $*; Remove-Item C:\\Users\\xam88\\$name -ErrorAction SilentlyContinue" | tr -d '\r'
