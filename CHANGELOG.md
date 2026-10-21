# Changelog

## 3.0.0

A rewrite as ES modules for D3 v7. The chart's behaviour and styling follow 1.x except where noted below.

Version 2.0.0 of `d3-parsets` on npm was published from an unrelated fork. 3.0.0 is the successor to 1.x.

### Upgrading from 1.x

**Packaging**

- The package is now `d3-parsets` (was `d3.parsets`). Import the chart factory instead of calling `d3.parsets()`:

  ```js
  import parsets from "d3-parsets";
  import "d3-parsets/style.css";
  ```

  For a script tag, `dist/d3-parsets.min.js` defines the global `d3Parsets`; create charts with `d3Parsets.default()`.
- The package is ESM only. `dist/d3-parsets.js` imports the D3 modules it uses, which are installed as dependencies, so no global `d3` is required and bundlers share them with your copy of D3. The script-tag build includes them.
- `d3.parsets.tree` is now the named export `tree`; it remains available as `parsets.tree`.

**Changed behaviour**

- Tooltips are drawn inside the SVG as a `.parsets-tooltip` group, instead of an HTML `div.parsets.tooltip` appended to the page. Tooltip callbacks return plain text: use `\n` instead of `<br>` for line breaks. Blank lines and leading spaces are kept, and a callback returning null or an empty string shows no tooltip. Style `.parsets-tooltip rect` and `.parsets-tooltip text` instead of `.tooltip`.
- The default ribbon tooltip includes every category in the path, including falsy names such as `0` or `""`, which 1.x skipped.
- The default tooltips show percentages to one decimal place, for example `32.3%` (was `32%`).
- Hovering a category highlights the whole flow through it, including the ribbons leading into it from earlier dimensions. 1.x highlighted only the ribbons leaving it.
- While a ribbon or category is hovered, the other ribbons get the class `inactive`, which the bundled stylesheet dims to `fill-opacity: .2`. Thanks to Cox Chen ([#13](https://github.com/jasondavies/d3-parsets/pull/13)).
- Highlights fade in and out over 0.3s in the bundled stylesheet, except when the user prefers reduced motion.
- When the user prefers reduced motion, the chart does not animate: sorting, dragging, tension and orientation changes happen at once.
- A dragged category's flow stays highlighted while it is dragged, and afterwards until the pointer leaves it. Its tooltip is hidden while dragging.
- A dragged category passes a neighbour when its middle passes the neighbour's, as in 1.x, or as soon as the gap it leaves behind would fit the neighbour, so a wide category passes a narrow one sooner.
- The category sort controls are labelled "key" and "value" (were "alpha" and "size"), and their classes changed to match: `tspan.sort.key` and `tspan.sort.value` (were `tspan.sort.alpha` and `tspan.sort.size`). The "key" control sorts by [`categorySortKey`](README.md#parsets_categorySortKey), which defaults to the category name. Each control shows ↑↓, and once used dims the arrow for the order it did not apply, so ↑ shows ascending and ↓ descending, until the categories are reordered another way (1.x showed » and «). The control then has the class `ascending` or `descending`.
- The 2px width of the category lines is set by the stylesheet instead of an inline style. If you use your own stylesheet, add `.category line { stroke-width: 2px; }`.
- Dimensions are always rendered in the order the [`dimensions`](README.md#parsets_dimensions) accessor returns. A dragged order lasts until the next render; to keep it, store the order passed to the "sortDimensions" listener.
- Categories start each render in data order, or in the order given by [`categorySort`](README.md#parsets_categorySort). An interactive sort lasts until the next render; to keep it, store the order passed to the "sortCategories" listener.
- "sortDimensions" listeners receive the new array of dimension names, and "sortCategories" listeners receive the dimension name and its new array of category names. In a listener, `this` is the element the interaction happened on (was the event dispatcher).
- A visible category keeps its colour across sorting, dragging and rerendering. See [colours](README.md#d3-parsets).
- A tension change animates over the chart's [duration](README.md#parsets_duration); 1.x applied it immediately unless the chart was called through a transition. When it is, all of the render's animations now follow that transition's delay, duration and easing for each element; 1.x moved dimensions and categories over the chart's own duration.
- The chart no longer adds a `mousemove` listener to `window`. Highlights clear when the pointer moves elsewhere in the chart or leaves it, and removing a chart's element needs no other cleanup.
- Formatters are called before anything is drawn, so `dimensionFormat` and `categoryFormat` no longer receive the label element as `this`. A render, sort or drag calls all of your callbacks before it changes anything, so one that throws leaves the chart as it was.
- A negative height no longer reverses the chart. To show the dimensions in reverse order, reverse the [`dimensions`](README.md#parsets_dimensions) array.
- Invalid settings throw: width, height, spacing, node thickness and duration must be finite and non-negative, and tension finite, or they throw a `RangeError`; settings that take a function throw a `TypeError` for anything else. Values returned by the value accessor must also be finite and non-negative. Setting any setting to `null` restores its default.
- The dimensions and ribbons are drawn inside a `g.parsets-plot` group, which orients them, rather than directly inside the chart's element.

**New**

- [`categoryFormat`](README.md#parsets_categoryFormat), which also receives the dimension name. Thanks to Ioannis Cherouvim ([#14](https://github.com/jasondavies/d3-parsets/pull/14)).
- [`categorySortKey`](README.md#parsets_categorySortKey), [`categorySort`](README.md#parsets_categorySort), [`nodeThickness`](README.md#parsets_nodeThickness) and [`color`](README.md#parsets_color).
- [`orientation`](README.md#parsets_orientation), for horizontal charts, which turn a quarter turn when the orientation changes ([#20](https://github.com/jasondavies/d3-parsets/issues/20)). `parsetsLayout` also has an `orientation`.
- [`chart.render(data, parent)`](README.md#parsets_render), which renders into a new SVG element and returns it.
- TypeScript declarations, for `d3-parsets` and `d3-parsets/layout`.
- [`parsetsLayout`](README.md#standalone-layout), which computes chart geometry without a DOM. It is also available as `d3-parsets/layout`.
