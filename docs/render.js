// Example SVG renderer for parsetsLayout(). This file is NOT part of the
// published package — it is one way (of many possible) to turn the pure
// {dimensions, links} geometry into an interactive chart with d3-selection
// and d3-drag. All styling is applied here with D3 (.attr/.style), no CSS.
// State the layout function deliberately does not keep (current order,
// previous render for animation) lives here instead.
import * as d3 from "https://esm.sh/d3@7";
import { parsetsLayout } from "../src/index.js";

export function renderParsets(svg, data, options = {}) {
  const width = options.width ?? 960;
  const height = options.height ?? 600;
  const spacing = options.spacing ?? 20;
  const duration = options.duration ?? 500;
  const value = options.value ?? ((d) => 1);
  const tooltip = options.tooltip ?? defaultTooltip;
  const categoryTooltip = options.categoryTooltip ?? defaultCategoryTooltip;
  // 1 = straight-sided ribbons (the default); lower values curve the two
  // edges into an S-shape, like sankey's links — just rotated 90°, since
  // our flow runs top-to-bottom instead of left-to-right. Ignored when
  // linkStyle is "line".
  const tension = options.tension ?? 1;
  // "ribbon" (default): a filled two-edge shape, per `tension` above.
  // "line": a single stroked centerline (d3.linkVertical()'s fixed bump
  // curve) with stroke-width equal to the flow's width — this is the case
  // linkVertical actually fits, since it draws one line, not a filled shape.
  const linkStyle = options.linkStyle ?? "ribbon";
  const lineLink = d3
    .linkVertical()
    .x((p) => p.category.x + p.x + p.dx / 2)
    .y((p) => p.y);

  // Headroom for the first dimension's header text. A rendering concern,
  // not a layout one: we ask the layout for a slightly shorter band and
  // shift everything down, instead of baking a pixel constant into
  // parsetsLayout()'s geometry.
  const headerMargin = 45;

  let order = options.dimensions ?? autoDimensions(data);
  const categoryOrders = new Map(); // dimensionName -> string[] | undefined
  let current = { dimensions: [], links: [] };
  let dragging = false;

  const layout = parsetsLayout()
    .width(width)
    .height(height - headerMargin)
    .spacing(spacing)
    .value(value)
    .categorySort((name) => {
      const explicit = categoryOrders.get(name);
      return (
        explicit &&
        ((a, b) => explicit.indexOf(a.name) - explicit.indexOf(b.name))
      );
    });
  if (options.nodeThickness != null)
    layout.nodeThickness(options.nodeThickness);
  // Read back rather than keep our own copy: the bar we draw and the gap
  // parsetsLayout() leaves for it must always be the same number.
  const nodeThickness = layout.nodeThickness();

  const color = d3.scaleOrdinal(d3.schemeCategory10);

  svg.attr("width", width).attr("height", height).style("display", "block");

  const tip = d3
    .select(document.body)
    .append("div")
    .style("display", "none")
    .style("position", "absolute")
    .style("background", "rgba(255,255,255,.95)")
    .style("border", "1px solid #ccc")
    .style("border-radius", "3px")
    .style("padding", "4px 8px")
    .style("font", "12px sans-serif")
    .style("pointer-events", "none");

  const root = svg
    .append("g")
    .attr("transform", `translate(0,${headerMargin})`);
  const gRibbon = root.append("g");
  const gRibbonMouse = root.append("g");
  const gDimension = root.append("g");

  render();

  function render() {
    current = layout.dimensions(order)(data);
    for (const dimension of current.dimensions) {
      for (const category of dimension.categories)
        category.dimensionName = dimension.name;
    }
    drawRibbons();
    drawDimensions();
  }

  function drawRibbons() {
    const ribbon = gRibbon.selectAll("path").data(current.links, (d) => d.path);
    ribbon.exit().remove();
    const ribbonEnter = ribbon.enter().append("path");
    if (linkStyle === "line") {
      ribbonEnter.attr("fill", "none");
      ribbonEnter
        .merge(ribbon)
        .attr("stroke", (d) => color(d.rootCategory))
        .attr("stroke-opacity", 0.5)
        .attr("stroke-width", (d) => d.source.dx)
        .attr("d", lineLink);
    } else {
      ribbonEnter.attr("stroke", "none");
      ribbonEnter
        .merge(ribbon)
        .attr("fill", (d) => color(d.rootCategory))
        .attr("fill-opacity", 0.5)
        .attr("d", ribbonPath);
    }

    // A second, fully transparent copy of every ribbon: a wider, simpler
    // hit target than the visible (semi-transparent, overlapping) paths,
    // kept in its own layer so re-sorting it for hover doesn't disturb the
    // visible stacking order. Painted-but-transparent (opacity: 0), not
    // display:none, so it still receives pointer events.
    const mouse = gRibbonMouse
      .selectAll("path")
      .data(current.links, (d) => d.path);
    mouse.exit().remove();
    const mouseEnter = mouse
      .enter()
      .append("path")
      .on("mousemove", (event, d) => {
        if (dragging) return;
        highlight(d.path);
        showTooltip(event, tooltip(d));
      })
      .on("mouseleave", unhighlight);
    if (linkStyle === "line") {
      mouseEnter
        .attr("fill", "none")
        .attr("stroke", "#000")
        .attr("stroke-opacity", 0);
      mouseEnter
        .merge(mouse)
        // A minimum width so even very thin flows stay easy to hover.
        .attr("stroke-width", (d) => Math.max(d.source.dx, 6))
        .attr("d", lineLink)
        .sort((a, b) => b.count - a.count);
    } else {
      mouseEnter
        .attr("stroke", "none")
        .attr("fill", "#000")
        .attr("fill-opacity", 0);
      mouseEnter
        .merge(mouse)
        .attr("d", ribbonPath)
        // Smaller flows on top, so they stay hoverable under bigger ones.
        .sort((a, b) => b.count - a.count);
    }
  }

  function highlight(path) {
    const attr = linkStyle === "line" ? "stroke-opacity" : "fill-opacity";
    gRibbon.selectAll("path").attr(attr, (d) => (d.path === path ? 0.85 : 0.5));
  }

  function unhighlight() {
    if (dragging) return;
    const attr = linkStyle === "line" ? "stroke-opacity" : "fill-opacity";
    gRibbon.selectAll("path").attr(attr, 0.5);
    hideTooltip();
  }

  function drawDimensions() {
    const dimension = gDimension
      .selectAll("g.dimension")
      .data(current.dimensions, (d) => d.name);
    dimension.exit().remove();

    const dEnter = dimension
      .enter()
      .append("g")
      .attr("class", "dimension")
      .style("cursor", "ns-resize")
      .attr("transform", (d) => `translate(0,${d.y})`);

    dEnter
      .append("rect") // invisible ns-resize hit target for the whole header band
      .attr("class", "hit")
      .attr("y", -45)
      .attr("width", width)
      .attr("height", 45)
      .attr("fill", "#fff")
      .attr("fill-opacity", 0);

    const textEnter = dEnter
      .append("text")
      .attr("transform", "translate(0,-25)");
    textEnter
      .append("tspan")
      .attr("class", "name")
      .attr("font-size", "1.4em")
      .attr("font-weight", "bold")
      .attr("fill", "#333");
    textEnter
      .append("tspan")
      .attr("class", "sort-alpha")
      .attr("dx", "2em")
      .attr("font-size", ".8em")
      .attr("fill", "#000")
      .attr("cursor", "pointer")
      .attr("opacity", 0)
      .text("alpha »");
    textEnter
      .append("tspan")
      .attr("class", "sort-size")
      .attr("dx", "2em")
      .attr("font-size", ".8em")
      .attr("fill", "#000")
      .attr("cursor", "pointer")
      .attr("opacity", 0)
      .text("size »");

    const dMerged = dEnter.merge(dimension);
    dMerged
      .on("mouseenter", function () {
        d3.select(this).select("rect.hit").attr("fill-opacity", 0.12);
        d3.select(this)
          .selectAll("tspan.sort-alpha, tspan.sort-size")
          .attr("opacity", 1);
      })
      .on("mouseleave", function () {
        d3.select(this).select("rect.hit").attr("fill-opacity", 0);
        d3.select(this)
          .selectAll("tspan.sort-alpha, tspan.sort-size")
          .attr("opacity", 0);
      });
    dMerged.select("tspan.name").text((d) => d.name);
    dMerged
      .transition()
      .duration(duration)
      .attr("transform", (d) => `translate(0,${d.y})`);
    dMerged.call(dimensionDrag());
    dMerged
      .select("tspan.sort-alpha")
      .on("click", (event, d) =>
        sortCategories(d.name, (a, b) => (a.name < b.name ? -1 : 1)),
      );
    dMerged
      .select("tspan.sort-size")
      .on("click", (event, d) =>
        sortCategories(d.name, (a, b) => b.count - a.count),
      );

    drawCategories(dMerged);
  }

  function sortCategories(dimensionName, comparator) {
    const dimension = current.dimensions.find((d) => d.name === dimensionName);
    const names = [...dimension.categories].sort(comparator).map((c) => c.name);
    categoryOrders.set(dimensionName, names);
    render();
  }

  function drawCategories(dimensionSelection) {
    const category = dimensionSelection.selectAll("g.category").data(
      (d) => d.categories,
      (d) => d.name,
    );
    category.exit().remove();

    // The bar is centered on the dimension's y: incoming links attach to
    // its top edge, outgoing links to its bottom edge (parsetsLayout()
    // already leaves exactly nodeThickness of room for it). The hit/label
    // band extends upward from the bar's top edge for the text and hover.
    const labelBand = 20;
    const halfThickness = nodeThickness / 2;
    const cEnter = category
      .enter()
      .append("g")
      .attr("class", "category")
      .style("cursor", "ew-resize")
      .attr("transform", (d) => `translate(${d.x})`);
    cEnter
      .append("rect")
      .attr("class", "hit")
      .attr("y", -labelBand - halfThickness)
      .attr("height", labelBand + nodeThickness)
      .attr("fill", "#fff")
      .attr("fill-opacity", 0);
    cEnter
      .append("rect")
      .attr("class", "bar")
      .attr("y", -halfThickness)
      .attr("height", nodeThickness);
    cEnter
      .append("text")
      .attr("dy", -halfThickness - 6)
      .attr("font-size", ".8em");

    const cMerged = cEnter.merge(category);
    cMerged
      .on("mouseenter", function () {
        d3.select(this).select("rect.hit").attr("fill-opacity", 0.2);
      })
      .on("mouseleave", function () {
        d3.select(this).select("rect.hit").attr("fill-opacity", 0);
      });
    cMerged
      .transition()
      .duration(duration)
      .attr("transform", (d) => `translate(${d.x})`);
    cMerged.select("rect.hit").attr("width", (d) => d.dx);
    cMerged
      .select("rect.bar")
      .attr("width", (d) => d.dx)
      .attr("fill", (d) =>
        d.dimensionName === current.dimensions[0].name ? color(d.name) : "#ccc",
      );
    cMerged.select("text").text((d) => d.name);
    cMerged
      .on("mousemove", (event, d) => {
        if (dragging) return;
        showTooltip(event, categoryTooltip(d));
      })
      .on("mouseleave", unhighlight)
      .call(categoryDrag());
  }

  function dimensionDrag() {
    let dragOrder;
    return d3
      .drag()
      .on("start", () => {
        dragging = true;
        dragOrder = [...order];
      })
      .on("drag", function (event, d) {
        const y = Math.max(0, Math.min(height, event.y));
        const n = dragOrder.length;
        const slot = n > 1 ? Math.round((y / height) * (n - 1)) : 0;
        const from = dragOrder.indexOf(d.name);
        if (slot !== from) {
          dragOrder.splice(from, 1);
          dragOrder.splice(slot, 0, d.name);
          order = dragOrder;
          render();
        } else {
          d3.select(this).attr("transform", `translate(0,${y})`);
        }
      })
      .on("end", () => {
        dragging = false;
        render();
      });
  }

  function categoryDrag() {
    return d3
      .drag()
      .on("start", () => {
        dragging = true;
      })
      .on("drag", function (event, d) {
        const x = Math.max(0, Math.min(width, event.x));
        const dimension = current.dimensions.find(
          (dm) => dm.name === d.dimensionName,
        );
        const categories = dimension.categories;
        const i = categories.findIndex((c) => c.name === d.name);
        let swapWith = -1;
        if (i > 0 && x < categories[i - 1].x + categories[i - 1].dx / 2)
          swapWith = i - 1;
        else if (
          i < categories.length - 1 &&
          x > categories[i + 1].x + categories[i + 1].dx / 2
        )
          swapWith = i + 1;
        if (swapWith >= 0) {
          const names = categories.map((c) => c.name);
          [names[i], names[swapWith]] = [names[swapWith], names[i]];
          categoryOrders.set(d.dimensionName, names);
          render();
        } else {
          d3.select(this).attr("transform", `translate(${x})`);
        }
      })
      .on("end", () => {
        dragging = false;
        render();
      });
  }

  function ribbonPath(d) {
    const s = d.source,
      t = d.target;
    const sx = s.category.x + s.x,
      sy = s.y;
    const tx = t.category.x + t.x,
      ty = t.y;
    if (tension >= 1) {
      return `M${sx},${sy}L${tx},${ty}h${t.dx}L${sx + s.dx},${sy}Z`;
    }
    const m0 = tension * sy + (1 - tension) * ty;
    const m1 = tension * ty + (1 - tension) * sy;
    return `M${sx},${sy}C${sx},${m0} ${tx},${m1} ${tx},${ty}h${t.dx}C${tx + t.dx},${m1} ${sx + s.dx},${m0} ${sx + s.dx},${sy}Z`;
  }

  function showTooltip(event, html) {
    tip
      .style("display", null)
      .style("left", `${event.pageX + 16}px`)
      .style("top", `${event.pageY - 16}px`)
      .html(html);
  }

  function hideTooltip() {
    tip.style("display", "none");
  }

  return {
    rerender(newData) {
      data = newData;
      render();
    },
  };
}

function autoDimensions(data) {
  return data.length
    ? Object.keys(data[0])
        .filter((k) => k !== "count")
        .sort()
    : [];
}

function format(n) {
  return d3.format(",")(n);
}

function defaultTooltip(d) {
  return `${d.path.split("\0").join(" → ")}<br>${format(d.count)}`;
}

function defaultCategoryTooltip(d) {
  return `${d.name}<br>${format(d.count)}`;
}
