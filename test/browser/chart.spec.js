import {test, expect} from "@playwright/test";

const errors = new WeakMap();
test.beforeEach(async ({page}) => {
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page).push(error.message));
  await page.goto("/test/browser/fixture.html");
  await page.waitForFunction(() => window.mount);
});
test.afterEach(async ({page}) => {
  expect(errors.get(page)).toEqual([]);
});

async function settled(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("svg, svg *")].every(n => !n.__transition));
}

for (const duration of [0, 150]) {
  test(`dimension crossing keeps the dragged bar and ribbons at the pointer (${duration}ms)`, async ({page}) => {
    await page.evaluate(duration => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(duration).nodeThickness(10)), duration);
    await settled(page);
    const box = await page.locator("tspan.name").first().boundingBox();
    const start = await page.locator("g.dimension").first().evaluate(n => n.transform.baseVal.consolidate().matrix.f);
    const x = box.x + 10, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const delta of [400, 450, -10]) {
      await page.mouse.move(x, y + delta);
      const samples = await page.evaluate(async () => {
        const samples = [];
        for (let i = 0; i < 5; i++) {
          await new Promise(requestAnimationFrame);
          const dimensions = new Map([...document.querySelectorAll("g.dimension")].map(n => [n.__data__, n]));
          const dragged = [...dimensions].find(([d]) => d.name === "A")[1];
          const attachments = [...document.querySelectorAll(".ribbon path")].flatMap(n => {
            const coordinates = n.getAttribute("d").match(/^M([^,]+),([^L]+)L([^,]+),([^h]+)/).slice(1).map(Number);
            return ["source", "target"].map((side, j) => {
              const end = n.__data__[side];
              return {ribbonY: coordinates[j * 2 + 1], barY: dimensions.get(end.dimension).transform.baseVal.consolidate().matrix.f + end.dy};
            });
          });
          samples.push({draggedY: dragged.transform.baseVal.consolidate().matrix.f, attachments});
        }
        return samples;
      });
      for (const sample of samples) {
        expect(sample.draggedY).toBeCloseTo(start + delta, 3);
        for (const end of sample.attachments) expect(end.ribbonY).toBeCloseTo(end.barY, 3);
      }
    }
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(() => [...document.querySelectorAll("g.dimension")]
      .sort((a, b) => a.__data__.y - b.__data__.y).map(n => n.__data__.name))).toEqual(["A", "B", "C"]);
  });
}

for (const detached of [false, true]) {
  test(`render helper fits the chart and its headings (detached ${detached})`, async ({page}) => {
    const result = await page.evaluate(detached => {
      const chart = parsets().dimensions(["A", "B", "C"]).nodeThickness(10).duration(0);
      const svg = chart.render(rows, detached ? undefined : document.body);
      if (detached) document.body.appendChild(svg);
      const viewport = svg.getBoundingClientRect();
      const bounds = [...svg.querySelectorAll("tspan.name, g.category, .ribbon path")].map(n => {
        const box = n.getBoundingClientRect();
        return {top: box.top - viewport.top, bottom: box.bottom - viewport.top};
      });
      return {height: viewport.height, attributeHeight: +svg.getAttribute("height"), bounds,
        headings: [...svg.querySelectorAll("tspan.name")].map(n => n.getBoundingClientRect().top)};
    }, detached);
    expect(result.attributeHeight).toBeGreaterThan(0);
    expect(result.height).toBeCloseTo(result.attributeHeight);
    for (const box of result.bounds) {
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.bottom).toBeLessThanOrEqual(result.height);
    }
    expect(result.headings[0]).toBeLessThan(result.headings[1]);
    expect(result.headings[1]).toBeLessThan(result.headings[2]);
    await settled(page);
    await page.locator(".ribbon-mouse path").first().hover();
    await expect(page.locator(".parsets-tooltip")).toBeVisible();
    await expect(page.locator(".ribbon path.active").first()).toBeAttached();
    await page.mouse.move(1100, 800);
    await expect(page.locator(".parsets-tooltip")).toBeHidden();
    await expect(page.locator(".ribbon path.active")).toHaveCount(0);
  });
}

test("one chart instance preserves each element's displayed tension", async ({page}) => {
  await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0));
    chart.render(rows, document.body).id = "second";
  });
  await settled(page);
  await page.evaluate(() => svg.call(chart.tension(0.5)));
  await settled(page);
  const paths = await page.evaluate(async () => {
    const {selectAll} = await import("/node_modules/d3-selection/src/index.js");
    const roots = [svg.node(), document.querySelector("#second > g")];
    const snapshot = () => roots.map(root => [...root.querySelectorAll(".ribbon path")].map(n => n.getAttribute("d")));
    const before = snapshot();
    selectAll(roots).call(chart.duration(300).tension(0.8));
    return {before, after: snapshot()};
  });
  for (let root = 0; root < 2; root++) {
    for (let i = 0; i < paths.before[root].length; i++) {
      const before = paths.before[root][i], after = paths.after[root][i];
      expect(after.replace(/[-\d.e]+/g, "")).toBe(before.replace(/[-\d.e]+/g, ""));
      const numbers = s => s.match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi).map(Number);
      const expected = numbers(before);
      numbers(after).forEach((n, j) => expect(n).toBeCloseTo(expected[j], 3));
    }
  }
  await settled(page);
  const final = await page.evaluate(() => [...document.querySelectorAll("svg")].map(root => ({
    visible: [...root.querySelectorAll(".ribbon path")].map(n => n.getAttribute("d")),
    hover: [...root.querySelectorAll(".ribbon-mouse path")].map(n => n.getAttribute("d"))
  })));
  for (const paths of final) expect(paths.visible).toEqual(paths.hover);
});

test("rerenders hide stale tooltips, including when the chart becomes empty", async ({page}) => {
  await page.evaluate(() => mount([{A: "old", B: "old"}], c => c.dimensions(["A", "B"]).duration(0)));
  await settled(page);
  await page.locator(".ribbon-mouse path").dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  await expect(page.locator(".parsets-tooltip")).toBeVisible();
  await page.evaluate(() => svg.datum([{A: "new", B: "new"}]).call(chart));
  await expect(page.locator(".parsets-tooltip")).toBeHidden();
  await settled(page);
  await page.locator(".ribbon-mouse path").dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  await expect(page.locator(".parsets-tooltip text")).toContainText("new → new");
  await page.evaluate(() => svg.datum([]).call(chart.dimensions([])));
  await expect(page.locator(".parsets-tooltip")).toBeHidden();
  await expect(page.locator(".ribbon path")).toHaveCount(0);
});

for (const kind of ["category", "dimension"]) {
  for (const empty of [false, true]) {
    test(`rerender during ${kind} drag keeps the replacement data (empty ${empty})`, async ({page}) => {
      await page.evaluate(() => mount([{A: "a", B: "x"}, {A: "b", B: "y"}], c => c.dimensions(["A", "B"]).duration(0)));
      await settled(page);
      const box = await page.locator(kind === "category" ? "g.category > rect" : "tspan.name").first().boundingBox();
      const x = box.x + 10, y = box.y + box.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (kind === "category" ? 20 : 0), y + (kind === "dimension" ? 20 : 0));
      await page.evaluate(empty => svg.datum(empty ? [] : [{A: "newA", B: "newB"}]).call(chart), empty);
      await page.mouse.move(x + (kind === "category" ? 800 : 0), y + (kind === "dimension" ? 650 : 0), {steps: 3});
      await page.mouse.up();
      await settled(page);
      expect(await page.locator("g.category text").allTextContents()).toEqual(empty ? [] : ["newA", "newB"]);
      expect(await page.locator(".ribbon path").evaluateAll(nodes => nodes.map(n => n.__data__.path)))
        .toEqual(empty ? [] : ["newA\0newB"]);
      if (!empty) {
        await page.locator(".ribbon-mouse path").dispatchEvent("mousemove", {clientX: 100, clientY: 100});
        await expect(page.locator(".parsets-tooltip text")).toHaveText("newA → newB1 (100.0%)");
      }
      expect(await page.locator("svg").innerHTML()).not.toMatch(/NaN|Infinity/);
    });
  }

  test(`${kind} drag starts at the displayed position during an animation`, async ({page}) => {
    await page.evaluate(() => mount([{A: "a", B: "x"}, {A: "b", B: "y"}], c => c.dimensions(["A", "B"]).duration(0)));
    await settled(page);
    await page.evaluate(async kind => {
      chart.duration(1000);
      if (kind === "category") chart.categorySort(() => (a, b) => b.name.localeCompare(a.name));
      else chart.height(400);
      svg.call(chart);
      for (let i = 0; i < 8; i++) await new Promise(requestAnimationFrame);
      const node = kind === "category"
        ? [...document.querySelectorAll("g.category")].find(n => n.__data__.name === "a")
        : [...document.querySelectorAll("g.dimension")].find(n => n.__data__.name === "B");
      node.id = "dragged";
      node.addEventListener("mousedown", () => {
        const matrix = node.transform.baseVal.consolidate().matrix;
        window.dragStart = kind === "category" ? matrix.e : matrix.f;
      }, {capture: true, once: true});
    }, kind);
    const box = await page.locator(kind === "category" ? "#dragged > rect" : "#dragged tspan.name").first().boundingBox();
    const x = box.x + 10, y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (const delta of [20, 40, 60]) {
      await page.mouse.move(x + (kind === "category" ? delta : 0), y + (kind === "dimension" ? delta : 0));
      const offset = await page.evaluate(kind => {
        const matrix = document.querySelector("#dragged").transform.baseVal.consolidate().matrix;
        return (kind === "category" ? matrix.e : matrix.f) - window.dragStart;
      }, kind);
      expect(offset).toBeCloseTo(delta, 2);
    }
    await page.mouse.up();
    await settled(page);
  });
}

for (const frames of [0, 5]) {
  for (const duration of [0, 150]) {
    test(`new tension wins over a previous transition (${frames} frames, ${duration}ms)`, async ({page}) => {
      await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
      await settled(page);
      await page.evaluate(async ({frames, duration}) => {
        svg.call(chart.duration(500).tension(0.5));
        for (let i = 0; i < frames; i++) await new Promise(requestAnimationFrame);
        svg.call(chart.duration(duration).tension(1));
      }, {frames, duration});
      await settled(page);
      const paths = await page.evaluate(() => ({
        visible: [...document.querySelectorAll(".ribbon path")].map(n => n.getAttribute("d")),
        hover: [...document.querySelectorAll(".ribbon-mouse path")].map(n => n.getAttribute("d"))
      }));
      expect(paths.visible).toEqual(paths.hover);
      expect(paths.visible.every(d => !d.includes("C"))).toBe(true);
    });
  }
}

test("tension rerenders preserve unrelated root transitions", async ({page}) => {
  await page.addScriptTag({url: "/test/d3.v7.min.js"});
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const completed = await page.evaluate(async () => {
    const root = window.d3.select(svg.node()).attr("data-progress", 0);
    const done = root.transition().duration(300).attr("data-progress", 1).end().then(() => true, () => false);
    svg.call(chart.duration(500).tension(0.5));
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    svg.call(chart.duration(0).tension(1));
    return done;
  });
  expect(completed).toBe(true);
  await expect(page.locator("svg")).toHaveAttribute("data-progress", "1");
  await settled(page);
});

test("tooltip labels preserve comparison signs, literal markup, and falsey category names", async ({page}) => {
  for (const [row, label] of [
    [{A: "<10", B: ">20", C: "ok"}, "<10 → >20 → ok"],
    [{A: "<br>", B: "<b>literal</b>", C: "ok"}, "<br> → <b>literal</b> → ok"],
    [{A: 0, B: false, C: "ok"}, "0 → false → ok"]
  ]) {
    await page.evaluate(row => mount([row], c => c.dimensions(["A", "B", "C"]).duration(0)), row);
    await settled(page);
    await page.locator(".ribbon-mouse path").last().dispatchEvent("mousemove", {clientX: 100, clientY: 400});
    expect(await page.locator(".parsets-tooltip tspan").allTextContents()).toEqual([label, "1 (100.0%)"]);
    await expect(page.locator(".parsets-tooltip b, .parsets-tooltip br")).toHaveCount(0);
  }
});

test("custom ribbon and category tooltips use newlines and display HTML as text", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)
    .tooltip(() => "first\r\n<em>second</em>\nthird")
    .categoryTooltip(() => "<br>\ncategory")));
  await settled(page);
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  expect(await page.locator(".parsets-tooltip tspan").allTextContents()).toEqual(["first", "<em>second</em>", "third"]);
  await page.locator("g.category").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  expect(await page.locator(".parsets-tooltip tspan").allTextContents()).toEqual(["<br>", "category"]);
});

