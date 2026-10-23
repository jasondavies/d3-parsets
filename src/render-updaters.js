import { drag } from "d3-drag";
import { easeCubic } from "d3-ease";
import { interpolateNumber } from "d3-interpolate";
import { select } from "d3-selection";
import { now, timeout } from "d3-timer";
import { columnHeaderOffset, frameTransform, header, inset, labelBand, upright } from "./frame.js";
import {
  cancelEvent,
  dimensionName,
  getTotal,
  stillness,
  transitionSelection
} from "./helpers.js";
import { layout, positionDimensions } from "./layout.js";
import { categoryLabels, colourSlots, compareKeys, dimensionLabels } from "./prepare.js";
import { truncateText } from "./text.js";
import { buildTree, rootCategory } from "./tree.js";
import { turnLayout } from "./turn.js";

/** @typedef {import("./render-context.js").RenderContext} RenderContext */

/**
 * Reads a translation of an element as displayed, which may be partway
 * through an animation: "e" for a category's x, "f" for a dimension's y.
 * @param {SVGGraphicsElement} node
 * @param {"e"|"f"} component
 * @param {number} fallback used when the element has no transform
 */
function displayed(node, component, fallback) {
  return node.transform.baseVal.consolidate()?.matrix[component] ?? fallback;
}

/**
 * The extent and margins of the dimension axis. Vertical charts reserve room
 * above for the headers; horizontal charts reserve room before the first
 * column for its labels.
 * @param {RenderContext} state
 * @returns {[number, {top: number, bottom: number, nodeThickness: number}]}
 */
function dimensionAxis(state) {
  const nodeThickness = state.nodeThickness;
  if (!state.horizontal) return [state.height, {top: header, bottom: inset, nodeThickness}];
  return [state.width, {top: labelBand, bottom: inset, nodeThickness}];
}

/**
 * Names and aligns the dimension headers. Headers start at their dimension,
 * except at the far end of a horizontal chart, where the header ends at its
 * column, with its sort controls before its name, to stay inside the chart.
 * A horizontal chart's names are shortened to fit between the columns.
 * @param {RenderContext} state
 * @param {*} dimensionSelection
 */
function alignHeaders(state, dimensionSelection) {
  const far = state.horizontal && state.dimensions.length > 1
    ? state.dimensions.reduce((a, b) => b.y > a.y ? b : a)
    : null;
  const columns = state.dimensions.slice().sort((a, b) => a.y - b.y);
  const room = d => {
    if (!state.horizontal) return Infinity;
    const i = columns.indexOf(d);
    const end = d === far;
    const neighbour = columns[end ? i - 1 : i + 1];
    // Headers either side of the gap before the far column share it.
    if (neighbour === undefined) return state.width - d.y - 8;
    const gap = Math.abs(neighbour.y - d.y);
    return (end || neighbour === far ? gap / 2 : gap) - 8;
  };
  dimensionSelection.select("tspan.name").text(truncateText(d => state.labels.dimensions.get(d.name), room));
  dimensionSelection.select("text").each(function(d) {
    const end = d === far;
    const name = this.querySelector("tspan.name");
    if (end) this.append(name);
    else this.prepend(name);
    select(this).attr("text-anchor", end ? "end" : null);
    select(name).attr("dx", end ? ".5em" : null);
    // A leading offset is not counted when anchoring at the end.
    select(this).select("tspan.sort.key").attr("dx", end ? null : "2em");
  });
}

/**
 * @param {RenderContext} state
 * @param {import("./turn.js").TurnSource} [source] the layout being turned
 *   from, when the orientation changes
 * @param {boolean} [carryOn] whether a dimension or category still moving may
 *   carry on as it was: not in a render that stops a turn, whose correction
 *   turns the plot with the render's timing
 * @returns {import("./turn.js").Turn|undefined}
 */
