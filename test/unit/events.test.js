import assert from "node:assert/strict";
import {test} from "node:test";
import parsets from "../../src/index.js";

test("event accessors retrieve listeners without changing them", () => {
  const chart = parsets();
  const categories = () => {};
  const dimensions = () => {};
  assert.equal(chart.on("sortCategories.test", categories), chart);
  assert.equal(chart.on("sortDimensions.test", dimensions), chart);
  assert.equal(chart.on("sortCategories.test"), categories);
  assert.equal(chart.on("sortCategories.test"), categories);
  assert.equal(chart.on("sortDimensions.test"), dimensions);
  assert.equal(chart.on("sortCategories.missing"), undefined);
  assert.equal(chart.on("sortCategories.test", null), chart);
  assert.equal(chart.on("sortCategories.test"), undefined);
  assert.equal(chart.on("sortDimensions.test"), dimensions);
  chart.on(".test", null);
  assert.equal(chart.on("sortDimensions.test"), undefined);
});
