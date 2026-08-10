import terser from "@rollup/plugin-terser";
import meta from "./package.json" with {type: "json"};

const config = {
  input: "src/index.js",
  external: Object.keys(meta.dependencies || {}),
  output: {
    file: `dist/${meta.name}.js`,
    name: "d3",
    format: "umd",
    indent: false,
    extend: true,
    banner: `// ${meta.homepage} v${meta.version} Copyright ${new Date().getFullYear()} ${meta.author.name}`,
    globals: Object.assign({}, ...Object.keys(meta.dependencies || {}).map(key => ({[key]: "d3"})))
  }
};

export default [
  config,
  {
    ...config,
    output: {
      ...config.output,
      file: `dist/${meta.name}.min.js`
    },
    plugins: [
      terser({
        output: {
          preamble: config.output.banner
        }
      })
    ]
  }
];