function updateDimensions(state, source, carryOn = true) {

  // Reuse bound dimension and category objects, which carry the displayed
  // positions that animations start from.
  let dimension = state.plot.selectAll("g.dimension");
  const cache = new Map();
  // Displayed category widths, which layout replaces.
  const widths = new Map();

  // Stop the old tweens before reading their displayed positions. A rerender
  // can arrive halfway through an animation, before x/y reach their targets.
  dimension.interrupt().each(function(d) {
    d.y0 = displayed(this, "f", d.y);
    cache.set(d.name, d);
  });
  dimension.selectAll("g.category").interrupt().each(function(c) {
    c.x0 = displayed(this, "e", c.x);
    widths.set(c, c.dx);
  });

  // The accessor order is used as given, independently of the height sign and
  // of positions crossing mid-transition.
  state.dimensionNames.forEach(d => {
    if (!cache.has(d)) {
      cache.set(d, { name: d, categories: [] });
    }
    state.dimensions.push(cache.get(d));
  });

  // Each render aggregates afresh, so parent links and removed dimensions
  // cannot retain stale data. Keep only endpoint animation positions from
  // the previous render.
  const previous = new Map();
  state.plot.select(".ribbon").selectAll("path").each(d => previous.set(d.path, d));

  // Categories start every render in data order, so an interactive sort lasts
  // until the next render.
  state.dimensions.forEach((d, i) => {
    const existing = new Map(d.categories.map(c => [c.name, c]));
    d.categories = Array.from(state.categoryOrders[i], name => existing.get(name) ?? { name });
  });

  relayout(state);
  // Turning moves displayed positions to where a turned copy of the old
  // layout leaves them, before they animate to the new layout.
  const turn = source && turnLayout(state, source, widths);
  // Categories where a ribbon now ends somewhere else, or a ribbon is new.
  const moved = new Set();
  state.nodes.forEach(node => {
    // A category path can reuse a DOM element even when its dimensions change.
    // Every new endpoint needs a valid start, including those without a match.
    node.source.x0 = node.source.x;
    node.target.x0 = node.target.x;
    let old = previous.get(node.path);
    if (old && (old.source.dimension.name !== node.source.dimension.name ||
        old.target.dimension.name !== node.target.dimension.name)) old = undefined;
    if (old) {
      node.source.x0 = old.source.x0 ?? old.source.x;
      node.target.x0 = old.target.x0 ?? old.target.x;
    }
    if (old?.source.x !== node.source.x) moved.add(node.source.node);
    if (old?.target.x !== node.target.x) moved.add(node.target.node);
    turn?.endpoint(node.source, old?.source);
    turn?.endpoint(node.target, old?.target);
  });
  state.total = getTotal(state.dimensions);

  state.dimensions.forEach(d => {
    d.count = state.total;
  });

  // The orientation applies at once; positions then animate.
  state.plot.attr("transform", turn ? turn.transform(0) : frameTransform(state.horizontal));
  dimension.attr("transform", d => `translate(0,${d.y0})`)
    .selectAll("g.category").attr("transform", c => `translate(${c.x0})`);

  dimension = dimension.data(state.dimensions, dimensionName);

  const dEnter = dimension
    .enter()
    .append("g")
    .attr("class", "dimension")
    .attr("transform", d => `translate(0,${d.y})`)
    .on("mousedown.parsets", cancelEvent);

  const dimensionSelection = dEnter.merge(dimension);

  dEnter
    .append("rect")
    .attr("y", -header)
    .attr("height", header);

  dimensionSelection.select("rect").attr("width", state.length);

  const textEnter = dEnter
    .append("text")
    .attr("class", "dimension");

  dimensionSelection.select("text")
    .attr("transform", state.horizontal ? upright(0, -columnHeaderOffset) : "translate(0,-25)");

  textEnter
    .append("tspan")
    .attr("class", "name");

  for (const type of ["key", "value"]) {
    // Both arrows come from the same font; the stylesheet dims the one for
    // the order not applied.
    const control = textEnter
      .append("tspan")
      .attr("class", `sort ${type}`)
      .attr("dx", "2em")
      .text(`${type} `)
      .on("mousedown.parsets", cancelEvent);
    control.append("tspan").attr("class", "up").text("↑");
    control.append("tspan").attr("class", "down").text("↓");
  }

  dimensionSelection.call(
    drag()
      .subject(function(_event, d) {
        if (!state.active) return null;
        stop(this);
        d.y0 = displayed(this, "f", d.y);
        return {x: 0, y: d.y0};
      })
      .on("start", () => {
        state.dragging++;
        clearHighlight(state);
        state.hideTooltip();
      })
      .on("drag", function(event, d) {
        if (!state.active) return;
        // Order the dimensions with this one at the pointer. If that reorders
        // them, work out the new order's tree, colours and labels, which call
        // the chart's callbacks, before changing anything.
        const y = event.y;
        const dimensions = state.dimensions.slice().sort((a, b) => (a === d ? y : a.y) - (b === d ? y : b.y));
        if (dimensions.some((dimension, i) => dimension !== state.dimensions[i])) {
          const names = dimensions.map(dimensionName);
          const tree = buildTree({ children: Object.create(null), count: 0 }, state.data, names, state.valueAccessor);
          const colours = colourSlots(state, state.colours, names[0], dimensions[0].categories.map(dimensionName));
          const labels = {dimensions: dimensionLabels(state, names), categories: state.labels.categories};
          d.y0 = d.y = y;
          state.dimensions = dimensions;
          state.dimensionNames = names;
          state.tree = tree;
          state.colours.set(colours.first, colours.slots);
          state.fills = colours.fills;
          state.labels = labels;
          relayout(state);
          state.total = getTotal(state.dimensions);
          state.plot
            .selectAll(".ribbon, .ribbon-mouse")
            .selectAll("path")
            .remove();
          updateRibbons(state);
          updateCategories(state, dimensionSelection);
          alignHeaders(state, dimensionSelection);
          // The dragged dimension stays at the pointer.
          move(state, dimensionSelection.filter(dimension => dimension !== d), motion(state), "y");
          state.dispatcher.call("sortDimensions", this, state.dimensionNames.slice());
          if (!state.active) return;
        }
        d.y0 = d.y = y;

        // Layout assigns a new resting slot on reorder; keep the dragged
        // dimension at its displayed position until the pointer is released.
        stop(this).attr("transform", `translate(0,${d.y0})`);

        for (const r of d.ribbons) state.paths.get(r)?.setAttribute("d", state.ribbonPath(r));
      })
      .on("end", function() {
        if (!state.active) return;
        state.dragging--;
        state.unhighlight();
        positionDimensions(state.dimensions, ...dimensionAxis(state));
        move(state, select(this), motion(state, state.ease), "y");
      })
  );

  // A sort control keeps showing its order across renders, such as a resize,
  // while the categories are still in that order: with new data, they may
  // not be. The first click sorts keys from A to Z and values from largest to
  // smallest.
  const ascending = {
    key: (a, b) => compareKeys(state, a, b),
    value: (a, b) => a.count - b.count
  };
  dimensionSelection.select("text").each(function(d) {
    labelSorts(this, d, state.marks.get(d.name) ?? null);
  });
  dimensionSelection
    .select("text")
    .select("tspan.sort.key")
    .on("click.parsets", sortBy(state, "key", ascending.key, 1, dimensionSelection));
  dimensionSelection
    .select("text")
    .select("tspan.sort.value")
    .on("click.parsets", sortBy(state, "value", ascending.value, -1, dimensionSelection));

  // A dimension or category still on its way to where it ends up carries on
  // as it was, and a ribbon end with it, unless the ribbon ends somewhere
  // else now; a turn moves everything afresh, as does a render that stops
  // one, to keep in step with the plot.
  const carrying = carryOn && !turn && !stillness();
  move(state, dimensionSelection, state.timing, "y", carrying && (() => true));

  dimension.exit().remove();

  alignHeaders(state, dimensionSelection);
  updateCategories(state, dimensionSelection, state.timing, carrying && (d => !moved.has(d)));
  updateRibbons(state);
  return turn;
}