{
  const height = 600;
  test("tooltips follow the pointer and stay inside the chart", async ({page}) => {
    await page.evaluate(height => {
      mount([{A: "a", B: "b"}], c => c.dimensions(["A", "B"]).height(height).duration(0));
      svg.attr("viewBox", "0 -50 960 700").attr("height", 700);
    }, height);
    await settled(page);
    const svgBox = await page.locator("svg").boundingBox();
    const x = svgBox.x + 100, y = svgBox.y + 300;
    await page.mouse.move(x, y);
    await expect(page.locator(".parsets-tooltip")).toBeVisible();
    const tip = await page.locator(".parsets-tooltip rect").boundingBox();
    // Browser bounding boxes include the rectangle's half-pixel border.
    expect(Math.abs(tip.x - (x + 12))).toBeLessThanOrEqual(1);
    expect(Math.abs(tip.y - (y + 12))).toBeLessThanOrEqual(1);

    for (const [x, y] of [[0, 0], [960, height]]) {
      const bounds = await page.evaluate(({x, y}) => {
        const point = new DOMPoint(x, y).matrixTransform(svg.node().getScreenCTM());
        document.querySelector(".ribbon-mouse path").dispatchEvent(new MouseEvent("mousemove", {
          bubbles: true, clientX: point.x, clientY: point.y
        }));
        const tooltip = document.querySelector(".parsets-tooltip");
        const box = tooltip.querySelector("rect").getBBox();
        const transform = tooltip.transform.baseVal.consolidate().matrix;
        return {x: box.x + transform.e, y: box.y + transform.f, width: box.width, height: box.height};
      }, {x, y});
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(960.001);
      expect(bounds.y).toBeGreaterThanOrEqual(0);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(height + 0.001);
      // Where it would not fit after the pointer, it goes before it rather
      // than over it, and over the labels there.
      if (x) {
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(x - 12 + 0.001);
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(y - 12 + 0.001);
      }
    }
  });
}

for (const duration of [0, 150]) {
  test(`replacing dimensions with the same category paths keeps finite ribbons (${duration}ms)`, async ({page}) => {
    await page.evaluate(() => mount([{A: "yes", B: "no"}], c => c.dimensions(["A", "B"]).duration(0)));
    await settled(page);
    await page.evaluate(duration => {
      svg.datum([{C: "yes", D: "no"}]).call(chart.dimensions(["C", "D"]).duration(duration));
    }, duration);
    await settled(page);
    await expect(page.locator(".ribbon path")).toHaveCount(1);
    await expect(page.locator(".ribbon path")).toHaveAttribute("d", "M0,45L0,598h940L940,45Z");
    await page.evaluate(() => svg.call(chart));
    await settled(page);
    await expect(page.locator(".ribbon path")).toHaveAttribute("d", "M0,45L0,598h940L940,45Z");
    await page.locator(".ribbon-mouse path").dispatchEvent("mousemove", {clientX: 100, clientY: 100});
    await expect(page.locator(".parsets-tooltip text")).toContainText("yes → no");
  });
}

for (const update of ["sort", "resize", "interrupted"]) {
  test(`${update} rerenders keep ribbons attached throughout transitions`, async ({page}) => {
    // Each category has one ribbon, so its attachment must equal the bar's
    // displayed left edge; there are no internal offsets to account for.
    await page.evaluate(() => mount([{A: "a", B: "x"}, {A: "b", B: "y"}], c => c.dimensions(["A", "B"]).duration(0)));
    await settled(page);
    const samples = await page.evaluate(async update => {
      function sample() {
        const dimensions = new Map([...document.querySelectorAll("g.dimension")].map(n => [n.__data__, n]));
        const categories = new Map([...document.querySelectorAll("g.category")].map(n => [n.__data__, n]));
        return [...document.querySelectorAll(".ribbon path")].flatMap(path => {
          const coordinates = path.getAttribute("d").match(/^M([^,]+),([^L]+)L([^,]+),([^h]+)/).slice(1).map(Number);
          return ["source", "target"].map((side, i) => {
            const end = path.__data__[side];
            const barX = categories.get(end.node).transform.baseVal.consolidate().matrix.e;
            const barY = dimensions.get(end.dimension).transform.baseVal.consolidate().matrix.f;
            return {barX, barY, ribbonX: coordinates[2 * i], ribbonY: coordinates[2 * i + 1]};
          });
        });
      }
      chart.duration(300);
      if (update !== "resize") chart.categorySort(() => (a, b) => b.name.localeCompare(a.name));
      if (update !== "sort") chart.width(800).height(800);
      svg.call(chart);
      const samples = [sample()];
      for (let i = 0; i < 30; i++) {
        await new Promise(requestAnimationFrame);
        samples.push(sample());
        if (update === "interrupted" && i === 5) {
          svg.call(chart.width(600).height(400).categorySort(() => (a, b) => a.name.localeCompare(b.name)));
          samples.push(sample());
        }
      }
      return samples;
    }, update);
    for (const sample of samples.flat()) {
      expect(sample.ribbonX).toBeCloseTo(sample.barX, 3);
      expect(sample.ribbonY).toBeCloseTo(sample.barY, 3);
    }
    expect(new Set(samples.map(sample => JSON.stringify(sample))).size).toBeGreaterThan(2);
    await settled(page);
  });
}

test("dimension headings update their formatter on existing elements", async ({page}) => {
  await page.evaluate(() => mount());
  await settled(page);
  const result = await page.evaluate(() => {
    const headings = [...document.querySelectorAll("tspan.name")];
    const calls = [];
    svg.call(chart.dimensionFormat((name, i) => {
      calls.push({name, i});
      return `Changed ${name}`;
    }));
    return {calls, reused: headings.every((n, i) => n === document.querySelectorAll("tspan.name")[i])};
  });
  expect(result.reused).toBe(true);
  expect(result.calls).toEqual(["A", "B", "C"].map((name, i) => ({name, i})));
  expect(await page.locator("tspan.name").allTextContents()).toEqual(["Changed A", "Changed B", "Changed C"]);
  await settled(page);
});

test("reading a registered event listener preserves event delivery", async ({page}) => {
  await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0));
    window.sortEvents = 0;
    const listener = () => window.sortEvents++;
    chart.on("sortCategories.test", listener);
    if (chart.on("sortCategories.test") !== listener) throw new Error("Listener getter changed its value");
  });
  await settled(page);
  await page.locator("tspan.sort.key").first().dispatchEvent("click");
  expect(await page.evaluate(() => window.sortEvents)).toBe(1);
  await page.evaluate(() => chart.on("sortCategories.test", null));
  await page.locator("tspan.sort.key").first().dispatchEvent("click");
  expect(await page.evaluate(() => window.sortEvents)).toBe(1);
  await settled(page);
});

test("failed render helpers remove only their own DOM and retain no listeners or timers", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const attempts = await page.evaluate(() => {
    const listeners = () => (window.__on || []).filter(d => d.name.startsWith("parsets.")).length;
    const parent = document.body.appendChild(document.createElement("div"));
    parent.innerHTML = '<span id="keep">Keep me</span>';
    const before = {listeners: listeners(), html: document.body.innerHTML};
    const results = [];
    for (const mountPoint of [undefined, parent]) {
      for (const failure of ["value", "formatter"]) {
        const broken = parsets().dimensions(["A", "B"]);
        const marker = new Error("Formatter failed");
        if (failure === "value") broken.value(-1);
        else broken.categoryFormat(() => {throw marker;});
        let error;
        try {broken.render([{A: "a", B: "b"}], mountPoint);} catch (e) {error = e;}
        results.push({
          threw: failure === "value" ? error instanceof RangeError : error === marker,
          listenersUnchanged: listeners() === before.listeners,
          domUnchanged: document.body.innerHTML === before.html
        });
        // The same chart instance must remain usable after an unsuccessful call.
        const node = broken.value(1).categoryFormat(String).duration(0).render([{A: "a", B: "b"}]);
        results.push({recovered: node.querySelectorAll(".ribbon path").length === 1,
          listenersUnchanged: listeners() === before.listeners});
      }
    }
    return results;
  });
  for (const attempt of attempts) expect(Object.values(attempt).every(Boolean)).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator("#keep")).toHaveText("Keep me");
});

test("a render whose callback throws changes nothing, so the chart keeps working and recovers", async ({page}) => {
  const result = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0));
    const listeners = () => (window.__on || []).filter(d => d.name.startsWith("parsets.")).length;
    const before = listeners();
    svg.call(chart.duration(500).tension(0.5));
    const markup = svg.node().innerHTML;
    const thrown = [];
    for (const broken of [
      c => c.categoryFormat(() => { throw new Error("bad label"); }),
      c => c.dimensionFormat(() => { throw new Error("bad heading"); }),
      c => c.color(() => { throw new Error("bad colour"); }),
      c => c.categorySort(() => () => { throw new Error("bad comparator"); })
    ]) {
      try { svg.call(broken(chart)); } catch (error) { thrown.push(error.message); }
      chart.categoryFormat(null).dimensionFormat(null).color(null).categorySort(null);
    }
    // The previous render's animation carries on untouched.
    const unchanged = svg.node().innerHTML === markup;
    const animating = [...document.querySelectorAll("svg, svg *")].some(n => n.__transition);
    const afterFailure = listeners();
    svg.call(chart.categoryFormat(String));
    return {thrown, unchanged, animating, before, afterFailure, afterRecovery: listeners()};
  });
  expect(result.thrown).toEqual(["bad label", "bad heading", "bad colour", "bad comparator"]);
  expect(result.unchanged).toBe(true);
  expect(result.animating).toBe(true);
  expect([result.before, result.afterFailure, result.afterRecovery]).toEqual([0, 0, 0]);
  await settled(page);
});

test("renders empty, singleton, zero-weight, and changing dimension sets", async ({page}) => {
  await page.evaluate(() => mount([], c => c));
  await expect(page.locator("g.dimension")).toHaveCount(0);
  await page.evaluate(() => mount([{A: "a"}], c => c));
  await expect(page.locator("g.dimension")).toHaveCount(1);
  await expect(page.locator("g.category")).toHaveCount(1);
  await expect(page.locator(".ribbon path")).toHaveCount(0);
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).value(0)));
  await expect(page.locator(".ribbon path")).toHaveCount(0);
  await page.evaluate(() => mount());
  await settled(page);
  await page.evaluate(() => svg.datum([{A: "a"}]).call(chart.dimensions(["A"])));
  await settled(page);
  await expect(page.locator("g.dimension")).toHaveCount(1);
  await page.evaluate(() => svg.datum([]).call(chart.dimensions([])));
  await expect(page.locator("g.dimension")).toHaveCount(0);
  await expect(page.locator(".ribbon path")).toHaveCount(0);
  expect(await page.locator("svg").innerHTML()).not.toMatch(/NaN|Infinity/);
});

test("renders and rerenders prototype-like category names without losing rows", async ({page}) => {
  await page.evaluate(() => {
    mount([
      {A: "__proto__", B: "constructor", C: "toString"},
      {A: "constructor", B: "__proto__", C: "hasOwnProperty"}
    ]);
    svg.call(chart);
  });
  await settled(page);
  await expect(page.locator(".ribbon path")).toHaveCount(4);
  expect(await page.locator("g.category text").allTextContents()).toContain("__proto__");
  expect(await page.locator("svg").innerHTML()).not.toMatch(/NaN|Infinity/);
});

test("ribbon and category hover highlight connected flow; tooltips never insert HTML", async ({page}) => {
  await page.evaluate(() => mount());
  await settled(page);
  const classes = () => page.locator(".ribbon path").evaluateAll(nodes => ({
    total: nodes.length,
    active: nodes.filter(n => n.classList.contains("active")).length,
    inactive: nodes.filter(n => n.classList.contains("inactive")).length
  }));
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  let hover = await classes();
  expect(hover.active).toBeGreaterThan(1);
  expect(hover.inactive).toBeGreaterThan(0);
  expect(hover.active + hover.inactive).toBe(hover.total);
  await page.locator("g.dimension").last().locator("g.category").first().dispatchEvent("mousemove", {clientX: 100, clientY: 500});
  hover = await classes();
  expect(hover.active).toBeGreaterThan(1);
  expect(hover.active + hover.inactive).toBe(hover.total);
  await page.locator("svg").dispatchEvent("mouseleave");
  expect(await classes()).toEqual({total: hover.total, active: 0, inactive: 0});
  await page.evaluate(() => mount([{A: '<img src=x onerror="window.injected=true">', B: "b"}], c => c.dimensions(["A", "B"])));
  await settled(page);
  await page.locator(".ribbon-mouse path").dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  await expect(page.locator(".parsets-tooltip")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

async function dragFirstHeading(page) {
  const headings = page.locator("tspan.name");
  const a = await headings.nth(0).boundingBox();
  const b = await headings.nth(1).boundingBox();
  const x = a.x + 10, y = a.y + a.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 1.3 * (b.y - a.y), {steps: 10});
  await page.mouse.up();
  await settled(page);
}

const dimensionOrder = page => page.evaluate(() => [...svg.node().querySelectorAll("g.dimension")]
  .sort((a, b) => a.__data__.y - b.__data__.y)
  .map(n => n.__data__.name));

test("dimensions render in accessor order and sortDimensions reports dragged order", async ({page}) => {
  await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0));
    chart.on("sortDimensions.test", order => window.dragged = order);
  });
  await settled(page);
  await dragFirstHeading(page);
  expect(await dimensionOrder(page)).toEqual(["B", "A", "C"]);
  expect(await page.evaluate(() => window.dragged)).toEqual(["B", "A", "C"]);
  await page.evaluate(() => svg.call(chart));
  await settled(page);
  expect(await dimensionOrder(page)).toEqual(["A", "B", "C"]);
  await page.evaluate(() => svg.call(chart.dimensions(window.dragged)));
  await settled(page);
  expect(await dimensionOrder(page)).toEqual(["B", "A", "C"]);
  await page.evaluate(() => svg.call(chart.dimensions(["C", "B", "A"])));
  await settled(page);
  expect(await dimensionOrder(page)).toEqual(["C", "B", "A"]);
  await page.evaluate(() => svg.call(chart.dimensions(["A", "C"])));
  await page.evaluate(() => svg.call(chart.dimensions(["A", "B", "C"])));
  await settled(page);
  expect(await dimensionOrder(page)).toEqual(["A", "B", "C"]);
});

