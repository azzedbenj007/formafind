#!/usr/bin/env python3
"""Author the ObjectSculptSpec for the Vent Baja 50 dirt bike.

The spec is the source of truth for every reconstruction decision; the TypeScript
factory is generated from it. Coordinates are metres in a right-handed frame:
+Y up, +Z = bike forward, +X = the rider's LEFT. The reference photo shows the
bike's RIGHT side (-X): front of the bike is on the right of the frame. Ground plane is y = 0.

Components are authored in WORLD coordinates and converted to parent-local here
(every container pivot carries zero rotation, so local = world - parent origin).
"""
from __future__ import annotations

import copy
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
starter = json.loads((HERE / "starter-spec.json").read_text())
assessment = json.loads((HERE / "assessment.json").read_text())

# ---------------------------------------------------------------- geometry refs
# Chassis is authored in a frame 0.10 m below final; the root node lifts the whole bike by
# CHASSIS_LIFT so the axles land at y=0.33/0.35 and the chassis rides high, as in the photo.
CHASSIS_LIFT = 0.10
REAR_AXLE = (0.0, 0.23, -0.68)
FRONT_AXLE = (0.0, 0.25, 0.731)
RAKE = math.radians(27.0)
U = (0.0, math.cos(RAKE), -math.sin(RAKE))        # steering axis, up-and-back
N = (0.0, -math.sin(RAKE), -math.cos(RAKE))       # perpendicular, pointing rearward
SWINGARM_PIVOT = (0.0, 0.40, -0.14)


def add(a, b):
    return tuple(x + y for x, y in zip(a, b))


def mul(v, s):
    return tuple(x * s for x in v)


def fork_point(t, x=0.0):
    """Point on the fork-tube axis, t metres up from the front axle."""
    p = add(FRONT_AXLE, mul(U, t))
    return (x, p[1], p[2])


def r(v, n=4):
    return [round(float(x), n) for x in v]


# --- rotation helpers (three.js Euler order 'XYZ': R = Rx * Ry * Rz) -------------------------
def mat_mul(a, b):
    return [[sum(a[i][k] * b[k][j] for k in range(3)) for j in range(3)] for i in range(3)]


def mat_t(a):
    return [[a[j][i] for j in range(3)] for i in range(3)]


def mat_vec(a, v):
    return tuple(sum(a[i][k] * v[k] for k in range(3)) for i in range(3))


def euler_to_mat(e):
    x, y, z = e
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]]
    ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]]
    rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]]
    return mat_mul(mat_mul(rx, ry), rz)


def mat_to_euler(m):
    y = math.asin(max(-1.0, min(1.0, m[0][2])))
    if abs(m[0][2]) < 0.9999999:
        return (math.atan2(-m[1][2], m[2][2]), y, math.atan2(-m[0][1], m[0][0]))
    return (math.atan2(m[2][1], m[1][1]), y, 0.0)


IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


# ---------------------------------------------------------------- materials
BASE_MAT = starter["materials"][0]


def hex_to_rgba(h, a=1.0):
    h = h.lstrip("#")
    return f"rgba({int(h[0:2],16)}, {int(h[2:4],16)}, {int(h[4:6],16)}, {a})"


MATERIAL_DEFS = [
    # id, name, color, secondary, roughness, metalness, class, physical extras, notes
    ("red-plastic", "Gloss red bodywork plastic", "#C8101E", ["#A8031A", "#B11728"], 0.32, 0.0, "plastic",
     {"clearcoat": 0.6, "clearcoatRoughness": 0.2}, "Vivid red (hue ~356), high saturation; photo mid-value #A8031A de-lit upward."),
    ("white-plastic", "Gloss white livery / silencer", "#EEF0F2", ["#DCDFE3", "#BCBDBE"], 0.3, 0.0, "plastic",
     {"clearcoat": 0.5, "clearcoatRoughness": 0.2}, "Neutral white with cool shadow side #BCBDBE."),
    ("grey-plastic", "Satin slate-grey livery stripe", "#56626F", ["#5A6776", "#506877"], 0.5, 0.0, "plastic",
     {}, "Blue-grey satin stripe separating red and white fields."),
    ("seat-vinyl", "Black textured seat vinyl", "#1B1C1D", ["#383939", "#4A4C4B"], 0.82, 0.0, "fabric",
     {}, "Matte black grained vinyl; top surface catches soft highlight."),
    ("gold-anodized", "Gold anodized fork stanchion", "#C99A3A", ["#DBB238", "#9F7521"], 0.25, 1.0, "metal",
     {}, "Gold TiN/anodized coating, strong specular, warm hue."),
    ("tyre-rubber", "Knobby tyre rubber", "#232322", ["#3A3A37", "#5A5A56"], 0.9, 0.0, "rubber",
     {}, "Near-black rubber; knob tops slightly lighter from wear."),
    ("black-frame", "Satin black painted steel", "#141517", ["#201F1A", "#0F1012"], 0.5, 0.3, "metal",
     {}, "Frame, swingarm, rims, engine cases, expansion chamber."),
    ("yellow-spring", "Yellow painted shock spring", "#E0B11E", ["#B48316", "#88610E"], 0.38, 0.1, "metal",
     {}, "Saturated yellow-gold spring coils."),
    ("brushed-steel", "Brushed steel / aluminium", "#A9B1B2", ["#888E8C", "#D0D9DB"], 0.32, 1.0, "metal",
     {}, "Discs, spokes, triple clamps, fork lowers, footpegs, radiator."),
    ("chain-steel", "Drive chain steel", "#5A5850", ["#4A4B4C", "#3B3D3E"], 0.45, 0.9, "metal",
     {}, "Dark steel chain; evidence crop reads neutral grey, not gold."),
    ("carbon-cap", "Carbon silencer end cap", "#26231F", ["#2A2621", "#322F2C"], 0.4, 0.0, "plastic",
     {"clearcoat": 0.8, "clearcoatRoughness": 0.15}, "Dark carbon weave under clear lacquer."),
    ("reflector-red", "Red reflector / tail lens", "#8A0F1A", ["#570712", "#93464F"], 0.2, 0.0, "plastic",
     {"emissive": "#300004"}, "Translucent red lens; faint emissive lift."),
]

MAT_COLORS = {}
materials = []
for mid, name, color, secondary, rough, metal, mclass, extras, notes in MATERIAL_DEFS:
    m = copy.deepcopy(BASE_MAT)
    m["id"] = mid
    m["name"] = name
    physical = bool(extras.get("clearcoat"))
    m["type"] = "physical" if physical else "standard"
    m["shaderModel"] = "MeshPhysicalMaterial" if physical else "MeshStandardMaterial / PBR approximation"
    m["baseColor"] = color
    m["color"] = color
    m["albedo"] = {"dominant": color, "secondary": secondary,
                   "samplingNotes": "Sampled from the reference crop in material-evidence/, de-lit toward the mid value."}
    m["colorVariation"] = {"palette": [color] + secondary, "pattern": "subtle-noise", "amplitude": 0.05, "heightCorrelation": 0.1}
    m["roughness"] = {"base": rough, "variation": 0.06, "map": "independent-procedural-field",
                      "localResponse": "slightly higher roughness in seams and fastener recesses"}
    m["metalness"] = {"base": metal, "variation": 0.0}
    m["normal"] = {"pattern": "derived-from-independent-height-field", "strength": 0.15, "scale": 24.0, "space": "tangent"}
    m["ambientOcclusion"] = {"cavityStrength": 0.25, "contactShadowBias": 0.35,
                             "notes": "Darken creases where panels overlap the frame and around the engine."}
    m["dirt"] = {"amount": 0.05 if mid in ("tyre-rubber", "black-frame") else 0.0, "cavityBias": 0.6, "color": "#2F2A22"}
    m["notes"] = notes
    m["physical"] = extras
    for k, v in extras.items():
        m[k] = v
    m["localOverrides"] = []
    materials.append(m)
    MAT_COLORS[mid] = (color, secondary[0], mclass)

