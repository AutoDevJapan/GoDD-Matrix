# Virtual Catalog (issue #71)

## Purpose

Make the Matrix static web UI’s advertised 100M+ DESIGN.md space a real,
addressable, searchable virtual catalog — not an estimate over a small
materialized index.

## Canonical space (versioned)

- **Version**: `VIRTUAL_SPACE_VERSION = 3` (bump when axis membership or rank digit order changes)
- **Axes** (stable order):
  1. category (16 — see `web/src/filter-taxonomy.ts`)
  2. style (16, maps to mood via `resolveMoodSlug`)
  3. JSIC fine class (sorted catalog codes)
  4. color (`VIRTUAL_COLOR_CATALOG` — one representative slug per color family + neutrals)
  5. variant (`0 … MAX_VIRTUAL_VARIANT`, count = 4000; `MAX_VIRTUAL_VARIANT = 3999`)
- **Cardinality**: product of axis sizes (must remain **≫ 100,000,000**; v3 ≈ 19.6B with current axes)
- **Identity**: `virtual_{jsic}_{color}_{mood}_c{category}_s{style}_v{variant}`

## Exact filtered counts

Filtered count = product of filtered axis list lengths. Filtering JSIC by
industry facet / search tokens is O(|JSIC|), never O(total cells).

## Rank / unrank

Mixed-radix bijection inside the filtered view (LSB → MSB):
`color → jsic → style → category → variant`.

Display order uses `virtualIndexAtRank` so Popular / Newest stay duplicate-free
and page-stable.

## Cursor pagination

Cursor form: `v{version}.{queryFingerprint}.{startRank}`

- Bound to the current query fingerprint (filters + sort + space version)
- Mismatched fingerprint / version → ignored (start at rank 0)
- Distant ordinal jumps set `startRank` / page directly (still O(page size))

## URL state

| Param | Meaning |
|-------|---------|
| `q` | free-text search |
| `cat` / `style` / `ind` / `color` | facet chips |
| `sort` | `popular` (default, omitted) or `newest` |
| `cursor` | query-bound start rank |
| `cell` | selected cell id (materialized or virtual) |

## Local render + materialized overlay

Every valid virtual cell is renderable via `buildVirtualDesign`. When the
materialized index contains the same jsic×color×mood, path/hash are attached so
the detail view fetches the real DESIGN.md while keeping the virtual id.

## Verification

- Unit: `web/src/virtual-catalog.test.ts`, `web/src/catalog-url-state.test.ts`
- E2E (local only): `pnpm test:e2e` — **not** run in GitHub Actions
