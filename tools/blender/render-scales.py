# render-scales.py — pre-rendered orientation atlas for one dark-glass snake scale.
#
#   blender -b -P tools/blender/render-scales.py
#   blender -b -P tools/blender/render-scales.py -- --px 96 --samples 32 --cells "4,0;6,1;8,4" --out /tmp/x
#   blender -b -P tools/blender/render-scales.py -- --set FILM_NM=420 --set ROUGHNESS=0.1
#
# One plate, one soft sun, orthographic face-on camera. The sun direction per
# cell comes from a half-vector grid (hA, hB) in the plate's local frame; the
# runtime picks the cell matching how each plate sits relative to the light.
# Reproducible: factory settings, fixed seed, one global exposure/tonemap for
# all cells (neighbouring cells must be continuous). GPU + denoiser mean reruns
# are visually identical but not bit-identical.

import bpy, sys, os, json, math, time, tempfile
import numpy as np
from mathutils import Vector

# ───────────────────────── tunables ─────────────────────────
# sprite contract (72-unit box, origin top-left, +x right, +y DOWN)
BOX = 72.0
TIP = (12.0, 36.0)
BASE_TOP = (60.0, 8.0)
BASE_BOT = (60.0, 64.0)
ARC_R = 56.0

# physical form (sprite units) — a smooth cabochon over the exact outline
EDGE_H = 1.2          # shoulder height (what the rim roll rises to)
DOME_H = 3.0          # extra paraboloid crown height at the centre; sets how fast the glint slides
ROLL_EXP = 0.65       # shoulder profile exponent: 0.5 = elliptical (tight rim), higher = softer, wider rim glints
SOFT_N = 3.0          # soft-min order joining the three arc distance fields (higher = crisper corner ridges)
KEEL_H = 0.10         # longitudinal keel along y=36 (0 disables)
KEEL_W = 5.0          # keel half-width (units)
SEG_ARC = 72          # outline samples per arc
RINGS = 96            # concentric rings rim→centre

# material — dark teal obsidian-like dielectric with a thin film
BODY_OKLCH = (0.30, 0.05, 175.0)   # body tint (diffuse albedo), per brief
BODY_ALBEDO_GAIN = 2.0             # scales the albedo without changing hue
ROUGHNESS = 0.18
IOR = 1.52
FILM_NM = 472.0       # 'Thin Film Thickness' (nm) — sets the hue at normal incidence
FILM_IOR = 1.25       # 'Thin Film IOR' — lower = hue shifts faster with angle
COAT_WEIGHT = 0.12    # clear lacquer over the film: the small crisp pale core inside the halo
COAT_ROUGHNESS = 0.05
TRANSMISSION = 0.0    # >0 makes the body transmissive (needed for dispersion to do anything)
DISPERSION = 0.0      # 'Transmission Dispersion Scale'; inert while TRANSMISSION == 0

# light + world
SUN_ANGLE_DEG = 10.0
SUN_STRENGTH = 1.0
WORLD_STRENGTH = 0.02     # uniform ambient
HORIZON_STRENGTH = 0.6    # extra ambient concentrated at the horizon: only the steep rim mirrors it
HORIZON_POW = 3.0         # falloff of that band away from the horizon, (1 − |z|)^pow
WORLD_RGB = (0.80, 0.90, 1.00)
LZ_MIN = 0.05         # clamp for grazing light directions

# grid
HA = [-0.6, -0.45, -0.3, -0.15, 0.0, 0.15, 0.3, 0.45, 0.6]
HB = [0.0, 0.15, 0.3, 0.45, 0.6]

# render
CELL_PX = 320
SAMPLES = 192
SEED = 7

# grade (identical for every cell)
EXPOSURE = 0.8        # linear gain before the shoulder
SHOULDER_KNEE = 0.55  # below this the response is linear
PEAK = 0.94           # max output channel value (never flat 255 white)
WHITE_BLEED = 0.35    # how far over-range highlights desaturate toward white (0 = pure hue)
OCC_START = 0.60      # occlusion begins at this fraction of the plate's tip→base extent
OCC_STRENGTH = 0.50   # darkening at the base edge (post-multiply, not physical)

WEBP_QUALITY = 90
PREVIEW_BG = (0x07, 0x09, 0x0d)
PREVIEW_SCALE = 2     # preview is 1/N of the atlas resolution
# ─────────────────────────────────────────────────────────────

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.normpath(os.path.join(HERE, "..", "..", "assets", "scales"))
CELLS = None
TMP_DIR = None