test("categories keep their colours through sorting, dragging, and changing data", async ({page}) => {
  const data = [
    {A: "a", B: "x"}, {A: "b", B: "x"}, {A: "b", B: "y"}, {A: "b", B: "y"}, {A: "c", B: "y"}
  ];
  await page.evaluate(data => mount(data, c => c.dimensions(["A", "B"]).duration(0)), data);
  await settled(page);
  // Colour class of each first-dimension category, read from its ribbons.
  const colours = () => page.evaluate(() => Object.fromEntries(
    [...svg.node().querySelectorAll(".ribbon path")].map(n => [n.__data__.path.split("\0")[0], n.getAttribute("class")])));
  const before = await colours();
  expect(new Set(Object.values(before)).size).toBe(3);
  const rerender = async script => {
    await page.evaluate(script, data);
    await settled(page);
  };
  await page.locator("tspan.sort.value").first().click();
  await settled(page);
  expect(await colours()).toEqual(before);
  await rerender(() => svg.call(chart.height(400)));
  expect(await colours()).toEqual(before);
  await rerender(() => svg.call(chart.height(600)));
  expect(await colours()).toEqual(before);
  // A category that disappears for several renders and returns keeps its slot.
  await rerender(data => svg.datum(data.filter(d => d.A !== "a")).call(chart));
  await rerender(() => svg.call(chart));
  const {a, ...rest} = before;
  expect(a).toBeDefined();
  expect(await colours()).toEqual(rest);
  await rerender(data => svg.datum(data).call(chart));
  expect(await colours()).toEqual(before);
  // Moving another dimension to the top and back restores the original colours.
  await dragFirstHeading(page);
  expect(await dimensionOrder(page)).toEqual(["B", "A"]);
  await dragFirstHeading(page);
  expect(await dimensionOrder(page)).toEqual(["A", "B"]);
  expect(await colours()).toEqual(before);
});

test("new categories reuse colours freed by absent ones", async ({page}) => {
  const rows = names => names.map(A => ({A, B: "x"}));
  await page.evaluate(data => mount(data, c => c.dimensions(["A", "B"]).duration(0)), rows(["a", "b", "c"]));
  await settled(page);
  const colours = () => page.evaluate(() => Object.fromEntries(
    [...svg.node().querySelectorAll(".ribbon path")].map(n => [n.__data__.path.split("\0")[0], n.getAttribute("class")])));
  const render = async data => {
    await page.evaluate(data => svg.datum(data).call(chart), data);
    await settled(page);
  };
  expect(await colours()).toEqual({a: "category-0", b: "category-1", c: "category-2"});
  await render(rows(["b", "c", "d"]));
  expect(await colours()).toEqual({d: "category-0", b: "category-1", c: "category-2"});
  // a's slot now belongs to d, so a takes the lowest free slot instead.
  await render(rows(["a", "b", "c", "d"]));
  expect(await colours()).toEqual({d: "category-0", b: "category-1", c: "category-2", a: "category-3"});
  await render(rows(["a", "d"]));
  await render(rows(["a", "d", "e"]));
  expect(await colours()).toEqual({d: "category-0", e: "category-1", a: "category-3"});
});

test("color accessor paints first-dimension bars and ribbons inline", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)
    .color((name, i) => `rgb(${i}, ${name === "a" ? 100 : 200}, 0)`)));
  await settled(page);
  const fills = () => page.evaluate(() => ({
    ribbons: [...svg.node().querySelectorAll(".ribbon path")].map(n =>
      [n.__data__.path.split("\0")[0], n.style.fill, n.style.stroke]).sort(),
    bars: [...document.querySelectorAll("g.dimension")].map(n =>
      [n.__data__.name, [...n.querySelectorAll("g.category > rect:first-child")].map(r => r.style.fill)])
  }));
  const painted = await fills();
  expect(new Set(painted.ribbons.map(([root, fill, stroke]) => `${root} ${fill} ${stroke}`))).toEqual(new Set([
    "a rgb(0, 100, 0) rgb(0, 100, 0)", "b rgb(1, 200, 0) rgb(1, 200, 0)"
  ]));
  expect(painted.bars).toEqual([
    ["A", ["rgb(0, 100, 0)", "rgb(1, 200, 0)"]], ["B", ["", ""]], ["C", ["", ""]]
  ]);
  expect(await page.evaluate(() => typeof chart.color())).toBe("function");
  await page.evaluate(() => svg.call(chart.color(null)));
  await settled(page);
  expect(await page.evaluate(() => chart.color())).toBeNull();
  const cleared = await fills();
  expect(cleared.ribbons.every(([, fill, stroke]) => !fill && !stroke)).toBe(true);
  expect(cleared.bars.every(([, bars]) => bars.every(fill => !fill))).toBe(true);
});

test("a different chart rendered into the same element assigns its own colours", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const rootColours = () => page.evaluate(() => Object.fromEntries(
    [...svg.node().querySelectorAll(".ribbon path")].map(n => [n.__data__.path.split("\0")[0], n.getAttribute("class")])));
  expect(await rootColours()).toEqual({a: "category-0", b: "category-1"});
  await page.evaluate(() => svg.datum(rows.filter(d => d.A === "b")).call(chart));
  await settled(page);
  expect(await rootColours()).toEqual({b: "category-1"});
  await page.evaluate(() => svg.call(parsets().dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  expect(await rootColours()).toEqual({b: "category-0"});
});

test("categories render in data order and sortCategories reports interactive order", async ({page}) => {
  await page.evaluate(() => {
    mount([{A: "a", B: "x"}, {A: "b", B: "x"}, {A: "b", B: "y"}], c => c.dimensions(["A", "B"]).duration(0));
    window.sorted = [];
    chart.on("sortCategories.test", (dimension, order) => window.sorted.push([dimension, order]));
  });
  await settled(page);
  const order = () => page.evaluate(() => [...document.querySelectorAll("g.dimension")]
    .find(n => n.__data__.name === "A").__data__.categories.map(c => c.name));
  const sort = page.locator("g.dimension").first().locator("tspan.sort.value");
  await sort.click();
  await settled(page);
  expect(await order()).toEqual(["b", "a"]);
  await expect(sort).toHaveClass("sort value descending");
  expect(await page.evaluate(() => window.sorted)).toEqual([["A", ["b", "a"]]]);
  await page.evaluate(() => svg.call(chart));
  await settled(page);
  expect(await order()).toEqual(["a", "b"]);
  await expect(sort).toHaveClass("sort value");
  // categorySort can persist an interactive order across renders.
  await page.evaluate(() => {
    const [dimension, saved] = window.sorted.at(-1);
    svg.call(chart.categorySort(name => name === dimension &&
      ((a, b) => saved.indexOf(a.name) - saved.indexOf(b.name))));
  });
  await settled(page);
  expect(await order()).toEqual(["b", "a"]);
});

test("curve changes follow the timing of a caller's transition", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const progress = await page.evaluate(async () => {
    const path = svg.node().querySelector(".ribbon path");
    const start = path.getAttribute("d");
    svg.transition().duration(400).call(chart.tension(0.5));
    const after = path.getAttribute("d");
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const during = path.getAttribute("d");
    await new Promise(resolve => setTimeout(resolve, 500));
    return {unchanged: after === start, animating: during !== start, done: path.getAttribute("d") !== during};
  });
  expect(progress).toEqual({unchanged: true, animating: true, done: true});
});

test("a caller's transition also times dimension moves", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const positions = await page.evaluate(async () => {
    const node = svg.node().querySelector("g.dimension:last-of-type");
    const y = () => node.transform.baseVal.consolidate().matrix.f;
    const start = y();
    svg.transition().duration(400).call(chart.height(300));
    for (let i = 0; i < 5; i++) await new Promise(requestAnimationFrame);
    const during = y();
    await new Promise(resolve => setTimeout(resolve, 500));
    return {start, during, end: y()};
  });
  expect(positions.end).toBeLessThan(positions.start);
  expect(positions.during).toBeLessThan(positions.start);
  expect(positions.during).toBeGreaterThan(positions.end);
});

test("a caller's transition times each chart by its own delay", async ({page}) => {
  const curved = await page.evaluate(async () => {
    mount();
    const roots = select("body").selectAll("svg.multi").data([rows, rows]).enter().append("svg").attr("class", "multi");
    const chart = parsets().dimensions(["A", "B", "C"]).duration(0);
    roots.call(chart);
    const isCurved = () => roots.nodes().map(n => n.querySelector(".ribbon path").getAttribute("d").includes("C"));
    roots.transition().delay((_d, i) => i * 1000).duration(50).call(chart.tension(0.5));
    await new Promise(resolve => setTimeout(resolve, 400));
    const early = isCurved();
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {early, late: isCurved()};
  });
  expect(curved).toEqual({early: [true, false], late: [true, true]});
});

test("calling through an empty or ended transition is safe", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const curved = await page.evaluate(async () => {
    selectAll(".none").transition().call(chart);
    const t = svg.transition().duration(10);
    await t.end();
    // The ended transition has no timing, so the chart's own applies.
    t.call(chart.tension(0.5));
    return svg.node().querySelector(".ribbon path").getAttribute("d").includes("C");
  });
  expect(curved).toBe(true);
});

test("trailing blank lines enlarge the tooltip", async ({page}) => {
  const heights = [];
  for (const content of ["a", "a\n\n"]) {
    await page.evaluate(content => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0).tooltip(() => content)), content);
    await settled(page);
    await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
    heights.push(await page.locator(".parsets-tooltip rect").evaluate(n => +n.getAttribute("height")));
  }
  const lineHeight = await page.locator(".parsets-tooltip text").evaluate(n => 1.2 * parseFloat(getComputedStyle(n).fontSize));
  expect(heights[1] - heights[0]).toBeCloseTo(2 * lineHeight, 5);
});

test("categoryFormat receives the category name, index and dimension name", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B"]).duration(0)
    .categoryFormat((name, i, dimension) => `${dimension}:${i}:${name}`)));
  await settled(page);
  const labels = await page.locator("g.category text").evaluateAll(nodes => nodes.map(n => n.textContent));
  expect(labels).toEqual(["A:0:a", "A:1:b", "B:0:x", "B:1:y"]);
});

test("tooltips keep blank lines and leading spaces", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0).tooltip(() => "Title\n\n  detail")));
  await settled(page);
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  const lines = await page.locator(".parsets-tooltip tspan").evaluateAll(nodes => nodes.map(n => [n.textContent, n.getAttribute("y")]));
  expect(lines).toEqual([["Title", "0em"], ["", "1.2em"], ["  detail", "2.4em"]]);
  const starts = await page.locator(".parsets-tooltip tspan").evaluateAll(nodes =>
    [nodes[0].getStartPositionOfChar(0).x, nodes[2].getStartPositionOfChar(2).x]);
  expect(starts[1]).toBeGreaterThan(starts[0] + 1);
  expect(await page.locator(".parsets-tooltip text").evaluate(n =>
    n.getAttributeNS("http://www.w3.org/XML/1998/namespace", "space"))).toBe("preserve");
});

test("render accepts a D3 selection, node, or selector as parent", async ({page}) => {
  const counts = await page.evaluate(() => {
    mount();
    const parent = document.body.appendChild(document.createElement("div"));
    parent.id = "render-parent";
    const result = [];
    for (const target of [parent, "#render-parent", svg.select(function() { return parent; })]) {
      const node = chart.render(rows, target);
      result.push(node.parentNode === parent && node.querySelectorAll(".ribbon path").length > 0);
    }
    return result;
  });
  expect(counts).toEqual([true, true, true]);
});

