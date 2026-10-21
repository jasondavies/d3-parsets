import {defineConfig} from "@playwright/test";

const port = process.env.PARSETS_TEST_PORT || "43817";

export default defineConfig({
  testDir: "test/browser",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    viewport: {width: 1200, height: 900}
  },
  webServer: {
    command: "npm run build:min --silent && node test/server.js",
    url: `http://127.0.0.1:${port}/test/browser/fixture.html`,
    reuseExistingServer: false
  }
});
