# Image analysis — reference.jpg (1280x850-ish studio shot)

## L1 Identification
- Work type: 50cc two-stroke enduro / off-road motorcycle (dirt bike). Branding "VENT" on side panel,
  exhaust silencer, fork guard and engine cover; "BA…" (Baja) on radiator shroud. Confidence 0.95.
- Classification: vehicle, mechanical assembly. primaryDomain = object.

## L2 Form & silhouette
- Camera: rear-left three-quarter, azimuth ≈ 215° from bike front (camera behind and to the bike's LEFT),
  elevation ≈ 12°, moderate perspective (rear wheel appears larger than front).
- Bounding volume ≈ 2.05 m long (X, forward +Z in model), 1.20 m tall to bar ends, 0.80 m wide at bars.
- Bilateral symmetry about the mid-plane for frame, forks, wheels, bodywork; asymmetric drivetrain
  (chain + sprockets on left, expansion chamber/silencer on right, brake discs on left).
- Shape language: mixed — geometric tubes/cylinders (frame, forks, wheels) + organic lofted
  plastics (tank shrouds, side panels, fenders, seat).
- Reference dimension: wheelbase ≈ 1.36 m. Front wheel 21" (tyre OD ≈ 0.70 m), rear 18" (tyre OD ≈ 0.66 m, wider tyre).

## L3 Decomposition
Macro: frame, front-end (forks + triple clamps + bars + front wheel + fender + number plate),
rear-end (swingarm + shock + rear wheel), engine, exhaust, bodywork (shrouds, side panels, rear fender), seat.
Meso: wheel = tyre (knobby) + rim + 36 spokes + hub + brake disc + caliper; fork = gold upper tube,
silver lower leg, red/white fork guard; handlebar = bar + grips + levers + mirrors stub; drivetrain =
front sprocket, rear sprocket, chain; exhaust = expansion chamber (black, loops under right of engine
forward then back), silencer (white can, carbon end cap); rear shock = yellow spring + black body;
footpegs + kickstart/shifter; rear fender = red tail with black licence-plate hanger + red reflector + tail light.
Micro: tyre knob rows, spoke nipples, wave-disc cutouts, "VENT" decals, grey/white livery stripes, radiator fins.

## L4 Spatial relationships
- <frame, supports, engine> embed; <frame head-tube, holds, steering stem> socket.
- <upper triple clamp, clamps, fork tubes> socket; <handlebar, attached-to, upper clamp> butt.
- <front axle, inside, fork lower legs> socket; <swingarm, pivots-on, frame behind engine> socket.
- <rear shock, between, frame top and swingarm> socket at both ends.
- <seat, above, frame rails, flush-with side panels>; <shrouds, overlap, tank and radiator>.
- <expansion chamber, attached-to, cylinder exhaust port (front of engine)> butt; routes down/right,
  back under the side panel to the silencer mounted on right subframe.
- <rear fender, embedded-in, rear of side panels>; <plate hanger, below, rear fender tip>.

## L5 Materials (PBR)
- Red bodywork: glossy ABS/PP plastic, dielectric, roughness ≈ 0.35.
- White panels/fork guard/silencer: gloss plastic/painted metal, roughness ≈ 0.35.
- Dark grey livery stripe: satin, roughness 0.5.
- Seat: black textured vinyl, roughness 0.8.
- Frame, swingarm, rims, expansion chamber, engine cases: black paint, satin, roughness 0.5–0.6.
- Fork uppers: gold anodized/TiN coating, metalness 1, roughness 0.25.
- Fork lowers, spokes, discs, triple clamps: raw/brushed aluminium & steel, metalness 1, roughness 0.3–0.4.
- Tyres: black rubber, roughness 0.9.
- Chain: gold/brass tint steel, metalness 1, roughness 0.45. Shock spring: yellow painted, roughness 0.4.

## L6 Colour
- Red: vivid red, hue ≈ 356°, high saturation, mid value (sRGB ≈ #d3121c).
- White: #f2f2f2. Grey stripe: #4a525c. Black: #16181b. Gold fork: #c9a141. Yellow spring: #e2b923.

## L7 Identity features
- Red/white/grey livery with large white "VENT" letters on rear side panel.
- High red rear fender kick with black plate hanger drooping down, red reflector.
- Gold upside-down... (actually conventional) gold fork tubes, silver lowers with red/white guards.
- Black expansion chamber (two-stroke "pipe") curling past the engine.
- Wave brake discs, knobby tyres, black rims with silver spokes, gold chain.
- Yellow rear shock spring visible above swingarm pivot.

## L8 Uncertainty
- Right side hidden: expansion chamber routing and silencer mount inferred from typical two-stroke layout.
- Front number plate / headlight hidden behind bars; inferred small headlight mask.
- Radiator (right side, visible fins behind left shroud) inferred symmetric shroud on right.
- Engine internals & detailed carb hidden; engine modelled as block + cylinder + cases.
- Decal text is a surface feature; code-only pipeline → approximated as geometry-paint bands, not true typography.