MAT = {m["id"]: m for m in materials}
MAT["red-plastic"]["localOverrides"] = [
    {"id": "red-panel-edge-gloss", "kind": "gloss", "region": "moulded panel edges", "roughness": 0.18,
     "notes": "Crisp specular line along shroud and fender edges in the photo."}]
MAT["tyre-rubber"]["localOverrides"] = [
    {"id": "tyre-knob-wear", "kind": "stain", "region": "knob tops", "dirtAmount": 0.15, "cavityBias": 0.7,
     "notes": "Knob crowns slightly lighter/dustier than the carcass."}]
MAT["black-frame"]["localOverrides"] = [
    {"id": "frame-edge-wear", "kind": "scratch", "region": "swingarm lower edge, footpeg mounts", "roughness": 0.6,
     "notes": "Faint satin scuffing only; the bike is new."}]
MAT["white-plastic"]["localOverrides"] = [
    {"id": "silencer-decal", "kind": "decal", "region": "silencer can outer face",
     "notes": "Red/yellow sticker and 'VENT' logo on the can (approximated by colour patch geometry)."}]
MAT["brushed-steel"]["localOverrides"] = [
    {"id": "disc-wave-edge", "kind": "gloss", "region": "brake disc friction ring", "roughness": 0.2,
     "notes": "Bright machined ring on the wave discs."}]

# ---------------------------------------------------------------- components
components: list[dict] = []
world_origin: dict[str, tuple] = {"root": (0.0, 0.0, 0.0)}
world_rot: dict[str, list] = {"root": IDENTITY}
detail_links: list[tuple[str, str, str]] = []

ATTACH = {"cylinder", "cone", "capsule", "tube", "curve-sweep"}


def component(cid, name, level, role, primitive, material, *, parent="root", pos=(0, 0, 0), rot=(0, 0, 0),
              dims=None, descriptor=None, start=None, end=None, radius=None, end_radius=None,
              topology="assembled-solid", rationale=None, anim="static-part", features=None, confidence=0.75,
              contact="butt", evidence="full-object"):
    """Register one component. pos/start/end/rot are WORLD-space; converted to the parent's frame."""
    porigin = world_origin[parent]
    prot = world_rot[parent]
    prot_t = mat_t(prot)

    def to_local(p):
        return mat_vec(prot_t, tuple(a - b for a, b in zip(p, porigin)))

    world_r = euler_to_mat(rot)
    local_rot = mat_to_euler(mat_mul(prot_t, world_r))
    desc = {"topologyIntent": "clean low-poly real-time mesh",
            "edgeTreatment": {"type": "none", "bevelRadius": 0.0, "segments": 1},
            "deformationStack": [], "uvStrategy": "generated procedural coordinates",
            "normalStrategy": "vertex normals from generated geometry"}
    if descriptor:
        desc.update(descriptor)
    comp = {
        "id": cid, "name": name, "level": level, "role": role, "importance": 0.8 if level == "macro" else 0.6,
        "confidence": confidence, "primitive": primitive, "topologyClass": topology,
        "topologyRationale": rationale or f"{name} is a discrete manufactured part assembled onto the bike, so it is an independent solid.",
        "geometryDescriptor": desc, "parent": parent,
        "dimensions": dims or {"width": 1.0, "height": 1.0, "depth": 1.0, "units": "m", "confidence": confidence},
        "material": material, "materialLayers": [material],
        "deformations": [], "joints": [], "seams": [], "localFeatures": features or [],
        "surfaceDetail": {"macroRoughness": MAT[material]["roughness"]["base"], "microRoughness": 0.05,
                          "bumpAmplitude": 0.0, "normalPattern": "", "displacementPattern": "",
                          "occlusionPattern": "contact AO where parts meet", "edgeWearPattern": "", "notes": ""},
        "evidenceRefs": [evidence], "details": [], "fidelityTier": "form",
    }
    color, secondary, mclass = MAT_COLORS[material]
    comp["colorMaterialRecipe"] = {
        "dominantAlbedo": hex_to_rgba(color), "secondaryAlbedo": hex_to_rgba(secondary),
        "materialClass": mclass, "materialClassConfidence": 0.85,
        "evidenceRef": f"material-evidence (region for {material})",
    }
    local_pos = to_local(pos)
    comp["transform"] = {"position": r(local_pos), "rotation": r(local_rot), "scale": [1, 1, 1]}
    del comp["transform"]["scale"]  # dimensions carry the shape size
    node_origin = pos
    if primitive in ATTACH:
        if start is not None and end is not None:
            ls = to_local(start)
            le = to_local(end)
            node_origin = start
            # endpoints are expressed in the parent's frame, so the pivot must not re-rotate
            comp["transform"]["rotation"] = [0.0, 0.0, 0.0]
            world_r = prot
        else:
            # Curved tube/sweep: zero-length contract at its root joint so the generator keeps the
            # authored tubePath instead of replacing it with a straight endpoint cylinder.
            ls = le = local_pos
        comp["attachment"] = {
            "parentId": parent, "parentSocket": f"{parent}-mount", "localStart": r(ls), "localEnd": r(le),
            "contactType": contact, "embedDepth": 0.005, "gapTolerance": 0.004,
            "evidenceRefs": [evidence],
        }
        if radius is not None:
            comp["attachment"]["baseRadius"] = radius
            comp["attachment"]["endRadius"] = end_radius if end_radius is not None else radius
    if parent is not None and "attachment" not in comp:
        comp["attachment"] = {
            "parentId": parent, "parentSocket": f"{parent}-mount", "localStart": r(local_pos), "localEnd": r(local_pos),
            "contactType": contact, "embedDepth": 0.005, "gapTolerance": 0.004, "evidenceRefs": [evidence],
        }
    comp["actionProfile"] = {
        "animationRole": anim,
        "pivot": {"mode": "joint", "localPosition": [0, 0, 0], "axis": [1, 0, 0], "confidence": 0.7},
        "transformChannels": {"translate": False, "rotate": anim in ("wheel-spin", "steering", "suspension"),
                              "scale": False, "bend": False, "twist": False, "detach": True,
                              "visibility": True, "materialState": True},
        "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": False,
                                    "notes": "Box proxy per part."},
        "constraints": [],
        "destruction": {"breakable": False, "fractureGroup": level, "seamRefs": [], "detachableFragments": [],
                        "breakImpulse": 0.0, "debrisMaterial": material},
    }
    world_origin[cid] = node_origin
    world_rot[cid] = world_r  # attachment pivots keep the authored (world) rotation on the node
    components.append(comp)
    return comp


def box_between(a, b):
    """Rotation (about X) and length for a Z-long box spanning a->b in the YZ plane."""
    dy, dz = b[1] - a[1], b[2] - a[2]
    length = math.hypot(dy, dz)
    theta = math.atan2(-dy, dz)  # Rx(theta) maps +Z to (0, -sin, cos)
    center = mul(add(a, b), 0.5)
    return center, (theta, 0.0, 0.0), length


def feature(fid, kind, desc, **extra):
    f = {"id": fid, "kind": kind, "description": desc}
    f.update(extra)
    return f