test("charts install no window listeners and unhighlight when the pointer leaves", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const box = await page.locator("g.category > rect:first-child").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.locator(".ribbon path.active").count()).toBeGreaterThan(0);
  await expect(page.locator(".parsets-tooltip")).toBeVisible();
  await page.mouse.move(1150, 880);
  expect(await page.locator(".ribbon path.active").count()).toBe(0);
  await expect(page.locator(".parsets-tooltip")).toBeHidden();
  expect(await page.evaluate(() => (window.__on || []).length)).toBe(0);
});

test("rerender uses current tooltip callbacks and counts", async ({page}) => {
  await page.evaluate(() => {
    mount();
    svg.call(chart).call(chart);
    svg.datum([{A: "a", B: "x", C: "m"}]).call(chart.tooltip(d => `current ${d.count}`));
  });
  await settled(page);
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  await expect(page.locator(".parsets-tooltip text")).toHaveText("current 1");
  await page.evaluate(() => svg.call(chart.tooltip(null)));
  await settled(page);
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  await expect(page.locator(".parsets-tooltip text")).toContainText("100.0%");
});

for (const duration of [0, 150]) {
  for (const kind of ["category", "dimension"]) {
    test(`${kind} drag keeps ribbons attached with duration ${duration}`, async ({page}) => {
      await page.evaluate(duration => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(duration).nodeThickness(10)), duration);
      await settled(page);
      const selector = kind === "category" ? "g.category > rect:first-child" : "tspan.name";
      const box = await page.locator(selector).first().boundingBox();
      const x = box.x + Math.min(30, box.width / 2), y = box.y + box.height / 2;
      const before = await page.locator(".ribbon").innerHTML();
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + (kind === "category" ? 50 : 0), y + (kind === "dimension" ? 60 : 0), {steps: 3});
      expect(await page.locator(".ribbon").innerHTML()).not.toBe(before);
      const attachment = await page.evaluate(() => {
        const dimension = document.querySelector("g.dimension");
        const category = dimension.querySelector("g.category");
        const path = [...document.querySelectorAll(".ribbon path")].find(n => n.__data__.source.node === category.__data__);
        const [x, y] = path.getAttribute("d").slice(1).split(/[LC]/)[0].split(",").map(Number);
        const source = path.__data__.source;
        return {x, y, expectedX: category.transform.baseVal.consolidate().matrix.e + source.x0,
          expectedY: dimension.transform.baseVal.consolidate().matrix.f + source.dy};
      });
      expect(attachment.x).toBeCloseTo(attachment.expectedX, 5);
      expect(attachment.y).toBeCloseTo(attachment.expectedY, 5);
      await page.mouse.up();
      await settled(page);
      expect(await page.locator("svg").innerHTML()).not.toMatch(/NaN|Infinity/);
    });
  }
}

test("programmatic category sorting works per dimension and user sorting still toggles", async ({page}) => {
  await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)
      .categorySort(name => name === "B" && ((a, b) => a.count - b.count)));
    window.sortEvents = 0;
    chart.on("sortCategories.test", () => window.sortEvents++);
  });
  await settled(page);
  const order = () => page.evaluate(() => [...document.querySelectorAll("g.dimension")]
    .find(n => n.__data__.name === "B").__data__.categories.map(c => c.name));
  expect(await order()).toEqual(["y", "x"]);
  const sort = page.locator("g.dimension").nth(1).locator("tspan.sort.key");
  await sort.dispatchEvent("click");
  await settled(page);
  expect(await order()).toEqual(["x", "y"]);
  await sort.dispatchEvent("click");
  await settled(page);
  expect(await order()).toEqual(["y", "x"]);
  expect(await page.evaluate(() => window.sortEvents)).toBe(2);
});

test("sorting animates attached ribbons instead of jumping straight to final geometry", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(300)));
  await settled(page);
  const before = await page.locator(".ribbon").innerHTML();
  const synchronous = await page.evaluate(() => {
    const sort = [...document.querySelectorAll("tspan.sort.value")].at(-1);
    const before = document.querySelector(".ribbon").innerHTML;
    sort.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    return before === document.querySelector(".ribbon").innerHTML;
  });
  expect(synchronous).toBe(true);
  await settled(page);
  expect(await page.locator(".ribbon").innerHTML()).not.toBe(before);
});

test("node thickness and narrow extents produce valid chart geometry", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).width(10).height(10).nodeThickness(100)));
  await settled(page);
  expect(await page.locator("svg").innerHTML()).not.toMatch(/NaN|Infinity/);
  const widths = await page.locator("g.category rect").evaluateAll(nodes => nodes.map(n => +n.getAttribute("width")));
  expect(widths.every(w => w >= 0)).toBe(true);
});

for (const kind of ["category", "dimension"]) {
  test(`${kind} drag reorders data and preserves highlighting after rerender`, async ({page}) => {
    await page.evaluate(() => {
      mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0));
      window.sortEvents = 0;
      chart.on("sortCategories.test", () => window.sortEvents++);
      chart.on("sortDimensions.test", () => window.sortEvents++);
    });
    await settled(page);
    const box = await page.locator(kind === "category" ? "g.category > rect:first-child" : "tspan.name").first().boundingBox();
    const x = box.x + Math.min(20, box.width / 2), y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (kind === "category" ? 850 : 0), y + (kind === "dimension" ? 400 : 0), {steps: 20});
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(() => window.sortEvents)).toBeGreaterThan(0);
    const order = await page.evaluate(kind => {
      const dims = [...document.querySelectorAll("g.dimension")].map(n => n.__data__);
      return kind === "category" ? dims.find(d => d.name === "A").categories.map(c => c.name)
        : dims.sort((a, b) => a.y - b.y).map(d => d.name);
    }, kind);
    expect(order).toEqual(kind === "category" ? ["b", "a"] : ["B", "A", "C"]);
    // Move the pointer off the chart: Chrome sends mouse events of its own
    // when the page changes under a resting pointer, which would race with
    // the hover below.
    await page.mouse.move(1100, 800);
    await page.evaluate(() => svg.call(chart));
    await settled(page);
    await page.locator(".ribbon-mouse path").last().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
    expect(await page.locator(".ribbon path.active").count()).toBeGreaterThan(1);
    expect(await page.locator("svg").innerHTML()).not.toMatch(/NaN|Infinity/);
  });
}

test.describe("horizontal charts", () => {
  const mountHorizontal = (page, configure = c => c) => page.evaluate(source => {
    const extra = new Function("return " + source)();
    mount(rows, c => extra(c.dimensions(["A", "B", "C"]).orientation("horizontal").nodeThickness(10).duration(0)));
  }, configure.toString());

  test("lay out columns left to right, with ribbons between their bars and labels reading up them", async ({page}) => {
    await mountHorizontal(page);
    await settled(page);
    const geometry = await page.evaluate(() => {
      const origin = svg.node().getBoundingClientRect();
      const bars = [...svg.node().querySelectorAll("g.dimension")].map(n => {
        const r = [...n.querySelectorAll("rect.category-bar")].map(b => b.getBoundingClientRect());
        return {
          name: n.__data__.name,
          left: r[0].left - origin.left,
          right: r[0].right - origin.left,
          top: Math.min(...r.map(b => b.top)) - origin.top,
          bottom: Math.max(...r.map(b => b.bottom)) - origin.top
        };
      });
      const ribbons = [...svg.node().querySelectorAll(".ribbon path")].map(n => {
        const r = n.getBoundingClientRect();
        return {source: n.__data__.source.dimension.name, target: n.__data__.target.dimension.name,
          left: r.left - origin.left, right: r.right - origin.left};
      });
      const orientation = selector => [...svg.node().querySelectorAll(selector)].map(n => {
        const m = n.getScreenCTM();
        return [m.a, m.b, m.c, m.d];
      });
      const labels = {headers: orientation("text.dimension"), categories: orientation("g.category text")};
      return {bars, ribbons, labels, width: chart.width()};
    });
    expect(geometry.bars.map(b => b.name)).toEqual(["A", "B", "C"]);
    for (const [i, bar] of geometry.bars.entries()) {
      expect(bar.right - bar.left).toBeCloseTo(10, 1);
      expect(bar.top).toBeCloseTo(30, 1);
      expect(bar.bottom).toBeCloseTo(598, 1);
      if (i) expect(bar.left).toBeGreaterThan(geometry.bars[i - 1].right);
    }
    expect(geometry.bars.at(-1).right).toBeLessThan(geometry.width);
    const bar = Object.fromEntries(geometry.bars.map(b => [b.name, b]));
    for (const r of geometry.ribbons) {
      expect(r.left).toBeCloseTo(bar[r.source].right, 1);
      expect(r.right).toBeCloseTo(bar[r.target].left, 1);
    }
    for (const m of geometry.labels.headers) expect(m).toEqual([1, 0, 0, 1]);
    for (const m of geometry.labels.categories) expect(m).toEqual([0, -1, 1, 0]);
  });

  test("drag dimensions horizontally and categories vertically", async ({page}) => {
    await mountHorizontal(page, c => c.on("sortDimensions.test", order => { window.dimensionOrder = order; })
      .on("sortCategories.test", (dimension, order) => { window.categoryOrder = [dimension, order]; }));
    await settled(page);
    const a = await page.locator("tspan.name").nth(0).boundingBox();
    const b = await page.locator("tspan.name").nth(1).boundingBox();
    await page.mouse.move(a.x + 5, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 5 + 1.3 * (b.x - a.x), a.y + a.height / 2, {steps: 10});
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(() => window.dimensionOrder)).toEqual(["B", "A", "C"]);
    expect(await dimensionOrder(page)).toEqual(["B", "A", "C"]);

    const categories = page.locator("g.dimension").first().locator("g.category rect.category-bar");
    const first = await categories.nth(0).boundingBox();
    const second = await categories.nth(1).boundingBox();
    await page.mouse.move(first.x + 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(first.x + 2, second.y + second.height, {steps: 10});
    await page.mouse.up();
    await settled(page);
    expect(await page.evaluate(() => window.categoryOrder)).toEqual(["A", ["b", "a"]]);
  });

  test("switching orientation keeps the dimensions, categories and colours", async ({page}) => {
    await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(50)));
    await settled(page);
    const snapshot = () => page.evaluate(() => ({
      classes: [...svg.node().querySelectorAll(".ribbon path")].map(n => [n.__data__.path, n.getAttribute("class")]).sort(),
      categories: [...svg.node().querySelectorAll("g.category")].map(n => n.__data__.name),
      markup: svg.node().innerHTML.match(/NaN|undefined|Infinity/g)
    }));
    const before = await snapshot();
    for (const orientation of ["horizontal", "vertical", "horizontal"]) {
      await page.evaluate(orientation => svg.call(chart.orientation(orientation)), orientation);
      await settled(page);
      expect(await snapshot()).toEqual(before);
      expect(await page.evaluate(() => svg.select(".parsets-plot").attr("transform"))).toBe(orientation === "horizontal" ? "matrix(0,1,1,0,0,30)" : null);
      expect(await page.locator("svg text[style*=opacity]").count()).toBe(0);
    }
    expect(await page.evaluate(() => svg.classed("parsets-horizontal"))).toBe(true);
  });

  // Screen boxes of ribbons, bars and hover strips, in a stable order.
  const boxes = () => window.svg.node().querySelectorAll(".parsets-plot .ribbon path, .parsets-plot g.category rect")
    .values().map(n => {
      const r = n.getBoundingClientRect();
      const d = n.__data__;
      return [d.path ?? `${d.dimension.name}:${d.name}:${n.getAttribute("class")}`, r.left, r.top, r.right, r.bottom];
    }).toArray().sort((a, b) => a[0] < b[0] ? -1 : 1);
  const unmoved = (before, after) => before.length === after.length &&
    before.every((b, i) => b[0] === after[i][0] && b.slice(1).every((v, j) => Math.abs(v - after[i][j + 1]) < 0.5));

  test("a turn starts from the chart as displayed, then rotates it", async ({page}) => {
    // Spacing does not scale, so leave none for an exact comparison.
    await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).spacing(0).nodeThickness(10).duration(0)));
    await settled(page);
    for (const orientation of ["horizontal", "vertical"]) {
      const same = await page.evaluate(([boxes, unmoved, orientation]) => {
        const before = eval(boxes)();
        svg.transition().duration(1000).call(chart.orientation(orientation));
        return eval(unmoved)(before, eval(boxes)());
      }, [boxes.toString(), unmoved.toString(), orientation]);
      expect(same).toBe(true);
      const midway = await page.evaluate(async () => {
        await new Promise(resolve => setTimeout(resolve, 500));
        return svg.select(".parsets-plot").attr("transform");
      });
      expect(midway).toMatch(/rotate\(-?[1-9]/);
      await settled(page);
    }
  });

  for (const reverse of [false, true]) {
    test(`rendering partway through a turn carries on from where it is${reverse ? ", turning back" : ""}`, async ({page}) => {
      await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).spacing(0).nodeThickness(10).duration(0)));
      await settled(page);
      const same = await page.evaluate(async ([boxes, unmoved, reverse]) => {
        svg.transition().duration(1000).call(chart.orientation("horizontal"));
        await new Promise(resolve => setTimeout(resolve, 400));
        const before = eval(boxes)();
        svg.transition().duration(1000).call(reverse ? chart.orientation("vertical") : chart);
        return eval(unmoved)(before, eval(boxes)());
      }, [boxes.toString(), unmoved.toString(), reverse]);
      expect(same).toBe(true);
      await settled(page);
      expect(await page.evaluate(() => svg.select(".parsets-plot").attr("transform"))).toBe(reverse ? null : "matrix(0,1,1,0,0,30)");
      expect(await page.locator("svg text[style*=opacity]").count()).toBe(0);
    });
  }

  test("header names are shortened to fit between narrow columns", async ({page}) => {
    const result = await page.evaluate(() => {
      const names = ["First long dimension", "Second long dimension", "Third long dimension"];
      mount([{[names[0]]: "a", [names[1]]: "x", [names[2]]: "m"}, {[names[0]]: "b", [names[1]]: "y", [names[2]]: "n"}],
        c => c.dimensions(names).orientation("horizontal").width(300).duration(0));
      const left = svg.node().getBoundingClientRect().left;
      const columns = [...svg.node().querySelectorAll("g.dimension")].map(n => left + n.__data__.y);
      const headers = [...svg.node().querySelectorAll("tspan.name")].map(n => {
        const r = n.getBoundingClientRect();
        return {text: n.textContent, left: r.left, right: r.right};
      });
      return {headers, columns: columns.sort((a, b) => a - b)};
    });
    const {headers, columns} = result;
    for (const name of headers) expect(name.text).toMatch(/…$/);
    // The first two start at their columns and stop before the next; the last ends at its column.
    expect(headers[0].right).toBeLessThan(columns[1]);
    expect(headers[1].right).toBeLessThan(columns[2]);
    expect(headers[2].left).toBeGreaterThan(columns[1]);
    // The last two share the gap between them.
    expect(headers[1].right).toBeLessThan(headers[2].left);
    // Vertical charts have room for the full names.
    expect(await page.evaluate(() => {
      svg.call(chart.orientation("vertical").width(960));
      return [...svg.node().querySelectorAll("tspan.name")].map(n => n.textContent);
    })).toEqual(["First long dimension", "Second long dimension", "Third long dimension"]);
  });
});

