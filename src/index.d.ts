// Type declarations for d3-parsets.

/** A row of input data: an object keyed by dimension name. */
export type Row = Record<string, unknown>;

/** Anything the chart can be called on: a D3 selection or transition. */
export interface ParsetsSelection<Data> {
  each(callback: (this: Element, data: Data, index: number, groups: any) => void): unknown;
}

/** A node of the aggregated tree; see {@link tree}. */
export interface TreeNode {
  /** The category, as it appears in the data: not necessarily a string. */
  name: unknown;
  /** The total weight of the rows below this node. */
  count: number;
  /** The name of the node's dimension. */
  dimension: string;
  parent: TreeNode | TreeRoot;
  /** Child nodes keyed by category name, or null at the last dimension. */
  children: Record<string, TreeNode> | null;
}

export interface TreeRoot {
  count: number;
  children: Record<string, TreeNode>;
}

/** A ribbon's tree node, as passed to a ribbon tooltip. */
export interface RibbonNode extends TreeNode {
  /** The category names along the ribbon's path, joined with "\0". */
  path: string;
}

export interface ParsetsDimension {
  name: string;
  /** The dimension's total weight. */
  count: number;
  /** Its position across the dimension axis. */
  y: number;
  categories: ParsetsCategory[];
}

export interface ParsetsCategory {
  name: string;
  count: number;
  dimension: ParsetsDimension;
  /** Its position along the dimension. */
  x: number;
  /** Its size along the dimension. */
  dx: number;
}

export type Orientation = "vertical" | "horizontal";

export interface ParsetsEvents {
  /** Called with the dimension names in their new order. */
  sortDimensions(this: Element, order: string[]): void;
  /** Called with a dimension's name and its category names in their new order. */
  sortCategories(this: Element, dimension: string, order: string[]): void;
}

type EventName = keyof ParsetsEvents;
type Typename<Name extends EventName> = Name | `${Name}.${string}`;

export interface Parsets<Datum = Row> {
  /** Renders the chart into each selected element, using its bound data. */
  (selection: ParsetsSelection<Datum[]>): void;

  dimensions(): (this: Element, data: Datum[], index: number) => Iterable<string>;
  /** Pass null to restore the default, the first row's keys in sorted order. */
  dimensions(dimensions: Iterable<string> | ((this: Element, data: Datum[], index: number) => Iterable<string>) | null): this;

  value(): (datum: Datum, index: number) => number;
  value(value: number | ((datum: Datum, index: number) => number)): this;

  width(): number;
  /** Pass null to restore the default. */
  width(width: number | null): this;

  height(): number;
  /** Pass null to restore the default. */
  height(height: number | null): this;

  spacing(): number;
  /** Pass null to restore the default. */
  spacing(spacing: number | null): this;

  nodeThickness(): number;
  /** Pass null to restore the default. */
  nodeThickness(thickness: number | null): this;

  orientation(): Orientation;
  orientation(orientation: Orientation): this;

  tension(): number;
  /** Pass null to restore the default. */
  tension(tension: number | null): this;

  duration(): number;
  /** Pass null to restore the default. */
  duration(duration: number | null): this;

  dimensionFormat(): (name: string, index: number) => unknown;
  /** Pass null to restore the default, String. */
  dimensionFormat(format: ((name: string, index: number) => unknown) | null): this;

  categoryFormat(): (name: string, index: number, dimension: string) => unknown;
  /** Pass null to restore the default, String. */
  categoryFormat(format: ((name: string, index: number, dimension: string) => unknown) | null): this;

  tooltip(): (this: SVGPathElement, node: RibbonNode) => string | null | undefined;
  /** Pass null to restore the default. A tooltip returning null or "" shows nothing. */
  tooltip(tooltip: ((this: SVGPathElement, node: RibbonNode) => string | null | undefined) | null): this;

  categoryTooltip(): (this: SVGGElement, category: ParsetsCategory) => string | null | undefined;
  /** Pass null to restore the default. A tooltip returning null or "" shows nothing. */
  categoryTooltip(tooltip: ((this: SVGGElement, category: ParsetsCategory) => string | null | undefined) | null): this;

  categorySortKey(): (name: string, category: SortableCategory) => unknown;
  /** Pass null to restore the default, the category name. */
  categorySortKey(key: ((name: string, category: SortableCategory) => unknown) | null): this;

  categorySort(): ((dimension: string) => CategoryComparator | null | undefined | false) | null | undefined;
  categorySort(sort: ((dimension: string) => CategoryComparator | null | undefined | false) | null): this;

  color(): ((name: string, index: number) => string | null | undefined) | null | undefined;
  color(color: ((name: string, index: number) => string | null | undefined) | null): this;

  on<Name extends EventName>(typenames: Typename<Name>): ParsetsEvents[Name] | undefined;
  on<Name extends EventName>(typenames: Typename<Name>, listener: ParsetsEvents[Name] | null): this;

  /**
   * Renders data into a new SVG element and returns it. The element is
   * appended to parent, an element, selector or D3 selection, or is returned
   * detached if parent is omitted.
   */
  render(data: Datum[], parent?: Element | string | {node(): Element | null}): SVGSVGElement;
}

/** What a categorySort comparator receives: categories before they are placed. */
export interface SortableCategory {
  name: string;
  count: number;
}

export type CategoryComparator = (a: SortableCategory, b: SortableCategory) => number;

/**
 * Aggregates data into a tree of counts, with one level for each dimension,
 * and returns root, whose existing counts are reset first.
 */
export function tree<Datum = Row>(
  root: {children: Record<string, unknown>},
  data: Datum[],
  dimensions: string[],
  value: (datum: Datum, index: number) => number
): TreeRoot;

export {default as parsetsLayout} from "./layout-api.js";
export type {
  ParsetsLayout,
  LayoutResult,
  LayoutDimension,
  LayoutCategory,
  LayoutLink,
  LayoutEndpoint
} from "./layout-api.js";

/** Creates a parallel sets chart. */
declare function parsets<Datum = Row>(): Parsets<Datum>;
declare namespace parsets {
  const tree: typeof import("./index.js").tree;
}
export default parsets;
