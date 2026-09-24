# HD racer models (optional tier)

AI-generated textured driver models for `src/hdracers.js`. The karts stay procedural (`src/racers.js`).
The game runs identically with this folder empty: `loadHDRacer()` rejects and the procedural driver stays.
Enabled by the **FANCY RACERS** setting (`settings.hd`) or `?hd=1`.

| file | racer | kind | tris | size | notes |
|---|---|---|---|---|---|
| `orion.glb`    | Orion    | rig (mixamorig, 23 bones) | 29,129 | 0.89 MB | |
| `kingdad.glb`  | King Dad | rig | 29,704 | 1.26 MB | back-of-head hair repainted to skin (texpaint) |
| `mum.glb`      | Mum      | rig | 29,285 | 1.17 MB | |
| `sootie.glb`   | Sootie   | rig | 28,013 | 1.09 MB | tail cut before rigging, grafted back on Hips, lifted 85° |
| `grumblin.glb` | Grumbles | static | 14,665 | 0.53 MB | generated already sitting |
| `jelly.glb`    | Wibble   | static | 14,985 | 0.35 MB | |
| `zapdrone.glb` | Zappy    | static | 14,093 | 0.44 MB | yaw -1.6 in HD_MODELS (eye to +Z) |
| `prickle.glb`  | Prickles | static | 14,193 | 0.52 MB | |

Total 6.0 MB. Every file: one mesh, one material, one 1024² WebP base-colour texture, meshopt-compressed
(`EXT_meshopt_compression`, needs `GLTFLoader.setMeshoptDecoder`). No metallic-roughness map (dropped; the
loader renders a flat soft plastic, metalness 0 / roughness 0.72).

## Budget / measured cost
8 karts from the chase camera, GPU headless Chrome on the Arc B60 (`hd.html?perf=1`, 120 frames each with a
`readPixels` sync, shadows on):

| drivers | ms/frame | triangles drawn (incl. shadow pass) |
|---|---|---|
| procedural only | 4.7 | 46k |
| **these HD models (4 × ~29k rigged + 4 × ~15k static)** | **6.0** | 356k |
| DAWG ARENA-style full-res (8 × 187k) | 13.1 | 3.0M |

The full-res route was measured and rejected for the Steam Deck. The quality at 30k/15k comes from
decimating **inside TRELLIS** (`to_glb(decimation_target=N)`) *before* its UV unwrap and texture bake, so each
target gets its own clean bake. DAWG ARENA simplified after baking, which shredded the texture and merged
clothes into skin. Compared at 200k/60k/30k (`shots/orion-static-tris.png`): 30k is visually the same at kart
distance.

## Pipeline (tools/charfab/, adapted from DAWG ARENA's charfab; work dirs in `work/<id>/`, gitignored)
1. `render.mjs <id> [--pose apose|creature] [--n 4] [--seed S] [--start K]`: Krea 2 **RAW** fp8 on maxpowa's
   ComfyUI (:8188), 28 steps, er_sde/simple, cfg 4. Humans are rendered in an **A-pose** at 832×1216,
   creatures already **sitting in a driving pose** at 1024², 3/4 front view. The pick goes in
   `work/<id>/pick-<pose>.txt`.
2. `mesh.sh <id> <pose> 30000,15000 [res]`: TRELLIS.2-4B docker in maxpowa's WSL, 1024³ (Grumbles needed
   512³: 1024³ ran out of memory), seed 42, 2048 texture, one GLB per target.
3. `rig.sh <id> 30000`: Make-It-Animatable docker, mixamorig, bound in the A-pose (`--reset-to-rest 0`).
4. `pack.mjs in.glb assets/models/<id>.glb`: neutral_bone reweight, weld, smooth normals, drop the MR map,
   1024 WebP q88, meshopt. `lib/meshfix.mjs` holds DAWG ARENA's proven fixes.
