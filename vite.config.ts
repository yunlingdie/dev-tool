import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const CURLCONVERTER_WEB_PARSER = /curlconverter[\\/]dist[\\/]src[\\/]shell[\\/]webParser\.js$/

/** Makes curlconverter's public WASM files follow Vite's deployment base path. */
function curlconverterWasmBasePlugin(): Plugin {
  return {
    name: 'curlconverter-wasm-base',
    enforce: 'pre',
    /** Rewrites only curlconverter's browser parser before Vite substitutes BASE_URL. */
    transform(source, id) {
      // Other modules must retain their original dependency code.
      if (!CURLCONVERTER_WEB_PARSER.test(id)) {
        return null
      }

      const coreWasmPath = 'return "/" + scriptName;'
      const bashWasmPath = 'Parser.Language.load("/tree-sitter-bash.wasm")'

      // Dependency upgrades must not silently restore root-relative Pages requests.
      if (!source.includes(coreWasmPath) || !source.includes(bashWasmPath)) {
        throw new Error('curlconverter browser WASM paths have changed')
      }

      return source
        .replace(coreWasmPath, 'return import.meta.env.BASE_URL + scriptName;')
        .replace(
          bashWasmPath,
          'Parser.Language.load(import.meta.env.BASE_URL + "tree-sitter-bash.wasm")',
        )
    },
  }
}

// Provides the Vue compiler and the test defaults shared by local and CI runs.
export default defineConfig({
  plugins: [curlconverterWasmBasePlugin(), vue()],
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