/**
 * Lays out the current tree and dimensions, with categories in the order
 * they already have. It calls none of the chart's callbacks.
 * @param {RenderContext} state
 */
function relayout(state) {
  const [extent, axis] = dimensionAxis(state);
  const slots = state.colours.get(state.dimensions[0]?.name);
  state.nodes = layout(
    state.tree,
    state.dimensions,
    name => slots?.get(name) ?? 0,
    state.length,
    extent,
    state.spacing,
    axis
  );
}

/**
 * The labels after a category reorder, which renumbers that dimension's
 * categories only, worked out before it changes anything.
 * @param {RenderContext} state
 * @param {*} dimension
 * @param {Array<*>} categories its new order
 */
function relabelCategories(state, dimension, categories) {
  const labels = categoryLabels(state, dimension.name, categories.map(dimensionName));
  return {dimensions: state.labels.dimensions, categories: new Map(state.labels.categories).set(dimension.name, labels)};
}

/**
 * Applies the colours from the color callback, worked out beforehand, as
 * inline fill and stroke, or clears them so the category-N classes apply.
 * @param {*} selection
 * @param {RenderContext} state
 * @param {(d: any) => string|null} name the first-dimension category, if any
 * @param {boolean} [stroke]
 */
function paint(selection, state, name, stroke = true) {
  selection.each(function(d) {
    const category = state.fills && name(d);
    const color = category == null ? null : state.fills.get(category) ?? null;
    select(this).style("fill", color).style("stroke", stroke ? color : null);
  });
}