- `tailsplit.mjs split|graft`: for non-humanoid appendages that confuse MIA (Sootie's tail).
- `texpaint.mjs --where "<xyz predicate>"`: recolours dark (hair) texels to sampled skin in a region.
- `inpaint.mjs`: masked Krea img2img touch-up of a render.
- `comfy-up.ps1` / `comfy-down.ps1` (via `psrun.sh`): start/stop ComfyUI on maxpowa. Run one GPU stage at a time.

Shared style suffix: *"3D CGI character render like a modern family animated movie, stylized chunky kid-friendly
proportions with a big oversized head, short body and big expressive eyes, cheerful friendly expression, bright
saturated colours, soft global illumination, smooth rounded 3D forms with soft shading, high detail, centered
composition"*. Negative: *"2D, flat illustration, drawing, line art, black outlines, cel shading, sketch, anime,
realistic, photograph, scary, horror, creepy, cropped, …"* (full text in `tools/charfab/characters.json`).
The first try without "3D CGI" came out as flat 2D line art.

| id | pick | seed | description (prefix of the prompt) |
|---|---|---|---|
| orion | apose 00 | 1000 | cheerful 7 year old cartoon boy, short dark brown hair with a neat fringe, big brown eyes, rosy cheeks, royal blue t-shirt with a big yellow star, red shorts, white socks + sneakers (SO2 orionAtlas colours) |
| kingdad | apose 19 | 1002 (+inpaint seed 9) | render 02: "big friendly cartoon dad with a completely bald head, short neat black beard, golden crown, short red royal velvet cape with white fur trim, slate blue t-shirt, dark grey jeans, brown sneakers, round tummy" (SO1 palette: slate shirt, dark pants, red cape). Krea 2 put hair on the temples in all 16 candidates, including with positive-only "bald scalp" phrasing and a "hair" negative. So on 02 the temple hair was painted to skin, then a masked RAW img2img pass at denoise 0.28 (0.36+ regrew grey hair). TRELLIS then invented hair on the unseen back of the head: `texpaint.mjs --where "y>0.6 && (z<0.03 \|\| (y>0.68 && z<0.13 && Math.abs(x)>0.10))" --dark 128 --dilate 4` |
| mum | apose 03 | 1003 | kind cheerful cartoon mum, long wavy chocolate brown hair, orchid purple long-sleeved top, purple leggings, white sneakers (SO1 Gemma: brown hair, #c46fd4 purple) |
| sootie | apose 03 | 1003 | fluffy all-black cartoon cat standing upright, huge round mint green eyes, pink nose, white whiskers, long fluffy tail, tiny mint green racing jacket |
| grumblin | creature 02 | 1002 | grumpy but cute green gremlin, chunky boxy body, big white eyes, sitting in a driving pose |
| jelly | creature 02 | 1002 | cute pink jellyfish, pale pink cap, big eyes, cheeky smile, red-pink tentacles |
| zapdrone | creature 02 | 1002 | cute grey diamond-octahedron robot drone, one big glowing red eye, light blue electric rings, antenna |
| prickle | creature 01 | 1001 | round chubby burr-hog, brown ball body with cream cone spikes, cream face, rosy cheeks, arms forward, sitting |

## Why rigged humans and static creatures
Humans were rendered in an A-pose, TRELLIS-meshed and MIA-rigged, then **seated in the browser at load**:
thighs forward, knees bent, and a two-bone IK puts the hands on the kart's own steering-wheel position, which
turns with steer. Every frame the spine rolls into the corner (more in a slide), the head looks into the turn,
the driver tucks forward on boost, squashes on landing, flails when hit or spun, throws a V to cheer, and
slumps when sad. The alternative, rendering the character already seated and leaning a static mesh, was tried
for Orion (`work/orion/mesh-seated`, `shots/orion-seated-static.png`). Krea put the hands on the knees rather
than on a wheel, and there are no arms or head to animate, so it was not used for humans. The creatures have no
humanoid body for MIA, so they are generated sitting and animated as a whole (lean, yaw into the turn, bob,
squash, hit wobble).

Rig traps found here (in addition to DAWG ARENA's neutral_bone and quantize traps):
- Big cartoon heads put the MIA head joint well in front of the hips. Standing the rig up by hips→head then
  reclines the body, so `HD_MODELS.sootie.up = 'legs'` (feet→thighs is up).
- A long tail made MIA predict a tilted skeleton, and when grafted back it drooped through the seat and became
  the "seat contact". Hence split before rigging, graft onto Hips, and lift the tail 85°.
- Sootie's jacket shell stretches if her arms go straight up: `armsUp: 0.4`.

Viewer: `hd.html?ids=orion,mum&poses=idle,left,slideL,hit,cheer&views=chase,front,close`, and
`&perf=1` for the benchmark. Screenshots: `node tools/shot-hd.mjs '<query>' shots/x.png`.
