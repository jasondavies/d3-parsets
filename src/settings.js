import { autoDimensions, dimensionsOption, finite, functor, nonnegative, orientation } from "./helpers.js";
import { defaultCategoryTooltip, defaultTooltip } from "./tooltips.js";

// Every setting of the chart and of the standalone layout, defined once: its
// default, and the check its setter applies to anything but null, which
// restores the default.

const one = () => 1;

function defaultCategorySortKey(key) {
  return key;
}

// A setting that takes a function rejects anything else here, rather than
// partway through a render.
const fn = (value, name) => {
  if (typeof value !== "function") throw new TypeError(`${name} must be a function`);
  return value;
};

const settings = {
  dimensions: {initial: autoDimensions, check: dimensionsOption},
  value: {initial: one, check: value => functor(value)},
  width: {initial: 960, check: nonnegative},
  height: {initial: 600, check: nonnegative},
  spacing: {initial: 20, check: nonnegative},
  nodeThickness: {initial: 0, check: nonnegative},
  orientation: {initial: "vertical", check: orientation},
  tension: {initial: 1, check: finite},
  duration: {initial: 500, check: nonnegative},
  dimensionFormat: {initial: String, check: fn},
  categoryFormat: {initial: String, check: fn},
  tooltip: {initial: defaultTooltip, check: fn},
  categoryTooltip: {initial: defaultCategoryTooltip, check: fn},
  categorySortKey: {initial: defaultCategorySortKey, check: fn},
  categorySort: {initial: null, check: fn},
  color: {initial: null, check: fn}
};

/**
 * Adds a getter/setter for each named setting to target, and returns the
 * object holding their values. A setter returns target, for chaining.
 * @param {*} target
 * @param {string[]} names
 * @returns {Record<string, *>}
 */
function accessors(target, names) {
  const options = {};
  for (const name of names) {
    const {initial, check} = settings[name];
    options[name] = initial;
    target[name] = function(value) {
      if (!arguments.length) return options[name];
      options[name] = value == null ? initial : check(value, name);
      return target;
    };
  }
  return options;
}

export { accessors };
