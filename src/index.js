// Parallel Sets by Jason Davies, https://www.jasondavies.com/
// Functionality based on https://eagereyes.org/publications/Kosara-TVCG-2006
import "d3-transition";
import { dispatch } from "d3-dispatch";
import { easeElastic } from "d3-ease";
import { create, select } from "d3-selection";
import { renderSelection } from "./render-selection.js";
import { accessors } from "./settings.js";
import { buildTree } from "./tree.js";

function createParsets() {
  const dispatcher = dispatch("sortDimensions", "sortCategories");

  function parsets(selection) {
    draw(selection, false);
  }

  // A new chart from render has nothing to animate from, so it is drawn at once.
  function draw(selection, instant) {
    renderSelection(selection, {...options, dispatcher, ease: parsetsEase, instant, owner: parsets});
  }

  const options = accessors(parsets, [
    "dimensions", "value", "width", "height", "spacing", "nodeThickness", "orientation",
    "tension", "duration", "dimensionFormat", "categoryFormat", "tooltip", "categoryTooltip",
    "categorySortKey", "categorySort", "color"
  ]);

  parsets.on = (...args) => {
    const value = dispatcher.on(...args);
    return value === dispatcher ? parsets : value;
  };

  parsets.render = (data, parent) => {
    if (typeof document === "undefined") {
      throw new Error("parsets.render requires a DOM (document is undefined)");
    }

    const svg = create("svg")
      .attr("width", options.width)
      .attr("height", options.height);
    const node = svg.node();

    const mount =
      parent != null
        // Accept a selection from this or another copy of D3, a node, or a selector.
        ? select(typeof parent.node === "function" ? parent.node() : parent)
        : select(document.body)
            .append("div")
            .style("position", "absolute")
            .style("left", "-99999px")
            .style("top", "-99999px")
            .style("visibility", "hidden")
            .style("pointer-events", "none");

    if (mount.empty()) {
      throw new Error("parsets.render parent was not found");
    }

    mount.append(() => node);
    try {
      // A new chart has nothing to animate from, so draw it at once.
      svg.append("g").datum(data).call(draw, true);
      return node;
    } catch (error) {
      svg.interrupt();
      svg.selectAll("*").interrupt();
      svg.remove();
      throw error;
    } finally {
      // Return the SVG detached, without the container it was measured in.
      if (parent == null) {
        node.remove();
        mount.remove();
      }
    }
  };

  return parsets;
}

createParsets.tree = buildTree;
const parsetsEase = easeElastic;

export { buildTree as tree };
export { default as parsetsLayout } from "./layout-api.js";
export default createParsets;
