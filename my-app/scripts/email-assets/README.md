# Email asset build

Produces everything in `pawtchi-website/public/email/` — four photographs and
eight icons — and writes them straight into that folder.

## Running it

```bash
node scripts/email-preview-server.js          # serves my-app/ on :4321
```

Put the four source photographs in `my-app/.tmp-assets/` as `src-together.png`,
`src-leash.png`, `src-rest.png` and `src-beach.png` (gitignored — they are
multi-megabyte originals and do not belong in the repo), then open:

```
http://localhost:4321/scripts/email-assets/build.html
```

It converts and POSTs each file to the preview server's `/save` endpoint, which
writes into the website's email folder. The page prints the resulting byte size
for every asset.

## Why the browser is the image pipeline

There is no `sharp`, ImageMagick or `node-canvas` on this machine, and adding a
native image dependency to an Expo app to resize four JPEGs once is a poor
trade. A headless Chrome canvas downscales and re-encodes perfectly well, and
the whole pipeline stays dependency-free.

`/save` is confined to the email asset folder and rejects anything resolving
outside it. It only exists on the dev preview server and is never deployed.

## Why the icons are drawn here rather than generated

Eight marks need identical stroke weight, cap style and optical size. That is
something path data does reliably and an image model does not — the first
attempt at generating them by prompt would have needed eight rounds of
correction to match each other.

They are rasterised to 48×48 PNG for a 24px slot because **Gmail strips `<svg>`
on every platform** and no mail client loads an icon webfont dependably.

**Every icon is checked for clipping before it is saved.** The first `activity`
draw put the runner's trailing leg at y=47 of 48 — the stroke was being cut off
at the canvas edge, which is invisible at 24px and obvious at 72px. The build
now measures the alpha bounding box and refuses to write anything touching an
edge. Healthy ink coverage sits between 14% and 23%; well outside that range
means the path is wrong.

## Budgets

Photographs stay under 200 KB and are exported at roughly 2x their display
width. `default-beach.jpg` is the only portrait and needed 820px rather than
1200px to fit the budget.

Icons land at 1–2 KB each. Total folder weight is about 544 KB.
