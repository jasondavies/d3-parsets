import { interpolateTransformSvg } from "d3-interpolate";
import { select } from "d3-selection";
import { framePoint, frameTransform, header, inset, transposed } from "./frame.js";
import { transitionSelection } from "./helpers.js";

// A horizontal chart is a transposed vertical one: a reflection, which no
// rotation can reach. So an orientation change turns the chart a quarter
// turn while reversing its categories along their axis. The chart starts in
// the new layout with every position reversed, drawn reversed again so that
// nothing appears to move; as it turns, the reversal unwinds and the
// categories restack into the new layout.

const turnTransition = "parsets-turn";

/**
 * @typedef {Object} TurnSource
 * @property {boolean} horizontal
 * @property {number} length the extent of the old category axis
 * @property {number} spacing the old spacing between categories
 * @property {Array<Object>} dimensions the old dimensions, in order
 */

/**
 * @typedef {Object} Turn
 * @property {(endpoint: Object, old?: Object) => void} endpoint
 * @property {(t: number) => string} transform the plot's transform at time t
 */

/**
 * Moves the displayed positions of a new layout to the old layout's,
 * reversed along the categories and scaled to the new layout's length.
 * Across the dimensions nothing scales, so bars keep their thickness; the
 * dimensions slide to their new positions as the chart turns.
 * @param {import("./render-context.js").RenderContext} state
 * @param {TurnSource} source
 * @param {Map<Object, number>} widths displayed category widths
 * @returns {Turn}
 */
function turnLayout(state, source, widths) {
  const s0 = source.dimensions[0]?.y0 ?? 0;
  const s1 = source.dimensions.at(-1)?.y0 ?? 0;
  const t0 = state.dimensions[0]?.y ?? 0;
  const t1 = state.dimensions.at(-1)?.y ?? 0;
  // Categories share their axis less the spacing between them, which does
  // not scale: scale by their total widths, so that they start as shown.
  const bars = (length, spacing) => length - Math.min(length, spacing);
  const b0 = bars(source.length, source.spacing);
  const b1 = bars(state.length, state.spacing);
  const sx = b0 > 0 && b1 > 0 ? b1 / b0 : 1;
  const from = [source.length / 2, (s0 + s1) / 2];
  const to = [state.length / 2, (t0 + t1) / 2];
  const along = x => to[0] - sx * (x - from[0]);
  const across = y => to[1] + y - from[1];

  state.dimensions.forEach(d => {
    if (!source.dimensions.includes(d)) return;
    d.y0 = across(d.y0);
    d.categories.forEach(c => {
      if (widths.has(c)) c.x0 = along(c.x0 + widths.get(c) / 2) - c.dx / 2;
    });
  });

  // Scaled widths can still differ from the new layout's when the data
  // changes too; reverse ribbon offsets in proportion. A new ribbon in a
  // reversed category starts reversed within it too.
  const endpoint = (e, old) => {
    const width = widths.get(e.node);
    if (!width) return;
    e.x0 = old ? e.node.dx / width * (width - e.x0 - old.dx) : e.node.dx - e.x - e.dx;
  };

  // The plot turns about the middle of its old layout, which moves to the
  // middle of the new one, scaling between their lengths.
  const start = framePoint(source.horizontal, from);
  const end = framePoint(state.horizontal, to);
  const angle = state.horizontal ? -90 : 90;
  const flip = source.horizontal ? transposed(0, 0) : "";
  const scale = t => 1 + (sx - 1) * t;

  // Zoom out while turning, so the corners stay within the chart.
  const size = [state.width, state.height];
  // The dimensions slide between their old and new spans as the chart turns.
  const extent = [source.length, Math.max(Math.abs(s1 - s0), Math.abs(t1 - t0)) + header + inset];
  const fit = t => {
    let [w, h] = [extent[0] * scale(t), extent[1]];
    if (source.horizontal) [w, h] = [h, w];
    const a = angle * t * Math.PI / 180;
    const cos = Math.abs(Math.cos(a));
    const sin = Math.abs(Math.sin(a));
    return Math.min(size[0] / (w * cos + h * sin), size[1] / (w * sin + h * cos));
  };
  const zoom = t => Math.min(1, fit(t) / (fit(0) * (1 - t) + fit(1) * t)) || 1;

  const transform = t => {
    if (t === 1) return frameTransform(state.horizontal) ?? "";
    return `translate(${start[0] + (end[0] - start[0]) * t},${start[1] + (end[1] - start[1]) * t})`
      + `rotate(${angle * t})scale(${zoom(t)})${flip}`
      + `scale(${-scale(t) / sx},1)translate(${-to[0]},${-to[1]})`;
  };
  return {endpoint, transform};
}

/**
 * When a render interrupts a turn, returns the transform taking the plot
 * from where the render's animation starts, in the frame of the orientation
 * being turned to, back to where the turn left it, easing to nothing. Null
 * if no turn was interrupted.
 * @param {DOMMatrix|undefined} shown the plot's transform as shown
 * @param {boolean} horizontal the orientation being turned to
 * @returns {((t: number) => string)|null}
 */
function turnCorrection(shown, horizontal) {
  if (!shown) return null;
  const c = shown.multiply(new DOMMatrix(frameTransform(horizontal) ?? "").inverse());
  // A turn only ever rotates and scales, never reflects.
  if (!(c.a * c.d - c.b * c.c > 0)) return null;
  const i = interpolateTransformSvg(`matrix(${c.a},${c.b},${c.c},${c.d},${c.e},${c.f})`, "matrix(1,0,0,1,0,0)");
  return t => t === 1 ? "" : i(t);
}