test("a dragged category passes a neighbour at its midpoint, or once the neighbour fits in the gap left behind", async ({page}) => {
  // With the default width and spacing, "a" is 846px wide and "b" 94px, 20px apart.
  const rows = [...Array(9).fill({A: "a", B: "x"}), {A: "b", B: "x"}];
  const drag = async (name, offsets) => {
    await page.evaluate(rows => {
      window.sorted = null;
      mount(rows, c => c.dimensions(["A", "B"]).duration(0)
        .on("sortCategories.test", (dimension, order) => { window.sorted = order; }));
    }, rows);
    await settled(page);
    const box = await page.locator("g.dimension").first().locator("g.category")
      .filter({hasText: name}).locator("rect").first().boundingBox();
    const start = {x: box.x + box.width / 2, y: box.y + box.height / 2};
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    const orders = [];
    for (const offset of offsets) {
      await page.mouse.move(start.x + offset, start.y, {steps: 5});
      orders.push(await page.evaluate(() => window.sorted));
    }
    await page.mouse.up();
    await settled(page);
    return orders;
  };
  // "b" fits in the gap once "a" moves 94 + 20 = 114px; its midpoint is 490px away.
  expect(await drag("a", [100, 130])).toEqual([null, ["b", "a"]]);
  // "b" is too wide a gap for "a" to fit in, so "b" passes at the midpoint, 490px away.
  expect(await drag("b", [-400, -520])).toEqual([null, ["b", "a"]]);
});

test("charts do not animate when the user prefers reduced motion", async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(5000)));
  await settled(page);
  const result = await page.evaluate(async () => {
    const frames = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
    const atRest = () => [...svg.node().querySelectorAll("g.category")]
      .every(n => Math.abs(n.transform.baseVal.consolidate().matrix.e - n.__data__.x) < 0.01);
    // Sorting C by value reverses its categories, m and n.
    const order = () => [...svg.node().querySelectorAll("g.dimension")][2].__data__.categories.map(c => c.name);
    const before = order();
    svg.node().querySelectorAll("tspan.sort.value")[2].dispatchEvent(new MouseEvent("click", {bubbles: true}));
    await frames();
    const sorted = atRest() && order().join() !== before.join();
    svg.transition().duration(5000).call(chart.orientation("horizontal").tension(0.5));
    await frames();
    return {
      sorted,
      turned: svg.select(".parsets-plot").attr("transform"),
      curved: svg.node().querySelector(".ribbon path").getAttribute("d").includes("C"),
      duration: chart.duration()
    };
  });
  expect(result).toEqual({sorted: true, turned: "matrix(0,1,1,0,0,30)", curved: true, duration: 5000});
});

test("dragging categories with no length, as in a very short horizontal chart, cannot hang", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B"]).orientation("horizontal").height(30).duration(0)));
  await settled(page);
  const box = await page.locator("g.dimension").first().locator("g.category rect").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 5, {steps: 3});
  await page.mouse.up();
  await settled(page);
  expect(await page.evaluate(() => svg.node().innerHTML)).not.toMatch(/NaN/);
});

test("hovering restores the stacking order afterwards, and moving within a ribbon changes nothing", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const order = () => page.locator(".ribbon path").evaluateAll(nodes => nodes.map(n => n.__data__.path));
  const before = await order();
  const ribbon = page.locator(".ribbon-mouse path").first();
  await ribbon.dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  const mutations = await page.evaluate(async () => {
    const changes = [];
    const observer = new MutationObserver(records => changes.push(...records));
    observer.observe(svg.node().querySelector(".ribbon"), {attributes: true, childList: true, subtree: true});
    svg.node().querySelector(".ribbon-mouse path").dispatchEvent(new MouseEvent("mousemove", {clientX: 101, clientY: 101}));
    await Promise.resolve();
    observer.disconnect();
    return changes.length;
  });
  expect(mutations).toBe(0);
  await page.locator("svg").dispatchEvent("mouseleave");
  expect(await order()).toEqual(before);
});

test("rendering the same orientation late in a turn keeps its labels showing", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const [before, after] = await page.evaluate(async () => {
    svg.transition().duration(600).ease(t => t).call(chart.orientation("horizontal"));
    await new Promise(resolve => setTimeout(resolve, 540));
    const opacity = () => +getComputedStyle(svg.node().querySelector("g.category text")).opacity;
    const before = opacity();
    svg.transition().duration(600).call(chart);
    return [before, opacity()];
  });
  expect(before).toBeGreaterThan(0.3);
  expect(after).toBeGreaterThanOrEqual(before - 0.01);
  await settled(page);
});

test.describe("touch", () => {
  test.use({hasTouch: true});

  test("a touch-dragged category keeps following the finger after passing a neighbour", async ({page}) => {
    const rows = [...Array(9).fill({A: "a", B: "x"}), {A: "b", B: "x"}];
    await page.evaluate(rows => {
      window.sorted = null;
      mount(rows, c => c.dimensions(["A", "B"]).duration(0)
        .on("sortCategories.test", (dimension, order) => { window.sorted = order; }));
    }, rows);
    await settled(page);
    const box = await page.locator("g.dimension").first().locator("g.category")
      .filter({hasText: "a"}).locator("rect").first().boundingBox();
    const start = {x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
    const client = await page.context().newCDPSession(page);
    const touch = (type, dx) => client.send("Input.dispatchTouchEvent", {
      type, touchPoints: type === "touchEnd" ? [] : [{x: start.x + dx, y: start.y}]
    });
    await touch("touchStart", 0);
    // "b" fits in the gap after 114px; keep going well past the swap.
    for (let dx = 10; dx <= 200; dx += 10) await touch("touchMove", dx);
    const during = await page.evaluate(() => {
      const node = [...svg.node().querySelectorAll("g.category")].find(n => n.__data__.name === "a");
      return {sorted: window.sorted, x: node.transform.baseVal.consolidate().matrix.e};
    });
    await touch("touchEnd", 200);
    await settled(page);
    expect(during.sorted).toEqual(["b", "a"]);
    // The category is still under the finger, 200px from where it started.
    expect(during.x).toBeCloseTo(200, 0);
    const rest = await page.evaluate(() => {
      const node = [...svg.node().querySelectorAll("g.category")].find(n => n.__data__.name === "a");
      return node.transform.baseVal.consolidate().matrix.e - node.__data__.x;
    });
    expect(Math.abs(rest)).toBeLessThan(0.01);
  });
});

test("sort controls show the order they applied, until the categories are reordered another way", async ({page}) => {
  await page.evaluate(() => mount([{A: "b", B: "x"}, {A: "a", B: "x"}, {A: "b", B: "y"}], c => c.dimensions(["A", "B"]).duration(0)));
  await settled(page);
  const header = page.locator("g.dimension").first().locator("text.dimension");
  const key = header.locator("tspan.sort.key");
  const value = header.locator("tspan.sort.value");
  const order = () => page.evaluate(() => document.querySelector("g.dimension").__data__.categories.map(c => c.name));
  // Each control shows both arrows, dimming the one for the order not applied.
  const label = control => control.evaluate(n => {
    const shown = arrow => getComputedStyle(n.querySelector(`tspan.${arrow}`)).fillOpacity === "1";
    return `${n.firstChild.textContent}${shown("up") ? "↑" : ""}${shown("down") ? "↓" : ""}`;
  });
  const labels = async () => [await label(key), await label(value)];
  expect(await labels()).toEqual(["key ↑↓", "value ↑↓"]);
  await key.dispatchEvent("click");
  expect([await order(), await labels()]).toEqual([["a", "b"], ["key ↑", "value ↑↓"]]);
  await key.dispatchEvent("click");
  expect([await order(), await labels()]).toEqual([["b", "a"], ["key ↓", "value ↑↓"]]);
  await value.dispatchEvent("click");
  expect([await order(), await labels()]).toEqual([["b", "a"], ["key ↑↓", "value ↓"]]);
  // A render that keeps the order, such as one persisting it, keeps the mark.
  await page.evaluate(() => {
    const kept = document.querySelector("g.dimension").__data__.categories.map(c => c.name);
    svg.call(chart.categorySort(name => name === "A" && ((a, b) => kept.indexOf(a.name) - kept.indexOf(b.name))));
  });
  await settled(page);
  expect([await order(), await labels()]).toEqual([["b", "a"], ["key ↑↓", "value ↓"]]);
  await value.dispatchEvent("click");
  expect([await order(), await labels()]).toEqual([["a", "b"], ["key ↑↓", "value ↑"]]);
  // A render that changes the order clears it.
  await page.evaluate(() => svg.call(chart.categorySort(null)));
  await settled(page);
  expect([await order(), await labels()]).toEqual([["b", "a"], ["key ↑↓", "value ↑↓"]]);
  await value.dispatchEvent("click");
  await value.dispatchEvent("click");
  // Dragging a category past another resets the labels.
  await settled(page);
  const box = await page.locator("g.dimension").first().locator("g.category").filter({hasText: "a"}).locator("rect").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // "a" is 313px wide and "b" 627px, 20px apart: "a" passes the middle of "b" after 490px.
  await page.mouse.move(box.x + box.width / 2 + 520, box.y + box.height / 2, {steps: 8});
  await page.mouse.up();
  await settled(page);
  expect([await order(), await labels()]).toEqual([["b", "a"], ["key ↑↓", "value ↑↓"]]);
});

test("a failed rerender leaves the chart on screen working", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const errors = await page.evaluate(() => {
    const errors = [];
    for (const broken of [c => c.value(-1), c => c.dimensions(() => { throw new Error("bad dimensions"); })]) {
      const before = {value: chart.value(), dimensions: chart.dimensions()};
      try { svg.call(broken(chart)); } catch (error) { errors.push(error.constructor.name); }
      chart.value(before.value).dimensions(before.dimensions);
    }
    return errors;
  });
  expect(errors).toEqual(["RangeError", "Error"]);
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  expect(await page.locator(".ribbon path.active").count()).toBeGreaterThan(0);
  await expect(page.locator(".parsets-tooltip")).toBeVisible();
});

