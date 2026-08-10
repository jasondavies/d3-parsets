import buildTree from "./buildTree.js";
import constant from "./constant.js";

function defaultValue() {
  return 1;
}

function autoDimensions(data) {
  return data.length ? Object.keys(data[0]).sort() : [];
}

// Walks the tree once, collecting the ordered (first-encountered) list of
// categories for each dimension together with their aggregate counts.
function computeCategories(tree, dimensionNames) {
  const dimensions = dimensionNames.map(name => ({name, categories: [], _byName: new Map()}));

  (function walk(node, depth) {
    if (!node.children || depth >= dimensions.length) return;
    const dimension = dimensions[depth];
    for (const key of Object.keys(node.children)) {
      const child = node.children[key];
      let category = dimension._byName.get(key);
      if (!category) {
        category = {name: key, count: 0};
        dimension._byName.set(key, category);
        dimension.categories.push(category);
      }
      category.count += child.count;
      walk(child, depth + 1);
    }
  })(tree, 0);

  for (const dimension of dimensions) delete dimension._byName;
  return dimensions;
}

// Assigns x/dx to every category, proportional to its count, stacked left
// to right with `spacing` distributed between categories.
function stackCategories(dimensions, width, spacing) {
  for (const dimension of dimensions) {
    dimension.categories = dimension.categories.filter(c => c.count > 0);
    const categories = dimension.categories;
    const total = categories.reduce((a, c) => a + c.count, 0);
    const p = categories.length > 1 ? spacing / (categories.length - 1) : 0;
    let x = 0;
    for (const c of categories) {
      c.x = x;
      c.dx = total > 0 ? c.count / total * (width - spacing) : 0;
      x += c.dx + p;
    }
  }
}

// Walks the tree a second time (in category-stacking order, so links land
// in a stable, non-crossing default order) building one link per edge
// between adjacent-dimension categories. Links attach to the outer edges
// of the `nodeThickness`-tall bar centered on each dimension's y, not to
// its center line, leaving a real gap the size of the bar between the
// flows entering and leaving it — the same role nodeWidth plays in sankey.
function computeLinks(tree, dimensions, width, spacing, total, nodeThickness) {
  const links = [];
  const inOffset = new Map();
  const outOffset = new Map();
  const bump = (map, category, amount) => map.set(category, (map.get(category) || 0) + amount);
  const offset = (map, category) => map.get(category) || 0;
  const halfThickness = nodeThickness / 2;

  function walk(parentCategory, rootName, node, path, depth) {
    if (depth >= dimensions.length) return;
    const dimension = dimensions[depth];
    const parentDimension = dimensions[depth - 1];
    for (const category of dimension.categories) {
      const child = node.children && node.children[category.name];
      if (!child) continue;
      const dx = total > 0 ? child.count / total * (width - spacing) : 0;
      const childPath = `${path}\0${category.name}`;
      links.push({
        path: childPath,
        count: child.count,
        rootCategory: rootName,
        source: {dimension: parentDimension, category: parentCategory, x: offset(outOffset, parentCategory), dx, y: parentDimension.y + halfThickness},
        target: {dimension, category, x: offset(inOffset, category), dx, y: dimension.y - halfThickness}
      });
      bump(inOffset, category, dx);
      bump(outOffset, parentCategory, dx);
      walk(category, rootName, child, childPath, depth + 1);
    }
  }

  for (const rootCategory of dimensions[0].categories) {
    const node = tree.children[rootCategory.name];
    if (node) walk(rootCategory, rootCategory.name, node, rootCategory.name, 1);
  }

  return links;
}

// A stateless parallel-sets layout: given the same data, dimension names
// and options, always returns the same geometry. It holds no memory of any
// previous call — reordering, animation and rendering are the caller's
// responsibility.
export default function Layout() {
  let width = 1,
      height = 1,
      spacing = 20,
      nodeThickness = 4,
      value = defaultValue,
      dimensionNames = autoDimensions,
      categorySort;

  function layout(data) {
    const names = dimensionNames.apply(null, arguments);
    if (names.length === 0) return {dimensions: [], links: []};

    const tree = buildTree(data, names, value);
    const dimensions = computeCategories(tree, names);

    // Reserve nodeThickness/2 at each end so the first and last bars stay
    // fully inside [0, height] instead of straddling the boundary.
    const dy = names.length > 1 ? (height - nodeThickness) / (names.length - 1) : 0;
    dimensions.forEach((dimension, i) => {
      dimension.y = nodeThickness / 2 + i * dy;
    });

    if (categorySort) {
      for (const dimension of dimensions) {
        const comparator = categorySort(dimension.name);
        if (comparator) dimension.categories.sort(comparator);
      }
    }

    stackCategories(dimensions, width, spacing);
    const links = computeLinks(tree, dimensions, width, spacing, tree.count, nodeThickness);

    return {dimensions, links};
  }

  layout.width = function(_) {
    return arguments.length ? (width = +_, layout) : width;
  };

  layout.height = function(_) {
    return arguments.length ? (height = +_, layout) : height;
  };

  layout.spacing = function(_) {
    return arguments.length ? (spacing = +_, layout) : spacing;
  };

  // Vertical thickness of each dimension's node bar. Links attach to its
  // outer edges rather than a single center line, so this is also the gap
  // left between the flow arriving at a dimension and the flow leaving it
  // — the equivalent of nodeWidth in sankey.
  layout.nodeThickness = function(_) {
    return arguments.length ? (nodeThickness = +_, layout) : nodeThickness;
  };

  layout.value = function(_) {
    return arguments.length ? (value = typeof _ === "function" ? _ : constant(+_), layout) : value;
  };

  layout.dimensions = function(_) {
    return arguments.length ? (dimensionNames = typeof _ === "function" ? _ : constant(_), layout) : dimensionNames;
  };

  // _ is a function (dimensionName) => comparator | falsy. Called once per
  // dimension so each one can be sorted independently (e.g. to reflect an
  // explicit drag-derived order for a single dimension while others keep
  // their default order).
  layout.categorySort = function(_) {
    return arguments.length ? (categorySort = _, layout) : categorySort;
  };

  return layout;
}
