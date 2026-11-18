# Glass skin

A landing-page transition: the page wears a skin of iridescent glass scales that slithers until you touch it, then cracks along the seams and sheds to reveal the page underneath.

**Play:** https://reine0017.github.io/glass-skin/ · July version: https://reine0017.github.io/glass-skin/v1/

## v1 → v2

- **v1 (July)** animates the skin as a flat sheet with a lit band painted in screen space.
- **v2 (November)**, rebuilt with Claude Opus 5.5:
  - **Body:** a tube bent along an S-curve. Bends roll back along the body while the skin slides forward through them, so scales bunch on the inside of each bend and spread on the outside.
  - **Light:** each scale is lit by its own angle to one fixed light, so the bright strip follows the body's geometry.
  - **Shed:** cracks run along the seams, rafts of plates lift, break apart and fall rocking like leaves.
- **Glass scales:** rendered by a Claude Fable 5.2 subagent in Blender 5.3 (Cycles). One plate is rendered at 45 orientations into a 99 KB WebP atlas (see `tools/blender/`). Add `?painted` for the procedural sprites instead.

Canvas 2D, no libraries. Add `?dev&ov` to watch the spine and the predicted highlight line drawn over the skin.
