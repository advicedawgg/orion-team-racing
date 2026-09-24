#!/bin/bash
# Run a PowerShell script on the 4090 box (Windows side), with no quoting pain.
# Usage: psrun.sh <script.ps1> [args...]
set -euo pipefail
MAXPOWA="${MAXPOWA:-xam88@maxpowa}"
script="$1"; shift
name="charfab-$(basename "$script" .ps1)-$$.ps1"
scp -q -o BatchMode=yes "$script" "$MAXPOWA:C:/Users/xam88/$name"
ssh -o BatchMode=yes "$MAXPOWA" "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\xam88\\$name $*; Remove-Item C:\\Users\\xam88\\$name -ErrorAction SilentlyContinue" | tr -d '\r'