/**
 * Records how a dimension's categories were sorted, and marks the control
 * that sorted them as ascending or descending. Reordering the categories any
 * other way clears both.
 * @param {Element} header the dimension's header text
 * @param {*} dimension
 * @param {{type: string, order: number}|null} sorted the control's type, and
 *   1 for ascending or -1 for descending
 */
function labelSorts(header, dimension, sorted) {
  dimension.sorted = sorted;
  for (const type of ["key", "value"]) {
    const order = sorted?.type === type ? sorted.order : 0;
    select(header).select(`tspan.sort.${type}`)
      .classed("ascending", order > 0)
      .classed("descending", order < 0);
  }
}

/**
 * @param {RenderContext} state
 * @param {string} type
 * @param {(a: any, b: any) => number} ascending
 * @param {number} first the order of the first sort: 1 ascending, -1 descending
 * @param {*} dimensionSelection
 * @returns {(event: Event, d: any) => void}
 */
function sortBy(state, type, ascending, first, dimensionSelection) {
  return function(_event, d) {
    if (!state.active) return;
    // Each further click reverses the order. Sort a copy and format its
    // labels first: a callback that throws leaves the chart as it was.
    const order = d.sorted?.type === type ? -d.sorted.order : first;
    const categories = d.categories.slice().sort((a, b) => order * ascending(a, b));
    const labels = relabelCategories(state, d, categories);
    d.categories = categories;
    state.labels = labels;
    labelSorts(this.parentNode, d, {type, order});
    relayout(state);
    updateCategories(state, dimensionSelection);
    updateRibbons(state);
    state.dispatcher.call("sortCategories", this, d.name, d.categories.map(dimensionName));
  };
}

/**
 * @param {RenderContext} state
 */
function updateRibbons(state) {
  const ribbonUpdate = state.plot
    .select(".ribbon")
    .selectAll("path")
    .data(state.nodes, d => d.path);

  ribbonUpdate.exit().remove();

  const ribbonEnter = ribbonUpdate
    .enter()
    .append("path")
    // Ribbons without a start, such as after a dimension drag rebuilds them,
    // start at rest; others keep theirs, such as a turn's reversed ones.
    .each(d => {
      d.source.x0 ??= d.source.x;
      d.target.x0 ??= d.target.x;
    });

  // Keep any highlight while setting the colour class: a ribbon that lost it
  // even briefly, such as while labels are measured during a drag, would
  // restart its fade.
  state.ribbon = ribbonEnter.merge(ribbonUpdate)
    .attr("class", function(d) {
      const lit = this.classList.contains("active") ? " active" : this.classList.contains("inactive") ? " inactive" : "";
      return `category-${d.major}${lit}`;
    })
    .call(paint, state, rootCategory)
    .attr("d", state.ribbonPath);

  // Larger ribbons go below smaller ones. Remember each one's place, to
  // return it there after highlighting raises it.
  // selection.sort returns a new, sorted selection; keep it, so highlighting
  // raises ribbons in this order too.
  state.ribbon = state.ribbon.sort((a, b) => b.count - a.count).property("__stack", (_d, i) => i);
  state.paths = new Map(state.ribbon.nodes().map(node => [node.__data__, node]));
  // New ribbons are not highlighted yet, so the next hover highlights afresh.
  state.highlighted = undefined;
  state.raised.clear();

  const mouseUpdate = state.plot
    .select(".ribbon-mouse")
    .selectAll("path")
    .data(state.nodes, d => d.path);

  mouseUpdate.exit().remove();

  const mouseEnter = mouseUpdate.enter().append("path");
  const mouse = mouseEnter.merge(mouseUpdate);
  mouse.on("mousemove.parsets", function(event, d) {
    // While the chart turns, hover paths are already where it ends up.
    if (!state.active || state.dragging || state.plot.property("__turning")) return;
    highlight(state, [d.node], d.node);
    state.showTooltip(d.node, () => state.tooltip.call(this, d.node), event);
    event.stopPropagation();
  }).on("mouseout.parsets", state.unhighlight);

  mouse
    .sort((a, b) => b.count - a.count)
    .attr("d", state.ribbonPathStatic);
}

