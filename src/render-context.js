/**
 * The settings of a chart, as src/settings.js defines them.
 * @typedef {Object} Settings
 * @property {Function} dimensions the dimensions accessor
 * @property {Function} value the value accessor
 * @property {number} width
 * @property {number} height
 * @property {number} spacing
 * @property {number} nodeThickness
 * @property {"vertical"|"horizontal"} orientation
 * @property {number} tension
 * @property {number} duration
 * @property {Function} dimensionFormat
 * @property {Function} categoryFormat
 * @property {Function} tooltip
 * @property {Function} categoryTooltip
 * @property {Function} categorySortKey
 * @property {Function|null} categorySort
 * @property {Function|null} color
 */

/**
 * @typedef {Object} RenderExtras
 * @property {*} dispatcher
 * @property {*} ease the easing of interactions
 * @property {boolean} [instant] whether to draw without animating
 * @property {Function} owner
 */

/** @typedef {Settings & RenderExtras} RenderOptions */

/**
 * @typedef {Object} Timing
 * @property {number} delay
 * @property {number} duration
 * @property {Function} [ease]
 */

/**
 * @typedef {Object} RenderState
 * @property {*} g
 * @property {*} plot the oriented group holding the dimensions and ribbons
 * @property {*} data
 * @property {Map<string, Map<string, number>>} colours
 * @property {number} dragging the number of drags in progress
 * @property {*} redraw the pending redraw of the ribbons, if any
 * @property {Set<*>|null} dirty the ribbons to redraw, or null for all
 * @property {Map<*, Element>} paths each ribbon's path element
 * @property {boolean} active
 * @property {string[]} dimensionNames
 * @property {string[][]} categoryOrders each dimension's categories, in the order a render shows them
 * @property {{dimensions: Map<string, string>, categories: Map<string, Map<string, string>>}} labels formatted labels
 * @property {Map<string, *>|null} fills each first-dimension category's colour, from the color callback
 * @property {Map<string, {type: string, order: number}>} marks the sort marks a render shows
 * @property {Array<Object>} dimensions
 * @property {{children: Object, count: number}} tree
 * @property {Array<Object>|undefined} nodes
 * @property {number|undefined} total
 * @property {*|undefined} ribbon
 * @property {*} [categoryDrag] the render's category drag behaviour
 * @property {boolean} lit whether any ribbon may be highlighted
 * @property {*} highlighted the hovered ribbon's node or category
 * @property {Set<Element>} raised ribbons that highlighting moved out of the stacking order
 * @property {number} currentTension0
 * @property {Timing} timing the render's animation timing
 * @property {Function} valueAccessor
 * @property {boolean} horizontal
 * @property {number} length the extent of the category axis
 * @property {(d: any) => string} ribbonPath
 * @property {(d: any) => string} ribbonPathStatic
 * @property {(key: *, content: () => *, event: Event) => void} showTooltip
 * @property {() => void} hideTooltip
 * @property {() => void} unhighlight
 */

/**
 * A render's state: the chart's options, and what the render derives, which
 * replaces the dimensions accessor with the dimensions themselves.
 * @typedef {Omit<RenderOptions, "dimensions"> & RenderState} RenderContext
 */

export {};
