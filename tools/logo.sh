#!/usr/bin/env bash
# bash tools/logo.sh  ->  assets/ui/logo.png (transparent, ~1400 px wide)
#
# The "ORION TEAM RACING" logo, composed with ImageMagick 6 — not generated:
# diffusion models can't spell reliably, compositing can (same approach as the
# DAWG ARENA Steam grid art). Font: Luckiest Guy (Apache-2.0, Google Fonts),
# fetched into work/fonts/ on first run. Deterministic: same inputs, same PNG.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FONTDIR="$ROOT/work/fonts"
FONT="$FONTDIR/LuckiestGuy-Regular.ttf"
OUT="$ROOT/assets/ui/logo.png"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$FONTDIR" "$(dirname "$OUT")"
[ -s "$FONT" ] || curl -sfL -o "$FONT" https://github.com/google/fonts/raw/main/apache/luckiestguy/LuckiestGuy-Regular.ttf

NAVY='#1b1f4a'

# word <text> <pointsize> <gradient-top> <gradient-bottom> <outline px> <out>
# gradient fill, a lighter shine on the upper half, thick navy outline, then a
# thin white rim outside that so it reads on any background.
word() {
  local txt="$1" ps="$2" c1="$3" c2="$4" ol="$5" out="$6"
  convert -background none -fill white -font "$FONT" -pointsize "$ps" label:"$txt" \
    -bordercolor none -border $((ol * 2 + 8)) "$T/m.png"
  local wh; wh=$(identify -format '%wx%h' "$T/m.png")
  convert -size "$wh" gradient:"$c1-$c2" "$T/m.png" -compose CopyOpacity -composite "$T/fill.png"
  # shine: white band over the top ~40% of the letters, clipped to them
  convert -size "$wh" xc:none -fill 'rgba(255,255,255,0.35)' \
    -draw "rectangle 0,0 ${wh%x*},$(( ${wh#*x} * 42 / 100 ))" "$T/m.png" -compose DstIn -composite "$T/shine.png"
  convert "$T/m.png" -channel A -morphology Dilate Disk:"$ol" +channel \
    -fill "$NAVY" -colorize 100 "$T/ol.png"
  convert "$T/m.png" -channel A -morphology Dilate Disk:$((ol + 5)) +channel \
    -fill white -colorize 100 "$T/rim.png"
  convert "$T/rim.png" "$T/ol.png" -composite \
    \( "$T/fill.png" -geometry +0-0 \) -composite "$T/shine.png" -composite \
    -trim +repage "$out"
}

word "ORION"       300 '#fff27a' '#ff8a1a' 16 "$T/l1.png"
word "TEAM RACING" 150 '#ffffff' '#8fd8ff' 11 "$T/l2.png"

# Checkered strip under line 2 (2 rows), navy-outlined.
W2=$(identify -format '%w' "$T/l2.png")
SQ=26
convert -size $((SQ * 2))x$((SQ * 2)) xc:white -fill black \
  -draw "rectangle 0,0 $((SQ - 1)),$((SQ - 1))" -draw "rectangle $SQ,$SQ $((SQ * 2 - 1)),$((SQ * 2 - 1))" "$T/tile.png"
convert -size $((W2 - 40))x$((SQ * 2)) tile:"$T/tile.png" \
  -bordercolor "$NAVY" -border 7 -bordercolor white -border 5 "$T/check.png"

# Star accent, same outline treatment.
STAR='polygon 100,0 124,70 198,70 138,114 161,186 100,142 39,186 62,114 2,70 76,70'
convert -size 200x190 xc:none -fill white -draw "$STAR" -bordercolor none -border 30 "$T/sm.png"
convert -size 260x250 gradient:'#fff27a-#ffb01a' "$T/sm.png" -compose CopyOpacity -composite "$T/sf.png"
convert "$T/sm.png" -channel A -morphology Dilate Disk:12 +channel -fill "$NAVY" -colorize 100 "$T/so.png"
convert "$T/sm.png" -channel A -morphology Dilate Disk:17 +channel -fill white -colorize 100 "$T/sr.png"
convert "$T/sr.png" "$T/so.png" -composite "$T/sf.png" -composite -trim +repage -background none -rotate 14 -resize 190x190 "$T/star.png"

# Stack: line 1 arcs gently, line 2 sits on the checker strip, star tucked in
# at the top right of ORION. Then a small tilt and a soft drop shadow.
convert "$T/l1.png" -virtual-pixel transparent -distort Arc 24 +repage "$T/l1a.png"
convert -background none -gravity center "$T/l1a.png" \
  \( "$T/l2.png" \) \( "$T/check.png" \) -smush -18 "$T/stack.png"
convert "$T/stack.png" -gravity northeast -background none -splice 60x40 \
  "$T/star.png" -geometry +0+0 -composite "$T/stack2.png"
convert "$T/stack2.png" -background none -rotate -4 +repage "$T/tilt.png"
convert "$T/tilt.png" \( +clone -background "$NAVY" -shadow 60x10+10+14 \) +swap \
  -background none -layers merge +repage -trim +repage \
  -resize '1400x>' "$OUT"
echo "logo  $(identify -format '%wx%h' "$OUT")  $(( $(stat -c %s "$OUT") / 1024 ))KB"
