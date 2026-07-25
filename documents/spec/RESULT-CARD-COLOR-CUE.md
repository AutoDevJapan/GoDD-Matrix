# Result card color cue (issue #97 / #102)

## Problem

After #90 removed color from the card title and tags (density cleanup), popular-order pages
showed many adjacent cards that differed only by color axis and looked identical
(especially when `variant === 0` and no Variant tag is shown).

#102: using `approxSwatchesForColor()[0]` painted every cue near-white because index 0 is
the surface token (L≈95), not the family accent.

## Contract

| Surface | Color information |
| --- | --- |
| Title (`buildDirectionTitle`) | No color (mood + surface only) |
| Tags (`buildEntryTags`) | Industry (+ Variant when `variant > 0`) only |
| Color cue (`buildCardColorCue`) | Always present: short family label + swatch hex |
| Footer | No date / color footer (kept removed by #90) |

`buildCardColorCue` returns:

- `familyKey` — `colorFamily(entry.color).key`
- `label` — short family label via `facetLabel("color", …)` (ja: `青系`, en: `Blues`)
- `swatchHex` — `familySwatchHex(familyKey)` first (saturated family sample, matches facet
  chips); fallback to approx swatch with `role === "primary"`, then `#94a3b8`

## Acceptance

- Given two popular-order cards that differ only by color, When rendered, Then their
  color cues differ in label and swatch hex.
- Given a light-tone slug (e.g. `lt-h03`), When rendered, Then the cue swatch is a
  saturated family color (not near-white surface).
- Given `variant === 0`, When rendered, Then the color cue is still shown.
- Given #90 density rules, When rendered, Then the title has no color and tags stay
  industry-focused.
