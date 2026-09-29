#!/usr/bin/env bash
# Deterministic review gates for one pass: render views, Tier-1, multi-angle, turntable, pass check, sheet.
set -e
cd "$(dirname "$0")"
PASS=$1
S=/home/user/formafind/.claude/skills/img2threejs/forge
H=/tmp/claude-0/-home-user-formafind/25462e0d-f84f-59ba-80e7-fa2462ce34b0/scratchpad/harness
OUT=review/$PASS; mkdir -p $OUT
CAM="d=3.1&fov=40&ty=0.6&tz=0"
PASS=$PASS ./render.sh "ref:az=234&el=11&$CAM" "front:az=0&el=8&d=4.2&ty=0.6&tz=0" "right:az=270&el=8&d=4.2&ty=0.6&tz=0" \
  "rear:az=180&el=8&d=4.2&ty=0.6&tz=0" "left:az=90&el=8&d=4.2&ty=0.6&tz=0" "top:az=300&el=55&d=3.8&ty=0.5&tz=0" >/dev/null
cp $H/shots/{ref,front,right,rear,left,top}.png $OUT/
python3 $S/stage4_review/diagnose_render.py --reference reference.jpg --render $OUT/ref.png --spec object-sculpt-spec.json --pass-id $PASS --in-place --json > $OUT/tier1.json || true
python3 $S/stage4_review/diagnose_render_multi_angle.py --reference $OUT/ref.png --orbit $OUT/right.png --orbit $OUT/front.png --orbit $OUT/top.png --json > $OUT/multi-angle.json || true
python3 $S/stage4_review/turntable_gate.py --capture 0=$OUT/front.png --capture 90=$OUT/left.png --capture 180=$OUT/rear.png --capture 270=$OUT/right.png --json > $OUT/turntable.json || true
python3 $S/stage3_build/orchestrate_passes.py check object-sculpt-spec.json --pass-id $PASS > $OUT/pass-check.txt 2>&1 || true
python3 $S/stage4_review/make_comparison_sheet.py --reference reference.jpg --render $OUT/ref.png --out $OUT/cmp.png --json > /dev/null
for f in tier1 multi-angle turntable; do python3 - "$OUT/$f.json" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); keys=[k for k in ("passed","pass","verdict","status","overall","ok","degenerate","holes","missingAzimuths","failures") if k in d]
print(sys.argv[1].split('/')[-1], {k:d[k] for k in keys} if keys else list(d.keys())[:8])
PY
done
tail -2 $OUT/pass-check.txt
