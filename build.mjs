// Bundles src/ into self-contained HTML files:
//   dist/index.html     standalone page (open directly or serve)
//   dist/artifact.html  body fragment for publishing as a claude.ai artifact
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');

async function write(result) {
  const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const tpl = readFileSync('src/template.html', 'utf8');
  const [head, body] = tpl.split('<!--BODY-->');
  const bodyWithScript = body.replace('<!--SCRIPT-->', () => `<script>${js}</script>`);
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/artifact.html', head + bodyWithScript);
  writeFileSync(
    'dist/index.html',
    `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}</head>\n<body>\n${bodyWithScript}</body>\n</html>\n`,
  );
  const kb = (Buffer.byteLength(js) / 1024).toFixed(0);
  console.log(`built dist/index.html and dist/artifact.html (script ${kb} KB)`);
}

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !watch,
  target: 'es2020',
  write: false,
  legalComments: 'none',
  logLevel: 'warning',
};

if (watch) {
  const ctx = await esbuild.context({
    ...opts,
    plugins: [{ name: 'html', setup(b) { b.onEnd((r) => r.errors.length || write(r)); } }],
  });
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: 'dist', port: 8080 });
  console.log(`dev server on http://localhost:${port}`);
} else {
  write(await esbuild.build(opts));
}
