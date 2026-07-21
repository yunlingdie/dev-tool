import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// Provides the Vue compiler and the test defaults shared by local and CI runs.
export default defineConfig({
  plugins: [vue()],
  server: {
    allowedHosts: ['web.dev-tool.orb.local'],
  },
  // php-parser checks the host word size through Node's process.arch global.
  define: {
    'process.arch': JSON.stringify('x64'),
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'curl-converter',
              test: /node_modules[\/](curlconverter|web-tree-sitter|tree-sitter|tree-sitter-bash|jsesc|lossless-json|yamljs)/,
              priority: 6,
            },
            {
              name: 'certificate-tools',
              test: /node_modules[\/](@peculiar|asn1js|pvtsutils|pvutils|tsyringe|reflect-metadata)/,
              priority: 5,
            },
            {
              name: 'base-encodings',
              test: /node_modules[\/]@scure[\/]base/,
              priority: 4,
            },
            {
              name: 'format-libraries',
              test: /node_modules[\\/](yaml|smol-toml|fast-xml-parser|sql-formatter|diff)/,
              priority: 3,
            },
            {
              name: 'vue-ui',
              test: /node_modules[\\/](@lucide|vue)/,
              priority: 2,
            },
            {
              name: 'vendor',
              test: /node_modules/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
