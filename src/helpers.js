function autoDimensions(d) {
  return d.length ? Object.keys(d[0]).sort() : [];
}

function cancelEvent(event) {
  event.stopPropagation();
  event.preventDefault();
}

function dimensionName(d) {
  return d.name;
}

function functor(value) {
  return typeof value === "function" ? value : () => value;
}

function getTotal(dimensions) {
  return dimensions.length ? dimensions[0].categories.reduce((a, d) => a + d.count, 0) : 0;
}

function finite(value, name) {
  value = +value;
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite`);
  return value;
}

function orientation(value) {
  if (value !== "vertical" && value !== "horizontal") {
    throw new RangeError("orientation must be \"vertical\" or \"horizontal\"");
  }
  return value;
}

function nonnegative(value, name) {
  value = +value;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be finite and non-negative`);
  }
  return value;
}

// Whether the user prefers reduced motion, checked when it matters, since it
// can change while a chart is shown.
function stillness() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Starts a transition with the given timing. With none, which reduced motion
 * or a zero duration gives, it applies the changes at once instead: a
 * zero-length transition would apply them a frame later. Only the
 * transition methods the chart uses, attr and tween, are needed then.
 * @param {*} selection
 * @param {{delay: number, duration: number, ease?: Function}} timing
 * @param {string} [name]
 */
function transitionSelection(selection, timing, name) {
  if (!timing.delay && !timing.duration) {
    selection.interrupt(name);
    return {
      attr(attribute, value) {
        selection.attr(attribute, value);
        return this;
      },
      // Tweens are told the change is immediate, to draw it at once.
      tween(_name, factory) {
        selection.each(function(...args) { factory.apply(this, args)(1, true); });
        return this;
      }
    };
  }
  const t = selection.transition(name).delay(timing.delay).duration(timing.duration);
  return timing.ease ? t.ease(timing.ease) : t;
}

/**
 * The dimensions accessor for a setting: a string is a single name, and other
 * iterables are copied, as they may be read once.
 * @param {*} value
 */
function dimensionsOption(value) {
  if (typeof value === "function") return value;
  return functor(typeof value === "string" ? [value] : Array.from(value));
}

export {
  autoDimensions,
  cancelEvent,
  dimensionName,
  dimensionsOption,
  finite,
  functor,
  getTotal,
  nonnegative,
  orientation,
  stillness,
  transitionSelection
};
