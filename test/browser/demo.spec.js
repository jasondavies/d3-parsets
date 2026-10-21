import {test, expect} from "@playwright/test";

const errors = new WeakMap();
test.beforeEach(async ({page}) => {
  errors.set(page, []);
  page.on("pageerror", error => errors.get(page).push(error.message));
  page.on("console", message => {
    if (message.type() === "error") errors.get(page).push(message.text());
  });
  await page.goto("/test/index.html");
  await page.waitForFunction(() => document.querySelectorAll("#chart .ribbon path").length > 0);
  await settled(page);
});
test.afterEach(async ({page}) => {
  expect(errors.get(page)).toEqual([]);
});

async function settled(page) {
  await page.waitForFunction(() => [...document.querySelectorAll("svg, svg *")].every(n => !n.__transition));
}

const dimensionOrder = page => page.evaluate(() => [...document.querySelectorAll("#chart g.dimension")]
  .sort((a, b) => a.__data__.y - b.__data__.y).map(n => n.__data__.name));

test("the example charts all 2,201 people on board", async ({page}) => {
  expect(await dimensionOrder(page)).toEqual(["Survived", "Sex", "Age", "Class"]);
  const totals = await page.evaluate(() => [...document.querySelectorAll("#chart g.dimension")]
    .map(n => n.__data__.categories.reduce((sum, c) => sum + c.count, 0)));
  expect(totals).toEqual([2201, 2201, 2201, 2201]);
  expect(await page.locator("#chart svg").innerHTML()).not.toMatch(/NaN|undefined|Infinity/);
});

test("the example curves its ribbons and turns horizontal and back", async ({page}) => {
  const curved = () => page.locator("#chart .ribbon path").first().getAttribute("d").then(d => d.includes("C"));
  await page.locator("#curved").check();
  await settled(page);
  expect(await curved()).toBe(true);
  await page.locator("#horizontal").check();
  await settled(page);
  await expect(page.locator("#chart svg")).toHaveClass(/parsets-horizontal/);
  expect(await page.locator("#chart .parsets-plot").getAttribute("transform")).toBe("matrix(0,1,1,0,0,30)");
  await page.locator("#horizontal").uncheck();
  await settled(page);
  expect(await page.locator("#chart .parsets-plot").getAttribute("transform")).toBeNull();
  expect(await curved()).toBe(true);
});

test("the example keeps dragged and sorted orders when it renders again", async ({page}) => {
  const headings = page.locator("#chart tspan.name");
  const a = await headings.nth(0).boundingBox();
  const b = await headings.nth(1).boundingBox();
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 10, a.y + a.height / 2 + 1.3 * (b.y - a.y), {steps: 10});
  await page.mouse.up();
  await settled(page);
  expect(await dimensionOrder(page)).toEqual(["Sex", "Survived", "Age", "Class"]);
  const classes = () => page.evaluate(() => [...document.querySelectorAll("#chart g.dimension")]
    .find(n => n.__data__.name === "Class").__data__.categories.map(c => c.name));
  const value = page.locator("#chart g.dimension").filter({has: page.locator("tspan.name", {hasText: "Class"})})
    .locator("tspan.sort.value");
  await value.dispatchEvent("click");
  await settled(page);
  const sorted = await classes();
  expect(sorted).toEqual(["Crew", "Third Class", "First Class", "Second Class"]);
  // A render, such as the curve toggle, keeps both orders and the sort mark.
  await page.locator("#curved").check();
  await settled(page);
  expect(await dimensionOrder(page)).toEqual(["Sex", "Survived", "Age", "Class"]);
  expect(await classes()).toEqual(sorted);
  await expect(value).toHaveClass("sort value descending");
});
