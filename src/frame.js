// The chart is laid out in its own coordinates, with x along each dimension's
// categories and y across the dimensions. A vertical chart draws them as they
// are. A horizontal chart transposes them, below room for the dimension
// headers, so layout, ribbon paths and dragging work unchanged.

// Room above the dimensions of a vertical chart for their headers, and the
// category labels below them.
const header = 45;

// Room after the last dimension, to keep its line inside the chart.
const inset = 2;

// Room before the first column of a horizontal chart for its labels.
const labelBand = 20;

// Room above the columns of a horizontal chart for their headers, which sit
// just above the columns, and how far above.
const columnHeader = 30;
const columnHeaderOffset = 6;

function transposed(x, y) {
  return `matrix(0,1,1,0,${x},${y})`;
}

// The transform of the group holding the chart's dimensions and ribbons.
function frameTransform(horizontal) {
  return horizontal ? transposed(0, columnHeader) : null;
}

// Where a point in the chart's coordinates is drawn.
function framePoint(horizontal, [x, y]) {
  return horizontal ? [y, x + columnHeader] : [x, y];
}

// Turns text in a transposed group upright, offset by (x, y) on screen.
function upright(x, y) {
  return transposed(y, x);
}

export { columnHeader, columnHeaderOffset, framePoint, frameTransform, header, inset, labelBand, transposed, upright };
