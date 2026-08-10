import * as d3 from "https://esm.sh/d3@7";
import {renderParsets} from "./render.js";

const data = await d3.csv("./titanic.csv", d => ({
  Class: d.Class,
  Sex: d.Sex,
  Survived: d.Survived,
  count: +d.count
}));

renderParsets(d3.select("svg"), data, {
  width: 960,
  height: 600,
  dimensions: ["Class", "Sex", "Survived"],
  value: d => d.count
});
