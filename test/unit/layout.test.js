import assert from "node:assert/strict";
import {test} from "node:test";
import parsetsLayout from "../../src/layout-api.js";
import {buildTree} from "../../src/tree.js";
import {layout} from "../../src/layout.js";
import {ribbonPath, ribbonPathStatic} from "../../src/ribbon-path.js";

const rows = [
  {A: "a", B: "x", C: "m", count: 2},
  {A: "a", B: "y", C: "n", count: 3},
  {A: "b", B: "x", C: "n", count: 5}
];
const make = () => parsetsLayout().dimensions(["A", "B", "C"]).value(d => d.count);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test("aggregates weighted categories and keeps complete paths through adjacent dimensions", () => {
  const {dimensions, links} = make()(rows);
  assert.deepEqual(dimensions.map(d => d.name), ["A", "B", "C"]);
  assert.deepEqual(dimensions[0].categories.map(c => [c.name, c.count]), [["a", 5], ["b", 5]]);
  assert.deepEqual(dimensions[1].categories.map(c => [c.name, c.count]), [["x", 7], ["y", 3]]);
  assert.equal(links.length, 6);
  for (const d of dimensions) {
    assert.equal(d.categories.reduce((sum, c) => sum + c.count, 0), 10);
    close(d.categories.at(-1).x + d.categories.at(-1).dx, 960);
  }
  for (const d of dimensions.slice(1)) {
    assert.equal(links.filter(l => l.target.dimension === d).reduce((sum, l) => sum + l.count, 0), 10);
  }
  for (const l of links) {
    assert.equal(l.source.dx, l.target.dx);
    close(l.source.dx, l.count / 10 * 940);
    assert.ok(l.source.dimension.categories.includes(l.source.category));
    assert.ok(l.target.dimension.categories.includes(l.target.category));
    assert.equal(l.rootCategory, l.path.split("\0")[0]);
  }
});

test("incoming and outgoing links exactly fill each category without overlap", () => {
  const {dimensions, links} = make()(rows);
  for (const [i, d] of dimensions.entries()) {
    for (const c of d.categories) {
      for (const side of [...(i ? ["target"] : []), ...(i < dimensions.length - 1 ? ["source"] : [])]) {
        const ends = links.map(l => l[side]).filter(e => e.category === c).sort((a, b) => a.x - b.x);
        let x = 0;
        for (const e of ends) {close(e.x, x); x += e.dx;}
        close(x, c.dx);
      }
    }
  }
});

test("calls are independent, preserve inputs, and honour explicit dimension order", () => {
  const data = structuredClone(rows);
  const compute = make();
  const first = compute(data);
  assert.deepEqual(compute(data), first);
  first.dimensions[0].categories[0].x = -999;
  assert.equal(compute(data).dimensions[0].categories[0].x, 0);
  assert.deepEqual(data, rows);
  assert.deepEqual(compute.dimensions(["C", "A"])(data).dimensions.map(d => d.name), ["C", "A"]);
});

test("supports automatic dimensions, dimension accessors, and constant values", () => {
  assert.deepEqual(parsetsLayout()([{B: "b", A: "a"}]).dimensions.map(d => d.name), ["A", "B"]);
  const compute = parsetsLayout().dimensions((data, dimension) => [dimension]).value(2);
  assert.equal(compute([{A: "a"}, {A: "a"}], "A").dimensions[0].categories[0].count, 4);
  assert.equal(parsetsLayout()([{A: "a"}, {A: "a"}]).dimensions[0].categories[0].count, 2);
});

test("sorts categories independently after computing their counts", () => {
  const graph = make().categorySort(name => name === "B" && ((a, b) => a.count - b.count))(rows);
  assert.deepEqual(graph.dimensions[0].categories.map(c => c.name), ["a", "b"]);
  assert.deepEqual(graph.dimensions[1].categories.map(c => c.name), ["y", "x"]);
  assert.ok(graph.links.some(l => l.target.category === graph.dimensions[1].categories[0]));
});

test("empty, zero-dimensional, single-dimensional, and zero-weight inputs have finite geometry", () => {
  assert.deepEqual(parsetsLayout()([]), {dimensions: [], links: []});
  assert.deepEqual(parsetsLayout().dimensions([])(rows), {dimensions: [], links: []});
  assert.equal(make()([]).dimensions.length, 3);
  assert.equal(make()([]).links.length, 0);
  const single = parsetsLayout()([{A: "a"}]);
  assert.equal(single.links.length, 0);
  assert.ok(Number.isFinite(single.dimensions[0].y));
  const zero = make().value(0)(rows);
  assert.equal(zero.links.length, 0);
  assert.ok(zero.dimensions.every(d => d.categories.length === 0));
});

