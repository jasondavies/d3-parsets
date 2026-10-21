import { format } from "d3-format";

const percent = format(".1%");
const comma = format(",.0f");

function defaultTooltip(d) {
  const count = d.count;
  const path = [];
  while (d.parent) {
    path.unshift(String(d.name));
    d = d.parent;
  }
  return `${path.join(" → ")}\n${comma(count)} (${percent(count / d.count)})`;
}

function defaultCategoryTooltip(d) {
  return `${d.name}\n${comma(d.count)} (${percent(d.count / d.dimension.count)})`;
}

export { defaultCategoryTooltip, defaultTooltip };
