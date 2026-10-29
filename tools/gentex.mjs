// node tools/gentex.mjs [--force] [--regen] [--list] [name|kind ...]
//
// Generates OTR's 2D art with Krea 2 and hands each raw render to
// tools/texpost.py, which makes it tile / keys it / resizes it and writes the
// shipped file under assets/.
//
//   node tools/gentex.mjs                 everything that's missing
//   node tools/gentex.mjs tex             only the tiling textures
//   node tools/gentex.mjs road_ice sky    by name or by kind (tex|sky|title|icon|track)
//   node tools/gentex.mjs --force lava    re-post-process lava (raw render is reused)
//   node tools/gentex.mjs --regen lava    re-render lava too
//   SEEDOFS=3 node tools/gentex.mjs --regen title   try a variant; bake the winner's seed in
//   node tools/gentex.mjs logo            (the logo is ImageMagick only — tools/logo.sh)
//
// Backends (BACKEND=...):
//   moss        (default since 2026-10-29) MOSS-Image on Unraid :8188 (comfy-moss,
//               card1 — it REPLACED comfy-krea2 there): SFT int8 + the 4-step
//               LoRA, euler/simple, 4 steps, cfg 1, ~12 s warm, t2i only
//               (memory project_moss_image_b60). Free. Never stop/restart it.
//   comfy       Krea 2 Turbo fp8 on Unraid's second Arc B60, ComfyUI
//               `comfy-krea2` at http://192.168.15.100:8188 — Turbo settings
//               euler/simple, 8 steps, cfg 1.0 (memory project_krea2_comfyui).
//               Needs ~18 GB of card1 free; see renderComfy for the OOM trap.
//   openrouter  hosted Krea 2 (krea/krea-2-medium-turbo) via OpenRouter; needs
//               OPENROUTER_API_KEY. EVERY SHIPPED ASSET ON 2026-09-25 CAME FROM
//               THIS, because card1 had no room (jv-probe held 5.4 GB) and the
//               ComfyUI worker then died.
//
// Idempotent: shipped files are skipped when they exist unless --force/--regen.
// Raw renders are cached in work/krea/<name>-<hash>.png (hash of
// prompt+seed+size+model, so editing a prompt re-renders only that asset); a
// raw from either backend is reused, so --force never needs a GPU or a key.
// Seeds are fixed per asset (the B60 path is bit-reproducible from them).
//
// Don't restart comfy-krea2 or touch its memory limit from here
// (project_krea2_arc_b60).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOST = process.env.COMFY || 'http://192.168.15.100:8188';
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'work', 'krea');

const UNET = 'krea2_turbo_fp8_scaled.safetensors';
const CLIP = 'qwen3vl_4b_fp8_scaled.safetensors';
const VAE = 'qwen_image_vae.safetensors';
// MOSS-Image (BACKEND=moss, the default): what comfy-moss on :8188 serves now
const MOSS_UNET = 'moss_image_sft_int8_convrot.safetensors', MOSS_LORA = 'moss_image_sft_4step_v2.0.safetensors';
const MOSS_TE = 'qwen3.5_9b_int8_convrot.safetensors', MOSS_VAE = 'flux2-vae.safetensors';
// BACKEND=comfy (default): Krea 2 Turbo on the B60. BACKEND=openrouter: hosted
// Krea 2 via OpenRouter (OR_MODEL, default krea/krea-2-medium-turbo) — the
// fallback used on 2026-09-25 when the B60 had no room (see renderComfy).
const BACKEND = process.env.BACKEND || 'moss';
const OR_MODEL = process.env.OR_MODEL || 'krea/krea-2-medium-turbo';
const MODEL = BACKEND === 'openrouter'
  ? `${OR_MODEL} via OpenRouter /api/v1/images (seed not honoured by the API)`
  : BACKEND === 'moss' ? 'MOSS-Image SFT int8 + 4-step LoRA v2.0, euler/simple 4 steps cfg 1.0, ComfyUI (comfy-moss) on the Arc B60'
  : 'Krea 2 Turbo fp8 (krea2_turbo_fp8_scaled), euler/simple 8 steps cfg 1.0, ComfyUI on the Arc B60';

