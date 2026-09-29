#!/usr/bin/env bash
# Rebuild spec -> merge evidence -> strict-validate -> generate factory -> render views.
set -e
cd "$(dirname "$0")"
S=/home/user/formafind/.claude/skills/img2threejs
H=/tmp/claude-0/-home-user-formafind/25462e0d-f84f-59ba-80e7-fa2462ce34b0/scratchpad/harness
PASS=${PASS:-blockout}
[ -f object-sculpt-spec.json ] && cp object-sculpt-spec.json object-sculpt-spec.prev.json
python3 build_spec.py
python3 finalize_spec.py
python3 $S/forge/stage2_spec/validate_sculpt_spec.py object-sculpt-spec.json --strict-quality > strict-validation.txt 2>&1 || { grep -v '^warning' strict-validation.txt | tail -20; exit 1; }
python3 $S/forge/stage3_build/generate_threejs_factory.py object-sculpt-spec.json --out out/createVentBaja50Model.ts --pass-id "$PASS" --force | tail -1
cp out/createVentBaja50Model.ts $H/gen.ts
(cd $H && npx esbuild main.ts --bundle --outfile=bundle.js --log-level=warning && node shoot.mjs shots "$@")
