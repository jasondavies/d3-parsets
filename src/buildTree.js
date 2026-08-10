// Builds a tree of nested category counts for the given ordered list of
// dimension names, aggregating `value` per row. Every node stores its
// aggregate `count` and a `parent` reference; leaves have `children: null`.
export default function buildTree(data, dimensionNames, value) {
  const root = {children: {}, count: 0};
  const nd = dimensionNames.length;
  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    const v = +value(d, i);
    let node = root;
    for (let j = 0; j < nd; j++) {
      const name = dimensionNames[j];
      const category = d[name];
      const children = node.children;
      node.count += v;
      node = Object.hasOwn(children, category) ? children[category]
          : children[category] = {
            children: j === nd - 1 ? null : {},
            count: 0,
            parent: node,
            dimension: name,
            name: category
          };
    }
    node.count += v;
  }
  return root;
}
