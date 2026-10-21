import { layout } from "./layout.js";
import { accessors } from "./settings.js";
import { buildTree, rootCategory } from "./tree.js";

// A DOM-independent interface to the same geometry used by the chart.
// Each invocation owns its tree and geometry; no input or prior result is changed.
export default function parsetsLayout() {
  function compute(data, ...args) {
    const {value, width, height, spacing, nodeThickness, categorySort} = options;
    const horizontal = options.orientation === "horizontal";
    // Data may be any iterable; read its rows once.
    if (!Array.isArray(data)) data = Array.from(data ?? []);
    const names = Array.from(new Set(options.dimensions.call(this, data, ...args)));
    const orders = names.map(() => new Set());
    const tree = buildTree({children: Object.create(null)}, data, names, value, orders);
    const dimensions = names.map((name, i) => ({name, categories: Array.from(orders[i], name => ({name}))}));
    // Categories stack along x in vertical layouts, and along y in horizontal
    // ones; the geometry is computed for the former and then transposed.
    const [length, extent] = horizontal ? [height, width] : [width, height];
    const [x, dx, y] = horizontal ? ["y", "dy", "x"] : ["x", "dx", "y"];
    const nodes = layout(tree, dimensions, () => 0, length, extent, spacing, {
      top: 0, bottom: 0, nodeThickness, categorySort
    });

    // Omit animation state and tree backreferences from the public geometry.
    const dimensionMap = new Map();
    const categoryMap = new Map();
    const result = dimensions.map(d => {
      const dimension = {name: d.name, [y]: d.y, nodeThickness: d.nodeThickness, categories: d.categories.map(c => {
        const category = {name: c.name, count: c.count, [x]: c.x, [dx]: c.dx};
        categoryMap.set(c, category);
        return category;
      })};
      dimensionMap.set(d, dimension);
      return dimension;
    });
    const endpoint = e => ({
      dimension: dimensionMap.get(e.dimension), category: categoryMap.get(e.node),
      [x]: e.x, [dx]: e.dx, [y]: e.dimension.y + e.dy
    });
    const links = nodes.map(node => ({
      path: node.path, count: node.count, rootCategory: rootCategory(node),
      source: endpoint(node.source), target: endpoint(node.target)
    }));
    return {dimensions: result, links};
  }

  const options = accessors(compute, [
    "dimensions", "value", "width", "height", "spacing", "nodeThickness", "categorySort", "orientation"
  ]);

  return compute;
}
