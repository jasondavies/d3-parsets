import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve, sep, extname} from "node:path";

const root = process.cwd();
const types = {".html": "text/html", ".js": "text/javascript", ".css": "text/css"};
createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    const path = resolve(root, `.${pathname}`);
    if (!path.startsWith(root + sep)) throw new Error("Invalid path");
    const body = await readFile(path);
    res.writeHead(200, {"Content-Type": types[extname(path)] || "application/octet-stream"});
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
}).listen(+(process.env.PARSETS_TEST_PORT || 43817), "127.0.0.1");