// House style (SO2's, tuned for karts). Flat even lighting matters: the game
// lights these itself, so any baked highlight or shadow fights the real one.
const STYLE = `Stylised hand-painted low-poly video-game texture, seamless repeating tile, top-down orthographic view, `
  + `flat even lighting with no baked shadows and no baked highlights, no vignette, `
  + `bright saturated cheerful colours, clean crisp detail, `
  + `no text, no watermark, no border, no objects, fills the entire frame edge to edge`;
// Mid-tone roads: textures MULTIPLY the material colour, so a dark road turns
// every tint brown (the dawgfps lesson). Ask for it explicitly.
const ROADTONE = `medium brightness overall, not dark`;

const ICON = `Chunky cartoon video-game item icon sticker, a single object centred with generous empty margin around it, `
  + `thick bold dark navy outline around the whole object, bright saturated glossy cheerful colours, simple bold shapes, `
  + `cel-shaded, reads clearly at small size, isolated on a plain flat pure white background, no shadow on the background, `
  + `no text, no letters, no watermark`;

// For icons the model tends to fill the frame edge to edge — ask for room.
const SMALL = `The whole object is fully visible, drawn small in the centre of the frame, filling only about two thirds of it, with plenty of plain white space on every side`;

const SCENE = `Bright joyful 3D cartoon kart-racing video game art, colourful stylised low-poly rendering like a family kart racer, `
  + `sunny saturated colours, no text, no letters, no logos, no watermark`;

const SKY = `Wide seamless 360 degree panoramic sky backdrop for a video game skybox, equirectangular panorama, `
  + `horizon across the lower third, stylised hand-painted cartoon look, bright saturated colours, `
  + `no text, no watermark, no border, no ground objects in the foreground`;

