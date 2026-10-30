# SURF — art direction

SURF is the third sibling of MEADOW and POND: the same hand and interaction grammar, now looking almost straight down on open sea. The reference is a flat, sunlit editorial illustration of surfers at a break (kept in `references/`, never committed: its usage rights are unknown).

## What the reference does

- **Full-bleed water.** No land, no horizon, no border: the sea fills the frame like a cropped print.
- **The light network.** The whole surface is covered in rounded mint cells separated by pale, slightly broken lines, the way sun through a rippled surface lays a net on the water. The cells are not uniform: some are larger, some stretch, a few merge. This net is what makes calm water feel alive.
- **Waves from the right, travelling left.** A breaking wave is a mass of stippled white foam whose leading edge breaks into specks and spray. Directly ahead of that edge lies a deep teal band — the face of the wave seen from above, in shadow — with a soft, ragged outline. Behind the foam, white water thins back into turquoise in streaks. One wave has a pointed peak where it is peeling.
- **Small, flat characters.** Surfers are tiny, simple shapes read from above: a board (white, yellow, orange), a body lying, sitting or standing on it, hair and swimsuit colour, arms out. No faces.
- **Shadows fall down and to the right**, in a darker teal, slightly offset. Moving surfers trail a few thin white wake lines and rings.
- **Texture.** A fine paper-and-pigment grain over everything; no gloss, no gradients beyond soft ones.

## Palette (sRGB)

| | |
|---|---|
| Water cells | `#7fd3c6` – `#8fdccf` |
| Light lines | `#c8f0e6` (to `#b6eadc` where broken) |
| Wave face shadow | `#2a9aa6` → `#1f8796` at its darkest |
| Character shadow | `#55b4b2` |
| Foam | `#ffffff`, specks `#f2f6f4` |
| Boards | white `#f7f5ef`, yellow `#f2c94c`, orange `#f2a03a`, a pale stripe or rail |
| Swimsuits | coral red `#e2554a`, navy `#2f3f6b`, purple `#8a63b8`, green `#6fae54`, yellow `#f2c94c`, teal `#2d8f8f` |
| Skin | `#f1c7a6`, `#e3a882`, `#c98d64`, `#9a6544`, `#6e4630` |
| Hair | `#3a2a22`, `#6b4a32`, `#a9825a`, `#1f1a18`, `#c9a46a` |

## What carries over from POND

The painted light (`paintLight`, warm light and gentle lavender-free shade on white so boards never go lilac), the shared sun shadow map, the watercolour bloom reveal with its pigment stain and ring, the ripple-ring pool, the pen line, the UI and its tokens, and the smooth-steering model (`steer.ts`).

## What is new

The sea is an analytic swell plus a set of breaking waves, each a parametric band (crest line, travel direction, speed, width, life) with exact CPU and GLSL twins, so behaviours and paint agree on where the foam is. Characters are a board and a small articulated person posed together; the board can come away from its rider in a wipeout.
