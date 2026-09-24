#!/bin/bash
# Stage 3: rig a mesh GLB to a Mixamo skeleton (Make-It-Animatable, charfab-rig docker on the 4090's WSL).
#   tools/charfab/rig.sh <slug> <tris>      e.g. rig.sh orion 60000
# Input  work/<slug>/mesh-apose/<slug>_<tris>.glb -> output work/<slug>/rig/<slug>_<tris>.glb
# Binds in the mesh's own A-pose (--reset-to-rest 0): forcing a T-pose rest onto an A-pose mesh tears forearms.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; WORK="$(cd "$HERE/../.." && pwd)/work"; MAXPOWA="${MAXPOWA:-xam88@maxpowa}"
slug="$1"; tris="$2"
src="$WORK/$slug/mesh-apose/${slug}_$tris.glb"
[ -f "$src" ] || { echo "FAIL rig: no mesh at $src"; exit 1; }
mkdir -p "$WORK/$slug/rig"
io="$slug-rig"; win="C:/Users/xam88/charfab-io/$io"
ssh -o BatchMode=yes "$MAXPOWA" "New-Item -ItemType Directory -Force C:\\Users\\xam88\\charfab-io\\$io | Out-Null" >/dev/null
scp -q -o BatchMode=yes "$src" "$MAXPOWA:$win/mesh.glb"
tmp="$(mktemp)"
cat > "$tmp" <<'WSL'
#!/bin/bash
set -e
io="/mnt/c/Users/xam88/charfab-io/$1"; rm -f "$io/rigged.glb" "$io/rigged.fbx"
docker run --rm --gpus all -v ~/charfab/mia_models:/models -v "$io":/io charfab-rig \
  --input /io/mesh.glb --output /io/rigged.fbx --weights /models --reset-to-rest 0 2>&1 | tail -6
ls -la "$io/rigged.glb"
WSL
scp -q -o BatchMode=yes "$tmp" "$MAXPOWA:C:/Users/xam88/charfab-rigrun.sh"; rm -f "$tmp"
ssh -o BatchMode=yes "$MAXPOWA" "wsl -d Ubuntu-24.04 -e bash /mnt/c/Users/xam88/charfab-rigrun.sh $io" 2>&1 | tr -d '\r' | tr -d '\0' | grep -v wslconfig
scp -q -o BatchMode=yes "$MAXPOWA:$win/rigged.glb" "$WORK/$slug/rig/${slug}_$tris.glb"
echo "OK rig: $slug -> $WORK/$slug/rig/${slug}_$tris.glb ($(du -h "$WORK/$slug/rig/${slug}_$tris.glb" | cut -f1))"
