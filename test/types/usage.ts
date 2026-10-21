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

export {width, orientation, svg, total, parentCount, same, y, x, columnX, top};
