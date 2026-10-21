// Everything a render or a reorder needs from the chart's callbacks, worked
// out before anything changes: a callback that throws then leaves the chart
// as it was, still working.

/**
 * Each dimension's category counts, summed from the aggregated tree.
 * @param {*} tree
 * @param {number} depth the number of dimensions
 * @returns {Array<Map<string, number>>}
 */
function categoryCounts(tree, depth) {
  const counts = Array.from({length: depth}, () => new Map());
  (function visit(node, j) {
    if (j >= depth || !node.children) return;
    for (const name in node.children) {
      const child = node.children[name];
      counts[j].set(name, (counts[j].get(name) ?? 0) + child.count);
      visit(child, j + 1);
    }
  })(tree, 0);
  return counts;
}

/**
 * Each dimension's categories with rows, in data order or the order
 * categorySort gives. Comparators receive categories' names and counts.
 * @param {*} options the chart's settings
 * @param {Array<Map<string, number>>} counts each dimension's category counts
 * @param {string[]} names the dimensions
 * @param {Array<Iterable<string>>} dataOrders each dimension's categories in data order
 * @returns {string[][]}
 */
function categoryOrders(options, counts, names, dataOrders) {
  return names.map((name, i) => {
    const categories = Array.from(dataOrders[i], category => ({name: category, count: counts[i].get(category) ?? 0}))
      .filter(c => c.count > 0);
    const comparator = options.categorySort?.(name);
    if (comparator) categories.sort(comparator);
    return categories.map(c => c.name);
  });
}

/**
 * Dimension labels, formatted; a dimension's index is its position.
 * @param {*} options the chart's settings
 * @param {string[]} names the dimensions, in order
 * @returns {Map<string, string>}
 */
function dimensionLabels(options, names) {
  return new Map(names.map((name, i) => [name, String(options.dimensionFormat(name, i) ?? "")]));
}

/**
 * A dimension's category labels, formatted; a category's index is its
 * position within its dimension.
 * @param {*} options the chart's settings
 * @param {string} dimension
 * @param {string[]} categories in order
 * @returns {Map<string, string>}
 */
function categoryLabels(options, dimension, categories) {
  return new Map(categories.map((category, j) => [category, String(options.categoryFormat(category, j, dimension) ?? "")]));
}

/**
 * Compares two categories by the key categorySortKey gives them.
 * @param {*} options the chart's settings
 * @param {{name: string}} a
 * @param {{name: string}} b
 */
function compareKeys(options, a, b) {
  const ak = options.categorySortKey(a.name, a);
  const bk = options.categorySortKey(b.name, b);
  return ak < bk ? -1 : ak > bk ? 1 : 0;
}

/**
 * The sort marks that still hold: those whose dimension's categories are
 * still in the order the mark shows, which new data can change.
 * @param {*} options the chart's settings
 * @param {Array<Map<string, number>>} counts each dimension's category counts
 * @param {string[]} names the dimensions
 * @param {string[][]} orders each dimension's categories, in order
 * @param {Map<string, {type: string, order: number}>} marks by dimension
 */
function keptMarks(options, counts, names, orders, marks) {
  const kept = new Map();
  names.forEach((name, i) => {
    const mark = marks.get(name);
    if (!mark) return;
    const categories = orders[i].map(category => ({name: category, count: counts[i].get(category)}));
    const ascending = mark.type === "key" ? (a, b) => compareKeys(options, a, b) : (a, b) => a.count - b.count;
    if (categories.every((c, j) => !j || mark.order * ascending(categories[j - 1], c) <= 0)) kept.set(name, mark);
  });
  return kept;
}

/**
 * Colour slots for the first dimension's categories, and their colours from
 * the color callback, if any. Shown categories keep their slots, so sorting,
 * dragging and rerendering never recolour them. A returning category gets its
 * old slot back unless another category took it while it was absent;
 * otherwise categories take the lowest slot no shown category is using.
 * Works on a copy of the slots, which the caller then keeps.
 * @param {*} options the chart's settings
 * @param {Map<string, Map<string, number>>|undefined} colours slots so far, by dimension
 * @param {string} first the first dimension
 * @param {string[]} order its categories, in order
 * @returns {{first: string, slots: Map<string, number>, fills: Map<string, *>|null}}
 */
function colourSlots(options, colours, first, order) {
  const slots = new Map(colours?.get(first));
  const used = new Set(order.filter(name => slots.has(name)).map(name => slots.get(name)));
  for (const name of order) {
    if (slots.has(name)) continue;
    let slot = 0;
    while (used.has(slot)) slot++;
    // Each slot has one owner, so an absent category loses a reused slot.
    for (const [other, s] of slots) if (s === slot) slots.delete(other);
    slots.set(name, slot);
    used.add(slot);
  }
  const fills = options.color && new Map(order.map(name => [name, options.color(name, slots.get(name))]));
  return {first, slots, fills: fills || null};
}

/**
 * Everything a render needs from the chart's callbacks.
 * @param {*} options the chart's settings
 * @param {Map<string, Map<string, number>>|undefined} colours slots so far, by dimension
 * @param {*} tree
 * @param {string[]} names the dimensions
 * @param {Array<Iterable<string>>} dataOrders each dimension's categories in data order
 * @param {Map<string, {type: string, order: number}>} marks the sort marks shown so far
 */
function prepare(options, colours, tree, names, dataOrders, marks) {
  const counts = categoryCounts(tree, names.length);
  const orders = categoryOrders(options, counts, names, dataOrders);
  return {
    orders,
    labels: {
      dimensions: dimensionLabels(options, names),
      categories: new Map(names.map((name, i) => [name, categoryLabels(options, name, orders[i])]))
    },
    colours: names.length ? colourSlots(options, colours, names[0], orders[0]) : null,
    marks: keptMarks(options, counts, names, orders, marks)
  };
}

export { categoryLabels, colourSlots, compareKeys, dimensionLabels, prepare };