/**
 * @param {RenderContext} state
 * @param {*} dimensionSelection
 * @param {import("./render-context.js").Timing} [timing] defaults to the chart's
 * @param {((d: any) => boolean)|false} [carryOn] which categories may carry on
 *   moving as they were, if they still end up where they were going
 */
function updateCategories(state, dimensionSelection, timing = motion(state), carryOn = false) {
  const category = dimensionSelection
    .selectAll("g.category")
    .data(
      d => d.categories,
      d => d.name
    );

  const categoryEnter = category
    .enter()
    .append("g")
    .attr("class", "category")
    .attr("transform", d => `translate(${d.x})`);

  const categorySelection = categoryEnter.merge(category);

  category.exit().remove();

  categorySelection
    .on("mousemove.parsets", function(event, d) {
      if (!state.active || state.dragging || state.plot.property("__turning")) return;
      highlight(state, d.nodes, d);
      state.showTooltip(d, () => state.categoryTooltip.call(this, d), event);
      event.stopPropagation();
    })
    // Unlike mouseout, mouseleave ignores moves between a category's parts.
    .on("mouseleave.parsets", state.unhighlight)
    .on("mousedown.parsets", cancelEvent)
    // Reordering during a drag redraws the categories, including the one
    // being dragged. Reuse the render's drag behaviour, which holds the
    // gesture in progress: a new one would replace the element's touch
    // listeners mid-gesture, and the category would stop following a finger.
    .call(
      state.categoryDrag ??= drag()
        .subject(function(_event, d) {
          if (!state.active) return null;
          stop(this);
          d.x0 = displayed(this, "e", d.x);
          return {x: d.x0, y: 0};
        })
        // The dragged category's flow stays highlighted, as those are the
        // ribbons that move with it; its tooltip is hidden while dragging.
        .on("start", (_event, d) => {
          clearHighlight(state);
          // Another finger may be dragging already.
          highlight(state, d.nodes, d, true);
          state.dragging++;
          state.hideTooltip();
        })
        .on("drag", function(event, d) {
          if (!state.active) return;
          // The dragged category passes a neighbour when its middle passes
          // the neighbour's, or when it leaves a gap the neighbour fits in:
          // when its leading edge passes the neighbour's far edge. The gap
          // lets a wide category pass a narrow one sooner. Neighbours take
          // their resting positions in the new order as they are passed.
          // Strict comparisons stop categories of no size swapping forever.
          // The swaps are worked out on a copy, which changes nothing until
          // the new order's labels are formatted.
          const categories = d.dimension.categories.slice();
          const rests = new Map();
          const at = c => rests.get(c) ?? c.x;
          const x = event.x;
          const middle = x + d.dx / 2;
          let i = categories.indexOf(d);
          let rest = d.x;
          let reordered = false;
          for (;;) {
            const next = categories[i + 1];
            const previous = categories[i - 1];
            if (next && (middle > at(next) + next.dx / 2 || x + d.dx > at(next) + next.dx)) {
              const gap = at(next) - rest - d.dx;
              rests.set(next, rest);
              rest += next.dx + gap;
              categories[i] = next;
              categories[++i] = d;
            } else if (previous && (middle < at(previous) + previous.dx / 2 || x < at(previous))) {
              const gap = rest - at(previous) - previous.dx;
              rest = at(previous);
              rests.set(previous, rest + d.dx + gap);
              categories[i] = previous;
              categories[--i] = d;
            } else {
              break;
            }
            reordered = true;
          }
          if (reordered) {
            const labels = relabelCategories(state, d.dimension, categories);
            d.dimension.categories = categories;
            state.labels = labels;
            labelSorts(this.parentNode.querySelector("text.dimension"), d.dimension, null);
            relayout(state);
            // The ribbons, their colours and stacking are unchanged, and the
            // tweens below move their ends; their hover paths are updated
            // when the drag ends.
            d.swapped = true;
            // A swap reorders the ribbons through this dimension, which moves
            // where they attach here, in the dimension before and in every
            // dimension after; earlier ones are unaffected.
            const from = state.dimensions.indexOf(d.dimension) - 1;
            moveCategories(state, dimensionSelection.filter(dimension => state.dimensions.indexOf(dimension) >= from)
              .selectAll("g.category"), motion(state));
            // Category labels are numbered by position.
            labelCategories(state, select(this.parentNode).selectAll("g.category"));
            state.dispatcher.call("sortCategories", this, d.dimension.name, d.dimension.categories.map(dimensionName));
            if (!state.active) return;
          }
          d.x0 = event.x;
          stop(this).attr("transform", node => `translate(${node.x0})`);
          for (const r of d.ribbons) state.paths.get(r)?.setAttribute("d", state.ribbonPath(r));
        })
        .on("end", function(event, d) {
          if (!state.active) return;
          state.dragging--;
          if (d.swapped) {
            d.swapped = false;
            state.plot.select(".ribbon-mouse").selectAll("path").attr("d", state.ribbonPathStatic);
          }
          // Stay highlighted, as after a hover, if a mouse is released over
          // the category; a touch, or a release elsewhere, ends it.
          const e = event.sourceEvent;
          if (!(e?.type === "mouseup" && this.contains(this.getRootNode().elementFromPoint?.(e.clientX, e.clientY)))) {
            state.unhighlight();
          }
          move(state, select(this), motion(state, state.ease), "x");
        })
    );

  moveCategories(state, categorySelection, timing, carryOn);

  categoryEnter.append("rect");

  categoryEnter.append("line");
  categoryEnter.append("rect").attr("class", "category-bar");

  categoryEnter.append("text");

  const first = state.dimensions[0];
  const slot = d => state.colours.get(first.name).get(d.name);
  // The first rect is the hover band, which holds the label.
  categorySelection
    .select("rect")
    .attr("width", d => d.dx)
    .attr("y", d => -20 - d.dimension.nodeThickness / 2)
    .attr("height", d => 20 + d.dimension.nodeThickness)
    .attr("class", d => `category-${d.dimension === first ? slot(d) : "background"}`)
    // The hover band is filled only: an inline stroke would override the
    // stylesheet's and outline it.
    .call(paint, state, d => d.dimension === first ? d.name : null, false);

  categorySelection
    .select("line")
    .attr("display", d => d.dimension.nodeThickness ? "none" : null)
    .attr("x2", d => d.dx);

  categorySelection.select("rect.category-bar")
    .attr("width", d => d.dx)
    .attr("y", d => -d.dimension.nodeThickness / 2)
    .attr("height", d => d.dimension.nodeThickness);

  labelCategories(state, categorySelection);
}