# Root ------------------------------------------------------------------
root = component("root", "Vent Baja 50", "macro", "body", "box", "black-frame",
                 dims={"width": 0.001, "height": 0.001, "depth": 0.001, "units": "m", "confidence": 0.9},
                 topology="assembled-solid",
                 rationale="Invisible assembly root: a zero-size anchor node; every visible part is its own solid child.",
                 anim="root")
root["parent"] = None
root["transform"]["position"] = [0.0, CHASSIS_LIFT, 0.0]  # applied after local conversion: lifts everything
root.pop("attachment", None)

# Frame (macro) ------------------------------------------------------------
HEAD_CENTER = add(fork_point(0.732), mul(N, 0.045))
HEAD_A = add(HEAD_CENTER, mul(U, -0.09))
HEAD_B = add(HEAD_CENTER, mul(U, 0.09))
component("frame-head-tube", "Frame head tube", "macro", "support", "cylinder", "black-frame",
          start=HEAD_A, end=HEAD_B, radius=0.028, anim="static-part",
          rationale="Short straight steel tube; a cylinder between measured endpoints on the rake axis.")
world_origin["frame"] = (0, 0, 0)

for side, sx in (("l", 1), ("r", -1)):
    x = 0.065 * sx
    component(f"frame-spar-{side}", f"Frame main spar {side.upper()}", "macro", "support", "tube", "black-frame",
              pos=(0, 0, 0), descriptor={"tubePath": {"points": [
                  [0.0, HEAD_CENTER[1] + 0.03, HEAD_CENTER[2] - 0.03], [x, 0.84, 0.18], [x, 0.76, 0.0],
                  [x, 0.66, -0.12], [x, 0.52, -0.16], [x, 0.40, -0.15]], "radius": 0.022, "radialSegments": 10}},
              topology="assembled-solid",
              rationale="Bent round-section steel spar following a measured polyline; swept tube, not a box.")
    component(f"frame-subframe-{side}", f"Rear subframe rail {side.upper()}", "meso", "support", "tube", "black-frame",
              pos=(0, 0, 0), descriptor={"tubePath": {"points": [
                  [x, 0.68, -0.12], [x * 1.15, 0.76, -0.40], [x * 1.25, 0.82, -0.66]], "radius": 0.012, "radialSegments": 8}},
              rationale="Thin bent subframe tube under the seat; swept tube.")
    component(f"frame-strut-{side}", f"Subframe strut {side.upper()}", "micro", "support", "tube", "black-frame",
              pos=(0, 0, 0), descriptor={"tubePath": {"points": [
                  [x, 0.46, -0.16], [x * 1.15, 0.62, -0.40], [x * 1.25, 0.80, -0.62]], "radius": 0.01, "radialSegments": 8}},
              rationale="Diagonal support tube; swept tube.")

component("frame-downtube", "Frame downtube and cradle", "macro", "support", "tube", "black-frame",
          descriptor={"tubePath": {"points": [
              [0.0, HEAD_CENTER[1] - 0.04, HEAD_CENTER[2] + 0.01], [0.0, 0.64, 0.33], [0.0, 0.42, 0.30],
              [0.0, 0.26, 0.21], [0.0, 0.25, 0.0], [0.0, 0.28, -0.12], [0.0, 0.40, -0.15]],
              "radius": 0.022, "radialSegments": 10}},
          rationale="Single cradle tube from head to under the engine and up to the pivot; swept tube.")