def parse_args():
    global CELL_PX, SAMPLES, OUT_DIR, CELLS, TMP_DIR
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    i = 0
    while i < len(argv):
        a, v = argv[i], (argv[i + 1] if i + 1 < len(argv) else None)
        if a == "--px": CELL_PX = int(v)
        elif a == "--samples": SAMPLES = int(v)
        elif a == "--out": OUT_DIR = os.path.abspath(v)
        elif a == "--tmp": TMP_DIR = os.path.abspath(v)
        elif a == "--cells": CELLS = [tuple(int(n) for n in c.split(",")) for c in v.split(";")]
        elif a == "--set":
            k, val = v.split("=")
            assert k in globals(), "unknown tunable " + k
            globals()[k] = type(globals()[k])(float(val))
        else: raise SystemExit("unknown arg " + a)
        i += 2


# ───────────────────────── colour helpers ─────────────────────────
def oklch_to_linear(L, C, h):
    a, b = C * math.cos(math.radians(h)), C * math.sin(math.radians(h))
    l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3
    return (max(0.0, 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
            max(0.0, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
            max(0.0, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s))


def linear_to_oklab(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    l = np.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    m = np.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    s = np.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return (0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
            1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
            0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s)


def srgb_oetf(x):
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(np.maximum(x, 1e-9), 1 / 2.4) - 0.055)


def srgb_eotf(x):
    return np.where(x <= 0.04045, x / 12.92, np.power((x + 0.055) / 1.055, 2.4))


# ───────────────────────── geometry ─────────────────────────
def arc_centre(p, q, r):
    """Centre of the radius-r arc p→q that bulges to the LEFT of p→q in y-down sprite
    coords (outward for our outline, which runs clockwise on screen)."""
    p, q = np.array(p), np.array(q)
    mid, d = (p + q) / 2, q - p
    half = np.linalg.norm(d) / 2
    left = np.array([d[1], -d[0]]) / (2 * half)
    return mid - left * math.sqrt(r * r - half * half)


def arc(p, q, r, n):
    c = arc_centre(p, q, r)
    a0 = math.atan2(p[1] - c[1], p[0] - c[0])
    a1 = math.atan2(q[1] - c[1], q[0] - c[0])
    da = (a1 - a0 + math.pi) % (2 * math.pi) - math.pi
    return [c + r * np.array([math.cos(a0 + da * i / n), math.sin(a0 + da * i / n)]) for i in range(n)]


def outline():
    pts = arc(TIP, BASE_TOP, ARC_R, SEG_ARC) + arc(BASE_TOP, BASE_BOT, ARC_R, SEG_ARC) + arc(BASE_BOT, TIP, ARC_R, SEG_ARC)
    pts = np.array(pts)
    assert pts.min() >= 0 and pts.max() <= BOX, "outline leaves the sprite box"
    return pts


def build_plate():
    o = outline()
    x, y = o[:, 0], o[:, 1]
    cross = x * np.roll(y, -1) - np.roll(x, -1) * y
    area = cross.sum() / 2
    cen = np.array([((x + np.roll(x, -1)) * cross).sum(), ((y + np.roll(y, -1)) * cross).sum()]) / (6 * area)
    n = len(o)
    # ring parameter t: 0 at rim → 1 at centre, denser inside the bevel
    nb = RINGS // 2
    ts = [0.25 * (i / nb) ** 2 for i in range(nb)] + [0.25 + 0.75 * i / (RINGS - nb) for i in range(RINGS - nb)]
    verts, faces = [], []
    # the outline is the intersection of three radius-56 discs; inside, the distance to
    # arc i is R − |p − c_i|. A soft-min of the three is exactly 0 on the outline and
    # smooth inside, so the body has no mitre creases.
    centres = [arc_centre(TIP, BASE_TOP, ARC_R), arc_centre(BASE_TOP, BASE_BOT, ARC_R), arc_centre(BASE_BOT, TIP, ARC_R)]

    def depth(q):
        ds = [max(ARC_R - math.hypot(q[0] - c[0], q[1] - c[1]), 0.0) for c in centres]
        if min(ds) <= 1e-9: return 0.0
        return sum(d ** -SOFT_N for d in ds) ** (-1.0 / SOFT_N)

    dmax = depth(cen)
    rmax = float(np.linalg.norm(o - cen, axis=1).max())

    def to_world(px, py, z):       # sprite (x right, y down) → Blender (x right, y UP)
        return (px - BOX / 2, BOX / 2 - py, z)

    def height(q):
        u = min(depth(q) / dmax, 1.0)
        f = (1 - (1 - u) ** 2) ** ROLL_EXP
        r2 = ((q[0] - cen[0]) ** 2 + (q[1] - cen[1]) ** 2) / (rmax * rmax)
        crown = EDGE_H + DOME_H * (1 - r2) + KEEL_H * math.exp(-((q[1] - BOX / 2) / KEEL_W) ** 2)
        return crown * f

    for p in o:                                            # ring 0: bottom of the wall
        verts.append(to_world(p[0], p[1], -0.6))
    for t in ts:
        for p in o:
            q = cen + (p - cen) * (1 - t)
            verts.append(to_world(q[0], q[1], height(q)))
    verts.append(to_world(cen[0], cen[1], height(cen)))
    rings = len(ts) + 1
    for r in range(rings - 1):
        for i in range(n):
            a, b = r * n + i, r * n + (i + 1) % n
            faces.append((a, a + n, b + n, b))             # CCW seen from +Z
    top = len(verts) - 1
    last = (rings - 1) * n
    for i in range(n):
        faces.append((last + i, top, last + (i + 1) % n))
    faces.append(tuple(range(n)))                          # flat underside
    me = bpy.data.meshes.new("plate")
    me.from_pydata(verts, [], faces)
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new("plate", me)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob, (float(x.min()), float(x.max()))


# ───────────────────────── material / scene ─────────────────────────
USED_SOCKETS = {}


def set_socket(node, name, value):
    if name not in node.inputs:
        USED_SOCKETS[name] = "MISSING in this Blender build"
        print("!! socket missing:", name, "— available:", [i.name for i in node.inputs])
        return
    node.inputs[name].default_value = value
    USED_SOCKETS[name] = value if not hasattr(value, "__len__") else [round(float(v), 5) for v in value]


def build_material():
    m = bpy.data.materials.new("dark-glass")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(p.outputs[0], out.inputs["Surface"])
    r, g, b = oklch_to_linear(*BODY_OKLCH)
    k = BODY_ALBEDO_GAIN
    set_socket(p, "Base Color", (r * k, g * k, b * k, 1.0))
    set_socket(p, "Roughness", ROUGHNESS)
    set_socket(p, "IOR", IOR)
    set_socket(p, "Thin Film Thickness", FILM_NM)
    set_socket(p, "Thin Film IOR", FILM_IOR)
    set_socket(p, "Coat Weight", COAT_WEIGHT)
    set_socket(p, "Coat Roughness", COAT_ROUGHNESS)
    set_socket(p, "Transmission Weight", TRANSMISSION)
    set_socket(p, "Transmission Dispersion Scale", DISPERSION)
    return m


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.render.engine = "CYCLES"
    info = {"engine": "CYCLES", "samples": SAMPLES, "seed": SEED}
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices: d.use = True
        s.cycles.device = "GPU"
        info["device"] = "GPU (Metal)"
    except Exception as e:
        s.cycles.device = "CPU"
        info["device"] = "CPU"
        print("GPU unavailable, using CPU:", e)
    s.cycles.samples = SAMPLES
    s.cycles.use_adaptive_sampling = False
    s.cycles.seed = SEED
    s.cycles.use_animated_seed = False
    s.cycles.max_bounces = 8
    s.cycles.caustics_reflective = False
    s.cycles.caustics_refractive = False
    try:
        s.cycles.use_denoising = True
        s.cycles.denoiser = "OPENIMAGEDENOISE"
        info["denoiser"] = "OPENIMAGEDENOISE"
    except Exception as e:
        s.cycles.use_denoising = False
        info["denoiser"] = "none"
        print("denoiser unavailable:", e)
    s.render.film_transparent = True
    s.render.resolution_x = s.render.resolution_y = CELL_PX
    s.render.resolution_percentage = 100
    s.render.use_file_extension = True
    im = s.render.image_settings
    if hasattr(im, "media_type"): im.media_type = "IMAGE"
    im.file_format = "OPEN_EXR"          # scene-linear float; the grade happens in numpy below
    im.color_mode = "RGBA"
    im.color_depth = "32"

    w = bpy.data.worlds.new("w")
    w.use_nodes = True
    wn, wl = w.node_tree.nodes, w.node_tree.links
    bg = next(n for n in wn if n.type == "BACKGROUND")
    bg.inputs["Color"].default_value = (*WORLD_RGB, 1.0)
    geo = wn.new("ShaderNodeNewGeometry")                 # Incoming = direction on the sky sphere
    sep = wn.new("ShaderNodeSeparateXYZ")
    wl.new(geo.outputs["Incoming"], sep.inputs[0])

    def math_node(op, a, b):
        n = wn.new("ShaderNodeMath")
        n.operation = op
        for sock, v in zip(n.inputs, (a, b)):
            if isinstance(v, (int, float)): sock.default_value = v
            elif v is not None: wl.new(v, sock)
        return n.outputs[0]

    absz = math_node("ABSOLUTE", sep.outputs["Z"], None)
    band = math_node("POWER", math_node("SUBTRACT", 1.0, absz), HORIZON_POW)
    wl.new(math_node("ADD", math_node("MULTIPLY", band, HORIZON_STRENGTH), WORLD_STRENGTH), bg.inputs["Strength"])
    s.world = w

    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = BOX
    co = bpy.data.objects.new("cam", cam)
    co.location = (0, 0, 60)             # default camera looks down −Z with +Y up
    s.collection.objects.link(co)
    s.camera = co

    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = SUN_STRENGTH
    sun.angle = math.radians(SUN_ANGLE_DEG)
    so = bpy.data.objects.new("key", sun)
    s.collection.objects.link(so)

    plate, xspan = build_plate()
    plate.data.materials.append(build_material())
    return s, so, xspan, info


# ───────────────────────── light grid ─────────────────────────
def light_dir(hA, hB):
    """Local frame: A = sprite +x, B = sprite +y (image down), n = toward camera."""
    hn = math.sqrt(1 - hA * hA - hB * hB)
    L = np.array([2 * hn * hA, 2 * hn * hB, 2 * hn * hn - 1])     # 2(H·V)H − V, V = (0,0,1)
    clamped = bool(L[2] < LZ_MIN)
    if clamped:
        L[2] = LZ_MIN
        L /= np.linalg.norm(L)
    return L, clamped


def aim_sun(so, L):
    world = Vector((L[0], -L[1], L[2]))   # sprite B is image-down → Blender −Y
    so.rotation_euler = world.to_track_quat("Z", "Y").to_euler()   # a sun shines along its −Z


# ───────────────────────── grade / pack ─────────────────────────
def grade(lin, xspan):
    """EXR (premultiplied, scene-linear) → straight-alpha sRGB floats, top-down rows."""
    a = lin[..., 3:4]
    rgb = np.where(a > 1e-4, lin[..., :3] / np.maximum(a, 1e-4), 0.0) * EXPOSURE
    rgb = np.maximum(rgb, 0.0)
    m = rgb.max(axis=-1, keepdims=True)
    k, top = SHOULDER_KNEE, PEAK
    over = np.maximum(m - k, 0.0)
    m2 = np.where(m > k, k + (top - k) * (1 - np.exp(-over / (top - k))), m)
    scaled = rgb * (m2 / np.maximum(m, 1e-6))             # hue-preserving shoulder
    bleed = WHITE_BLEED * (1 - np.exp(-over / 2.0))       # hot cores lean toward white, a little
    rgb = scaled + (m2 - scaled) * bleed
    px = rgb.shape[1]
    xs = (np.arange(px) + 0.5) / px * BOX
    u = np.clip(((xs - xspan[0]) / (xspan[1] - xspan[0]) - OCC_START) / (1 - OCC_START), 0, 1)
    occ = 1 - OCC_STRENGTH * (u * u * (3 - 2 * u))
    rgb = rgb * occ[None, :, None]
    return np.concatenate([srgb_oetf(rgb), np.clip(a, 0, 1)], axis=-1).astype(np.float32)


def save_image(arr, path, fmt, quality=None):
    """arr: top-down straight-alpha sRGB floats (h, w, 4)."""
    h, w = arr.shape[:2]
    img = bpy.data.images.new("out", w, h, alpha=True)
    img.alpha_mode = "STRAIGHT"
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1]).ravel())   # Blender rows are bottom-up
    img.filepath_raw = path
    img.file_format = fmt
    if quality is None: img.save()
    else: img.save(quality=quality)
    bpy.data.images.remove(img)