test("moving between a category's parts keeps its highlight", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const category = page.locator("g.dimension").first().locator("g.category").first();
  const band = await category.locator("rect").first().boundingBox();
  const label = await category.locator("text").boundingBox();
  await page.mouse.move(band.x + band.width - 5, band.y + 3);
  const active = await page.locator(".ribbon path.active").count();
  expect(active).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.changes = 0;
    window.observer = new MutationObserver(records => { window.changes += records.length; });
    window.observer.observe(svg.node().querySelector(".ribbon"), {attributes: true, childList: true, subtree: true});
  });
  await page.mouse.move(label.x + label.width / 2, label.y + label.height / 2, {steps: 4});
  expect(await page.evaluate(() => { window.observer.disconnect(); return window.changes; })).toBe(0);
  expect(await page.locator(".ribbon path.active").count()).toBe(active);
});

test("settings are validated, and render returns a detached SVG", async ({page}) => {
  const result = await page.evaluate(() => {
    const errors = [];
    for (const set of [c => c.tension("curvy"), c => c.duration(-1), c => c.duration(NaN), c => c.width(-1), c => c.height(-600)]) {
      try { set(parsets()); } catch (error) { errors.push(error instanceof RangeError); }
    }
    const node = parsets().dimensions(["A", "B"]).render(rows);
    const empty = parsets().orientation("horizontal").render([]);
    return {errors, parent: node.parentNode, empty: empty instanceof SVGSVGElement};
  });
  expect(result).toEqual({errors: [true, true, true, true, true], parent: null, empty: true});
});

test("a dragged category keeps its flow highlighted, through reorders and after release", async ({page}) => {
  const rows = [...Array(9).fill({A: "a", B: "x"}), {A: "b", B: "y"}];
  await page.evaluate(rows => mount(rows, c => c.dimensions(["A", "B"]).duration(0)), rows);
  await settled(page);
  const lit = () => page.evaluate(() => [...svg.node().querySelectorAll(".ribbon path.active")].map(n => n.__data__.path).sort());
  const box = await page.locator("g.dimension").first().locator("g.category").filter({hasText: "a"}).locator("rect").first().boundingBox();
  const start = {x: box.x + box.width / 2, y: box.y + box.height / 2};
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 20, start.y, {steps: 2});
  expect(await lit()).toEqual(["a\0x"]);
  await expect(page.locator(".parsets-tooltip")).toBeHidden();
  // Record every class the highlighted ribbon has while it swaps.
  await page.evaluate(() => {
    const ribbon = [...svg.node().querySelectorAll(".ribbon path")].find(n => n.__data__.path === "a\0x");
    window.classes = [];
    window.observer = new MutationObserver(records => window.classes.push(...records.map(r => r.oldValue)));
    window.observer.observe(ribbon, {attributes: true, attributeFilter: ["class"], attributeOldValue: true});
  });
  // Past "b", which fits in the gap left behind after 114px.
  await page.mouse.move(start.x + 150, start.y, {steps: 4});
  // It was never unhighlighted, even briefly, which would restart its fade.
  expect(await page.evaluate(() => {
    window.observer.disconnect();
    return window.classes.every(c => c.includes("active"));
  })).toBe(true);
  expect(await page.evaluate(() => document.querySelector("g.dimension").__data__.categories.map(c => c.name))).toEqual(["b", "a"]);
  expect(await lit()).toEqual(["a\0x"]);
  await page.mouse.up();
  await settled(page);
  expect(await lit()).toEqual(["a\0x"]);
  await page.mouse.move(5, 5);
  await page.locator("svg").dispatchEvent("mouseleave");
  expect(await lit()).toEqual([]);
});

test("tooltips can be left out, keep leading blank lines, and are laid out once per hover", async ({page}) => {
  const result = await page.evaluate(() => {
    let calls = 0;
    const contents = [() => null, () => "", () => "a", () => "\n\na"];
    const heights = [];
    let visible = [];
    for (const content of contents) {
      mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0).tooltip(function() { calls++; return content(); }));
      const path = svg.node().querySelector(".ribbon-mouse path");
      for (let i = 0; i < 3; i++) path.dispatchEvent(new MouseEvent("mousemove", {clientX: 100 + i, clientY: 100, bubbles: true}));
      visible.push(getComputedStyle(svg.node().querySelector(".parsets-tooltip")).visibility !== "hidden");
      heights.push(+svg.node().querySelector(".parsets-tooltip rect").getAttribute("height"));
    }
    const lineHeight = 1.2 * parseFloat(getComputedStyle(svg.node().querySelector(".parsets-tooltip text")).fontSize);
    return {calls, visible, extra: heights[3] - heights[2], lineHeight};
  });
  expect(result.visible).toEqual([false, false, true, true]);
  expect(result.calls).toBe(4);
  expect(result.extra).toBeCloseTo(2 * result.lineHeight, 5);
});

test("formatters may return any value, and null restores the default", async ({page}) => {
  const labels = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).width(120).duration(0)
      .categoryFormat(name => name === "a" ? 1234567890123456 : null));
    const before = [...svg.node().querySelectorAll("g.category text")].map(n => n.textContent);
    svg.call(chart.categoryFormat(null).dimensionFormat(null).width(960));
    return {before, after: [...svg.node().querySelectorAll("g.category text")].map(n => n.textContent)};
  });
  expect(labels.before[0]).toMatch(/^\d+…$|^$/);
  expect(labels.before[1]).toBe("");
  expect(labels.after).toEqual(["a", "b", "x", "y"]);
});

test("rendering a chart with no labels partway through a turn, then again, works", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  await page.evaluate(async () => {
    svg.transition().duration(1000).call(chart.orientation("horizontal"));
    await new Promise(resolve => setTimeout(resolve, 200));
    svg.transition().duration(1000).call(chart.dimensions([]));
    await new Promise(resolve => setTimeout(resolve, 200));
    svg.transition().duration(1000).call(chart.dimensions(["A", "B", "C"]));
  });
  await settled(page);
  expect(await page.locator(".ribbon path").count()).toBeGreaterThan(0);
});

test("releasing a dragged category away from it ends its highlight", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B"]).duration(0)));
  await settled(page);
  const box = await page.locator("g.dimension").first().locator("g.category").first().locator("rect").first().boundingBox();
  await page.mouse.move(box.x + 10, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 10, box.y + 400, {steps: 4});
  await page.mouse.up();
  await settled(page);
  await expect(page.locator(".ribbon path.active")).toHaveCount(0);
  await expect(page.locator(".ribbon path.inactive")).toHaveCount(0);
});

test("a turn that adds ribbons starts them reversed within their categories", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B"]).spacing(0).duration(0)));
  await settled(page);
  const offsets = await page.evaluate(() => {
    svg.datum([...rows, {A: "a", B: "z"}]).transition().duration(1000).call(chart.orientation("horizontal"));
    const ribbon = [...svg.node().querySelectorAll(".ribbon path")].find(n => n.__data__.path === "a\0z").__data__;
    const s = ribbon.source;
    return {x0: s.x0, reversed: s.node.dx - s.x - s.dx};
  });
  expect(offsets.x0).toBeCloseTo(offsets.reversed, 6);
  await settled(page);
});

test("dragging a dimension while categories are still sliding keeps ribbons attached", async ({page}) => {
  await page.evaluate(() => mount([...rows, {A: "b", B: "y", C: "m"}], c => c.dimensions(["A", "B", "C"]).duration(400)));
  await settled(page);
  await page.locator("tspan.sort.value").nth(1).dispatchEvent("click");
  await page.waitForTimeout(60);
  await dragFirstHeading(page);
  await settled(page);
  const attached = await page.evaluate(() => [...svg.node().querySelectorAll(".ribbon path")].every(n => {
    const d = n.__data__;
    const [sx, sy, tx, ty] = n.getAttribute("d").match(/^M([^,]+),([^L]+)L([^,]+),([^h]+)/).slice(1).map(Number);
    const close = (a, b) => Math.abs(a - b) < 0.01;
    return close(sx, d.source.node.x + d.source.x) && close(sy, d.source.dimension.y + d.source.dy)
      && close(tx, d.target.node.x + d.target.x) && close(ty, d.target.dimension.y + d.target.dy);
  }));
  expect(attached).toBe(true);
});

test("a sort mark clears when new data leaves the categories out of its order", async ({page}) => {
  const result = await page.evaluate(() => {
    const kept = new Map();
    const data = [{A: "a", B: "x"}, {A: "b", B: "x"}, {A: "b", B: "y"}];
    mount(data, c => c.dimensions(["A", "B"]).duration(0)
      .on("sortCategories.test", (name, order) => kept.set(name, order))
      .categorySort(name => kept.has(name) && ((a, b) => kept.get(name).indexOf(a.name) - kept.get(name).indexOf(b.name))));
    const value = svg.node().querySelector("tspan.sort.value");
    value.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    const sorted = value.getAttribute("class");
    svg.call(chart);
    const resized = value.getAttribute("class");
    // Now "a" outnumbers "b", so the kept order is no longer largest first.
    svg.datum([...data, {A: "a", B: "y"}, {A: "a", B: "y"}]).call(chart);
    return [sorted, resized, value.getAttribute("class")];
  });
  expect(result).toEqual(["sort value descending", "sort value descending", "sort value"]);
});

test("dimensions may be an iterator or repeat names, and null restores the default", async ({page}) => {
  const names = await page.evaluate(() => {
    const shown = () => [...svg.node().querySelectorAll("g.dimension")].map(n => n.__data__.name);
    mount(rows, c => c.dimensions(new Set(["B", "A"]).values()).duration(0));
    const first = shown();
    svg.call(chart);
    const again = shown();
    svg.call(chart.dimensions(["A", "B", "A"]));
    const repeated = shown();
    svg.call(chart.dimensions(null));
    return {first, again, repeated, auto: shown()};
  });
  expect(names).toEqual({first: ["B", "A"], again: ["B", "A"], repeated: ["B", "A"], auto: ["B", "A", "C"]});
});

test("a chart nested inside another keeps its own tooltip", async ({page}) => {
  const visible = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).duration(0));
    const inner = svg.append("g").datum(rows).call(parsets().dimensions(["B", "C"]).width(300).height(200).duration(0));
    svg.call(chart);
    const path = inner.node().querySelector(".ribbon-mouse path");
    const r = path.getBoundingClientRect();
    path.dispatchEvent(new MouseEvent("mousemove", {clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true}));
    return getComputedStyle(inner.node().querySelector(":scope > .parsets-tooltip")).visibility;
  });
  expect(visible).toBe("visible");
});

test("render draws the chart without animating it", async ({page}) => {
  const pending = await page.evaluate(async () => {
    const node = parsets().dimensions(["A", "B", "C"]).render(rows);
    // Transitions of no duration end on the next frame.
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    return [node, ...node.querySelectorAll("*")].filter(n => n.__transition).length;
  });
  expect(pending).toBe(0);
});

test("charts made with render animate their interactions", async ({page}) => {
  const moving = await page.evaluate(async () => {
    mount();
    const node = parsets().dimensions(["A", "B", "C"]).duration(300).render(rows, document.body);
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    node.querySelectorAll("tspan.sort.value")[2].dispatchEvent(new MouseEvent("click", {bubbles: true}));
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    const moving = [...node.querySelectorAll("g.category")].some(n => Math.abs(n.transform.baseVal.consolidate().matrix.e - n.__data__.x) > 1);
    node.remove();
    return moving;
  });
  expect(moving).toBe(true);
});

test("value(null) restores the default weight of one", async ({page}) => {
  const result = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).value(() => 5).value(null).duration(0));
    return [chart.value()(rows[0], 0), svg.node().querySelector("g.dimension").__data__.categories.reduce((s, c) => s + c.count, 0)];
  });
  expect(result).toEqual([1, 3]);
});

test("dimension formatters get each dimension's current position", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0).dimensionFormat((name, i) => `${i}:${name}`)));
  await settled(page);
  await dragFirstHeading(page);
  const headers = await page.evaluate(() => [...svg.node().querySelectorAll("g.dimension")]
    .sort((a, b) => a.__data__.y - b.__data__.y).map(n => n.querySelector("tspan.name").textContent));
  expect(headers).toEqual(["0:B", "1:A", "2:C"]);
});

test("reduced motion applies from when it is chosen, without a render", async ({page}) => {
  // The first render's long transitions have nothing to move, so do not wait for them.
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(5000)));
  await page.emulateMedia({reducedMotion: "reduce"});
  const atRest = await page.evaluate(async () => {
    svg.node().querySelectorAll("tspan.sort.value")[2].dispatchEvent(new MouseEvent("click", {bubbles: true}));
    for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
    return [...svg.node().querySelectorAll("g.category")].every(n => Math.abs(n.transform.baseVal.consolidate().matrix.e - n.__data__.x) < 0.01);
  });
  expect(atRest).toBe(true);
});

