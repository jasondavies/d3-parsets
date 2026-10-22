// Compiles the declarations against typical usage. Each line after an
// expect-error directive must fail to type-check.
import parsets, {parsetsLayout, tree, type ParsetsCategory, type RibbonNode} from "d3-parsets";
import layout from "d3-parsets/layout";

interface Passenger {
  Class: string;
  Survived: string;
  Number: string;
}

const chart = parsets<Passenger>()
  .dimensions(["Class", "Survived"])
  .value(d => +d.Number)
  .width(960)
  .height(600)
  .orientation("horizontal")
  .categoryFormat((name, i, dimension) => `${dimension}: ${name} (${i})`)
  .tooltip((node: RibbonNode) => `${node.path} ${node.count}`)
  .categoryTooltip((category: ParsetsCategory) => `${category.name} of ${category.dimension.name}`)
  .categorySort(dimension => dimension === "Class" ? (a, b) => b.count - a.count : null)
  .color((name, i) => i < 10 ? null : "#999")
  .on("sortDimensions.app", function(order) {
    const element: Element = this;
    chart.dimensions(order);
    return element;
  })
  .on("sortCategories", (dimension, order) => console.log(dimension, order.join()));

const width: number = chart.width();
const orientation: "vertical" | "horizontal" = chart.orientation();
const listener = chart.on("sortCategories");
listener?.call(document.body, "Class", ["First", "Second"]);
chart.dimensions((data, i) => new Set(Object.keys(data[i])));
chart.tooltip(null).categoryTooltip(null).categorySortKey(null).color(null).categorySort(null);
chart.value(null).orientation(null);

// The chart can be called on anything with each(), such as a selection.
chart({each(callback) { callback.call(document.body, [], 0, []); }});
const svg: SVGSVGElement = chart.render([], "#chart");
chart.render([], {node: () => document.body});

const root = tree<Passenger>({children: {}}, [], ["Class"], d => +d.Number);
const total: number = root.count;
const child = root.children["First"];
const parentCount: number = child.parent.count;
// @ts-expect-error tree node names are raw values from the data
child.name.toUpperCase();
const same: typeof tree = parsets.tree;

const vertical = parsetsLayout<Passenger>().dimensions(["Class", "Survived"])([]);
const y: number = vertical.dimensions[0].y;
const x: number = vertical.dimensions[0].categories[0].x + vertical.links[0].source.dx;

const horizontal = layout<Passenger>().orientation("horizontal").width(960)([]);
const columnX: number = horizontal.dimensions[0].x;
const top: number = horizontal.dimensions[0].categories[0].y + horizontal.links[0].target.dy;

// Iterables work at every data entry point; callbacks still receive arrays.
const passengers = new Set<Passenger>();
function* passengerRows() { yield* passengers; }
chart.render(passengers);
chart.render(passengerRows());
chart({each(callback) { callback.call(document.body, passengers, 0, []); }});
chart({each(callback) { callback.call(document.body, passengerRows(), 0, []); }});
parsetsLayout<Passenger>()(passengers);
layout<Passenger>()(passengerRows());
tree({children: {}}, passengers, ["Class"], d => +d.Number);
tree({children: {}}, passengerRows(), ["Class"], d => +d.Number);

const reset = layout<Passenger>().orientation("horizontal").value(null).orientation(null);
const resetOrientation: "vertical" = reset.orientation();
const resetY: number = reset(passengers).dimensions[0].y;
// @ts-expect-error resetting orientation restores vertical geometry
reset(passengers).dimensions[0].x;

// An orientation chosen at runtime gives one geometry or the other, not both.
const dynamic = layout<Passenger>().orientation(orientation)(passengers);
const dimension = dynamic.dimensions[0];
// @ts-expect-error a vertical dimension has no x
dimension.x.toFixed();
// @ts-expect-error a horizontal dimension has no y
dimension.y.toFixed();
if ("x" in dimension) {
  dimension.x.toFixed();
  dimension.categories[0].dy.toFixed();
} else {
  dimension.y.toFixed();
  dimension.categories[0].dx.toFixed();
}
const category = dynamic.dimensions[0].categories[0];
// @ts-expect-error a vertical category has no dy
category.dy.toFixed();
// @ts-expect-error a horizontal category has no dx
category.dx.toFixed();
const endpoint = dynamic.links[0].source;
// @ts-expect-error a horizontal endpoint has no dx
endpoint.dx.toFixed();
if ("dx" in endpoint) endpoint.category.dx.toFixed();
else endpoint.category.dy.toFixed();

const maybeReset = layout().orientation(Math.random() < 0.5 ? "horizontal" : null)([]);
// @ts-expect-error null may have reset the layout to vertical
maybeReset.dimensions[0].x.toFixed();

// @ts-expect-error orientations are "vertical" or "horizontal"
chart.orientation("diagonal");
// @ts-expect-error a horizontal layout has no category x
horizontal.dimensions[0].categories[0].x;
// @ts-expect-error sortDimensions listeners receive dimension names
chart.on("sortDimensions", (order: number[]) => order);
// @ts-expect-error there is no such event
chart.on("resize", () => {});
// @ts-expect-error value accessors return numbers
chart.value(d => d.Class);

export {width, orientation, svg, total, parentCount, same, y, x, columnX, top, resetOrientation, resetY};