// kind: tex = seamless 1024 tile (+512), sky = 2048x1024 wrap-x panorama,
// title = 1920x1080 key art, track = 640x360 card, icon = 256 transparent.
// w/h = RENDER size (multiples of 16, kept ≤ ~1.3 MP so the B60 never needs
// to offload); texpost resizes to the shipped size.
export const ASSETS = {
  // ---------------------------------------------------------------- roads
  road_beach: { kind: 'tex', seed: 3111, luma: 160, prompt: `Light grey asphalt tarmac road surface seen from directly above, fine even gravel aggregate grain with tiny pale pebbles, sun-bleached warm light grey, a few faint wisps of blown sand, uniform all-over texture with no large shapes, ${ROADTONE}. ${STYLE}` },
  road_ice: { kind: 'tex', seed: 3112, luma: 185, prompt: `Smooth packed strawberry and vanilla ice cream road surface seen from directly above, soft pastel pink with small creamy white flecks and fine shallow scoop marks, evenly textured all over with no large swirls, a few tiny rainbow sprinkles, ${ROADTONE}. ${STYLE}` },
  road_volcano: { kind: 'tex', flat: true, seed: 3103, luma: 130, prompt: `Grey basalt paving stones road seen from directly above, irregular flat hexagonal flagstones in light slate grey and warm grey, thin faint warm orange glow in a few of the narrow cracks between the stones, mostly grey, ${ROADTONE}. ${STYLE}` },
  road_castle: { kind: 'tex', flat: true, seed: 3114, luma: 150, prompt: `Castle courtyard road of large rounded cobblestones seen from directly above, about eight cobbles across the frame, evenly sized and tightly packed, light warm grey and pale sandstone beige stones with thin mortar lines, ${ROADTONE}. ${STYLE}` },
  road_jungle: { kind: 'tex', flat: true, seed: 3116, luma: 150, prompt: `Packed reddish-brown jungle dirt road seen from directly above, firm smooth earth with fine gravel grain, small scattered pebbles and a few tiny fallen green leaves, warm terracotta and clay tones, uniform all-over texture with no large shapes, ${ROADTONE}. ${STYLE}` },
  // road_bedroom (Toy Box Turbo's orange toy track) is procedural: tools/tex-toytrack.py — MOSS rendered it flat orange and the seam cut left blotches
  road_star: { kind: 'tex', seed: 3125, luma: 190, prompt: `Shimmering opal rainbow road surface seen from directly above, smooth pearly surface with soft pastel pink, lilac, mint and sky blue colour patches blending gently, sprinkled all over with tiny white twinkling star sparkles and glitter. ${STYLE}` },
  // -------------------------------------------------------------- terrain
  sand: { kind: 'tex', seed: 3201, prompt: `Golden tropical beach sand from directly above, fine even grain with gentle wind ripple lines, warm cream and honey tones, a few tiny shell fragments. ${STYLE}` },
  grass: { kind: 'tex', seed: 3202, prompt: `Lush bright green grass lawn from directly above, short even blades, subtle patches of lighter yellow-green and darker green, tiny scattered clover. ${STYLE}` },
  snow: { kind: 'tex', seed: 3203, prompt: `Fresh soft white snow from directly above, gentle powdery drifts with very soft pale blue and lilac tints in the dips, fine sparkly glitter. ${STYLE}` },
  waffle: { kind: 'tex', flat: true, seed: 3204, prompt: `Ice cream cone waffle pattern seen straight on, a regular diagonal grid of square waffle cells with raised ridges, golden toasted biscuit and warm caramel tones. ${STYLE}` },
  lava: { kind: 'tex', seed: 3215, luma: 150, prompt: `Bright flowing molten lava from directly above, swirling glowing rivers of bright yellow and orange covering most of the surface, only a few small thin darker orange-red crust plates, very bright hot and luminous. ${STYLE}` },
  rock_volcanic: { kind: 'tex', seed: 3206, luma: 115, prompt: `Volcanic rock surface from directly above, chunky faceted angular stone in warm medium grey-brown and rusty reddish tones, a few small pits, not black. ${STYLE}` },
  castle_wall: { kind: 'tex', flat: true, seed: 3207, prompt: `Castle wall made of large rectangular stone blocks in a regular running-bond brick pattern seen straight on, light warm grey and sandy beige stones with slightly different tints, thin pale mortar lines. ${STYLE}` },
  castle_floor: { kind: 'tex', flat: true, seed: 3208, prompt: `Castle hall floor of large square polished stone tiles in a checkerboard of warm cream and soft terracotta red, thin grout lines, seen from directly above. ${STYLE}` },
  water: { kind: 'tex', seed: 3209, prompt: `Tropical shallow lagoon water from directly above, gentle caustic light ripples, bright turquoise and aqua tones with soft white highlights, clean stylised waves. ${STYLE}` },
  wood: { kind: 'tex', seed: 3210, flat: true, prompt: `Warm timber boardwalk planks seen from directly above, straight parallel planks with visible grain and a few knots, honey and light chestnut brown tones, thin gaps between planks. ${STYLE}` },
  metal: { kind: 'tex', seed: 3221, luma: 150, flat: true, prompt: `Shiny steel diamond-plate metal panel from directly above, raised tread pattern, light cool silver grey, perfectly uniform even brightness everywhere with no gradients, clean and bright. ${STYLE}` },
  hedge: { kind: 'tex', seed: 3212, prompt: `Neatly trimmed garden hedge seen straight on, dense small leaves, bright fresh green with lighter yellow-green leaf tips, even texture. ${STYLE}` },
  space: { kind: 'tex', seed: 3213, prompt: `Deep space starfield, dark navy and purple night sky densely scattered with small twinkling white, pale yellow and pale blue stars of various sizes, faint wisps of pink and violet nebula. Seamless repeating tile, flat, no planets, no text, no watermark, fills the frame edge to edge` },
  jungle: { kind: 'tex', seed: 3216, prompt: `Lush jungle floor from directly above, soft bright green moss and short grass with tiny clover, small ferns and a few scattered small fallen leaves, fresh greens with lighter yellow-green patches, even texture all over. ${STYLE}` },
  mud: { kind: 'tex', seed: 3217, luma: 135, prompt: `Soft wet chocolate-brown mud from directly above, smooth glossy patches, gentle squishy ripples and a few small shallow puddles, warm medium brown, friendly and clean looking. ${STYLE}` },
  rock_mossy: { kind: 'tex', seed: 3218, luma: 140, prompt: `Mossy jungle rock surface seen straight on, rounded light grey stone with patches of bright green moss and tiny ferns in the cracks, light warm grey and fresh green tones, not dark. ${STYLE}` },
  temple_stone: { kind: 'tex', flat: true, seed: 3239, luma: 170, prompt: `Ancient jungle temple wall seen straight on, big rectangular carved stone blocks of varied widths laid in a running-bond pattern, light warm sandstone beige and pale grey, thin light mortar lines, only a few small patches of soft green moss, bright and sunny. ${STYLE}` },
  carpet: { kind: 'tex', seed: 3240, luma: 140, prompt: `Soft fluffy bedroom carpet seen from directly above, short dense plush pile in a calm periwinkle blue with tiny lighter and darker flecks, even cosy texture all over, ${ROADTONE}. ${STYLE}` },
  quilt: { kind: 'tex', seed: 3241, luma: 170, prompt: `Cosy patchwork quilt seen from directly above, square fabric patches in soft pastel colours, mint green, sky blue, butter yellow, pink and lilac, printed with tiny stars, dots and stripes, soft puffy stitched seams between the patches, even texture all over. ${STYLE}` },
  cloud: { kind: 'tex', seed: 3214, prompt: `Soft fluffy white cartoon clouds seen from directly above, puffy rounded cloud tops filling the whole frame, bright white with very soft pale blue and lavender shading in the gaps. ${STYLE}` },

  // ----------------------------------------------------------------- skies
  sky_beach: { kind: 'sky', horizon: 0.77, seed: 3301, w: 1536, h: 768, prompt: `Sunny tropical sky, clear bright cerulean blue gradient to pale turquoise near the horizon, big fluffy white cumulus clouds scattered around, distant calm turquoise sea along the horizon. ${SKY}` },
  sky_ice: { kind: 'sky', horizon: 0.95, seed: 3302, w: 1536, h: 768, prompt: `Pink and peach sunset sky over a distant range of snowy mountains shaped like scoops of strawberry and vanilla ice cream, soft cotton-candy clouds, warm pastel pink, lilac and gold. ${SKY}` },
  sky_volcano: { kind: 'sky', horizon: 0.88, seed: 3303, w: 1536, h: 768, prompt: `Smoky orange volcanic sky, warm amber and tangerine glow near the horizon fading to dusky red-purple above, soft billowing ash clouds, a few floating glowing embers, distant dark volcano silhouettes on the horizon, bright and friendly not scary. ${SKY}` },
  sky_castle: { kind: 'sky', horizon: 0.97, seed: 3304, w: 1536, h: 768, prompt: `Blue twilight sky at dusk, deep royal blue above fading to soft violet and warm peach glow at the horizon, first twinkling stars, a few soft lilac clouds, distant green hills along the horizon. ${SKY}` },
  sky_jungle: { kind: 'sky', horizon: 0.66, seed: 3306, w: 1536, h: 768, prompt: `Sunny tropical jungle sky, bright clear blue gradient to soft pale aqua near the horizon, big fluffy white clouds, a distant range of misty green jungle-covered mountains with a thin far waterfall along the horizon. ${SKY}` },
  sky_bedroom: { kind: 'sky', horizon: 0.85, seed: 3308, w: 1536, h: 768, prompt: `Friendly night sky at bedtime, deep blue above fading to soft violet and a warm peach glow at the horizon, a big glowing crescent moon, lots of twinkling stars, a few soft lilac clouds, a gentle row of dark rooftops and round trees along the horizon with a few warm lit windows. ${SKY}` },
  sky_star: { kind: 'sky', seed: 3307, w: 1536, h: 768, prompt: `Deep outer space, colourful swirling pink, violet and teal nebula clouds, dense twinkling starfield, a couple of small distant cartoon planets with rings, magical and bright. ${SKY}` },

  // ------------------------------------------------------------- key art
  // Title screen: headroom in the top third for logo.png.
  title: {
    kind: 'title', seed: 3405, w: 1536, h: 864,
    prompt: `Dynamic action scene from a colourful family kart racing game. In front, a happy fair-skinned young boy with short messy brown hair and a huge grin, wearing a blue hoodie with a big yellow star on the chest and orange racing stripes, `
      + `drives a small bright blue go-kart with yellow and red trim, leading the race towards the viewer. Close behind him a cheerful big grown-up dad with light peach skin like the boy, completely bald head with a short black beard wearing a shiny golden crown and a royal blue robe drives a red kart, `
      + `next to him a smiling grown-up adult woman, his mum, with pale skin and long brown hair with a flower in it and a purple dress drives a purple kart, and a small black cat with bright mint-green eyes drives a tiny pink kart. `
      + `Tropical beach race track with palm trees, turquoise sea, golden sand, bunting flags, sparkles, speed lines and motion blur, drifting dust, bright sunny blue sky. Wide shot: the karts and characters are in the lower two thirds of the picture and the top third is open clear blue sky with nothing in it, leaving room for a logo. ${SCENE}`,
  },
  // Same cast, tight close-up with no headroom (loading / results / Steam art).
  title_close: {
    kind: 'title', seed: 3405, w: 1536, h: 864,
    prompt: `Dynamic action scene from a colourful family kart racing game. In front, a happy fair-skinned young boy with short messy brown hair and a huge grin, wearing a blue hoodie with a big yellow star on the chest and orange racing stripes, `
      + `drives a small bright blue go-kart with yellow and red trim, leading the race towards the viewer. Close behind him a cheerful big grown-up dad with light peach skin like the boy, completely bald head with a short black beard wearing a shiny golden crown and a royal blue robe drives a red kart, `
      + `next to him a smiling grown-up adult woman, his mum, with pale skin and long brown hair with a flower in it and a purple dress drives a purple kart, and a small black cat with bright mint-green eyes drives a tiny pink kart. `
      + `Tropical beach race track with palm trees, turquoise sea, golden sand, bunting flags, sparkles, speed lines and motion blur, drifting dust, bright sunny blue sky. ${SCENE}`,
  },

  // ----------------------------------------------------------- track cards
  track_beach: { kind: 'track', seed: 3501, w: 1344, h: 768, prompt: `Bubbly Beach kart race track: a wide sandy-edged road curving along a tropical beach, palm trees, turquoise lagoon with a jump ramp over the water, soap bubbles floating in the air, sunny blue sky. ${SCENE}` },
  track_ice: { kind: 'track', seed: 3502, w: 1344, h: 768, prompt: `Ice Cream Peaks kart race track: a winding pink and white road climbing snowy mountains made of giant scoops of strawberry and vanilla ice cream, waffle cone towers, sprinkles, candy canes, pink sunset sky. ${SCENE}` },
  track_volcano: { kind: 'track', seed: 3503, w: 1344, h: 768, prompt: `Taco Volcano kart race track: a dark stone road bridging over rivers of glowing orange lava, a big friendly volcano shaped like a taco in the background puffing smoke, ramps, orange sky. ${SCENE}` },
  track_castle: { kind: 'track', seed: 3504, w: 1344, h: 768, prompt: `King Dad's Castle kart race track: a cobblestone road through a grand fairy-tale castle courtyard, tall stone towers, colourful banners showing a golden crown, torches, blue twilight sky. ${SCENE}` },
  track_jungle: { kind: 'track', seed: 3506, w: 1344, h: 768, prompt: `Jungle Jumble kart race track, an empty race track with no karts and no drivers: a reddish dirt road with red and white kerbs winding through a bright sunny jungle, giant green leaves and hanging vines, a big waterfall pouring into a muddy river where a friendly smiling hippo bathes, a wooden rope bridge, a mossy grey stone temple with a big carved smiling black cat face with glowing mint green eyes, colourful parrots and tropical fruit, blue sky. ${SCENE}` },
  track_bedroom: { kind: 'track', seed: 3507, w: 1344, h: 768, prompt: `Toy Box Turbo kart race track, an empty race track with no karts and no drivers: a bright orange plastic toy car race track winding across a giant cosy child's bedroom at bedtime, a ramp made of a stack of colourful books up onto a wooden desk with giant crayons and colourful toy building bricks, a big bed with a patchwork quilt and pillows where a fluffy black cat sleeps curled up, a yellow toy slide, glow-in-the-dark stars on the ceiling, a warm glowing desk lamp, a moon in the window, toys everywhere. ${SCENE}` },
  track_star: { kind: 'track', seed: 3505, w: 1344, h: 768, prompt: `Star Road kart race track: a glowing rainbow road floating in outer space with no walls, looping through colourful nebula clouds, stars and small cartoon planets. ${SCENE}` },

  // ---------------------------------------------------------- item icons
  item_taco_bomb: { kind: 'icon', seed: 3621, prompt: `A round black cartoon bomb with a short lit sparkling fuse, sitting inside a crunchy yellow taco shell with green lettuce and red tomato poking out. ${SMALL}. ${ICON}` },
  item_rocket: { kind: 'icon', seed: 3622, prompt: `A small cartoon homing rocket missile flying diagonally up to the right, purple body with a yellow star on its side, silver nose cone, red fins, a bright orange flame puff at its tail. ${SMALL}. ${ICON}` },
  item_tnt: { kind: 'icon', seed: 3623, prompt: `A small red wooden crate seen at a three-quarter angle, with a black and yellow warning stripe band around it and a short lit fuse sparking on top, chunky cartoon explosive box. ${SMALL}. ${ICON}` },
  item_nitro: { kind: 'icon', seed: 3604, prompt: `A bright green glowing cartoon crate with lightning bolt symbols on its sides, fizzing green sparks. ${ICON}` },
  item_icecream: { kind: 'icon', seed: 3605, prompt: `A big dropped scoop of melting strawberry ice cream splatting into a gooey pink puddle, with a waffle cone lying on its side and sprinkles. ${ICON}` },
  item_shield: { kind: 'icon', seed: 3606, prompt: `A big shiny translucent light blue soap bubble shield sphere with rainbow sheen and a white highlight, sparkles around it. ${ICON}` },
  item_turbo: { kind: 'icon', seed: 3637, prompt: `On a plain white background: a small red and orange cartoon turbo rocket booster pointing to the right with a big blue and orange flame blasting out of its back end, speed lines. ${SMALL}. ${ICON}` },
  item_superstar: { kind: 'icon', seed: 3608, prompt: `A big shining golden five-pointed star with a happy smiling face, rainbow sparkle trail swirling around it. ${ICON}` },
  item_remote: { kind: 'icon', seed: 3609, prompt: `A chunky black TV remote control with colourful round buttons and a big red pause button, a small golden crown sticker on it. ${ICON}` },
  item_warp: { kind: 'icon', seed: 3610, prompt: `A glowing magic blue and purple warp orb sphere with a swirling spiral inside and a tail of stars, crackling energy. ${ICON}` },
  star: { kind: 'icon', seed: 3631, prompt: `A single chunky bright golden yellow five-pointed star collectible, glossy and puffy with rounded points, a small white shine, thick dark navy outline. ${SMALL}. ${ICON}` },
  itembox: { kind: 'icon', seed: 3612, prompt: `A floating translucent rainbow coloured cube item box with a big bold white question mark on its front face, glossy glass edges, sparkles. ${ICON}` },
};