test("animations redraw each ribbon at most once a frame", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const most = await page.evaluate(async () => {
    let most = 0;
    const observer = new MutationObserver(records => {
      const counts = new Map();
      for (const r of records) counts.set(r.target, (counts.get(r.target) ?? 0) + 1);
      most = Math.max(most, ...counts.values());
    });
    observer.observe(svg.node().querySelector(".ribbon"), {attributes: true, attributeFilter: ["d"], subtree: true});
    svg.transition().duration(300).call(chart.height(400).tension(0.5));
    await new Promise(resolve => setTimeout(resolve, 400));
    observer.disconnect();
    return most;
  });
  expect(most).toBe(1);
});

test.describe("multi-touch", () => {
  test.use({hasTouch: true});

  test("one finger lifting does not end another's drag", async ({page}) => {
    await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
    await settled(page);
    const centre = async (dimension, i) => {
      const box = await page.locator("g.dimension").nth(dimension).locator("g.category").nth(i).locator("rect").first().boundingBox();
      return {x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2)};
    };
    const first = await centre(0, 0);
    const second = await centre(2, 0);
    const client = await page.context().newCDPSession(page);
    const touch = (type, points) => client.send("Input.dispatchTouchEvent", {type, touchPoints: points});
    const at = (p, id, dx = 0) => ({x: p.x + dx, y: p.y, id});
    await touch("touchStart", [at(first, 0)]);
    await touch("touchStart", [at(first, 0), at(second, 1)]);
    await touch("touchMove", [at(first, 0, 5), at(second, 1, 5)]);
    // Lift the first finger, while the second keeps dragging.
    await touch("touchEnd", [at(second, 1, 5)]);
    await touch("touchMove", [at(second, 1, 10)]);
    const lit = await page.locator(".ribbon path.active").count();
    await touch("touchEnd", []);
    await settled(page);
    expect(lit).toBeGreaterThan(0);
    await expect(page.locator(".ribbon path.active")).toHaveCount(0);
  });
});

test("dragging a category moves the ribbon ends in the dimensions either side", async ({page}) => {
  await page.evaluate(() => mount([{A: "a", B: "x"}, {A: "a", B: "y"}, {A: "b", B: "x"}, {A: "a", B: "y"}],
    c => c.dimensions(["A", "B"]).duration(100)));
  await settled(page);
  const box = await page.locator("g.dimension").nth(1).locator("g.category").filter({hasText: "y"}).locator("rect").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 300, box.y + box.height / 2, {steps: 8});
  await page.mouse.up();
  await settled(page);
  expect(await page.evaluate(() => document.querySelectorAll("g.dimension")[1].__data__.categories.map(c => c.name))).toEqual(["y", "x"]);
  const attached = await page.evaluate(() => [...svg.node().querySelectorAll(".ribbon path")].every(n => {
    const d = n.__data__;
    const [sx, , tx] = n.getAttribute("d").match(/^M([^,]+),([^L]+)L([^,]+),/).slice(1).map(Number);
    return Math.abs(sx - (d.source.node.x + d.source.x)) < 0.01 && Math.abs(tx - (d.target.node.x + d.target.x)) < 0.01;
  }));
  expect(attached).toBe(true);
});

test("highlighted ribbons stay stacked largest first", async ({page}) => {
  await page.evaluate(() => mount([{A: "a", B: "y"}, {A: "a", B: "x"}, {A: "a", B: "x"}, {A: "a", B: "x"}, {A: "b", B: "x"}],
    c => c.dimensions(["A", "B"]).duration(0)));
  await settled(page);
  await page.locator("g.dimension").first().locator("g.category").filter({hasText: "a"}).dispatchEvent("mousemove", {clientX: 100, clientY: 40});
  const counts = await page.locator(".ribbon path.active").evaluateAll(nodes => nodes.map(n => n.__data__.count));
  expect(counts).toEqual([3, 1]);
});

test("data may be read only once, and may be any iterable", async ({page}) => {
  await page.evaluate(() => {
    const generate = function*() { yield* rows; };
    mount(generate(), c => c.dimensions(["A", "B", "C"]).duration(0));
  });
  await settled(page);
  await dragFirstHeading(page);
  expect(await page.locator(".ribbon path").count()).toBeGreaterThan(0);
  const auto = await page.evaluate(() => {
    mount(new Set(rows), c => c.duration(0));
    return [...svg.node().querySelectorAll("g.dimension")].map(n => n.__data__.name);
  });
  expect(auto).toEqual(["A", "B", "C"]);
});

test("without animation, a render is complete when the call returns", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const result = await page.evaluate(() => {
    svg.call(chart.orientation("horizontal").height(500));
    return {
      pending: [...svg.node().querySelectorAll("*")].filter(n => n.__transition).length,
      placed: [...svg.node().querySelectorAll("g.dimension")]
        .every(n => Math.abs(n.transform.baseVal.consolidate().matrix.f - n.__data__.y) < 1e-6)
    };
  });
  expect(result).toEqual({pending: 0, placed: true});
});

test("without animation, a caller's transition can still be configured after calling the chart", async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"])));
  await settled(page);
  const ended = await page.evaluate(() => new Promise(resolve => {
    svg.transition().duration(50).call(chart.tension(0.5)).attr("data-done", "yes").on("end", () => resolve(true));
  }));
  expect(ended).toBe(true);
  await expect(page.locator("svg")).toHaveAttribute("data-done", "yes");
});

test("dimension accessors get array data as it is, and extra call arguments are ignored", async ({page}) => {
  const result = await page.evaluate(() => {
    const data = rows.slice();
    data.columns = ["C", "A"];
    mount(data, c => c.dimensions(d => d.columns).duration(300));
    const names = [...svg.node().querySelectorAll("g.dimension")].map(n => n.__data__.name);
    svg.call(chart.height(400), {});
    const animating = [...svg.node().querySelectorAll("g.dimension")].some(n => n.__transition);
    svg.call(chart.dimensions("A"));
    const single = [...svg.node().querySelectorAll("g.dimension")].map(n => n.__data__.name);
    return {names, animating, single};
  });
  expect(result).toEqual({names: ["C", "A"], animating: true, single: ["A"]});
  await settled(page);
});

test("shortened labels keep emoji whole", async ({page}) => {
  const labels = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).width(200).duration(0).categoryFormat(() => "🚀".repeat(20)));
    return [...svg.node().querySelectorAll("g.category text")].map(n => n.textContent);
  });
  for (const label of labels) expect(label).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
});

test("a render that throws partway through a turn lets the turn finish", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  await page.evaluate(async () => {
    svg.transition().duration(1000).call(chart.orientation("horizontal"));
    await new Promise(resolve => setTimeout(resolve, 300));
    try {
      svg.transition().duration(1000).call(chart.dimensionFormat(() => { throw new Error("bad"); }));
    } catch {
      // Expected.
    }
  });
  await settled(page);
  expect(await page.evaluate(() => svg.select(".parsets-plot").attr("transform"))).toBe("matrix(0,1,1,0,0,30)");
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  expect(await page.locator(".ribbon path.active").count()).toBeGreaterThan(0);
});

test("a color accessor fills hover bands without outlining them", async ({page}) => {
  const strokes = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).duration(0).color(() => "rgb(1, 2, 3)"));
    return [...svg.node().querySelectorAll("g.dimension")][0].querySelectorAll("g.category > rect:first-child")
      .values().map(n => [n.style.fill, n.style.stroke]).toArray();
  });
  expect(strokes.length).toBeGreaterThan(0);
  for (const [fill, stroke] of strokes) expect([fill, stroke]).toEqual(["rgb(1, 2, 3)", ""]);
});

test("a failed render keeps the drag cursors of the orientation still drawn", async ({page}) => {
  const horizontal = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).duration(0));
    try {
      svg.call(chart.orientation("horizontal").dimensionFormat(() => { throw new Error("bad"); }));
    } catch {
      // Expected.
    }
    return svg.classed("parsets-horizontal");
  });
  expect(horizontal).toBe(false);
});

test("a category swap leaves ribbons before the previous dimension alone, and updates hover paths", async ({page}) => {
  await page.evaluate(() => mount([{A: "a", B: "x", C: "m"}, {A: "b", B: "y", C: "n"}, {A: "a", B: "y", C: "m"}],
    c => c.dimensions(["A", "B", "C"]).duration(100)));
  await settled(page);
  await page.evaluate(() => {
    window.changed = new Set();
    window.observer = new MutationObserver(records => records.forEach(r => window.changed.add(r.target.__data__.path)));
    for (const path of svg.node().querySelectorAll(".ribbon path")) {
      if (path.__data__.target.dimension.name === "B") window.observer.observe(path, {attributes: true, attributeFilter: ["d"]});
    }
  });
  const box = await page.locator("g.dimension").nth(2).locator("g.category").filter({hasText: "n"}).locator("rect").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 400, box.y + box.height / 2, {steps: 8});
  await page.mouse.up();
  await settled(page);
  expect(await page.evaluate(() => document.querySelectorAll("g.dimension")[2].__data__.categories.map(c => c.name))).toEqual(["n", "m"]);
  // Swapping C's categories reorders nothing through A and B.
  expect(await page.evaluate(() => { window.observer.disconnect(); return [...window.changed]; })).toEqual([]);
  const hover = await page.evaluate(() => [...svg.node().querySelectorAll(".ribbon-mouse path")].every(n => {
    const d = n.__data__;
    const [sx, , tx] = n.getAttribute("d").match(/^M([^,]+),([^L]+)L([^,]+),/).slice(1).map(Number);
    return Math.abs(sx - (d.source.node.x + d.source.x)) < 0.01 && Math.abs(tx - (d.target.node.x + d.target.x)) < 0.01;
  }));
  expect(hover).toBe(true);
});

test("hovering is ignored while the chart turns", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const lit = await page.evaluate(async () => {
    svg.transition().duration(1000).call(chart.orientation("horizontal"));
    await new Promise(resolve => setTimeout(resolve, 300));
    svg.node().querySelector(".ribbon-mouse path").dispatchEvent(new MouseEvent("mousemove", {clientX: 100, clientY: 100, bubbles: true}));
    return {
      active: svg.node().querySelectorAll(".ribbon path.active").length,
      tooltip: getComputedStyle(svg.node().querySelector(".parsets-tooltip")).visibility
    };
  });
  expect(lit).toEqual({active: 0, tooltip: "hidden"});
  await settled(page);
});

test("settings reject the wrong kind of value, and null restores their defaults", async ({page}) => {
  const result = await page.evaluate(() => {
    const errors = [];
    for (const set of [c => c.color(["red", "blue"]), c => c.categorySort(true), c => c.tooltip("text"), c => c.categoryFormat(1)]) {
      try { set(parsets()); } catch (error) { errors.push(error.constructor.name); }
    }
    const chart = parsets().width(100).height(100).spacing(5).tension(0.5).duration(10).nodeThickness(3);
    chart.width(null).height(null).spacing(null).tension(null).duration(null).nodeThickness(null);
    return {errors, defaults: [chart.width(), chart.height(), chart.spacing(), chart.tension(), chart.duration(), chart.nodeThickness()]};
  });
  expect(result.errors).toEqual(["TypeError", "TypeError", "TypeError", "TypeError"]);
  expect(result.defaults).toEqual([960, 600, 20, 1, 500, 0]);
});

test("with reduced motion, a delayed orientation change happens at once with labels showing", async ({page}) => {
  await page.emulateMedia({reducedMotion: "reduce"});
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"])));
  const result = await page.evaluate(() => {
    svg.transition().delay(500).duration(1000).call(chart.orientation("horizontal"));
    return {
      frame: svg.select(".parsets-plot").attr("transform"),
      hidden: [...svg.node().querySelectorAll("text")].filter(n => getComputedStyle(n).opacity === "0").length
    };
  });
  expect(result).toEqual({frame: "matrix(0,1,1,0,0,30)", hidden: 0});
  await settled(page);
});

test("moving within a ribbon moves its tooltip without re-adding it", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)));
  await settled(page);
  const moved = await page.evaluate(async () => {
    const path = svg.node().querySelector(".ribbon-mouse path");
    path.dispatchEvent(new MouseEvent("mousemove", {clientX: 100, clientY: 100, bubbles: true}));
    const changes = [];
    const observer = new MutationObserver(records => changes.push(...records));
    observer.observe(svg.node(), {childList: true});
    path.dispatchEvent(new MouseEvent("mousemove", {clientX: 110, clientY: 105, bubbles: true}));
    await Promise.resolve();
    observer.disconnect();
    return changes.length;
  });
  expect(moved).toBe(0);
});

