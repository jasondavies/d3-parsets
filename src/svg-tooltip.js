import { pointer } from "d3-selection";

function createSvgTooltip(g) {
  return g
    // Not the tooltip of a chart nested inside this one.
    .selectAll(":scope > g.parsets-tooltip")
    .data([null])
    .join(enter => {
      const group = enter
        .append("g")
        .attr("class", "parsets-tooltip")
        .style("visibility", "hidden")
        .style("pointer-events", "none");
      group.append("rect");
      group
        .append("text")
        .attr("x", 0)
        .attr("y", 0)
        .attr("dominant-baseline", "hanging")
        // Keep leading and repeated spaces, also where CSS white-space does
        // not apply to SVG text.
        .attr("xml:space", "preserve")
        .style("white-space", "pre");
      return group;
    });
}

function hideSvgTooltip(tooltipGroup) {
  tooltipGroup.style("visibility", "hidden");
}

/**
 * Lays out the tooltip's text, returning false, and hiding it, if there is
 * none: a callback returning null, an empty string or only blank lines.
 * @param {*} tooltipGroup
 * @param {*} content
 * @returns {boolean}
 */
function setSvgTooltip(tooltipGroup, content) {
  const lines = String(content ?? "").split(/\r?\n/);
  const first = lines.findIndex(line => line !== "");
  if (first < 0) {
    hideSvgTooltip(tooltipGroup);
    return false;
  }
  const last = lines.findLastIndex(line => line !== "");
  const text = tooltipGroup.select("text");

  text
    .selectAll("tspan")
    .data(lines)
    .join("tspan")
    .attr("x", 0)
    // Absolute offsets keep blank lines, which relative dy would collapse.
    .attr("y", (_line, lineIndex) => `${lineIndex * 1.2}em`)
    .text(line => line);

  // The bounding box ignores blank lines before the first line with text
  // and after the last, so add them back.
  const box = text.node().getBBox();
  const lineHeight = 1.2 * parseFloat(getComputedStyle(text.node()).fontSize);
  const padding = 6;
  const x = box.x - padding;
  const y = box.y - first * lineHeight - padding;
  const width = box.width + padding * 2;
  const height = box.height + (first + lines.length - 1 - last) * lineHeight + padding * 2;
  tooltipGroup.select("rect").attr("x", x).attr("y", y).attr("width", width).attr("height", height);
  // Above anything drawn since; only new content needs it.
  tooltipGroup.property("__box", {x, y, width, height}).raise();
  return true;
}

/**
 * Places a tooltip after the pointer, or before it where it would not fit,
 * so that it never covers what the pointer is on. A tooltip that fits on
 * neither side is kept within the chart, and one larger than the chart is
 * anchored at its start.
 * @param {number} p the pointer's position
 * @param {number} size the tooltip's size
 * @param {number} extent the chart's size
 */
function place(p, size, extent) {
  const gap = 12;
  const after = p + gap;
  const before = p - gap - size;
  const position = after + size <= extent || before < 0 ? after : before;
  return Math.max(0, Math.min(extent - size, position));
}

/**
 * Shows the tooltip beside the pointer, within the chart.
 * @param {*} tooltipGroup
 * @param {*} chartGroup
 * @param {Event} event
 * @param {number} width
 * @param {number} height
 */
function moveSvgTooltip(tooltipGroup, chartGroup, event, width, height) {
  const box = tooltipGroup.property("__box");
  const [x, y] = pointer(event, chartGroup.node());
  const tx = place(x, box.width, width) - box.x;
  const ty = place(y, box.height, height) - box.y;

  tooltipGroup
    .attr("transform", `translate(${tx},${ty})`)
    .style("visibility", null);
}

export { createSvgTooltip, hideSvgTooltip, moveSvgTooltip, setSvgTooltip };
