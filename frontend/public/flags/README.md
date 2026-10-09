# The journeys-card band's flags

One SVG per country in the app's own country list, painted by a journey card's
header band. This folder is a **generated** copy — do not hand-edit a file here,
and do not add one by hand.

## Why this folder exists

The band on a journey card carries the flags of the countries the trip was in
(owner, 2026-10-09). The frontend's own flag component (`FlagImg`) loads
`https://flagcdn.com` at **runtime**, which the owner's rule forbids for the
band: the card may not fetch a flag from a third party. So the band paints only
files this repository ships, and those files live here.

## What ships, and why exactly these

Every code in `ISO_3166_1_ALPHA2`
(`frontend/src/shared/geo/countryCode.ts`) has exactly one file here, named
`<code>.svg` in lower case. That list is the app's country domain — the set the
resolver can name — so "a code goes in, a flag comes out" holds for every code
the band can be handed. A code the domain does not contain (a grouping code, a
placeholder like `XX`, or a bare two letters that is not a country) resolves to
**no flag**, and the band keeps its neutral fallback rather than inventing one.

## How to regenerate (or add a country)

```
node scripts/vendor-flags.mjs          # copy / refresh every flag
node scripts/vendor-flags.mjs --check  # verify, write nothing
```

The script copies each SVG verbatim from `backend/node_modules/flag-icons`
(the set the repo already vendors for its backend) and prepends a provenance
header. Nothing is downloaded, at author time or at build time. To give a new
country a flag, add the code to `ISO_3166_1_ALPHA2` and re-run the script; if
`flag-icons` has no file for it the script says so rather than shipping a hole.

A test (`frontend/src/lib/__tests__/flagAssets.test.ts`) fails if this folder
and that list ever disagree, in either direction — which is what lets the band
derive the URL by convention with no flag registry to keep in sync.

## Provenance and licence

Each file carries its source and licence in a header comment. The flags are from
the `flag-icons` package, MIT-licensed — Copyright (c) 2013 Panayiotis Lipiridis.
See `backend/node_modules/flag-icons/LICENSE`.
