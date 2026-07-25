# Result card color cue (issue #97)

## Problem

After #90 removed color from the card title and tags (density cleanup), popular-order pages
showed many adjacent cards that differed only by color axis and looked identical
(especially when `variant === 0` and no Variant tag is shown).

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
- `swatchHex` — primary approx swatch for the entry color (fallback: family representative)

## Acceptance

- Given two popular-order cards that differ only by color, When rendered, Then their
  color cues differ in label and/or swatch hex.
- Given `variant === 0`, When rendered, Then the color cue is still shown.
- Given #90 density rules, When rendered, Then the title has no color and tags stay
  industry-focused.
