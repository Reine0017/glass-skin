# Scale plate atlas (Blender 5.3, Cycles)
Rerun: `blender -b -P tools/blender/render-scales.py` (~75 s on an M3 Pro; the first GPU run compiles Metal kernels once, ~7 min).
Writes `assets/scales/plate-atlas.{png,webp,json}` + `plate-atlas-preview.png`. Fixed seed, factory settings; EXRs go to a temp dir.
Quick look: `-- --px 160 --samples 48 --out /tmp/x`; subset `--cells "4,0;6,1"` (col,row); override any knob `--set FILM_NM=440`.
Knobs are the constants at the top of the script:
- `EDGE_H`, `DOME_H`, `ROLL_EXP`, `SOFT_N`, `KEEL_*`: plate form. More `DOME_H` = smaller glint that slides further per cell.
- `FILM_NM`, `FILM_IOR`: thin film. Thickness sets the face-on hue (472 nm = gold); lower IOR = faster shift to green/cyan off-angle.
- `ROUGHNESS` (coloured halo), `COAT_*` (crisp pale core), `BODY_OKLCH`/`BODY_ALBEDO_GAIN` (body tint), `SUN_*`, `WORLD_*`, `HORIZON_*` (rim line).
- `EXPOSURE`, `SHOULDER_KNEE`, `PEAK`, `WHITE_BLEED`: one global grade for every cell. `OCC_*`: baked base occlusion (post-multiply).
- `TRANSMISSION`, `DISPERSION`: off. Dispersion only acts on transmitted light; enabling it made the body blotchy.
