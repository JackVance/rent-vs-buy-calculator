# Rent vs. Buy Calculator

A self-contained `<rent-vs-buy>` web component that ports the
`reference/RealEstate_Calculator_Macro.xlsm` model to the browser. No backend,
no build step, no dependencies.

## Files

| File | Purpose |
| --- | --- |
| `src/rent-vs-buy.js` | The whole widget — financial model **and** UI in one ES module. Also exports `pmt`, `amortize`, `computeModel` for testing. |
| `src/RentVsBuy.html` | Eleventy embed page (front matter matches the existing site convention). |
| `src/RentVsBuy-about.html` | Behind-the-scenes "about" companion page. |
| `demo.html` | Standalone local preview (no Eleventy needed). |
| `test/verify.mjs` | Asserts the model matches the source workbook. |
| `test/golden.json` | Cached workbook values used by the test. |

## Try it locally

```sh
# any static server works; e.g.
npx serve .
# then open http://localhost:3000/demo.html
```

(Opening `demo.html` directly via `file://` may be blocked by the browser's
module-loading rules — serve it over http.)

## Run the test

```sh
node test/verify.mjs
```

## Pulling into the Eleventy site (bigolbuffalo)

1. Copy `src/rent-vs-buy.js` into the site so it ships to the web root as
   `/rent-vs-buy.js`. The simplest match for the existing pattern is a
   passthrough copy in `eleventy.config.js`:

   ```js
   eleventyConfig.addPassthroughCopy({ "src/RentVsBuy/rent-vs-buy.js": "rent-vs-buy.js" });
   ```

   (or drop it next to the other root assets and copy it through the same way
   `scripts.js` is handled).
2. Copy `src/RentVsBuy.html` and `src/RentVsBuy-about.html` into the site's
   `src/`. They already use `layout: layouts/page.njk` / `layouts/standalone.njk`
   and the `aboutUrl` convention.
3. Build and confirm `/RentVsBuy.html` renders the calculator.

## Embedding anywhere else

```html
<script type="module" src="/rent-vs-buy.js"></script>
<rent-vs-buy></rent-vs-buy>
```

The component uses Shadow DOM, so it won't collide with page styles. It exposes
CSS custom properties (`--rvb-accent`, `--rvb-bg`, `--rvb-fg`, …) if you want to
theme it to match the host page.