/**
 * Labels categories, from labels formatted beforehand. Labels lie along
 * their bars, before them. In a horizontal chart, they read upwards: reversed
 * along the bar, which the transposition turns into a quarter turn.
 * @param {RenderContext} state
 * @param {*} categories
 */
function labelCategories(state, categories) {
  categories
    .select("text")
    .attr("transform", d => state.horizontal ? `translate(${d.dx})scale(-1,1)` : null)
    .attr("y", d => -d.dimension.nodeThickness / 2)
    .attr("dy", "-.3em")
    .text(truncateText(d => state.labels.categories.get(d.dimension.name)?.get(d.name) ?? "", d => d.dx));
}

/**
 * Moves categories to their places, animating their ribbons' ends.
 * @param {RenderContext} state
 * @param {*} categories
 * @param {import("./render-context.js").Timing} timing
 * @param {((d: any) => boolean)|false} [carryOn]
 */
function moveCategories(state, categories, timing, carryOn = false) {
  move(state, categories, timing, "x", carryOn);
}

// Where each dimension or category element is moving to, and when, so that a
// render that leaves its destination unchanged can let it carry on.
const motions = new WeakMap();

/**
 * Moves dimensions ("y") or categories ("x") to their places, animating their
 * ribbons' ends. Those that carryOn allows, and that are still on their way
 * to the same places, carry on as they were, with the timing they started
 * with, rather than starting again with this one.
 * @param {RenderContext} state
 * @param {*} selection
 * @param {import("./render-context.js").Timing} timing
 * @param {"x"|"y"} axis
 * @param {((d: any) => boolean)|false} [carryOn]
 */