// Shipped path per kind (texpost writes it; used for the skip check).
const OUTFILE = {
  tex: n => `assets/tex/${n}.jpg`,
  sky: n => `assets/tex/${n}.jpg`,
  title: n => `assets/ui/${n}.jpg`,
  track: n => `assets/ui/${n}.jpg`,
  icon: n => `assets/ui/${n}.png`,
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

const graph = (prompt, seed, w, h, tag) => ({
  1: { class_type: 'UNETLoader', inputs: { unet_name: UNET, weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: CLIP, type: 'krea2' } },
  3: { class_type: 'VAELoader', inputs: { vae_name: VAE } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  6: { class_type: 'EmptySD3LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
  7: {
    class_type: 'KSampler',
    inputs: {
      model: ['1', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0],
      seed, steps: 8, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0,
    },
  },
  8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
  9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: `otr/${tag}` } },
});

// MOSS-Image: Flux2 latent + VAE, qwen3.5 text encoder, the 4-step distill LoRA (no img2img with it)
const graphMoss = (prompt, seed, w, h, tag) => ({
  1: { class_type: 'UNETLoader', inputs: { unet_name: MOSS_UNET, weight_dtype: 'default' } },
  2: { class_type: 'CLIPLoader', inputs: { clip_name: MOSS_TE, type: 'moss_image', device: 'default' } },
  3: { class_type: 'VAELoader', inputs: { vae_name: MOSS_VAE } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['2', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 0] } },
  6: { class_type: 'EmptyFlux2LatentImage', inputs: { width: w, height: h, batch_size: 1 } },
  20: { class_type: 'LoraLoaderModelOnly', inputs: { model: ['1', 0], lora_name: MOSS_LORA, strength_model: 1.0 } },
  7: { class_type: 'KSampler', inputs: { model: ['20', 0], positive: ['4', 0], negative: ['5', 0], latent_image: ['6', 0], seed, steps: 4, cfg: 1.0, sampler_name: 'euler', scheduler: 'simple', denoise: 1.0 } },
  8: { class_type: 'VAEDecode', inputs: { samples: ['7', 0], vae: ['3', 0] } },
  9: { class_type: 'SaveImage', inputs: { images: ['8', 0], filename_prefix: `otr/${tag}` } },
});

