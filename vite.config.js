import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";
import process from "node:process";
import { readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

/* 版本号只有一处来源：`src-tauri/tauri.conf.json`（安装包文件名与 exe 属性用的都是它）。
   注进前端给 `src/lib/version.ts` 读 —— 底栏那颗 pill 与「关于」页都从那里取，
   界面里不许再写死版本。构建时间也在这一刻钉住（打进包里就不会变）。
   `tmp/perf-guard.test.mjs` 顺带盯着 tauri.conf.json / Cargo.toml / package.json 三处一致。 */
const 配置 = JSON.parse(readFileSync(new URL("./src-tauri/tauri.conf.json", import.meta.url), "utf8"));
const 现在 = new Date();
/** @param {number} n */
const 两位 = (n) => String(n).padStart(2, "0");
const 构建时间 =
  `${现在.getFullYear()}-${两位(现在.getMonth() + 1)}-${两位(现在.getDate())} ` +
  `${两位(现在.getHours())}:${两位(现在.getMinutes())}`;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [sveltekit()],

  define: {
    __APP_VERSION__: JSON.stringify(配置.version),
    __BUILD_TIME__: JSON.stringify(构建时间),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
