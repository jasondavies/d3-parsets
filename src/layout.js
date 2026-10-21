function positionDimensions(dimensions, height, {nodeThickness = 0, top = 0, bottom = 0} = {}) {
  // The chart passes room for headers; the standalone layout uses no margins.
  const start = Math.min(top, height);
  const end = Math.max(start, height - bottom);
  const thickness = Math.min(nodeThickness, (end - start) / Math.max(1, dimensions.length));
  const first = start + thickness / 2;
  const last = end - thickness / 2;
  const dy = dimensions.length > 1 ? (last - first) / (dimensions.length - 1) : 0;
  dimensions.forEach((d, i) => {
    d.y = first + i * dy;
    d.nodeThickness = thickness;
    if (d.y0 == null) d.y0 = d.y;
  });
}

function layout(tree, dimensions, ordinal, width, height, spacing, options = {}) {
  const nodes = [];
  if (!dimensions.length) return nodes;
  spacing = Math.min(width, spacing);
  positionDimensions(dimensions, height, options);

  // Each dimension and category also lists the ribbons attached to it.
  dimensions.forEach(d => {
    d.ribbons = [];
    d.categories.forEach(c => {
      c.dimension = d;
      c.count = 0;
      c.nodes = [];
      c.ribbons = [];
    });
  });

  // Compute per-category counts.
  const total = (function rollup(d, i) {
    if (!d.children) return d.count;
    const dim = dimensions[i];
    let subtotal = 0;
    dim.categories.forEach(c => {
      const child = Object.hasOwn(d.children, c.name) ? d.children[c.name] : null;
      if (!child) return;
      c.nodes.push(child);
      const count = rollup(child, i + 1);
      c.count += count;
      subtotal += count;
    });
    return subtotal;
  })(tree, 0);

  // Stack the counts.
  dimensions.forEach(d => {
    d.categories = d.categories.filter(c => c.count > 0);
    const comparator = options.categorySort?.(d.name);
    if (comparator) d.categories.sort(comparator);
    stackCategories(d.categories, total, width, spacing);
    d.categories.forEach(c => {
      c.in = { dx: 0 };
      c.out = { dx: 0 };
      if (c.x0 == null) c.x0 = c.x;
    });
  });

  const firstDimension = dimensions[0];
  firstDimension.categories.forEach(c => {
    const k = c.name;
    if (Object.hasOwn(tree.children, k)) {
      recurse(c, { node: tree.children[k], path: k }, 1, ordinal(k));
    }
  });

  function recurse(p, d, depth, major) {
    if (depth >= dimensions.length) return;
    const node = d.node;
    const dimension = dimensions[depth];
    dimension.categories.forEach(c => {
      const k = c.name;
      if (!Object.hasOwn(node.children, k)) return;
      const child = node.children[k];
      if (child.count <= 0) return;
      child.path = `${d.path}\0${k}`;

      const target = child.target || { node: c, dimension };
      target.dy = -dimension.nodeThickness / 2;
      target.x = c.in.dx;
      target.dx = (child.count / total) * (width - spacing);
      c.in.dx += target.dx;

      const source = child.source || {
        node: p,
        dimension: dimensions[depth - 1]
      };
      source.dy = source.dimension.nodeThickness / 2;
      source.x = p.out.dx;
      source.dx = target.dx;
      p.out.dx += source.dx;

      child.node = child;
      child.source = source;
      child.target = target;
      child.major = major;
      nodes.push(child);
      c.ribbons.push(child);
      p.ribbons.push(child);
      dimension.ribbons.push(child);
      source.dimension.ribbons.push(child);
      if (depth + 1 < dimensions.length) recurse(c, child, depth + 1, major);
    });
  }

  return nodes;
}

// Sets each category's resting x and width, dividing spacing between them.
function stackCategories(categories, total, width, spacing) {
  let x = 0;
  const p = categories.length > 1 ? spacing / (categories.length - 1) : 0;
  categories.forEach(c => {
    c.x = x;
    c.dx = (c.count / total) * (width - spacing);
    x += c.dx + p;
  });
}

export { layout, positionDimensions };