// The labels as shown before a turn, which fade out as it starts.
const fadingClass = "parsets-turning-labels";

/**
 * Copies the labels as shown, before a render changes them, so that they can
 * fade out as the chart starts to turn. The copies keep the classes of the
 * groups the labels were in, for the stylesheet. Null if the chart is not
 * displayed, so nothing can be measured.
 * @param {*} root the element the chart is rendered into
 * @param {*} plot
 */
function fadingLabels(root, plot) {
  const base = root.node().getScreenCTM?.();
  if (!base) return null;
  const inverse = base.inverse();
  const layer = root.append("g").attr("class", fadingClass).attr("aria-hidden", "true").style("pointer-events", "none");
  // Each copy follows the dimension or category it labels, which the render
  // keeps, as it moves to its place in the new layout.
  const copies = [];
  plot.selectAll("text").each(function() {
    const ctm = this.getScreenCTM();
    if (!ctm) return;
    const m = inverse.multiply(ctm);
    const dimension = this.closest("g.dimension");
    const category = this.closest("g.category");
    const outer = layer.append("g");
    let parent = outer;
    // With the data of what they copy, for any selection of the classes.
    if (dimension) parent = parent.append("g").attr("class", "dimension").datum(dimension.__data__);
    if (category) parent = parent.append("g").attr("class", "category").datum(category.__data__);
    const copy = this.cloneNode(true);
    copy.setAttribute("transform", `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
    parent.node().append(copy);
    copies.push({node: outer.node(), category: category?.__data__, dimension: dimension?.__data__});
  });
  layer.property("__copies", copies);
  return layer;
}

/**
 * Moves the labels' copies with the dimensions and categories they label,
 * from where those were when the turn started.
 * @param {*} fading
 */
function placeLabels(fading) {
  const base = fading.property("__base");
  for (const {node, category, dimension, x0, y0} of fading.property("__copies")) {
    node.setAttribute("transform", `translate(${category ? category.x0 - x0 : 0},${dimension ? dimension.y0 - y0 : 0})${base}`);
  }
}

/**
 * Turns the plot, with labels hidden until the last third of the turn, or
 * from the opacity they had already reached. The labels as they were shown,
 * if copied, turn with the chart while they fade out in the first third.
 * @param {*} plot
 * @param {(t: number) => string} transform the plot's transform at time t
 * @param {boolean} horizontal the orientation turned to
 * @param {import("./render-context.js").Timing} timing
 * @param {number} [labels] the labels' opacity at the start
 * @param {*} [fading] the labels as they were shown, from fadingLabels
 */
function startTurn(plot, transform, horizontal, timing, labels = 0, fading) {
  if (!timing.delay && !timing.duration) {
    fading?.remove();
    plot.attr("transform", frameTransform(horizontal));
    return;
  }
  // Show the start at once, including during any delay.
  plot.property("__turning", true).attr("transform", transform(0));
  if (fading) {
    // The copies were measured in the plot as it was shown, which its start
    // in the new layout draws the same.
    const m = plot.node().transform.baseVal.consolidate().matrix.inverse();
    fading.property("__base", `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`);
    for (const copy of fading.property("__copies")) {
      copy.x0 = copy.category?.x0;
      copy.y0 = copy.dimension?.y0;
    }
    placeLabels(fading);
    fading.attr("transform", transform(0));
    transitionSelection(fading, timing, turnTransition)
      .attrTween("transform", () => transform)
      // After the positions' tweens, which come first in each frame.
      .tween("place", () => () => placeLabels(fading))
      .styleTween("opacity", () => fadeOut)
      .on("end", () => fading.remove());
  }
  transitionSelection(plot, timing, turnTransition)
    .attrTween("transform", () => transform)
    .on("end", () => plot.property("__turning", null).attr("transform", frameTransform(horizontal)));
  transitionSelection(plot.selectAll("text").style("opacity", labels), timing, turnTransition)
    .styleTween("opacity", () => t => Math.max(labels, 3 * t - 2))
    .on("end", function() {
      this.style.removeProperty("opacity");
    });
}

/**
 * Stops an unfinished turn, so a new render starts from the plot as shown.
 * If a turn was stopped, returns the plot's transform, copied before the
 * render replaces it, and the labels' opacity.
 * @param {*} plot
 * @returns {{shown: DOMMatrix, labels: number}|undefined}
 */
function endTurn(plot) {
  const matrix = plot.property("__turning") && plot.node().transform.baseVal.consolidate()?.matrix;
  const label = plot.node().querySelector("text");
  const stopped = matrix ? {
    shown: DOMMatrix.fromMatrix(matrix),
    labels: label ? +getComputedStyle(label).opacity : 0
  } : undefined;
  plot.property("__turning", null).interrupt(turnTransition)
    .selectAll("text").interrupt(turnTransition).style("opacity", null);
  turningLabels(plot).interrupt(turnTransition).remove();
  return stopped;
}

/**
 * The opacity of the labels as they were, fading out in the first third of a
 * turn at eased progress t.
 * @param {number} t
 */
function fadeOut(t) {
  return Math.max(0, 1 - 3 * t);
}

/**
 * The copies of the labels as they were before a plot's turn, if any.
 * @param {*} plot
 */
function turningLabels(plot) {
  return select(plot.node().parentNode).selectAll(`:scope > g.${fadingClass}`);
}

export { endTurn, fadingLabels, startTurn, turnCorrection, turnLayout };
