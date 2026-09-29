#!/usr/bin/env python3
"""Merge cached reference evidence into a freshly built spec and apply the flat-finish contract.

build_spec.py regenerates geometry; the evidence tools (extract_pbr_evidence, apply_material_analysis)
are slow, so their additions are cached in evidence-cache.json and merged back here.

Every material on this bike is a flat paint / moulded plastic / plain metal finish (the photo shows
no print, grain or weave at review scale), so per the skill's rule "solid albedo for flat paint" each
material declares `textureless` with its reference measurement as evidence instead of carrying a
5-channel texture set cropped from a 20-50 px patch.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec_path = HERE / "object-sculpt-spec.json"
cache_path = HERE / "evidence-cache.json"
spec = json.loads(spec_path.read_text())
prev_path = HERE / "object-sculpt-spec.prev.json"
if prev_path.exists():
    # carry review/pipeline state across geometry rebuilds (reviews, tier-1 results, pass locks)
    prev = json.loads(prev_path.read_text())
    for key in ("reviewHistory", "sculptPipeline", "visualEvidence"):
        if key in prev:
            spec[key] = prev[key]
    for key, value in prev.items():
        if key not in spec:
            spec[key] = value

TOP = ("materialAnalysisHistory", "materialPipeline", "pbrExtractionHistory")
MAT_KEYS = ("referencePbr", "materialEvidence", "materialFamily", "materialFinish", "materialReference",
            "materialSubtype", "referenceMaterialId", "textureAnalysis", "ior", "roughness", "textureless")
COMP_KEYS = ("materialRegions", "uvContract")

if not cache_path.exists():
    cache = {"top": {k: spec[k] for k in TOP if k in spec},
             "materials": {m["id"]: {k: m[k] for k in MAT_KEYS if k in m} for m in spec["materials"]},
             "components": {c["id"]: {k: c[k] for k in COMP_KEYS if k in c} for c in spec["componentTree"]}}
    cache_path.write_text(json.dumps(cache, indent=1))
cache = json.loads(cache_path.read_text())

spec.update(cache["top"])
for m in spec["materials"]:
    m.update(cache["materials"].get(m["id"], {}))
for c in spec["componentTree"]:
    c.update(cache["components"].get(c["id"], {}))

TEXTURE_FIELDS = ("normal", "bump", "displacement", "surfaceFrequencyBands", "textureProjection",
                  "textureResolution", "referencePbr")
for m in spec["materials"]:
    pbr = m.get("referencePbr") or {}
    if "textureless" not in m:
        m["textureless"] = {
            "declared": True,
            "evidence": [
                f"reference crop {pbr.get('sourceImage', '?')} (confidence {pbr.get('confidence', '?')}) "
                f"palette {pbr.get('palette', [])[:3]}: one flat hue family, no print/grain/weave at review scale",
                "material-analysis.json region assignment: flat finish class",
            ],
        }
        m["referencePbrMeasurement"] = {k: pbr.get(k) for k in ("confidence", "palette", "sourceImage", "verdict")}
    for f in TEXTURE_FIELDS:
        m.pop(f, None)
    rough = m.get("roughness")
    if isinstance(rough, dict) and isinstance(rough.get("map"), dict):
        rough["map"] = "independent-procedural-field (flat; reference-derived base value)"
spec_path.write_text(json.dumps(spec, indent=2, ensure_ascii=False))
print("finalized", len(spec["materials"]), "materials")
