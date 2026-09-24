#!/bin/bash
# Stage 2: one render PNG -> textured GLB(s) via TRELLIS.2 in the 4090's WSL docker.
#   tools/charfab/mesh.sh <slug> <pose> [targets] [resolution] [seed]
#   targets = comma list of triangle counts (default 200000,60000,30000): TRELLIS decimates BEFORE
#   the uv unwrap + texture bake, so each target gets its own clean bake.
# Chosen render = work/<slug>/pick-<pose>.txt (a 2-digit index, default 00).
# Output: work/<slug>/mesh-<pose>/<slug>_<N>.glb
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(cd "$HERE/../.." && pwd)/work"
MAXPOWA="${MAXPOWA:-xam88@maxpowa}"
slug="$1"; pose="$2"; targets="${3:-200000,60000,30000}"; res="${4:-1024}"; seed="${5:-42}"
wdir="$WORK/$slug"
pick=0
[ -f "$wdir/pick-$pose.txt" ] && pick="$(head -1 "$wdir/pick-$pose.txt" | tr -dc 0-9)"
idx="$(printf '%02d' "$((10#${pick:-0}))")"
src="$wdir/render-$pose/$idx.png"
[ -f "$src" ] || { echo "FAIL mesh: no render at $src"; exit 1; }
out="$wdir/mesh-$pose"; mkdir -p "$out"
echo "OK mesh: $slug/$pose using render $idx at ${res}^3 seed $seed targets $targets"
io="$slug-$pose"
win="C:/Users/xam88/charfab-io/$io"
ssh -o BatchMode=yes "$MAXPOWA" "New-Item -ItemType Directory -Force C:\\Users\\xam88\\charfab-io\\$io | Out-Null" >/dev/null
scp -q -o BatchMode=yes "$src" "$MAXPOWA:$win/in.png"
scp -q -o BatchMode=yes "$HERE/trellis_runner.py" "$MAXPOWA:C:/Users/xam88/charfab-runner.py"
tmp="$(mktemp)"
cat > "$tmp" <<'WSL'
#!/bin/bash
set -e
io="/mnt/c/Users/xam88/charfab-io/$1"; res="$2"; targets="$3"; seed="$4"
mkdir -p ~/charfab/hf
rm -f "$io"/out*.glb
docker run --rm --gpus all --ulimit nofile=65536:65536 \
  -v ~/charfab/hf:/root/.cache/huggingface \
  -v "$io":/io \
  -v /mnt/c/Users/xam88/charfab-runner.py:/workspace/TRELLIS.2/trellis_runner.py \
  -w /workspace/TRELLIS.2 \
  charlzkp/trellis2:2026-01-07-setup-no-weight \
  bash -lc "python trellis_runner.py --input /io/in.png --out /io/out.glb --resolution $res --decimation $targets --texture 2048 --seed $seed" 2>&1 | grep -v -E 'it/s\]|s/it\]' || true
ls -la "$io"/out*.glb
WSL
scp -q -o BatchMode=yes "$tmp" "$MAXPOWA:C:/Users/xam88/charfab-meshrun.sh"; rm -f "$tmp"
ssh -o BatchMode=yes "$MAXPOWA" "wsl -d Ubuntu-24.04 -e bash /mnt/c/Users/xam88/charfab-meshrun.sh $io $res $targets $seed" 2>&1 | tr -d '\r' | tr -d '\0' | grep -v wslconfig | tail -15
IFS=, read -ra T <<< "$targets"
for t in "${T[@]}"; do
  f="out_$t.glb"; [ "${#T[@]}" -eq 1 ] && f="out.glb"
  scp -q -o BatchMode=yes "$MAXPOWA:$win/$f" "$out/${slug}_$t.glb" && echo "OK mesh: $out/${slug}_$t.glb ($(du -h "$out/${slug}_$t.glb" | cut -f1))"
done