GLYPH = {"0": ["111", "101", "101", "101", "111"], "1": ["010", "110", "010", "010", "111"],
         "2": ["111", "001", "111", "100", "111"], "3": ["111", "001", "111", "001", "111"],
         "4": ["101", "101", "111", "001", "001"], "5": ["111", "100", "111", "001", "111"],
         "6": ["111", "100", "111", "101", "111"], "7": ["111", "001", "010", "010", "010"],
         "8": ["111", "101", "111", "101", "111"], "9": ["111", "101", "111", "001", "111"],
         "-": ["000", "000", "111", "000", "000"], "+": ["000", "010", "111", "010", "000"],
         ".": ["000", "000", "000", "000", "010"], " ": ["000"] * 5,
         "A": ["010", "101", "111", "101", "101"], "B": ["110", "101", "110", "101", "110"]}


def draw_text(img, x, y, text, scale, colour):
    for ch in text:
        g = GLYPH.get(ch, GLYPH[" "])
        for r in range(5):
            for c in range(3):
                if g[r][c] == "1":
                    img[y + r * scale:y + (r + 1) * scale, x + c * scale:x + (c + 1) * scale, :3] = colour
        x += 4 * scale


def make_preview(sheet):
    n = PREVIEW_SCALE
    lin = np.concatenate([srgb_eotf(sheet[..., :3]) * sheet[..., 3:4], sheet[..., 3:4]], axis=-1)
    h, w = lin.shape[0] // n, lin.shape[1] // n
    lin = lin[:h * n, :w * n].reshape(h, n, w, n, 4).mean(axis=(1, 3))
    bg = srgb_eotf(np.array(PREVIEW_BG) / 255.0)
    out = np.ones((h, w, 4), np.float32)
    out[..., :3] = srgb_oetf(lin[..., :3] + bg * (1 - lin[..., 3:4]))
    cp = CELL_PX // n
    sc = max(1, cp // 80)
    for r, hb in enumerate(HB):
        for c, ha in enumerate(HA):
            draw_text(out, c * cp + 4, r * cp + 4, "A%+.2f B%+.2f" % (ha, hb), sc, (0.42, 0.45, 0.5))
    return out


def stats(cell):
    """Taste metrics for one graded cell: fraction of plate pixels sitting on the tonemap
    cap (within 8/255 of PEAK), fraction >= 200/255, chroma-weighted hue spread (deg), mean L."""
    a = cell[..., 3] > 0.5
    rgb = cell[..., :3][a]
    if not len(rgb): return 0, 0, 0, 0
    cap = float(srgb_oetf(np.array(PEAK))) - 8 / 255
    clip = float((rgb.max(axis=-1) >= cap).mean())
    hot = float((rgb.max(axis=-1) >= 200 / 255).mean())
    L, A, B = linear_to_oklab(srgb_eotf(rgb))
    C = np.hypot(A, B)
    sel = (C > 0.04) & (L > 0.25)                         # only pixels that visibly carry colour
    if sel.sum() < 20: return clip, hot, 0.0, float(L.mean())
    hue = np.degrees(np.arctan2(B[sel], A[sel])) % 360
    wgt = C[sel]
    order = np.argsort(hue)
    hue, wgt = hue[order], wgt[order] / wgt.sum()
    # smallest arc containing 98% of the chroma weight
    hh = np.concatenate([hue, hue + 360])
    cw = np.concatenate([[0], np.cumsum(np.concatenate([wgt, wgt]))])
    best, j = 360.0, 0
    for i in range(len(hue)):
        while cw[j + 1] - cw[i] < 0.98: j += 1
        best = min(best, hh[j] - hh[i])
    return clip, hot, float(best), float(L.mean())


def main():
    parse_args()
    t0 = time.time()
    scene, sun, xspan, info = setup_scene()
    tmp = TMP_DIR or tempfile.mkdtemp(prefix="scales-")
    os.makedirs(tmp, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    cols, rows = len(HA), len(HB)
    sheet = np.zeros((rows * CELL_PX, cols * CELL_PX, 4), np.float32)
    cells_meta, clamped = [], []
    for r, hb in enumerate(HB):
        for c, ha in enumerate(HA):
            L, was_clamped = light_dir(ha, hb)
            if was_clamped:
                Heff = L + np.array([0, 0, 1.0]); Heff /= np.linalg.norm(Heff)
                clamped.append({"col": c, "row": r, "hA": ha, "hB": hb,
                                "L": [round(float(v), 5) for v in L],
                                "effectiveH": [round(float(v), 5) for v in Heff]})
            if CELLS is not None and (c, r) not in CELLS: continue
            aim_sun(sun, L)
            path = os.path.join(tmp, "cell_%d_%d.exr" % (c, r))
            scene.render.filepath = path
            bpy.ops.render.render(write_still=True)
            img = bpy.data.images.load(path)
            buf = np.empty(CELL_PX * CELL_PX * 4, np.float32)
            img.pixels.foreach_get(buf)
            bpy.data.images.remove(img)
            lin = buf.reshape(CELL_PX, CELL_PX, 4)[::-1]   # → top-down rows
            cell = grade(lin, xspan)
            sheet[r * CELL_PX:(r + 1) * CELL_PX, c * CELL_PX:(c + 1) * CELL_PX] = cell
            clip, hot, spread, meanL = stats(cell)
            cells_meta.append((c, r, clip, hot, spread, meanL))
            print("CELL col=%d row=%d hA=%+.2f hB=%+.2f clamp=%d atCap=%.4f ge200=%.4f hueSpread=%5.1f meanL=%.3f rawMax=%.2f"
                  % (c, r, ha, hb, was_clamped, clip, hot, spread, meanL, float(lin[..., :3].max())))
    render_s = time.time() - t0

    png = os.path.join(OUT_DIR, "plate-atlas.png")
    webp = os.path.join(OUT_DIR, "plate-atlas.webp")
    prev = os.path.join(OUT_DIR, "plate-atlas-preview.png")
    scene.render.image_settings.file_format = "PNG"       # Image.save() reads PNG compression from here
    scene.render.image_settings.compression = 100
    save_image(sheet, png, "PNG")
    webp_ok = True
    try: save_image(sheet, webp, "WEBP", WEBP_QUALITY)
    except Exception as e:
        webp_ok = False
        print("WebP write failed:", e)
    save_image(make_preview(sheet), prev, "PNG")

    manifest = {
        "image": "plate-atlas.png",
        "imageWebp": "plate-atlas.webp" if webp_ok else None,
        "cellPx": CELL_PX, "unitsPerCell": BOX, "cols": cols, "rows": rows,
        "hA": HA, "hB": HB, "mirrorB": True,
        "layout": "column = hA ascending (left→right), row = hB ascending (top→bottom)",
        "alpha": "straight (non-premultiplied), 8-bit sRGB",
        "frame": "A = sprite +x (toward base/head), B = sprite +y (image down), n = toward camera; V = (0,0,1)",
        "lightFormula": "H = (hA, hB, sqrt(1-hA^2-hB^2)); L = 2(H.V)H - V; if L.z < %.2f then L.z = %.2f and renormalise" % (LZ_MIN, LZ_MIN),
        "mirrorNote": "for hB < 0 sample the |hB| row and flip the sprite about y = 36",
        "clampedCells": clamped,
        "light": {"type": "sun", "angularDiameterDeg": SUN_ANGLE_DEG, "strength": SUN_STRENGTH,
                  "worldStrength": WORLD_STRENGTH,
                  "horizonBand": "world strength += %.2f * (1-|z|)^%.1f — dim horizon glow so the rim keeps a faint line" % (HORIZON_STRENGTH, HORIZON_POW)},
        "render": {**info, "blender": bpy.app.version_string},
        "grade": {"exposure": EXPOSURE, "shoulderKnee": SHOULDER_KNEE, "peak": PEAK, "whiteBleed": WHITE_BLEED,
                  "note": "one global grade for all cells; no per-cell normalisation"},
        "occlusion": {"type": "post-multiply on RGB (not physical)", "startFrac": OCC_START,
                      "strengthAtBase": OCC_STRENGTH, "plateXSpanUnits": [round(v, 3) for v in xspan]},
        "plate": {"tip": TIP, "baseCorners": [BASE_TOP, BASE_BOT], "arcRadius": ARC_R,
                  "thicknessUnits": EDGE_H + DOME_H, "keelUnits": KEEL_H},
        "material": {"bodyOklch": BODY_OKLCH, "principledSockets": USED_SOCKETS},
    }
    if CELLS is None:
        with open(os.path.join(OUT_DIR, "plate-atlas.json"), "w") as f:
            json.dump(manifest, f, indent=2)
            f.write("\n")
    print("DONE %.1fs render+grade, wrote %s" % (render_s, OUT_DIR))
    for p in (png, webp, prev):
        if os.path.exists(p): print("SIZE %8d %s" % (os.path.getsize(p), p))


main()
