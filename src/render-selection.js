import { interpolateNumber } from "d3-interpolate";
import { select } from "d3-selection";
import {
  ribbonPath as buildRibbonPath,
  ribbonPathStatic as buildRibbonPathStatic
} from "./ribbon-path.js";
import { columnHeader, frameTransform, inset } from "./frame.js";
import { stillness, transitionSelection } from "./helpers.js";
import { redrawRibbons, unhighlight, updateDimensions } from "./render-updaters.js";
import { createSvgTooltip, hideSvgTooltip, moveSvgTooltip, setSvgTooltip } from "./svg-tooltip.js";
import { buildTree } from "./tree.js";
import { prepare } from "./prepare.js";
import { endTurn, fadingLabels, startTurn, turnCorrection } from "./turn.js";

/** @typedef {import("./render-context.js").RenderContext} RenderContext */
/** @typedef {import("./render-context.js").RenderOptions} RenderOptions */

const tensionTransition = "parsets-tension";
// Displayed geometry belongs to the rendered element. Other chart instances
// may render into the same element, so only the owner's state carries over.
const renders = new WeakMap();

/**
 * @param {*} selection
 * @param {RenderOptions} options
 */
function renderSelection(selection, options) {
  const {
    dimensions: dimensionsAccessor,
    value: valueAccessor,
    width,
    height,
    tension,
    duration,
    instant,
    owner
  } = options;
  const horizontal = options.orientation === "horizontal";

  // Categories stack across the width of vertical charts and down the height
  // of horizontal ones.
  const length = horizontal ? Math.max(0, height - columnHeader - inset) : width;

  // When called through a transition, a render animates with its timing.
  // Test for a method rather than a class: callers may use another copy of D3.
  const caller = typeof selection.tween === "function" ? selection : null;
  // Changes happen at once for people who prefer reduced motion, and in a
  // new chart, which has nothing to animate from.
  const still = instant || stillness();

  selection.each(function(data, i) {
    // Aggregate, and call every callback the render needs, first: bad data,
    // or a callback that throws, throws before the chart on screen is
    // touched, which then keeps working. Data may be any iterable, so read
    // its rows once, and weigh each row once: dragging a dimension aggregates
    // them again. A repeated dimension name is shown once.
    const rows = Array.isArray(data) ? data : Array.from(data ?? []);
    const dimensionNames = Array.from(new Set(dimensionsAccessor.call(this, rows, i)));
    const dataOrders = dimensionNames.map(() => new Set());
    const weights = rows.map((d, j) => +valueAccessor(d, j));
    const weigh = (_d, j) => weights[j];
    const tree = buildTree({children: Object.create(null), count: 0}, rows, dimensionNames, weigh, dataOrders);
    const previous = renders.get(this);
    const retained = previous?.owner === owner ? previous : undefined;
    const marks = new Map(retained?.dimensions.filter(d => d.sorted).map(d => [d.name, d.sorted]));
    const prepared = prepare(options, retained?.colours, tree, dimensionNames, dataOrders, marks);

    const g = select(this).classed("parsets-horizontal", horizontal);
    // The plot group holds the dimensions and ribbons, and orients them. Find
    // groups by class rather than by bound data: selecting them with
    // selection.select, as callers may, replaces their data.
    const plot = select(this.querySelector(":scope > g.parsets-plot")
      ?? g.append("g").attr("class", "parsets-plot").node());
    const stopped = endTurn(plot);
    for (const name of ["ribbon", "ribbon-mouse"]) {
      if (!plot.node().querySelector(`:scope > g.${name}`)) plot.append("g").attr("class", name);
    }
    // Curve updates run on the ribbon group, where they cannot collide with a
    // caller's transition on the root, even one from another copy of D3.
    // Cancel pending as well as active updates, even when the new render
    // needs no transition.
    const ribbonGroup = plot.select(".ribbon").interrupt(tensionTransition);
    const tooltipGroup = createSvgTooltip(g);
    hideSvgTooltip(tooltipGroup);
    // The tooltip's content is laid out only when the hovered ribbon or
    // category changes; moving within it only moves the tooltip.
    let tooltipKey;
    let tooltipShown = false;

    // D3 keeps a gesture's original callbacks until pointer release. Make
    // those callbacks inert before reusing any of their bound data or DOM.
    if (previous) previous.active = false;

    const called = callerTiming(caller, this);
    // Reduced motion drops a caller's delay too, so a change has no
    // intermediate state, such as a turn's hidden labels.
    const timing = still ? {delay: 0, duration: 0} : called ?? {delay: 0, duration};
    const animated = Boolean(timing.delay || timing.duration);

    /** @type {RenderContext} */
    // The render's state starts from the chart's settings.
    const state = {
      ...options,
      g,
      plot,
      data: rows,
      // Colour slots are permanent, so rerendering never recolours a category.
      // Its own copy: a failed render leaves the previous one's untouched.
      colours: new Map(retained?.colours),
      fills: prepared.colours?.fills ?? null,
      labels: prepared.labels,
      marks: prepared.marks,
      // The number of drags in progress, as several fingers may drag at once.
      dragging: 0,
      redraw: null,
      dirty: new Set(),
      paths: new Map(),
      active: true,
      dimensionNames,
      categoryOrders: prepared.orders,
      dimensions: [],
      tree,
      nodes: undefined,
      total: undefined,
      ribbon: undefined,
      // A previous render may have left ribbons highlighted.
      lit: true,
      highlighted: undefined,
      raised: new Set(),
      currentTension0: retained?.currentTension0 ?? tension,
      timing,
      valueAccessor: weigh,
      horizontal,
      length,
      ribbonPath: undefined,
      ribbonPathStatic: undefined,
      showTooltip: (key, content, event) => {
        if (key !== tooltipKey) {
          tooltipKey = undefined;
          tooltipShown = setSvgTooltip(tooltipGroup, content());
          tooltipKey = key;
        }
        if (tooltipShown) moveSvgTooltip(tooltipGroup, g, event, width, height);
      },
      hideTooltip: () => {
        tooltipKey = undefined;
        hideSvgTooltip(tooltipGroup);
      },
      unhighlight: () => unhighlight(state)
    };
    if (prepared.colours) state.colours.set(prepared.colours.first, prepared.colours.slots);
    renders.set(this, state);

    state.ribbonPath = d => buildRibbonPath(d, state.currentTension0);
    state.ribbonPathStatic = d => buildRibbonPathStatic(d, state.tension);

    // Ribbon and category handlers stop propagation, so any other movement
    // within the chart, or leaving it, ends the current highlight.
    g.on("mousemove.parsets mouseleave.parsets", state.unhighlight);

    // An animated orientation change turns the displayed chart.
    const turning = retained && retained.horizontal !== horizontal && animated &&
      plot.selectAll("g.dimension").size() > 0;
    // The labels as shown fade out as a turn starts, unless it stops another.
    const fading = turning && !stopped ? fadingLabels(g, plot) : null;

    try {
      const turn = updateDimensions(state, turning ? {
        horizontal: retained.horizontal,
        length: retained.length,
        dimensions: retained.dimensions
      } : undefined);
      // A render that interrupts a turn carries on from where it left off,
      // and its labels from the opacity they had reached unless they turn.
      const correction = retained && animated ? turnCorrection(stopped?.shown, retained.horizontal) : null;
      if (turn || correction) {
        const frame = frameTransform(horizontal) ?? "";
        startTurn(plot, t => (correction ? correction(t) : "") + (turn ? turn.transform(t) : frame),
          horizontal, state.timing, turn ? 0 : stopped.labels, fading);
      }

      if (state.tension !== state.currentTension0) {
        if (animated) {
          transitionSelection(ribbonGroup, state.timing, tensionTransition)
            .tween("ribbon", () => tensionTween(state));
        } else {
          state.currentTension0 = state.tension;
          state.ribbon.attr("d", state.ribbonPath);
        }
      }
    } catch (error) {
      state.active = false;
      // The next render carries on from the last complete one.
      if (previous) renders.set(this, previous);
      else renders.delete(this);
      // Callbacks have all run by now, so only a bug in the library can
      // throw here, after some transitions may have been queued.
      ribbonGroup.interrupt(tensionTransition);
      endTurn(plot);
      const restored = previous?.horizontal ?? horizontal;
      plot.attr("transform", frameTransform(restored));
      g.classed("parsets-horizontal", restored);
      g.selectAll("*").interrupt();
      throw error;
    }
  });
}

/**
 * Reads a node's timing from the transition the chart was called through. An
 * ended transition has no timing left, so the chart then uses its own.
 * @param {*} transition
 * @param {Element} node
 * @returns {import("./render-context.js").Timing|null}
 */
function callerTiming(transition, node) {
  if (!transition) return null;
  const t = transition.filter(function() { return this === node; });
  try {
    return {delay: t.delay(), duration: t.duration(), ease: t.ease()};
  } catch {
    return null;
  }
}

/**
 * @param {RenderContext} state
 * @returns {(t: number) => void}
 */
function tensionTween(state) {
  const i = interpolateNumber(state.currentTension0, state.tension);
  return t => {
    state.currentTension0 = i(t);
    redrawRibbons(state);
  };
}

export { renderSelection };
