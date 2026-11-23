import { defineConfig } from '#q-app';

export default defineConfig(() => ({
  boot: ['vue-query', 'tooltip'],
  css: [
    '~@fontsource/space-mono/400.css',
    '~@fontsource/space-mono/700.css',
    '~@fontsource/eb-garamond/400.css',
    '~@fontsource/eb-garamond/400-italic.css',
    'app.scss',
  ],
  extras: ['material-icons'],
  build: {
    target: { browser: 'baseline-widely-available', node: 'node22' },
    typescript: { strict: true, vueShim: true },
    vueRouterMode: 'history',
    vitePlugins: [
      ['unplugin-vue-components/vite', { globs: ['src/submodules/**/Base*.vue'], dts: 'src/components.d.ts' }],
    ],
  },
  devServer: {
    port: 9082,
    open: false,
    proxy: {
      '/api': {
        target: 'http://localhost:3041',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ''),
      },
    },
  },
  framework: { config: { dark: false }, plugins: [] },
  animations: [],
}));
