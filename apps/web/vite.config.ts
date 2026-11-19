import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The rail's faces its first screen draws in (main.tsx imports them): index.css's --fw-regular is 500, labels and
 * buttons --fw-medium 600, titles --fw-semibold 700. Bold and the italics wait until they are used.
 */
const RAIL_FONTS = ['adwaita-sans-latin-500-normal.woff2', 'adwaita-sans-latin-600-normal.woff2', 'adwaita-sans-latin-700-normal.woff2'];

/**
 * Fills in the rail's faces in the built index.html's <meta name="omni-rail-fonts">, so its head script can preload
 * them when it sets the rail layout, and only then. Their file names carry a hash only the build knows.
 */
function railFontsMeta(): Plugin {
  let base = '/';
  return {
    name: 'omni-rail-fonts',
    apply: 'build',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const assets = Object.values(ctx.bundle ?? {}).filter((file) => file.type === 'asset');
        const paths = RAIL_FONTS.map((name) => {
          const font = assets.find((file) => file.names.includes(name));
          if (!font) throw new Error(`the build emitted no ${name}, which index.html's head script preloads`);
          return `${base}${font.fileName}`;
        });
        const empty = '<meta name="omni-rail-fonts" content="" />';
        if (!html.includes(empty)) throw new Error(`index.html lost its ${empty}`);
        return html.replace(empty, `<meta name="omni-rail-fonts" content="${paths.join(' ')}" />`);
      },
    },
  };
}

export default defineConfig({
  // So `vite --config apps/web/vite.config.ts` works from the repo root too (scripts/qa-stack.sh).
  root: import.meta.dirname,
  plugins: [react(), tailwindcss(), railFontsMeta()],
  server: {
    port: 4748,
    proxy: { '/api': { target: `http://127.0.0.1:${process.env.OMNI_PORT ?? 4747}`, changeOrigin: false } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
