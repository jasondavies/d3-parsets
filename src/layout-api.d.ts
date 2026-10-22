// Type declarations for d3-parsets/layout.

import type {CategoryComparator, Orientation, Row} from "./index.js";

/** Geometry in screen coordinates, whose names depend on the orientation. */
type Along<O extends Orientation> = O extends "horizontal" ? "y" : "x";
type AlongSize<O extends Orientation> = O extends "horizontal" ? "dy" : "dx";
type Across<O extends Orientation> = O extends "horizontal" ? "x" : "y";

// Distribute the whole geometry over O, rather than combining the coordinate
// keys when the caller's orientation is a union.
export type LayoutDimension<O extends Orientation = "vertical"> = O extends Orientation ? {
  name: string;
  /** The effective bar thickness, after clamping. */
  nodeThickness: number;
  categories: LayoutCategory<O>[];
} & {
  /** The bar's centre. */
  [K in Across<O>]: number;
} : never;

export type LayoutCategory<O extends Orientation = "vertical"> = O extends Orientation ? {
  name: string;
  count: number;
} & {
  /** The category's start. */
  [K in Along<O>]: number;
} & {
  /** The category's size. */
  [K in AlongSize<O>]: number;
} : never;

export type LayoutEndpoint<O extends Orientation = "vertical"> = O extends Orientation ? {
  dimension: LayoutDimension<O>;
  category: LayoutCategory<O>;
} & {
  /** The ribbon's offset within its category. */
  [K in Along<O>]: number;
} & {
  /** The ribbon's width. */
  [K in AlongSize<O>]: number;
} & {
  /** Where the ribbon attaches, including the bar's thickness. */
  [K in Across<O>]: number;
} : never;

export type LayoutLink<O extends Orientation = "vertical"> = O extends Orientation ? {
  /** The category names along the link's path, joined with "\0". */
  path: string;
  count: number;
  /** The link's category in the first dimension. */
  rootCategory: string;
  source: LayoutEndpoint<O>;
  target: LayoutEndpoint<O>;
} : never;

export type LayoutResult<O extends Orientation = "vertical"> = O extends Orientation ? {
  dimensions: LayoutDimension<O>[];
  links: LayoutLink<O>[];
} : never;

export interface ParsetsLayout<Datum = Row, O extends Orientation = "vertical"> {
  /** Computes fresh geometry for data. */
  (data: Iterable<Datum>, ...args: unknown[]): LayoutResult<O>;

  dimensions(): (data: Datum[], ...args: unknown[]) => Iterable<string>;
  dimensions(dimensions: Iterable<string> | ((data: Datum[], ...args: unknown[]) => Iterable<string>) | null): this;

  value(): (datum: Datum, index: number) => number;
  /** Pass null to restore the default weight of one. */
  value(value: number | ((datum: Datum, index: number) => number) | null): this;

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

  categorySort(): ((dimension: string) => CategoryComparator | null | undefined | false) | null | undefined;
  categorySort(sort: ((dimension: string) => CategoryComparator | null | undefined | false) | null | undefined): this;

  orientation(): O;
  /** Pass null to restore vertical orientation. */
  orientation<O2 extends Orientation | null>(orientation: O2): ParsetsLayout<Datum, O2 extends Orientation ? O2 : "vertical">;
}

/** Creates a layout that computes chart geometry without a DOM. */
export default function parsetsLayout<Datum = Row>(): ParsetsLayout<Datum>;
