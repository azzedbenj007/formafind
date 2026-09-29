#!/usr/bin/env python3
"""Dump the Tier-1 foreground mask of the reference (224x224 grid) for camera fitting."""
import json, sys
from pathlib import Path
sys.path.insert(0, "/home/user/formafind/.claude/skills/img2threejs/forge/stage4_review")
sys.path.insert(0, "/home/user/formafind/.claude/skills/img2threejs/forge")
from diagnose_render import load_mask, MASK_GRID_SIZE  # noqa: E402
mask, warnings = load_mask(Path(sys.argv[1]))
Path(sys.argv[2]).write_text(json.dumps({"size": MASK_GRID_SIZE, "mask": "".join("1" if m else "0" for m in mask), "warnings": warnings}))
print(MASK_GRID_SIZE, sum(mask), warnings)