test("default and constrained sizes never create negative widths or overlapping bars", () => {
  for (const [width, height, spacing, thickness] of [[960, 600, 20, 0], [1, 1, 20, 4], [0, 0, 20, 4]]) {
    const graph = make().width(width).height(height).spacing(spacing).nodeThickness(thickness)(rows);
    for (const d of graph.dimensions) {
      assert.ok(d.y - d.nodeThickness / 2 >= 0);
      assert.ok(d.y + d.nodeThickness / 2 <= height + 1e-9);
      for (const c of d.categories) assert.ok(Number.isFinite(c.dx) && c.dx >= 0);
    }
    for (const l of graph.links) assert.ok(l.target.y >= l.source.y - 1e-9);
  }
  assert.ok(parsetsLayout()([{A: "a", B: "b"}]).links[0].source.dx > 0);
});

test("node thickness leaves a real gap and keeps bars inside the extent", () => {
  const {dimensions, links} = make().nodeThickness(10)(rows);
  assert.equal(dimensions[0].y, 5);
  assert.equal(dimensions.at(-1).y, 595);
  for (const l of links) {
    assert.equal(l.source.y, l.source.dimension.y + 5);
    assert.equal(l.target.y, l.target.dimension.y - 5);
  }
});

test("prototype-like category names survive aggregation at every depth", () => {
  const data = [
    {A: "__proto__", B: "constructor", C: "toString"},
    {A: "constructor", B: "__proto__", C: "hasOwnProperty"},
    {A: "normal", B: "valueOf", C: "__proto__"}
  ];
  const graph = parsetsLayout().dimensions(["A", "B", "C"])(data);
  assert.equal(graph.links.length, 6);
  for (const d of graph.dimensions) assert.equal(d.categories.reduce((n, c) => n + c.count, 0), 3);
  assert.ok(graph.links.every(l => Number.isFinite(l.source.dx)));
  const root = buildTree({children: {}}, data, ["A", "B", "C"], () => 1);
  assert.equal(Object.getPrototypeOf(root.children), null);
  assert.equal(root.children.__proto__.count, 1);
  buildTree(root, data.slice(0, 1), ["A", "B", "C"], () => 2);
  assert.equal(root.count, 2);
  assert.equal(root.children.constructor.count, 0);
});

test("rejects invalid extents and weights instead of producing NaN geometry", () => {
  for (const method of ["width", "height", "spacing", "nodeThickness"]) {
    for (const value of [-1, NaN, Infinity]) assert.throws(() => make()[method](value), RangeError);
  }
  for (const value of [-1, NaN, Infinity]) assert.throws(() => make().value(value)(rows), RangeError);
});

test("chart geometry preserves its margins and ribbon attachment offsets", () => {
  const tree = buildTree({children: {}}, [{A: "a", B: "b"}], ["A", "B"], () => 1);
  const dimensions = [{name: "A", categories: [{name: "a"}]}, {name: "B", categories: [{name: "b"}]}];
  const [link] = layout(tree, dimensions, () => 0, 960, 600, 20, {top: 45, bottom: 2});
  assert.equal(dimensions[0].y, 45);
  assert.equal(dimensions[1].y, 598);
  layout(tree, dimensions, () => 0, 960, 600, 20, {top: 45, bottom: 2, nodeThickness: 10});
  assert.equal(link.source.dy, 5);
  assert.equal(link.target.dy, -5);
  dimensions.forEach(d => d.y0 = d.y);
  assert.equal(ribbonPath(link, 0.5), ribbonPathStatic(link, 0.5));
});

test("categories follow first appearance in the data, including number-like names", () => {
  const layout = parsetsLayout().dimensions(new Set(["Year", "B"]));
  const {dimensions} = layout([
    {Year: 2020, B: "b1"}, {Year: "10", B: "b2"}, {Year: "x", B: "b3"}, {Year: 3, B: "b2"}, {Year: "10", B: "b1"}
  ]);
  assert.deepEqual(dimensions.map(d => d.categories.map(c => c.name)), [["2020", "10", "x", "3"], ["b1", "b2", "b3"]]);
});