# Engine (macro) ------------------------------------------------------------
component("engine-cases", "Engine crankcase", "macro", "body", "box", "black-frame",
          pos=(0.0, 0.40, 0.06), dims={"width": 0.22, "height": 0.24, "depth": 0.30, "units": "m", "confidence": 0.6},
          descriptor={"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.02, "segments": 1}},
          rationale="Cast crankcase block; mostly occluded so a bevel-ready box stands in.", confidence=0.55)
component("engine-cylinder", "Engine cylinder barrel", "meso", "body", "cylinder", "black-frame",
          start=(0.0, 0.50, 0.14), end=(0.0, 0.66, 0.22), radius=0.07, end_radius=0.065,
          features=[feature("cylinder-fins", "ridge", "Horizontal cooling-fin ridges on the barrel (approximated by head ring).")],
          rationale="Forward-inclined round barrel; tapered cylinder between endpoints.")
component("engine-head", "Cylinder head", "micro", "body", "cylinder", "black-frame",
          start=(0.0, 0.66, 0.22), end=(0.0, 0.70, 0.24), radius=0.08, end_radius=0.075,
          rationale="Flat cylinder-head disc capping the barrel.")
component("engine-clutch-cover", "Left engine side cover", "meso", "body", "cylinder", "black-frame",
          start=(-0.11, 0.40, 0.07), end=(-0.135, 0.40, 0.07), radius=0.10, end_radius=0.092,
          rationale="Round cast side cover on the visible left side.")
component("engine-badge", "VENT oval badge on side cover", "micro", "decal", "cylinder", "white-plastic",
          start=(-0.135, 0.38, 0.07), end=(-0.14, 0.38, 0.07), radius=0.035, end_radius=0.035,
          features=[feature("engine-vent-badge", "decal", "Silver/white oval 'VENT' badge on the side cover.")],
          rationale="Thin raised badge disc.")
detail_links.append(("engine-vent-badge", "engine-badge", "decal"))
component("radiator", "Radiator core", "meso", "body", "box", "brushed-steel",
          pos=(-0.09, 0.70, 0.28), rot=(-RAKE * 0.4, 0, 0),
          dims={"width": 0.05, "height": 0.26, "depth": 0.12, "units": "m", "confidence": 0.55},
          features=[feature("radiator-fins", "groove", "Fine vertical fin grooves on the silver radiator core.")],
          rationale="Rectangular finned core; box with fin grooves as surface feature.")
detail_links.append(("radiator-fins", "radiator", "groove"))

# Exhaust (macro) — on the photographed right (-X) side ------------------
component("exhaust-chamber", "Two-stroke expansion chamber", "macro", "pipe", "tube", "black-frame",
          descriptor={"tubePath": {"points": [
              [-0.03, 0.60, 0.27], [-0.10, 0.55, 0.37], [-0.16, 0.40, 0.37], [-0.17, 0.30, 0.25],
              [-0.17, 0.28, 0.06], [-0.16, 0.34, -0.10], [-0.15, 0.48, -0.22], [-0.14, 0.60, -0.31]],
              "radius": 0.045, "radialSegments": 14}},
          features=[feature("pipe-curl", "contour", "Pipe curls out in front of the engine and runs back low along it.")],
          rationale="Continuous curved steel pipe of near-constant section; swept tube along measured spine.")
detail_links.append(("pipe-curl", "exhaust-chamber", "contour"))
SIL_A, SIL_B = (-0.14, 0.61, -0.30), (-0.15, 0.76, -0.70)
component("silencer", "Silencer can", "meso", "pipe", "cylinder", "white-plastic",
          start=SIL_A, end=SIL_B, radius=0.058, end_radius=0.058,
          features=[feature("silencer-sticker", "decal", "Red/yellow sticker with VENT logo on the white can.")],
          rationale="Round muffler can; straight cylinder between measured endpoints.")
detail_links.append(("silencer-sticker", "silencer", "decal"))
component("silencer-cap", "Carbon silencer end cap", "micro", "pipe", "cylinder", "carbon-cap",
          start=SIL_B, end=add(SIL_B, (-0.003, 0.02, -0.06)), radius=0.058, end_radius=0.045,
          rationale="Tapered carbon end cap.")
component("silencer-sticker-patch", "Silencer sticker patch", "micro", "decal", "box", "reflector-red",
          pos=(-0.2, 0.69, -0.52), rot=(-0.36, 0, 0),
          dims={"width": 0.004, "height": 0.06, "depth": 0.10, "units": "m", "confidence": 0.5},
          rationale="Flat applied sticker; thin plate proud of the can.")

# Swingarm + rear suspension (macro) ------------------------------------------
for side, sx in (("l", 1), ("r", -1)):
    a = (0.075 * sx, SWINGARM_PIVOT[1], SWINGARM_PIVOT[2])
    b = (0.075 * sx, REAR_AXLE[1], REAR_AXLE[2] + 0.02)
    c, rot, L = box_between(a, b)
    component(f"swingarm-{side}", f"Swingarm arm {side.upper()}", "macro", "support", "box", "black-frame",
              pos=c, rot=rot, dims={"width": 0.035, "height": 0.065, "depth": L, "units": "m", "confidence": 0.75},
              anim="suspension", rationale="Rectangular-section steel arm; box oriented along pivot->axle.")
component("swingarm-brace", "Swingarm cross brace", "meso", "support", "box", "black-frame",
          pos=(0.0, 0.39, -0.24), dims={"width": 0.15, "height": 0.04, "depth": 0.05, "units": "m", "confidence": 0.5},
          rationale="Box brace joining the arms ahead of the tyre.")
SHOCK_A, SHOCK_B = (0.0, 0.37, -0.25), (0.0, 0.74, -0.10)
component("shock-body", "Rear shock body", "meso", "support", "cylinder", "black-frame",
          start=SHOCK_A, end=SHOCK_B, radius=0.02, end_radius=0.024, anim="suspension",
          rationale="Straight damper body between swingarm and frame mounts.")
# helical spring along the lower 70 % of the shock axis
axis = tuple(b - a for a, b in zip(SHOCK_A, SHOCK_B))
alen = math.sqrt(sum(v * v for v in axis))
ax = mul(axis, 1 / alen)
perp1 = (1.0, 0.0, 0.0)
perp2 = (0.0, ax[2], -ax[1])
coil = []
turns, steps = 8, 8 * 10
for i in range(steps + 1):
    t = i / steps
    ang = 2 * math.pi * turns * t
    base = add(SHOCK_A, mul(ax, 0.06 + t * alen * 0.68))
    p = add(base, add(mul(perp1, 0.036 * math.cos(ang)), mul(perp2, 0.036 * math.sin(ang))))
    coil.append(r(p))
component("shock-spring", "Yellow shock spring", "meso", "support", "tube", "yellow-spring",
          descriptor={"tubePath": {"points": coil, "radius": 0.006, "radialSegments": 6}},
          features=[feature("yellow-spring-coils", "ridge", "Eight saturated yellow coils around the black damper.")],
          topology="fiber-strand", rationale="A helical wire: a thin swept strand, not a solid volume.")
detail_links.append(("yellow-spring-coils", "shock-spring", "ridge"))

# Wheels (macro) --------------------------------------------------------------


def wheel(prefix, axle, tyre_r, tyre_tube, rim_r, disc_r, disc_x, knobs, spokes=36):
    world_origin_key = f"{prefix}-hub"
    component(world_origin_key, f"{prefix.title()} wheel hub", "macro", "support", "lathe", "brushed-steel",
              pos=axle, rot=(0, 0, math.pi / 2), anim="wheel-spin",
              descriptor={"latheProfile": {"points": [[0.02, -0.07], [0.035, -0.065], [0.03, -0.02], [0.028, 0.0],
                                                      [0.03, 0.02], [0.035, 0.065], [0.02, 0.07]], "segments": 20}},
              rationale="Turned hub barrel with flanges; lathe profile around the axle.")
    s = tyre_r / 0.45
    ratio = (tyre_tube / s) / 0.45
    component(f"{prefix}-tyre", f"{prefix.title()} knobby tyre", "meso", "wheel", "torus", "tyre-rubber",
              parent=world_origin_key, pos=axle, rot=(0, math.pi / 2, 0),
              dims={"width": 2 * 0.45 * s, "height": 2 * 0.45 * s, "depth": 2 * 0.45 * s, "units": "m", "confidence": 0.8},
              descriptor={"torusTubeRatio": round(ratio, 4)}, anim="wheel-spin",
              features=[feature(f"{prefix}-tyre-knobs", "ridge", "Rows of square rubber knobs around the tread.")],
              rationale="Toroidal tyre carcass; torus with measured section ratio.")
    # torus geometry is 0.9 across at unit scale -> scale factor is width/0.9; dims above are width = 0.9*s
    components[-1]["dimensions"] = {"width": s, "height": s, "depth": s, "units": "scale", "confidence": 0.8}
    rs = rim_r / 0.45
    component(f"{prefix}-rim", f"{prefix.title()} black rim", "meso", "wheel", "torus", "black-frame",
              parent=world_origin_key, pos=axle, rot=(0, math.pi / 2, 0),
              dims={"width": rs, "height": rs, "depth": rs * 1.6, "units": "scale", "confidence": 0.8},
              descriptor={"torusTubeRatio": round((0.012 / rs) / 0.45, 4)}, anim="wheel-spin",
              rationale="Channel-section rim; slim torus widened on the axle axis.")
    component(f"{prefix}-disc", f"{prefix.title()} wave brake disc", "meso", "support", "cylinder", "brushed-steel",
              parent=world_origin_key, start=(disc_x, axle[1], axle[2]), end=(disc_x + 0.004, axle[1], axle[2]),
              radius=disc_r, end_radius=disc_r, anim="wheel-spin",
              features=[feature(f"{prefix}-disc-ring", "gloss", "Bright machined friction ring on the wave disc.")],
              rationale="Thin flat rotor; very short cylinder along the axle.")
    detail_links.append((f"{prefix}-disc-ring", "brushed-steel", "gloss-override"))
    detail_links.append((f"{prefix}-tyre-knobs", f"{prefix}-tyre", "ridge"))
    return world_origin_key


rear_hub = wheel("rear", REAR_AXLE, 0.285, 0.045, 0.238, 0.105, -0.076, 44)
front_hub_key = None

# Rear drivetrain -------------------------------------------------------------
component("rear-sprocket", "Rear sprocket", "meso", "support", "cylinder", "brushed-steel",
          parent=rear_hub, start=(0.066, REAR_AXLE[1], REAR_AXLE[2]), end=(0.07, REAR_AXLE[1], REAR_AXLE[2]),
          radius=0.105, end_radius=0.105, anim="wheel-spin",
          rationale="Flat toothed plate on the hub; thin cylinder (teeth as repetition system).")
# Chain runs on the hidden left (+X) side; it shows through the spokes in the photo.
chain_pts = []
fs = (0.075, 0.40, -0.03)   # front sprocket centre (left side)
rsc = (0.075, REAR_AXLE[1], REAR_AXLE[2])
for i in range(9):          # front half of the front sprocket, top -> forward -> bottom
    a = math.pi / 2 - math.pi * i / 8
    chain_pts.append(r((fs[0], fs[1] + 0.042 * math.sin(a), fs[2] + 0.042 * math.cos(a))))
for i in range(13):         # rear half of the rear sprocket, bottom -> rearward -> top
    a = -math.pi / 2 - math.pi * i / 12
    chain_pts.append(r((rsc[0], rsc[1] + 0.108 * math.sin(a), rsc[2] + 0.108 * math.cos(a))))
component("chain", "Drive chain loop", "meso", "cable", "tube", "chain-steel",
          descriptor={"tubePath": {"points": chain_pts, "radius": 0.007, "radialSegments": 6, "closed": True}},
          topology="fiber-strand", rationale="Closed loop of links around both sprockets; a swept closed strand.")
component("front-sprocket", "Front sprocket", "micro", "support", "cylinder", "brushed-steel",
          start=(0.072, 0.40, -0.03), end=(0.08, 0.40, -0.03), radius=0.04, end_radius=0.04,
          rationale="Small gearbox output sprocket.")

# Front end (macro, steering) ---------------------------------------------------
front_hub = wheel("front", FRONT_AXLE, 0.31, 0.04, 0.268, 0.13, -0.085, 44)
for side, sx in (("l", 1), ("r", -1)):
    x = 0.095 * sx
    component(f"fork-lower-{side}", f"Fork lower leg {side.upper()}", "meso", "fork", "cylinder", "brushed-steel",
              start=fork_point(-0.03, x), end=fork_point(0.34, x), radius=0.03, end_radius=0.029, anim="steering",
              rationale="Straight aluminium slider; cylinder on the rake axis.")
    component(f"fork-upper-{side}", f"Fork stanchion (gold) {side.upper()}", "meso", "fork", "cylinder", "gold-anodized",
              start=fork_point(0.32, x), end=fork_point(0.93, x), radius=0.022, end_radius=0.022, anim="steering",
              features=[feature(f"gold-stanchion-{side}", "gloss", "Gold anodized stanchion with a bright vertical highlight.")],
              rationale="Straight fork tube; cylinder on the rake axis.")
    detail_links.append((f"gold-stanchion-{side}", f"fork-upper-{side}", "gloss"))
    c = add(fork_point(0.17, x * 1.05), mul(N, -0.03))
    component(f"fork-guard-{side}", f"Fork guard {side.upper()}", "micro", "body", "box", "white-plastic",
              pos=c, rot=(-RAKE, 0, 0),
              dims={"width": 0.035, "height": 0.26, "depth": 0.03, "units": "m", "confidence": 0.6},
              features=[feature(f"fork-guard-logo-{side}", "decal", "White guard with red 'VENT' lettering.")],
              rationale="Plastic guard plate clipped to the slider front.")
    component(f"fork-guard-stripe-{side}", f"Fork guard red stripe {side.upper()}", "micro", "decal", "box", "red-plastic",
              pos=add(c, (0.0, 0.0, 0.0)) if False else add(c, mul(N, -0.017)), rot=(-RAKE, 0, 0),
              dims={"width": 0.02, "height": 0.18, "depth": 0.004, "units": "m", "confidence": 0.5},
              rationale="Red logo band on the fork guard; thin plate.")
detail_links.append(("fork-guard-logo-r", "fork-guard-r", "decal"))

for cid, t in (("clamp-lower", 0.69), ("clamp-upper", 0.87)):
    component(cid, "Lower triple clamp" if cid == "clamp-lower" else "Upper triple clamp", "meso", "support", "box",
              "brushed-steel", pos=add(fork_point(t), mul(N, 0.02)), rot=(-RAKE, 0, 0),
              dims={"width": 0.25, "height": 0.035, "depth": 0.09, "units": "m", "confidence": 0.7}, anim="steering",
              rationale="Machined aluminium clamp; box perpendicular to the steering axis.")

BAR_Y, BAR_Z = fork_point(0.97)[1] + 0.13, fork_point(0.97)[2] - 0.02
bar_pts = [[-0.39, BAR_Y + 0.04, BAR_Z - 0.06], [-0.26, BAR_Y + 0.025, BAR_Z - 0.03], [-0.12, BAR_Y, BAR_Z],
           [0.0, BAR_Y - 0.005, BAR_Z + 0.005], [0.12, BAR_Y, BAR_Z], [0.26, BAR_Y + 0.025, BAR_Z - 0.03],
           [0.39, BAR_Y + 0.04, BAR_Z - 0.06]]
for side, sx in (("l", 1), ("r", -1)):
    top = add(fork_point(0.87), mul(N, 0.02))
    component(f"bar-riser-{side}", f"Handlebar riser {side.upper()}", "micro", "support", "cylinder", "brushed-steel",
              start=(0.035 * sx, top[1] + 0.01, top[2]), end=(0.035 * sx, BAR_Y - 0.005, BAR_Z), radius=0.014, end_radius=0.014,
              anim="steering", rationale="Machined bar-clamp riser between the upper clamp and the bar.")
component("handlebar", "Handlebar", "meso", "handle", "tube", "black-frame",
          descriptor={"tubePath": {"points": bar_pts, "radius": 0.012, "radialSegments": 10}}, anim="steering",
          rationale="Bent tapered bar; swept tube through measured bend points.")
for side, sx in (("l", 1), ("r", -1)):
    component(f"grip-{side}", f"Grip {side.upper()}", "micro", "handle", "cylinder", "seat-vinyl",
              start=(0.27 * sx, BAR_Y + 0.028, BAR_Z - 0.035), end=(0.40 * sx, BAR_Y + 0.041, BAR_Z - 0.062),
              radius=0.017, end_radius=0.018, anim="steering", rationale="Rubber grip sleeve.")
    component(f"lever-{side}", f"{'Clutch' if side == 'l' else 'Brake'} lever {side.upper()}", "micro", "handle", "box",
              "brushed-steel", pos=(0.28 * sx, BAR_Y + 0.0, BAR_Z + 0.07), rot=(0, 0.25 * sx, 0),
              dims={"width": 0.16, "height": 0.012, "depth": 0.02, "units": "m", "confidence": 0.5}, anim="steering",
              rationale="Flat forged lever blade.")
    component(f"lever-perch-{side}", f"Lever perch {side.upper()}", "micro", "handle", "box", "reflector-red" if side == "l" else "black-frame",
              pos=(0.22 * sx, BAR_Y + 0.02, BAR_Z - 0.01),
              dims={"width": 0.035, "height": 0.035, "depth": 0.04, "units": "m", "confidence": 0.5}, anim="steering",
              rationale="Lever clamp block (red switch on the left in the photo).")
component("headlight-mask", "Headlight number plate", "meso", "body", "extrude", "black-frame",
          pos=(0.10, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
          descriptor={"profile2D": {"points": [[0.42, 0.86], [0.47, 0.88], [0.45, 1.03], [0.39, 1.05], [0.38, 0.95]], "depth": 0.18}},
          topology="conforming-shell", rationale="Thin moulded mask; extruded side profile.")
component("front-fender", "Front fender", "macro", "body", "extrude", "red-plastic",
          pos=(0.075, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
          descriptor={"profile2D": {"points": [[0.36, 0.745], [0.52, 0.79], [0.72, 0.80], [0.90, 0.77], [1.02, 0.72],
                                               [1.0, 0.70], [0.88, 0.745], [0.70, 0.77], [0.52, 0.76], [0.37, 0.72]],
                                    "depth": 0.15}},
          topology="conforming-shell", rationale="High-mount mudguard: thin curved shell, extruded side profile.",
          features=[feature("front-fender-kick", "contour", "Long forward-reaching red fender tip.")])
detail_links.append(("front-fender-kick", "front-fender", "contour"))

# Bodywork (macro) ------------------------------------------------------------
component("tank", "Fuel tank", "meso", "body", "extrude", "black-frame",
          pos=(0.10, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
          descriptor={"profile2D": {"points": [[0.05, 0.86], [0.30, 0.96], [0.34, 0.90], [0.28, 0.76], [0.06, 0.74]], "depth": 0.20}},
          rationale="Tank volume mostly hidden under the shrouds; extruded side profile.")
component("fuel-cap", "Fuel cap", "micro", "body", "cylinder", "black-frame",
          start=(0.0, 0.93, 0.17), end=(0.0, 0.965, 0.18), radius=0.03, end_radius=0.028,
          rationale="Round screw cap on the tank top.")

SEAT = [[0.24, 0.94], [0.12, 0.93], [-0.10, 0.905], [-0.45, 0.915], [-0.73, 0.935], [-0.74, 0.895],
        [-0.45, 0.855], [-0.05, 0.845], [0.14, 0.86], [0.26, 0.905]]
component("seat", "Seat", "macro", "body", "extrude", "seat-vinyl",
          pos=(0.12, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
          descriptor={"profile2D": {"points": SEAT, "depth": 0.24}},
          topology="conforming-shell", rationale="Long flat enduro seat; extruded side profile.",
          features=[feature("seat-texture", "stitch", "Fine grain texture on the black seat top.")])
detail_links.append(("seat-texture", "seat", "stitch"))

SHROUD = [[0.05, 0.92], [0.36, 0.955], [0.49, 0.90], [0.45, 0.74], [0.32, 0.60], [0.20, 0.62], [0.10, 0.74]]
SIDE_PANEL = [[-0.03, 0.855], [-0.66, 0.905], [-0.64, 0.80], [-0.40, 0.66], [-0.12, 0.60], [-0.06, 0.66]]
REAR_FENDER = [[-0.40, 0.87], [-0.75, 0.915], [-1.04, 1.0], [-1.05, 0.975], [-0.78, 0.88], [-0.46, 0.82]]
for side, sx in (("l", 1), ("r", -1)):
    # extrude runs toward -X from its pivot; offset so each panel sits on its own side
    # ExtrudeGeometry grows one way (local +Z -> world -X), so a mirrored pivot puts the hidden
    # left panel 25 mm inboard of a true reflection; the visible right panel is exact.
    x_out = 0.14 * sx
    component(f"shroud-{side}", f"Radiator shroud {side.upper()}", "macro", "body", "extrude", "red-plastic",
              pos=(x_out, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
              descriptor={"profile2D": {"points": SHROUD, "depth": 0.025}}, topology="conforming-shell",
              rationale="Thin moulded shroud panel; extruded side profile.")
    x_panel = 0.125 * sx
    component(f"side-panel-{side}", f"Side number panel {side.upper()}", "macro", "body", "extrude", "red-plastic",
              pos=(x_panel, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
              descriptor={"profile2D": {"points": SIDE_PANEL, "depth": 0.025}}, topology="conforming-shell",
              rationale="Thin side cover panel under the seat; extruded side profile.")
component("rear-fender", "Rear fender", "macro", "body", "extrude", "red-plastic",
          pos=(0.11, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
          descriptor={"profile2D": {"points": REAR_FENDER, "depth": 0.22}}, topology="conforming-shell",
          rationale="Long upswept tail; extruded side profile.",
          features=[feature("rear-fender-kick", "contour", "Tail rises steeply to a sharp tip behind the seat.")])
detail_links.append(("rear-fender-kick", "rear-fender", "contour"))
component("plate-hanger", "Licence plate hanger", "meso", "body", "extrude", "black-frame",
          pos=(0.075, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
          descriptor={"profile2D": {"points": [[-0.99, 0.965], [-1.03, 0.98], [-1.10, 0.70], [-1.05, 0.68]], "depth": 0.15}},
          topology="conforming-shell", rationale="Flexible black plastic flap; extruded profile.")
component("plate-reflector", "Red reflector", "micro", "decal", "box", "reflector-red",
          pos=(0.0, 0.705, -1.09), rot=(-0.27, 0, 0),
          dims={"width": 0.07, "height": 0.03, "depth": 0.012, "units": "m", "confidence": 0.7},
          features=[feature("red-reflector", "emissive", "Small red reflector at the bottom of the plate hanger.")],
          rationale="Small rectangular lens.")
detail_links.append(("red-reflector", "plate-reflector", "emissive"))
component("tail-light", "Tail light", "micro", "body", "box", "reflector-red",
          pos=(0.0, 0.965, -1.03), dims={"width": 0.06, "height": 0.025, "depth": 0.04, "units": "m", "confidence": 0.6},
          rationale="Compact LED tail lamp under the fender tip.")

# Livery decals (micro) — thin plates just proud of the red panels on the photographed right side (-X)
LIVERY = {
    "shroud-white": ("white-plastic", -0.166, [[0.10, 0.84], [0.40, 0.90], [0.47, 0.87], [0.38, 0.80], [0.16, 0.76]]),
    "shroud-grey": ("grey-plastic", -0.169, [[0.12, 0.86], [0.38, 0.905], [0.40, 0.89], [0.16, 0.835]]),
    "shroud-lower-white": ("white-plastic", -0.166, [[0.30, 0.62], [0.44, 0.75], [0.46, 0.73], [0.33, 0.61]]),
    "panel-grey-stripe": ("grey-plastic", -0.151, [[-0.06, 0.82], [-0.55, 0.875], [-0.55, 0.85], [-0.08, 0.795]]),
    "panel-white-lower": ("white-plastic", -0.151, [[-0.10, 0.63], [-0.40, 0.69], [-0.60, 0.79], [-0.62, 0.76], [-0.38, 0.665], [-0.13, 0.605]]),
}
for cid, (mat, x, pts) in LIVERY.items():
    component(f"livery-{cid}", f"Livery {cid.replace('-', ' ')}", "micro", "decal", "extrude", mat,
              pos=(x, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
              descriptor={"profile2D": {"points": pts, "depth": 0.003}}, topology="surface-relief",
              rationale="Printed livery field; a 3 mm plate standing proud of the panel (code-only, no textures).")

# "VENT" letters: italic block glyphs, white, on the right side panel.
def glyph(ch, z0, y0, w=0.075, h=0.085, t=0.018, slant=0.025):
    def P(u, v):  # u = reading direction (toward the bike front, +Z seen from the right side), v up
        return [round(z0 + u + slant * v / h, 4), round(y0 + v, 4)]
    if ch == "V":
        return [P(0, h), P(t, h), P(w / 2, t * 1.4), P(w - t, h), P(w, h), P(w / 2 + t * 0.5, 0), P(w / 2 - t * 0.5, 0)]
    if ch == "E":
        return [P(0, 0), P(w, 0), P(w, t), P(t, t), P(t, h / 2 - t / 2), P(w * 0.85, h / 2 - t / 2), P(w * 0.85, h / 2 + t / 2),
                P(t, h / 2 + t / 2), P(t, h - t), P(w, h - t), P(w, h), P(0, h)]
    if ch == "N":
        return [P(0, 0), P(t, 0), P(t, h - t * 1.8), P(w - t, 0), P(w, 0), P(w, h), P(w - t, h), P(w - t, t * 1.8), P(t, h), P(0, h)]
    if ch == "T":
        return [P(0, h), P(w, h), P(w, h - t), P(w / 2 + t / 2, h - t), P(w / 2 + t / 2, 0), P(w / 2 - t / 2, 0),
                P(w / 2 - t / 2, h - t), P(0, h - t)]
    raise ValueError(ch)


z_cursor = -0.50
for i, ch in enumerate("VENT"):
    # letters step down toward the front, following the panel's rising stripe
    y0 = 0.76 - 0.022 * i
    component(f"logo-{ch.lower()}{i}", f"VENT logo letter {ch}", "micro", "decal", "extrude", "white-plastic",
              pos=(-0.155, 0.0, 0.0), rot=(0, -math.pi / 2, 0),
              descriptor={"profile2D": {"points": glyph(ch, z_cursor, y0), "depth": 0.003}}, topology="surface-relief",
              features=[feature(f"vent-letter-{i}", "decal", f"White italic '{ch}' of the VENT side-panel logo.")] if i == 0 else [],
              rationale="Raised logo glyph outline; extruded letter polygon (code-only typography).")
    z_cursor += 0.09
detail_links.append(("vent-letter-0", "logo-v0", "decal"))

# Controls (micro)
for side, sx in (("l", 1), ("r", -1)):
    component(f"footpeg-{side}", f"Footpeg {side.upper()}", "micro", "support", "cylinder", "brushed-steel",
              start=(0.09 * sx, 0.33, -0.03), end=(0.20 * sx, 0.33, -0.03), radius=0.016, end_radius=0.016,
              features=[feature(f"footpeg-teeth-{side}", "fastener", "Serrated steel footpeg teeth.")] if side == "r" else [],
              rationale="Folding steel peg.")
detail_links.append(("footpeg-teeth-r", "footpeg-r", "fastener"))
component("brake-pedal", "Rear brake pedal", "micro", "handle", "box", "brushed-steel",
          pos=(-0.14, 0.33, 0.07), rot=(0.25, 0, 0),
          dims={"width": 0.015, "height": 0.02, "depth": 0.14, "units": "m", "confidence": 0.5},
          rationale="Forged brake pedal ahead of the right peg (silver in the photo).")
component("rear-caliper", "Rear brake caliper", "micro", "support", "box", "brushed-steel",
          pos=(-0.085, 0.33, -0.62), dims={"width": 0.03, "height": 0.06, "depth": 0.07, "units": "m", "confidence": 0.6},
          rationale="Cast caliper over the disc edge.")
component("front-caliper", "Front brake caliper", "micro", "support", "box", "black-frame",
          pos=(-0.10, 0.34, 0.66), rot=(-RAKE, 0, 0),
          dims={"width": 0.03, "height": 0.08, "depth": 0.05, "units": "m", "confidence": 0.6},
          rationale="Caliper on the fork leg behind the disc.")

# ---------------------------------------------------------------- repetition systems
repetition = []
for prefix, hub, tyre_r, rim_r in (("rear", "rear-hub", 0.33, 0.238), ("front", "front-hub", 0.35, 0.268)):
    spoke_len = rim_r - 0.035
    repetition.append({
        "id": f"{prefix}-spokes", "name": f"{prefix} wheel spokes", "level": "micro", "parent": hub,
        "primitive": "box", "material": "brushed-steel", "count": 36,
        "instanceScale": [spoke_len, 0.004, 0.004],
        "placement": {"mode": "radial", "axis": [0, 1, 0], "radius": 2 * (0.035 + spoke_len / 2), "startAngleDeg": 0},
        "notes": "36 steel spokes radiating from hub flange to rim (hub pivot is rotated so local Y = axle).",
    })
    repetition.append({
        "id": f"{prefix}-knobs", "name": f"{prefix} tyre knobs", "level": "micro", "parent": f"{prefix}-tyre",
        "primitive": "box", "material": "tyre-rubber", "count": 40,
        "instanceScale": [0.024, 0.03, 0.10 if prefix == "rear" else 0.085],
        "placement": {"mode": "radial", "axis": [0, 0, 1], "radius": 2 * (tyre_r - 0.004), "startAngleDeg": 4.5},
        "notes": "Square tread knobs around the carcass crown (tyre pivot local Z = axle).",
    })
repetition.append({
    "id": "rear-sprocket-teeth", "name": "rear sprocket teeth", "level": "micro", "parent": "rear-sprocket",
    "primitive": "box", "material": "brushed-steel", "count": 40, "instanceScale": [0.014, 0.008, 0.004],
    "placement": {"mode": "radial", "axis": [1, 0, 0], "radius": 0.22, "startAngleDeg": 0},
    "notes": "Sprocket teeth ring.",
})

# ---------------------------------------------------------------- spec assembly
spec = copy.deepcopy(starter)
spec["targetName"] = "Vent Baja 50 Dirt Bike"
spec["suitability"] = "conditional"
spec["scores"] = {"object_isolation": 3, "silhouette_readability": 3, "depth_inference": 2, "primitive_decomposition": 2,
                  "material_procedurality": 3, "occlusion_risk": 2, "interaction_fit": 2}
spec["coordinateFrame"] = {"front": "+Z (bike forward)", "up": "+Y", "left": "+X (rider's left); the photo shows the right side (-X)",
                           "scaleReference": "metres; wheelbase 1.41 m, rear axle z=-0.68, front axle z=+0.73, ground y=0 (root lifted 0.10)"}
spec["referenceCamera"] = {"solved": False, "fovDegrees": 30.0, "aspect": 1.5006,
                           "orientation": {"yaw": 215.0, "pitch": -12.0, "roll": 0.0},
                           "positionHint": [-2.2, 1.35, -2.6],
                           "note": "Rear-right three-quarter studio shot; camera behind and to the RIGHT of the bike (-X), target (0, 0.55, -0.05)."}
spec["silhouette"] = {
    "boundingShape": "long low rectangle 2.1 m x 1.2 m side-on, with two large wheel discs and a tall front end",
    "aspectRatios": ["length/height = 1.75", "wheelbase/length = 0.65", "seat height/overall height = 0.78"],
    "symmetry": "bilateral about the mid-plane except drivetrain, exhaust and brakes",
    "dominantCurves": ["upswept rear fender", "raked gold fork line", "expansion-chamber curl"],
    "negativeSpaces": ["open spoked wheels", "gap between swingarm and seat", "triangle between fork, fender and engine"],
    "landmarks": ["rear fender tip", "handlebar ends", "front fender tip", "tyre contact patches"],
}
spec["viewEvidence"] = [{"id": "full-object", "view": "rear-right three-quarter", "imageRegion":
                         {"x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0, "units": "normalized"},
                         "observations": ["entire bike visible on white background", "right side fully visible, left side hidden"],
                         "confidence": 0.85}]
spec["assumptions"] = [
    "Left-side parts (left shroud/panel, left fork leg) mirror the visible right.",
    "Chain and sprockets on the far (left) side, seen through the spokes; exhaust, rear disc and brake pedal on the visible right.",
    "Tank is hidden under the shrouds; volume inferred.",
    "Hidden left shroud/side panel sit 25 mm inboard of a true mirror (one-directional extrusion).",
]
spec["risks"] = ["Decal lettering is approximate", "Engine internals and carburettor hidden", "Single view: left side inferred"]
spec["componentTree"] = components
spec["materials"] = materials
spec["repetitionSystems"] = repetition
spec["lightingFromPhoto"] = [
    {"id": "key", "type": "directional", "color": "#FFFFFF", "intensity": 2.4, "direction": [-0.4, -0.8, 0.45],
     "notes": "Large soft studio key from upper front-left; exposure 1.0 with ACES filmic tone mapping."},
    {"id": "fill", "type": "hemisphere", "skyColor": "#FFFFFF", "groundColor": "#D8D8D8", "intensity": 1.1,
     "notes": "Bright white-sweep fill keeps shadows open (high-key studio)."},
    {"id": "rim", "type": "directional", "color": "#FFFFFF", "intensity": 1.2, "direction": [0.5, -0.4, -0.6],
     "notes": "Back rim light producing the bright specular on the red plastics."},
    {"id": "ground", "type": "contact-shadow", "opacity": 0.35,
     "notes": "Soft ground shadow / contact shadow under both tyres on a white floor."},
]

pa = spec["preSpecAssessment"]
pa["objectClass"] = {
    "primaryType": "enduro dirt bike (50cc two-stroke motorcycle)", "primaryDomain": "object",
    "formLanguage": ["geometric tubes", "organic moulded plastics", "radial wheels"],
    "structureKind": ["frame-and-panel assembly", "spoked wheels", "telescopic fork", "swingarm suspension"],
    "motionPotential": ["wheel spin", "steering", "rear suspension travel"],
    "materialFamilies": ["gloss plastic", "painted steel", "anodized aluminium", "rubber", "vinyl"],
    "notes": "Identified from direct inspection: VENT branding, Baja model shroud text.",
}
pa["complexity"]["scores"] = {"silhouetteComplexity": 3, "componentCount": 3, "hierarchyDepth": 2, "repetitionDensity": 3,
                              "materialLayerCount": 2, "localDetailDensity": 2, "occlusionRisk": 2, "actionReadinessNeed": 2}
pa["complexity"]["estimatedCounts"] = {
    "macroComponents": sum(1 for c in components if c["level"] == "macro"),
    "mesoComponents": sum(1 for c in components if c["level"] == "meso"),
    "microFeatureGroups": sum(1 for c in components if c["level"] == "micro"),
    "materialLayers": len(materials), "repetitionSystems": len(repetition)}
pa["complexity"]["reasoning"] = ["~90 parts across frame, suspension, wheels, engine, exhaust and bodywork",
                                 "repetition-dense wheels (spokes, knobs)", "one view; right side inferred"]
pa["unknownsToResolveBeforeImplementation"] = []
pa["resolvedUnknowns"] = [
    {"unknown": "Left-side drivetrain detail (hidden)", "resolution": "standard chain + sprocket layout on the left, visible through spokes"},
    {"unknown": "Exact decal typography", "resolution": "stylized italic block glyphs; flagged approximate"},
    {"unknown": "Tank shape under shrouds", "resolution": "simple extruded volume; it is almost fully covered"}]

# detail inventory ------------------------------------------------------------
details = []
REGIONS = {
    "engine-vent-badge": (0.52, 0.55, 0.06, 0.05), "radiator-fins": (0.62, 0.27, 0.06, 0.15), "pipe-curl": (0.55, 0.45, 0.12, 0.18),
    "silencer-sticker": (0.33, 0.33, 0.08, 0.08), "yellow-spring-coils": (0.45, 0.47, 0.04, 0.06), "rear-disc-ring": (0.30, 0.64, 0.08, 0.10),
    "rear-tyre-knobs": (0.19, 0.48, 0.23, 0.40), "front-disc-ring": (0.66, 0.51, 0.08, 0.12), "front-tyre-knobs": (0.63, 0.38, 0.18, 0.40),
    "gold-stanchion-l": (0.65, 0.18, 0.05, 0.25), "gold-stanchion-r": (0.63, 0.18, 0.04, 0.22), "fork-guard-logo-r": (0.71, 0.46, 0.05, 0.14),
    "front-fender-kick": (0.68, 0.22, 0.10, 0.10), "seat-texture": (0.32, 0.22, 0.24, 0.08), "rear-fender-kick": (0.17, 0.23, 0.18, 0.08),
    "red-reflector": (0.16, 0.37, 0.03, 0.03), "vent-letter-0": (0.36, 0.30, 0.14, 0.12), "footpeg-teeth-r": (0.48, 0.60, 0.06, 0.05),
}
KIND = {"decal": "decal", "groove": "groove", "contour": "contour", "ridge": "ridge", "gloss": "gloss", "gloss-override": "gloss",
        "stitch": "stitch", "emissive": "emissive", "fastener": "fastener"}
for fid, target, kind in detail_links:
    x, y, w, h = REGIONS.get(fid, (0.0, 0.0, 1.0, 1.0))
    maps = ({"type": "material.localOverrides", "ref": "brushed-steel/disc-wave-edge"} if kind == "gloss-override"
            else {"type": "component.localFeatures", "ref": f"{target}/{fid}"})
    details.append({"id": fid, "kind": KIND[kind], "description": fid.replace("-", " "),
                    "region": {"x": x, "y": y, "width": w, "height": h, "units": "normalized"},
                    "scale": "micro" if kind in ("fastener", "stitch", "decal") else "meso", "affects": "albedo" if kind in ("decal", "emissive") else "geometry",
                    "mapsTo": maps, "evidenceRef": "reference.jpg", "confidence": 0.7})
for extra, mat, ov in (("tyre-knob-wear", "tyre-rubber", "tyre-knob-wear"), ("frame-edge-wear", "black-frame", "frame-edge-wear"),
                       ("red-panel-edge-gloss", "red-plastic", "red-panel-edge-gloss")):
    details.append({"id": extra, "kind": "stain" if "wear" in extra else "gloss", "description": extra.replace("-", " "),
                    "region": {"x": 0.2, "y": 0.2, "width": 0.6, "height": 0.6, "units": "normalized"}, "scale": "micro",
                    "affects": "roughness", "mapsTo": {"type": "material.localOverrides", "ref": f"{mat}/{ov}"},
                    "evidenceRef": "reference.jpg", "confidence": 0.6})
pa["detailInventory"]["scanMethod"] = "grid-3x3"
pa["detailInventory"]["details"] = details

# feature review targets --------------------------------------------------------
spec["featureReviewTargets"] = [
    {"id": "bike-silhouette", "name": "Wheelbase, wheel size and seat/fender line", "tier": "critical",
     "passIds": ["blockout", "structural-pass"], "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["rear-tyre", "front-tyre", "seat", "rear-fender"], "evidenceRefs": ["full-object"]},
    {"id": "front-end-geometry", "name": "Raked gold fork, clamps and bars", "tier": "critical",
     "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.8, "mustPass": True,
     "componentRefs": ["fork-upper-l", "fork-lower-l", "clamp-upper", "handlebar"], "evidenceRefs": ["full-object"]},
    {"id": "spoked-wheels", "name": "Spoked wheels with knobby tyres and wave discs", "tier": "critical",
     "passIds": ["structural-pass", "form-refinement"], "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["rear-tyre", "rear-rim", "rear-disc", "front-tyre"], "evidenceRefs": ["full-object"]},
    {"id": "red-white-livery", "name": "Red bodywork with white/grey livery and VENT logo", "tier": "critical",
     "passIds": ["material-pass", "surface-pass"], "minimumScore": 0.75, "mustPass": True,
     "componentRefs": ["shroud-l", "side-panel-l", "rear-fender", "logo-v0"], "evidenceRefs": ["full-object"]},
    {"id": "two-stroke-exhaust", "name": "Black expansion chamber and white silencer", "tier": "important",
     "passIds": ["form-refinement", "material-pass"], "minimumScore": 0.7, "mustPass": False,
     "componentRefs": ["exhaust-chamber", "silencer", "silencer-cap"], "evidenceRefs": ["full-object"]},
    {"id": "rear-suspension", "name": "Swingarm and yellow shock spring", "tier": "important",
     "passIds": ["structural-pass", "material-pass"], "minimumScore": 0.7, "mustPass": False,
     "componentRefs": ["swingarm-l", "shock-spring"], "evidenceRefs": ["full-object"]},
]
spec["qualityContract"]["minimumSpecDepth"]["reviewViewpoints"] = 4
spec["performanceBudget"]["targetTriangles"] = 60000
spec["performanceBudget"]["fpsTarget"] = 60

for bp in spec["buildPasses"]:
    bp["componentRefs"] = [c["id"] for c in components]

spec["localSpecSearch"] = assessment["localSpecSearch"]
(HERE / "object-sculpt-spec.json").write_text(json.dumps(spec, indent=2, ensure_ascii=False))
# keep the assessment in sync with the spec's filled preSpecAssessment
assessment["preSpecAssessment"] = pa
(HERE / "assessment.json").write_text(json.dumps(assessment, indent=2, ensure_ascii=False))
print(f"components={len(components)} materials={len(materials)} repetition={len(repetition)} details={len(details)}")
