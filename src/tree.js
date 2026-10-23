// Construct tree of all category counts for a given ordered list of
// dimensions. Similar to d3.nest, except we also set the parent. If given one
// Set per dimension, also collects category names in order of first
// appearance; tree keys cannot give this order, as integer-like keys are
// enumerated first.
function buildTree(root, data, dimensions, value, orders) {
  // Check every value before changing the tree, so a bad one leaves it as it
  // was. Data may be any iterable, read once.
  if (!Array.isArray(data)) data = Array.from(data);
  const values = data.map((d, i) => {
    const v = +value(d, i);
    if (!Number.isFinite(v) || v < 0) {
      throw new RangeError("parsets values must be finite and non-negative");
    }
    return v;
  });
  zeroCounts(root, dimensions);
  const n = data.length;
  const nd = dimensions.length;
  for (let i = 0; i < n; i++) {
    const d = data[i];
    const v = values[i];
    let node = root;
    for (let j = 0; j < nd; j++) {
      const dimension = dimensions[j];
      const category = d[dimension];
      if (orders) orders[j].add(String(category));
      // A tree built with fewer dimensions ends earlier: extend it.
      const children = node.children ??= Object.create(null);
      node.count += v;
      node = Object.hasOwn(children, category)
        ? children[category]
        : (children[category] = {
            children: j === nd - 1 ? null : Object.create(null),
            count: 0,
            parent: node,
            dimension: dimension,
            name: category
          });
    }
    node.count += v;
  }
  return root;
}

// Resets counts and dimension metadata, and ends the tree at the new depth,
// in case it was built with more dimensions. Keep the root's children even
// when there are no dimensions.
function zeroCounts(d, dimensions, depth = 0) {
  d.count = 0;
  if (depth) {
    if (depth <= dimensions.length) d.dimension = dimensions[depth - 1];
    if (depth >= dimensions.length) d.children = null;
  }
  if (d.children) {
    // Accept the historical {children: {}} root without treating category
    // names such as __proto__ as setters or inherited properties. Copy it
    // rather than change the prototype of the caller's object.
    if (Object.getPrototypeOf(d.children) !== null) d.children = Object.assign(Object.create(null), d.children);
    for (const child of Object.values(d.children)) zeroCounts(child, dimensions, depth + 1);
  }
}

// The first-dimension category name of a tree node below the root.
function rootCategory(node) {
  while (node.parent?.parent) node = node.parent;
  return String(node.name);
}

export { buildTree, rootCategory };
