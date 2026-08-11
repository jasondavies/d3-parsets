# d3-parsets

A parallel sets layout for D3.js, in the spirit of [d3-sankey](https://github.com/d3/d3-sankey): `parsetsLayout()` is a pure function that turns categorical data into geometry (dimension rows, category bars, connecting links). It renders nothing itself — rendering, dragging, sorting and tooltips are the caller's responsibility, exactly as with sankey's node/link layout. See [docs/](docs/) for a complete SVG + d3-drag renderer built on top of it.

Originally based on [d3.parsets](https://github.com/jasondavies/d3-parsets) by Jason Davies, itself based on [Parallel Sets](http://eagereyes.org/parallel-sets) by Robert Kosara and Caroline Ziemkiewicz.

## Install

```
npm install d3-parsets
```

```js
import {parsetsLayout} from "d3-parsets";
```

## Example

```js
const data = [
  {Class: "1st", Sex: "Male", Survived: "No", count: 118},
  {Class: "1st", Sex: "Male", Survived: "Yes", count: 62},
  // …
];

const {dimensions, links} = parsetsLayout()
    .width(960)
    .height(600)
    .dimensions(["Class", "Sex", "Survived"])
    .value(d => d.count)
    (data);
```

Run it again with different arguments (a reordered `.dimensions()` array, a different `.categorySort()`) to get new geometry; nothing is kept between calls. See [docs/render.js](docs/render.js) for a complete renderer, including how it keeps the state the layout deliberately doesn't (current order, previous frame for animation).

## Output

`parsetsLayout()(data)` returns `{dimensions, links}` — plain data, no DOM, no D3 selections. This is what's in them.

**`dimensions`**: one entry per configured dimension, in order, each `{name, y, categories}`.

- `name` — the dimension name, e.g. `"Class"`.
- `y` — the vertical center of this dimension's node bar. Already accounts for `nodeThickness`, so the first and last bars sit fully inside `[0, height]` — draw the bar centered on this `y`, thickness `nodeThickness`.
- `categories` — that dimension's distinct values, stacked left to right, each `{name, count, x, dx}`: `name`/`count` are the category value and its aggregate, `x`/`dx` are its absolute horizontal position and width (proportional to `count`). Draw a category as a bar/rect at `[x, x + dx]`.

**`links`**: one entry per edge between two adjacent dimensions' categories (e.g. every non-empty Class → Sex combination), each `{path, count, rootCategory, source, target}`.

- `path` — a string unique to this link (category names joined by `"\0"`), stable across calls with the same data/order. Use it as the key in a D3 `.data(links, d => d.path)` join.
- `count` — this link's aggregate value.
- `rootCategory` — the name of the category in `dimensions[0]` this link traces back to. Not a color or an index — pick a scale yourself, e.g. `d3.scaleOrdinal(d3.schemeCategory10).domain(dimensions[0].categories.map(c => c.name))`, and look up `color(link.rootCategory)`.
- `source`/`target` — where the link attaches on each side, `{dimension, category, x, dx, y}`. `dimension`/`category` are the *same object references* as in `dimensions`/`dimensions[i].categories` (so `link.source.dimension === dimensions[0]` holds — useful for filtering, e.g. every link touching a given category). `x` is this link's own offset *within* its category's band (add `category.x` for an absolute coordinate: `category.x + x`); `dx` is this link's own width, the same value on both `source` and `target`. `y` is already offset outward by `nodeThickness / 2` from the dimension's `y` — the point where the flow should visually touch the bar, no further adjustment needed.

A straight-sided ribbon between a link's two attachment points, for example:

```js
function ribbonPath(d) {
  const s = d.source, t = d.target;
  const sx = s.category.x + s.x, sy = s.y;
  const tx = t.category.x + t.x, ty = t.y;
  return `M${sx},${sy}L${tx},${ty}h${t.dx}L${sx + s.dx},${sy}Z`;
}
```

[docs/render.js](docs/render.js) has three worked variants of this (straight, curved, and a single stroked centerline via `d3.linkVertical()`) plus drag-to-reorder, sorting and tooltips built on the same output.

## API

<a name="parsetsLayout" href="#parsetsLayout">#</a> <b>parsetsLayout</b>()

Creates a new layout with default settings. The returned function is stateless: calling it with the same arguments always returns the same geometry.

<a name="parsetsLayout_dimensions" href="#parsetsLayout_dimensions">#</a> <i>parsetsLayout</i>.<b>dimensions</b>([<i>dimensions</i>])

If *dimensions* is specified, sets the ordered list of categorical dimensions to lay out. If a function is specified, it is invoked with the input data and an array of dimension names is expected in return; if an array is specified, it is used as-is. Defaults to the sorted keys of the first data row.

<a name="parsetsLayout_value" href="#parsetsLayout_value">#</a> <i>parsetsLayout</i>.<b>value</b>([<i>value</i>])

If *value* is specified, sets the value accessor, invoked once per input row. Defaults to a constant `1`, i.e. counting rows. Set this to an accessor returning the aggregate count if the input is already a pivot table.

<a name="parsetsLayout_width" href="#parsetsLayout_width">#</a> <i>parsetsLayout</i>.<b>width</b>([<i>width</i>])

The horizontal extent categories are stacked across. Defaults to 1.

<a name="parsetsLayout_height" href="#parsetsLayout_height">#</a> <i>parsetsLayout</i>.<b>height</b>([<i>height</i>])

The vertical extent dimensions are spread across. Defaults to 1.

<a name="parsetsLayout_spacing" href="#parsetsLayout_spacing">#</a> <i>parsetsLayout</i>.<b>spacing</b>([<i>spacing</i>])

Total horizontal spacing distributed between a dimension's categories. Defaults to 20.

<a name="parsetsLayout_nodeThickness" href="#parsetsLayout_nodeThickness">#</a> <i>parsetsLayout</i>.<b>nodeThickness</b>([<i>nodeThickness</i>])

Vertical thickness reserved for each dimension's node bar — the equivalent of `nodeWidth` in d3-sankey. Links attach to its outer edges, so this is also the gap left between the flow arriving at a dimension and the flow leaving it. Defaults to 4.

<a name="parsetsLayout_categorySort" href="#parsetsLayout_categorySort">#</a> <i>parsetsLayout</i>.<b>categorySort</b>([<i>categorySort</i>])

If specified, a function `(dimensionName) => comparator | falsy`, called once per dimension so each can be sorted independently — e.g. reflecting a drag-derived order for one dimension while others keep their default (first-encountered) order. Return a falsy value to leave a dimension's categories unsorted.

## Development

```
npm test    # mocha + eslint
npm run build   # UMD bundle in dist/
```

## Releasing

```
npm version patch   # or minor / major — bumps package.json and creates the matching git tag together
git push --follow-tags
npm publish
gh release create "v$(node -p "require('./package.json').version")" --generate-notes
```

Always bump with `npm version` rather than editing `package.json` and tagging separately — it keeps the git tag and the published version from drifting apart. The last step (turning the tag into a GitHub release with notes) is optional.