function move(state, selection, timing, axis, carryOn = false) {
  const transform = axis === "x" ? d => `translate(${d.x})` : d => `translate(0,${d.y})`;
  const tween = axis === "x" ? d => ribbonTweenX(state, d) : d => ribbonTweenY(state, d);
  const continuing = new Set();
  if (carryOn) {
    selection.each(function(d) {
      const rest = carryOn(d) && remainder(this, d[axis], d[axis + "0"]);
      if (!rest) return;
      continuing.add(this);
      transitionSelection(select(this), rest).attr("transform", transform).tween("ribbon", tween);
    });
  }
  const fresh = continuing.size ? selection.filter(function() { return !continuing.has(this); }) : selection;
  const start = now() + timing.delay;
  fresh.each(function(d) {
    if (timing.delay || timing.duration) motions.set(this, {from: d[axis + "0"], to: d[axis], start, duration: timing.duration, ease: timing.ease ?? easeCubic});
    else motions.delete(this);
  });
  transitionSelection(fresh, timing).attr("transform", transform).tween("ribbon", tween);
}

/**
 * The timing for the rest of an element's motion, if it is still on its way
 * to the given place: from where it is shown, it follows the same path, at
 * the same pace, and arrives when it would have done.
 * @param {Element} node
 * @param {number} to
 * @param {number} shown where it is shown
 * @returns {import("./render-context.js").Timing|null}
 */
function remainder(node, to, shown) {
  const m = motions.get(node);
  if (!m || m.to !== to || m.from === to) return null;
  const elapsed = now() - m.start;
  if (elapsed >= m.duration) return null;
  if (elapsed <= 0) return {delay: -elapsed, duration: m.duration, ease: m.ease};
  // Eased progress from where it is shown, which can be a frame behind the
  // clock: an ease that passes its destination would magnify the difference.
  // Then the rest of the path, as a fraction of the distance still to go.
  const f = elapsed / m.duration;
  const done = (shown - m.from) / (to - m.from);
  // Close to its destination, perhaps passing it, start again instead.
  if (Math.abs(1 - done) < 1e-3) return null;
  return {delay: 0, duration: m.duration - elapsed, ease: u => (m.ease(f + u * (1 - f)) - done) / (1 - done)};
}

/**
 * Stops an element's motion, such as when it is grabbed.
 * @param {Element} node
 */
function stop(node) {
  motions.delete(node);
  return select(node).interrupt();
}

/**
 * The timing of an interaction's animation: the chart's duration, or none
 * for people who prefer reduced motion.
 * @param {RenderContext} state
 * @param {Function} [ease]
 */
function motion(state, ease) {
  return {delay: 0, duration: stillness() ? 0 : state.duration, ease};
}

/**
 * Redraws the given ribbons, or all of them, once, at the end of the
 * animation frame in which animations moved their ends. Tweens only move the
 * ends: redrawing in each would redraw a ribbon for each of its two
 * categories and two dimensions. A change applied without animation is
 * drawn at once.
 * @param {RenderContext} state
 * @param {Array<*>} [ribbons]
 * @param {boolean} [now]
 */
function redrawRibbons(state, ribbons, now) {
  if (now && ribbons) {
    if (state.active) for (const r of ribbons) state.paths.get(r)?.setAttribute("d", state.ribbonPath(r));
    return;
  }
  if (!ribbons) state.dirty = null;
  else if (state.dirty) for (const r of ribbons) state.dirty.add(r);
  state.redraw ??= timeout(() => {
    const dirty = state.dirty;
    state.redraw = null;
    state.dirty = new Set();
    // A later render owns the ribbons now.
    if (!state.active || !state.ribbon) return;
    if (!dirty) state.ribbon.attr("d", state.ribbonPath);
    else for (const r of dirty) state.paths.get(r)?.setAttribute("d", state.ribbonPath(r));
  });
}

