# Virtual Catalog (issue #71)

Last updated: 2026-07-25

Versioned canonical virtual space for the Matrix static web UI. Exact filtered
counts and page materialization are O(axis sizes), never O(total cells).

```mermaid
flowchart TB
  subgraph ui [Presentation - main.ts]
    Search[Search / facets / sort]
    Pager[Pager + ordinal jump]
    Detail[Detail + local render]
  end

  subgraph domain [Domain - pure modules]
    Catalog[virtual-catalog.ts]
    UrlState[catalog-url-state.ts]
    Permalink[virtual-permalink.ts]
    Design[virtual-design.ts]
    Sort[result-sorting.ts]
  end

  subgraph data [Bundled / remote data]
    Jsic[JSIC catalog]
    Colors[MINIMAL_COLORS]
    Index[Materialized index.json]
  end

  Search --> UrlState
  UrlState --> Catalog
  Search --> Catalog
  Catalog --> Permalink
  Catalog --> Sort
  Pager --> Catalog
  Catalog --> Detail
  Detail --> Design
  Detail --> Index
  Jsic --> Catalog
  Colors --> Catalog
```

## Legend

- Blue UI nodes: DOM wiring only
- Green domain nodes: deterministic, DOM-free, unit-tested
- Gray data nodes: bundled axes or fetched materialized bodies
