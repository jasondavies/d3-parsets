import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {parsetsLayout} from "../src/index.js";

const titanic = JSON.parse(readFileSync(fileURLToPath(new URL("./data/titanic.json", import.meta.url))));
const total = titanic.reduce((a, d) => a + d.count, 0);

function sumCounts(categories) {
  return categories.reduce((a, c) => a + c.count, 0);
}

describe("parsetsLayout()", () => {
  it("computes one entry per configured dimension, in order", () => {
    const {dimensions} = parsetsLayout()
        .dimensions(["Class", "Sex", "Survived"])
        .value(d => d.count)(titanic);
    assert.deepEqual(dimensions.map(d => d.name), ["Class", "Sex", "Survived"]);
  });

  it("collects every category per dimension with its aggregate count", () => {
    const {dimensions} = parsetsLayout()
        .dimensions(["Class", "Sex", "Survived"])
        .value(d => d.count)(titanic);
    assert.deepEqual(dimensions[0].categories.map(c => c.name).sort(), ["1st", "2nd", "3rd", "Crew"].sort());
    assert.deepEqual(dimensions[1].categories.map(c => c.name).sort(), ["Female", "Male"]);
    assert.deepEqual(dimensions[2].categories.map(c => c.name).sort(), ["No", "Yes"]);
    for (const dimension of dimensions) {
      assert.equal(sumCounts(dimension.categories), total);
    }
  });

  it("stacks categories left to right proportional to count, spanning [0, width]", () => {
    const width = 960, spacing = 20;
    const {dimensions} = parsetsLayout()
        .width(width)
        .spacing(spacing)
        .dimensions(["Class", "Sex", "Survived"])
        .value(d => d.count)(titanic);
    for (const dimension of dimensions) {
      const first = dimension.categories[0];
      const last = dimension.categories[dimension.categories.length - 1];
      assert.equal(first.x, 0);
      assert.ok(Math.abs(last.x + last.dx - width) < 1e-6);
    }
  });

  it("produces one link per edge between adjacent-dimension categories", () => {
    const {links} = parsetsLayout()
        .dimensions(["Class", "Sex", "Survived"])
        .value(d => d.count)(titanic);
    // Class -> Sex (8 non-empty combinations) + Sex -> Survived (16 non-empty combinations).
    assert.equal(links.length, 8 + 16);
    const leafLinks = links.filter(l => l.target.dimension.name === "Survived");
    assert.equal(leafLinks.reduce((a, l) => a + l.count, 0), total);
  });

  it("is stateless: identical input always yields identical output", () => {
    const layout = parsetsLayout().dimensions(["Class", "Sex", "Survived"]).value(d => d.count);
    assert.deepEqual(layout(titanic), layout(titanic));
  });

  it("reorders dimensions purely from the .dimensions() argument", () => {
    const {dimensions} = parsetsLayout()
        .dimensions(["Sex", "Class", "Survived"])
        .value(d => d.count)(titanic);
    assert.deepEqual(dimensions.map(d => d.name), ["Sex", "Class", "Survived"]);
  });

  it("sorts each dimension's categories independently via .categorySort()", () => {
    const explicitOrder = {Class: ["Crew", "3rd", "2nd", "1st"]};
    const {dimensions} = parsetsLayout()
        .dimensions(["Class", "Sex"])
        .value(d => d.count)
        .categorySort(name => {
          const order = explicitOrder[name];
          return order && ((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
        })(titanic);
    assert.deepEqual(dimensions[0].categories.map(c => c.name), ["Crew", "3rd", "2nd", "1st"]);
    // Sex has no explicit order configured: falls back to first-encountered order.
    assert.deepEqual(dimensions[1].categories.map(c => c.name).sort(), ["Female", "Male"]);
  });

  it("defaults to counting one per row when no .value() is set", () => {
    const rows = [
      {Group: "A"}, {Group: "A"}, {Group: "B"}
    ];
    const {dimensions} = parsetsLayout().dimensions(["Group"])(rows);
    const byName = Object.fromEntries(dimensions[0].categories.map(c => [c.name, c.count]));
    assert.deepEqual(byName, {A: 2, B: 1});
  });

  it("auto-detects dimensions from the first row when .dimensions() is unset", () => {
    const rows = [{B: "x", A: "y"}];
    const {dimensions} = parsetsLayout()(rows);
    assert.deepEqual(dimensions.map(d => d.name), ["A", "B"]);
  });

  it("keeps every dimension's node bar within [0, height], nodeThickness included", () => {
    const height = 600, nodeThickness = 10;
    const {dimensions} = parsetsLayout()
        .height(height)
        .nodeThickness(nodeThickness)
        .dimensions(["Class", "Sex", "Survived"])
        .value(d => d.count)(titanic);
    const first = dimensions[0], last = dimensions[dimensions.length - 1];
    assert.equal(first.y - nodeThickness / 2, 0);
    assert.equal(last.y + nodeThickness / 2, height);
  });

  it("attaches links to the outer edges of the node bar, leaving a nodeThickness gap", () => {
    const nodeThickness = 10;
    const {dimensions, links} = parsetsLayout()
        .height(600)
        .nodeThickness(nodeThickness)
        .dimensions(["Class", "Sex", "Survived"])
        .value(d => d.count)(titanic);
    const [classDim, sexDim] = dimensions;
    const link = links.find(l => l.source.dimension === classDim && l.target.dimension === sexDim);
    assert.equal(link.source.y, classDim.y + nodeThickness / 2);
    assert.equal(link.target.y, sexDim.y - nodeThickness / 2);
    assert.ok(link.target.y - link.source.y > 0); // downstream dimension sits below, with the gap in between
  });
});