test("an interaction whose callback throws changes nothing", async ({page}) => {
  const order = () => page.evaluate(() => [...document.querySelectorAll("g.dimension")]
    .sort((a, b) => a.__data__.y - b.__data__.y)
    .map(n => `${n.__data__.name}:${n.__data__.categories.map(c => c.name).join("")}`));
  // A sort whose key throws.
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(0)
    .categorySortKey(() => { throw new Error("bad key"); })));
  await settled(page);
  const before = await order();
  await page.locator("tspan.sort.key").first().dispatchEvent("click");
  expect(await order()).toEqual(before);
  // A category drag whose new position makes a label throw.
  await page.evaluate(() => svg.call(chart.categorySortKey(null)
    .categoryFormat((name, i) => { if (name === "b" && i === 0) throw new Error("bad label"); return name; })));
  await settled(page);
  const box = await page.locator("g.dimension").first().locator("g.category").filter({hasText: "b"}).locator("rect").first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 600, box.y + box.height / 2, {steps: 6});
  await page.mouse.up();
  await settled(page);
  expect(await order()).toEqual(before);
  // A dimension drag whose new first dimension makes a colour throw.
  await page.evaluate(() => svg.call(chart.categoryFormat(null)
    .color(name => { if (name === "x") throw new Error("bad colour"); return null; })));
  await settled(page);
  await dragFirstHeading(page);
  expect(await order()).toEqual(before);
  // The chart still works.
  await page.locator(".ribbon-mouse path").first().dispatchEvent("mousemove", {clientX: 100, clientY: 100});
  expect(await page.locator(".ribbon path.active").count()).toBeGreaterThan(0);
  const messages = errors.get(page);
  expect(messages.some(m => m.includes("bad key"))).toBe(true);
  expect(messages.some(m => m.includes("bad label"))).toBe(true);
  expect(messages.some(m => m.includes("bad colour"))).toBe(true);
  errors.set(page, []);
});

test("a failed render leaves sort marks and colour slots as they were", async ({page}) => {
  const result = await page.evaluate(() => {
    mount(rows, c => c.dimensions(["A", "B"]).duration(0));
    svg.node().querySelector("tspan.sort.key").dispatchEvent(new MouseEvent("click", {bubbles: true}));
    const markup = svg.node().innerHTML;
    const errors = [];
    // A key sort's mark is checked with categorySortKey before the render changes anything.
    try { svg.call(chart.categorySortKey(() => { throw new Error("bad key"); })); } catch (error) { errors.push(error.message); }
    chart.categorySortKey(null);
    // New data that would give "c" a colour slot, then fails.
    try {
      svg.datum([{A: "c", B: "x"}, {A: "b", B: "y"}]).call(chart.categoryFormat(() => { throw new Error("bad label"); }));
    } catch (error) { errors.push(error.message); }
    const unchanged = svg.node().innerHTML === markup;
    chart.categoryFormat(null);
    // Sorting the chart left on screen keeps its colours.
    svg.node().querySelectorAll("tspan.sort.value")[0].dispatchEvent(new MouseEvent("click", {bubbles: true}));
    const classes = [...svg.node().querySelectorAll("g.dimension")][0].querySelectorAll("g.category > rect:first-child")
      .values().map(n => `${n.__data__.name}:${n.getAttribute("class")}`).toArray().sort();
    return {errors, unchanged, classes};
  });
  expect(result.errors).toEqual(["bad key", "bad label"]);
  expect(result.unchanged).toBe(true);
  expect(result.classes).toEqual(["a:category-0", "b:category-1"]);
});

// Keeps dragged and sorted orders across renders, as the README suggests.
async function keepOrders(page) {
  await page.evaluate(() => {
    window.keepOrders = c => {
      const orders = new Map();
      return c
        .on("sortCategories.test", (dimension, order) => orders.set(dimension, order))
        .on("sortDimensions.test", order => c.dimensions(order))
        .categorySort(dimension => orders.has(dimension)
          ? (a, b) => orders.get(dimension).indexOf(a.name) - orders.get(dimension).indexOf(b.name)
          : null);
    };
  });
}

test("a render that leaves moving categories' destinations alone lets them carry on", async ({page}) => {
  // Each category has one ribbon, so the ribbon's end is at the bar's
  // displayed left edge.
  await keepOrders(page);
  await page.evaluate(() => mount([{A: "a", B: "y"}, {A: "b", B: "x"}], c => keepOrders(c.dimensions(["A", "B"]).duration(600))));
  await settled(page);
  const result = await page.evaluate(async () => {
    // Sort B's categories from A to Z, which swaps them.
    document.querySelectorAll("g.dimension")[1].querySelector("tspan.sort.key")
      .dispatchEvent(new MouseEvent("click", {bubbles: true}));
    const start = performance.now();
    const categories = () => [...document.querySelectorAll("g.dimension")[1].querySelectorAll("g.category")];
    const frames = [];
    let rendered = false;
    let settledAt;
    while (performance.now() - start < 1200) {
      await new Promise(requestAnimationFrame);
      const elapsed = performance.now() - start;
      if (!rendered && elapsed > 250) {
        rendered = true;
        svg.call(chart.tension(0.5));
      }
      const bars = new Map(categories().map(n => [n.__data__, n.transform.baseVal.consolidate().matrix.e]));
      // A ribbon's end in B: after M and L, or the second C's end point.
      const ends = [...document.querySelectorAll(".ribbon path")].map(path => {
        const n = path.getAttribute("d").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g).map(Number);
        return {ribbon: n.length > 7 ? n[6] : n[2], bar: bars.get(path.__data__.target.node)};
      });
      frames.push({elapsed, ends});
      if (settledAt === undefined && categories().every(n => !n.__transition)) settledAt = elapsed;
    }
    return {
      settledAt,
      frames,
      resting: categories().map(n => [n.__data__.name, n.transform.baseVal.consolidate().matrix.e, n.__data__.x])
        .sort((a, b) => a[2] - b[2]),
      curved: [...document.querySelectorAll(".ribbon path")].every(n => n.getAttribute("d").includes("C"))
    };
  });
  // Without the render, the sort ends at 600ms; starting again at 250ms
  // would end it at 850ms.
  expect(result.settledAt).toBeLessThan(700);
  for (const frame of result.frames) {
    for (const end of frame.ends) expect(end.ribbon).toBeCloseTo(end.bar, 3);
  }
  expect(result.resting.map(([name]) => name)).toEqual(["x", "y"]);
  for (const [, shown, x] of result.resting) expect(shown).toBeCloseTo(x, 6);
  expect(result.curved).toBe(true);
  await settled(page);
});

test("a render that leaves a moving dimension's destination alone lets it carry on", async ({page}) => {
  await keepOrders(page);
  await page.evaluate(() => mount(rows, c => keepOrders(c.dimensions(["A", "B", "C"]).duration(600))));
  await settled(page);
  // Drag A below C, which moves B and C up.
  const box = await page.locator("tspan.name").first().boundingBox();
  const x = box.x + 10, y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x, y + i * 60);
  const result = await page.evaluate(async () => {
    const start = performance.now();
    const moving = () => [...document.querySelectorAll("g.dimension")].filter(n => n.__data__.name !== "A");
    let rendered = false;
    let settledAt;
    while (performance.now() - start < 1200) {
      await new Promise(requestAnimationFrame);
      const elapsed = performance.now() - start;
      if (!rendered && elapsed > 250) {
        rendered = true;
        svg.call(chart.tension(0.5));
      }
      if (settledAt === undefined && moving().every(n => !n.__transition)) settledAt = elapsed;
    }
    return {settledAt, order: chart.dimensions()(rows)};
  });
  await page.mouse.up();
  expect(result.order).toEqual(["B", "C", "A"]);
  // B and C started moving up during the drag, at most 600ms before the end.
  expect(result.settledAt).toBeLessThan(700);
  await settled(page);
});

test("labels as shown before a turn fade out as it starts", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(600)));
  await settled(page);
  const labels = await page.evaluate(() => [...document.querySelectorAll(".parsets-plot text")].map(n => n.textContent));
  const result = await page.evaluate(async () => {
    const layer = () => document.querySelector(".parsets-turning-labels");
    svg.call(chart.orientation("horizontal"));
    const copies = [...layer().querySelectorAll("text")].map(n => n.textContent);
    const opacities = [];
    while (layer()) {
      opacities.push(+getComputedStyle(layer()).opacity);
      await new Promise(requestAnimationFrame);
    }
    return {copies, opacities};
  });
  expect(result.copies).toEqual(labels);
  // Fading out over the start of the turn, and gone at its end.
  expect(result.opacities.length).toBeGreaterThan(3);
  for (let i = 1; i < result.opacities.length; i++) expect(result.opacities[i]).toBeLessThanOrEqual(result.opacities[i - 1] + 1e-9);
  expect(result.opacities.at(-1)).toBe(0);
  await settled(page);
});
test("labels fading out as the chart turns stay with what they label", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(400)));
  await settled(page);
  const {drift, frames} = await page.evaluate(async () => {
    svg.call(chart.orientation("horizontal"));
    const layer = document.querySelector(".parsets-turning-labels");
    const groups = [...document.querySelectorAll("g.dimension, g.category")];
    // Each copy as placed in the dimension or category it labels.
    const placed = () => layer.__copies.filter(c => c.category ?? c.dimension).map(({node, category, dimension}) => {
      const group = groups.find(n => n.__data__ === (category ?? dimension));
      const m = group.getScreenCTM().inverse().multiply(node.querySelector("text").getScreenCTM());
      return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    const start = placed();
    let drift = 0;
    let frames = 0;
    while (true) {
      await new Promise(requestAnimationFrame);
      if (!layer.isConnected) break;
      placed().forEach((m, i) => m.forEach((v, j) => drift = Math.max(drift, Math.abs(v - start[i][j]))));
      frames++;
    }
    return {drift, frames};
  });
  expect(frames).toBeGreaterThan(3);
  expect(drift).toBeLessThan(0.5);
});

test("a render partway through a turn keeps dimensions and categories in step with the plot", async ({page}) => {
  await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(400)));
  await settled(page);
  const {plotEnd, movesEnd} = await page.evaluate(async () => {
    const plot = document.querySelector(".parsets-plot");
    svg.call(chart.orientation("horizontal"));
    const start = performance.now();
    while (performance.now() - start < 200) await new Promise(requestAnimationFrame);
    svg.call(chart.tension(0.5));
    let plotEnd;
    let movesEnd;
    while (plotEnd === undefined || movesEnd === undefined) {
      await new Promise(requestAnimationFrame);
      const t = performance.now() - start;
      if (plotEnd === undefined && !plot.__transition) plotEnd = t;
      if (movesEnd === undefined && ![...document.querySelectorAll("g.dimension, g.category")].some(n => n.__transition)) movesEnd = t;
    }
    return {plotEnd, movesEnd};
  });
  // The render's timing applies to both, rather than the turn's to the moves.
  expect(Math.abs(movesEnd - plotEnd)).toBeLessThan(50);
});

for (const [from, to] of [["vertical", "horizontal"], ["horizontal", "vertical"]]) {
  test(`bars and ribbons start a turn from ${from} where they were shown`, async ({page}) => {
    await page.evaluate(from => mount(rows, c => c.dimensions(["A", "B", "C"]).duration(600).orientation(from)), from);
    await settled(page);
    const {before, start} = await page.evaluate(to => {
      // Spacing between categories does not scale, so scaling the plot by
      // the axes' lengths would draw every bar a little wider or narrower.
      const boxes = () => [...document.querySelectorAll(".parsets-plot g.category line, .parsets-plot .ribbon path")].map(n => {
        const r = n.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      });
      const before = boxes();
      svg.call(chart.orientation(to));
      return {before, start: boxes()};
    }, to);
    expect(start.length).toBe(before.length);
    start.forEach((box, i) => box.forEach((v, j) => expect(Math.abs(v - before[i][j])).toBeLessThan(0.01)));
    await settled(page);
  });
}

test("a move that carries on through a render keeps to its path, even with an elastic ease", async ({page}) => {
  for (const at of [25, 30, 35, 40, 45]) {
    await page.evaluate(() => mount(rows, c => c.dimensions(["A", "B", "C"])));
    await settled(page);
    const {low, high, seen} = await page.evaluate(async at => {
      const {easeElastic} = await import("d3-ease");
      const node = [...document.querySelectorAll(".parsets-plot g.dimension")].find(n => n.__data__.name === "C");
      const y = () => node.transform.baseVal.consolidate().matrix.f;
      const from = y();
      svg.transition().duration(500).ease(easeElastic).call(chart.height(400));
      const to = node.__data__.y;
      // The elastic path's own range, which overshoots its destination.
      const path = Array.from({length: 1001}, (_, i) => from + (to - from) * easeElastic(i / 1000));
      const start = performance.now();
      while (performance.now() - start < at) await new Promise(requestAnimationFrame);
      // Only the tension changes, so C carries on to the same place.
      svg.call(chart.tension(0.5));
      const seen = [];
      while (node.__transition) {
        await new Promise(requestAnimationFrame);
        seen.push(y());
      }
      return {low: Math.min(...path), high: Math.max(...path), seen};
    }, at);
    expect(seen.length).toBeGreaterThan(3);
    for (const v of seen) {
      expect(v).toBeGreaterThan(low - 2);
      expect(v).toBeLessThan(high + 2);
    }
  }
});