function specOf(name) {
  const s = ASSETS[name];
  const o = { w: 1024, h: 1024, ...s };
  if (process.env.SEEDOFS) o.seed += Number(process.env.SEEDOFS);   // for trying variants; bake the winner into the spec
  return o;
}
function rawPath(name, model = BACKEND === 'openrouter' ? OR_MODEL : BACKEND === 'moss' ? MOSS_UNET : UNET) {
  const s = specOf(name);
  const h = crypto.createHash('sha1').update(`${s.prompt}|${s.seed}|${s.w}x${s.h}|${model}`).digest('hex').slice(0, 8);
  return path.join(RAW, `${name}-${h}.png`);
}
// A cached raw of the SAME prompt from either backend counts (so --force
// re-post-processing never needs the GPU or an API key); the current
// backend's render wins when both exist.
function cachedRaw(name) {
  return [rawPath(name), rawPath(name, UNET), rawPath(name, MOSS_UNET), rawPath(name, OR_MODEL)].find(p => fs.existsSync(p));
}

async function submit(prompt) {
  const res = await fetch(`${HOST}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(`submit failed: ${JSON.stringify(body).slice(0, 700)}`);
  const id = body.prompt_id;
  for (let i = 0; i < 600; i++) {       // 20 min: first run after an idle unload is ~100 s
    await sleep(1500);
    const h = await (await fetch(`${HOST}/history/${id}`)).json();
    const e = h[id];
    if (!e) {
      // Dead-worker guard: after an XPU OOM the prompt_worker thread can die
      // while HTTP stays up — prompts then sit in the queue forever.
      if (i === 40) {
        const q = await (await fetch(`${HOST}/queue`)).json();
        if (!q.queue_running.length && q.queue_pending.some(p => p[1] === id)) {
          await fetch(`${HOST}/queue`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ delete: [id] }) });
          throw new Error('ComfyUI is not executing anything (prompt_worker thread dead?) — needs `docker restart comfy-krea2`, or use BACKEND=openrouter');
        }
      }
      continue;
    }
    if (e.status?.status_str === 'error') {
      const m = e.status.messages.find(x => x[0] === 'execution_error')?.[1];
      throw new Error(`run failed in ${m?.node_type}: ${(m?.exception_message || JSON.stringify(e.status.messages)).slice(0, 400).trim()}`);
    }
    return e;
  }
  throw new Error('timed out after 20 min');
}

// Unload every model from VRAM. /free only sets a flag; the idle worker acts
// on it within a moment.
async function freeVram() {
  await fetch(`${HOST}/free`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"unload_models":true}' });
  await sleep(2500);
}

// SPLIT=1 (opt-in, UNPROVEN): card1 is shared (jv-probe's speech server held
// ~5.4 GB of it on 2026-09-25) and ComfyUI's XPU free-memory estimate only
// sees its OWN allocations, so with the 5 GB text encoder resident it loads
// the 13 GB UNET anyway and dies with UR_RESULT_ERROR_OUT_OF_DEVICE_MEMORY
// instead of offloading. The idea: pass 1 runs only the text encode (output
// cached by ComfyUI), unload, pass 2 runs the full graph with the encode a
// cache hit. CAUTION: a /free issued AFTER such an OOM (model left half-moved)
// OOMed again inside unload_all_models and KILLED ComfyUI's prompt_worker
// thread — the HTTP side stays up and queues forever; only a container
// restart fixes it. Only use SPLIT on a freshly started, never-OOMed ComfyUI.
const SPLIT = process.env.SPLIT === '1';

async function renderComfy(name) {
  const s = specOf(name);
  const g = (BACKEND === 'moss' ? graphMoss : graph)(s.prompt, s.seed, s.w, s.h, name);
  if (SPLIT) {
    await freeVram();
    await submit({ 2: g[2], 4: g[4], 5: g[5], 90: { class_type: 'PreviewAny', inputs: { source: ['5', 0] } }, 91: { class_type: 'PreviewAny', inputs: { source: ['4', 0] } } });
    await freeVram();
  }
  const e = await submit(g);
  const imgs = Object.values(e.outputs || {}).flatMap(o => o.images || []);
  if (!imgs.length) throw new Error('finished with no image output');
  const f = imgs[0];
  const url = `${HOST}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder || '')}&type=${f.type || 'output'}`;
  return Buffer.from(await (await fetch(url)).arrayBuffer());
}

// Fallback backend: the same Krea 2 family, hosted, through OpenRouter's
// /api/v1/images (NOT chat/completions — Krea models 404 there). It takes
// `aspect_ratio` (1:1 -> 1024², 16:9 -> 1376x768, 2:1 -> ~1440x720) and
// ignores `size`. Seed: two CONCURRENT identical requests came back
// different, but repeating a request later returned byte-identical PNGs, so
// treat the raw cache in work/krea/ as the source of truth, and change the
// seed (SEEDOFS=n to try variants) to get a different picture. ~$0.015 and ~30 s per image, runs 4 at a time.
async function renderOpenRouter(name) {
  const s = specOf(name);
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('BACKEND=openrouter needs OPENROUTER_API_KEY');
  const r = s.w / s.h;
  const aspect_ratio = r > 1.6 ? '16:9' : '1:1';   // Krea accepts 1:1 4:3 3:2 16:9 4:5 2:3 9:16 — no 2:1; skies are cropped
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/images', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: OR_MODEL, prompt: s.prompt, aspect_ratio, seed: s.seed }),
        signal: AbortSignal.timeout(300000),
      });
      const j = await res.json();
      const b64 = j.data?.[0]?.b64_json;
      if (!b64) throw new Error(JSON.stringify(j).slice(0, 300));
      return Buffer.from(b64, 'base64');
    } catch (e) {
      if (attempt >= 3) throw e;
      await sleep(5000 * attempt);
    }
  }
}

async function render(name) {
  const buf = BACKEND === 'openrouter' ? await renderOpenRouter(name) : await renderComfy(name);
  fs.mkdirSync(RAW, { recursive: true });
  fs.writeFileSync(rawPath(name), buf);
}

// --------------------------------------------------------------------- CLI
const argv = process.argv.slice(2);
const force = argv.includes('--force');
const regen = argv.includes('--regen');
const sel = argv.filter(a => !a.startsWith('--'));

if (argv.includes('--rawpath')) {        // print the cache path an asset's raw render lives at
  for (const n of sel) console.log(rawPath(n));
  process.exit(0);
}
if (argv.includes('--list')) {
  for (const [n, s] of Object.entries(ASSETS)) console.log(`${n.padEnd(16)} ${s.kind.padEnd(6)} seed ${s.seed}`);
  process.exit(0);
}
if (argv.includes('--credits')) {       // machine-readable dump for CREDITS.md
  console.log(JSON.stringify({ model: MODEL, assets: Object.fromEntries(Object.entries(ASSETS).map(([n, s]) => [n, { ...specOf(n), out: OUTFILE[s.kind](n) }])) }, null, 1));
  process.exit(0);
}

const kinds = new Set(Object.values(ASSETS).map(s => s.kind));
let want = [...new Set(sel.length ? sel.flatMap(a => kinds.has(a) ? Object.keys(ASSETS).filter(n => ASSETS[n].kind === a) : [a]) : Object.keys(ASSETS))];
if (want.includes('logo')) {
  console.log(execFileSync('bash', [path.join(ROOT, 'tools', 'logo.sh')], { encoding: 'utf8' }).trim());
  want = want.filter(n => n !== 'logo');
}
for (const n of want) if (!ASSETS[n]) { console.error(`no such asset: ${n}`); process.exit(1); }

let failed = 0;
async function one(name) {
  const s = specOf(name);
  const out = path.join(ROOT, OUTFILE[s.kind](name));
  if (fs.existsSync(out) && !force && !regen) { console.log(`${name.padEnd(16)} exists, skip`); return; }
  let msg = `${name.padEnd(16)} `;
  try {
    let raw = cachedRaw(name);
    if (!raw || regen) {
      const t0 = Date.now();
      await render(name);
      raw = rawPath(name);
      msg += `rendered ${((Date.now() - t0) / 1000).toFixed(0)}s  `;
    } else msg += 'cached raw  ';
    msg += execFileSync('python3', [path.join(ROOT, 'tools', 'texpost.py'), s.kind, raw, out, ...(s.luma ? ['--luma', String(s.luma)] : []), ...(s.flat ? ['--flat'] : []), ...(s.horizon ? ['--horizon', String(s.horizon)] : [])], { encoding: 'utf8' }).trim();
  } catch (e) {
    failed++;
    msg += `FAILED: ${e.message}`;
  }
  console.log(msg);
}
// The B60 renders one at a time anyway; the hosted API is latency-bound.
const CONC = BACKEND === 'openrouter' ? 4 : 1;
const queue = [...want];
await Promise.all(Array.from({ length: CONC }, async () => { while (queue.length) await one(queue.shift()); }));
if (failed) { console.error(`${failed} failed`); process.exit(1); }