// Animates the x-coordinates of a category and its ribbons' ends.
/**
 * @param {RenderContext} state
 * @param {*} d
 * @returns {(t: number) => void}
 */
function ribbonTweenX(state, d) {
  const ribbons = d.ribbons ?? [];
  const nodes = [d];
  for (const r of ribbons) {
    if (r.source.node === d) nodes.push(r.source);
    if (r.target.node === d) nodes.push(r.target);
  }
  if (nodes.every(node => node.x0 === node.x)) return () => {};
  const i = nodes.map(node => interpolateNumber(node.x0, node.x));
  const n = nodes.length;
  return (t, now) => {
    for (let j = 0; j < n; j++) nodes[j].x0 = i[j](t);
    redrawRibbons(state, ribbons, now);
  };
}

// Animates the y-coordinate of a dimension, and so of its ribbons' ends.
/**
 * @param {RenderContext} state
 * @param {*} d
 * @returns {(t: number) => void}
 */
function ribbonTweenY(state, d) {
  const ribbons = d.ribbons ?? [];
  if (d.y0 === d.y) return () => {};
  const i = interpolateNumber(d.y0, d.y);
  return (t, now) => {
    d.y0 = i(t);
    redrawRibbons(state, ribbons, now);
  };
}

// Highlight the flow through tree nodes, their descendants and ancestors, and
// dim the other ribbons.
/**
 * @param {RenderContext} state
 * @param {Array<*>} nodes
 * @param {*} key the hovered ribbon or category; moving within it changes nothing
 * @param {boolean} [held] whether to highlight during a drag
 */
function highlight(state, nodes, key, held) {
  if (!state.active || state.dragging && !held || !state.ribbon || state.highlighted === key) return;
  state.highlighted = key;
  state.lit = true;
  const highlighted = new Set();
  const recurse = node => {
    highlighted.add(node);
    for (const k in node.children) recurse(node.children[k]);
  };
  nodes.forEach(node => {
    recurse(node);
    // Nodes share ancestors; stop at the first one already collected.
    for (let p = node.parent; p && !highlighted.has(p); p = p.parent) highlighted.add(p);
  });
  state.ribbon
    .classed("active", function(node) {
      const active = highlighted.has(node.node);
      if (active) {
        raise(this);
        state.raised.add(this);
      }
      return active;
    })
    .classed("inactive", node => !highlighted.has(node.node));
}

// Moves a node to the end of its parent. Where supported, moveBefore keeps
// the node's state, which appendChild would reset, restarting its
// fill-opacity transition.
function raise(node) {
  const parent = node.parentNode;
  if (parent.moveBefore) parent.moveBefore(node, null);
  else parent.appendChild(node);
}

/**
 * Clears any highlight, and returns raised ribbons to their places in the
 * stacking order; the others are still in it. Without moveBefore, moving them
 * would cancel their fade, so they stay raised until the next render.
 * @param {RenderContext} state
 */
function clearHighlight(state) {
  state.highlighted = undefined;
  if (!state.lit || !state.ribbon) return;
  state.lit = false;
  state.ribbon.classed("active inactive", false);
  const raised = [...state.raised].filter(node => node.isConnected);
  const parent = raised[0]?.parentNode;
  if (!parent?.moveBefore) return;
  const moving = new Set(raised);
  state.raised.clear();
  const rest = [...parent.children].filter(node => !moving.has(node));
  for (const node of raised.sort((a, b) => a.__stack - b.__stack)) {
    // The first ribbon above this one's place, by binary search.
    let lo = 0;
    let hi = rest.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rest[mid].__stack > node.__stack) hi = mid;
      else lo = mid + 1;
    }
    parent.moveBefore(node, rest[lo] ?? null);
    rest.splice(lo, 0, node);
  }
}

/**
 * @param {RenderContext} state
 */
function unhighlight(state) {
  if (!state.active || state.dragging) return;
  clearHighlight(state);
  state.hideTooltip();
}


export { redrawRibbons, unhighlight, updateDimensions };