test("horizontal layouts transpose vertical geometry into screen coordinates", () => {
  const vertical = make().width(600).height(960).nodeThickness(8)(rows);
  const horizontal = make().width(960).height(600).nodeThickness(8).orientation("horizontal")(rows);
  assert.equal(make().orientation(), "vertical");
  assert.throws(() => make().orientation("diagonal"), RangeError);
  for (const [i, v] of vertical.dimensions.entries()) {
    const h = horizontal.dimensions[i];
    assert.deepEqual(Object.keys(h), ["name", "x", "nodeThickness", "categories"]);
    assert.equal(h.x, v.y);
    assert.deepEqual(h.categories.map(c => [c.name, c.count, c.y, c.dy]), v.categories.map(c => [c.name, c.count, c.x, c.dx]));
  }
  for (const [i, v] of vertical.links.entries()) {
    const h = horizontal.links[i];
    for (const end of ["source", "target"]) {
      assert.deepEqual([h[end].y, h[end].dy, h[end].x], [v[end].x, v[end].dx, v[end].y]);
      assert.equal(h[end].category, horizontal.dimensions.find(d => d === h[end].dimension).categories.find(c => c.name === v[end].category.name));
    }
  }
});

test("tree leaves the prototype of the caller's children object alone", () => {
  const children = {};
  const root = buildTree({children}, rows, ["A", "B"], d => d.count);
  assert.equal(Object.getPrototypeOf(children), Object.prototype);
  assert.equal(root.children.a.count, 5);
});

test("tree leaves its root unchanged when a value is invalid", () => {
  const root = buildTree({children: Object.create(null)}, rows, ["A", "B"], d => d.count);
  const before = JSON.stringify(root, (key, value) => key === "parent" ? undefined : value);
  assert.throws(() => buildTree(root, [...rows, {A: "a", B: "x", count: -1}], ["A", "B"], d => d.count), RangeError);
  assert.equal(JSON.stringify(root, (key, value) => key === "parent" ? undefined : value), before);
});

test("tree reads data from any iterable", () => {
  const root = buildTree({children: Object.create(null)}, new Set(rows), ["A"], d => d.count);
  assert.equal(root.count, 10);
});

test("a tree can be reused with more dimensions than it was built with", () => {
  const root = buildTree({children: Object.create(null)}, rows, ["A"], d => d.count);
  buildTree(root, rows, ["A", "B"], d => d.count);
  assert.equal(root.children.a.children.x.count, 2);
  assert.equal(parsetsLayout().dimensions(null)(new Set(rows)).dimensions.length, 4);
});

test("a tree reused with fewer dimensions ends at the last of them", () => {
  const root = buildTree({children: Object.create(null)}, rows, ["A", "B", "C"], d => d.count);
  buildTree(root, rows, ["A", "B"], d => d.count);
  assert.equal(root.children.a.children.x.children, null);
  assert.equal(root.children.a.children.x.count, 2);
});

test("a reused tree updates dimension names, including retained zero-count nodes", () => {
  const root = buildTree({children: {}}, [{A: "x", B: "y"}, {A: "absent", B: "old"}], ["A", "B"], () => 1);
  const existing = root.children.x;
  buildTree(root, [{C: "x", D: "y"}], ["C", "D"], () => 2);
  assert.equal(root.children.x, existing);
  assert.equal(root.count, 2);
  assert.equal(existing.children.y.count, 2);
  assert.equal(root.children.absent.count, 0);
  for (const first of Object.values(root.children)) {
    assert.equal(first.dimension, "C");
    assert.equal(first.parent, root);
    for (const second of Object.values(first.children)) {
      assert.equal(second.dimension, "D");
      assert.equal(second.parent, first);
    }
  }
  buildTree(root, [{C: "x", D: "x"}], ["D", "C"], () => 1);
  assert.equal(existing.dimension, "D");
  assert.equal(existing.children.x.dimension, "C");
  assert.equal(existing.children.y.dimension, "C");
  assert.equal(existing.children.y.count, 0);
});

test("layout settings restore their defaults with null, and categorySort takes a function", () => {
  const layout = make().width(100).height(100).spacing(5).nodeThickness(3);
  layout.width(null).height(null).spacing(null).nodeThickness(null);
  assert.deepEqual([layout.width(), layout.height(), layout.spacing(), layout.nodeThickness()], [960, 600, 20, 0]);
  assert.throws(() => make().categorySort(true), TypeError);
});
