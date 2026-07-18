import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    dts: {
      tsgo: true
    },
    entry: ['src/cli.ts', 'src/http.ts', 'src/index.ts', 'src/vite.ts'],
    exports: true
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true
    }
  },
  fmt: {
    quoteProps: 'preserve',
    printWidth: 100,
    singleQuote: true,
    semi: false,
    trailingComma: 'none',
    tabWidth: 2
  },
  test: {
    typecheck: {
      enabled: true
    }
  },
  run: {
    cache: {
      scripts: false,
      tasks: true
    },
    tasks: {
      build: {
        command: 'vp pack',
        input: [{ auto: true }, '!dist/**'],
        output: ['dist/**']
      },
      check: {
        command: 'vp check',
        dependsOn: [
          'build',
          'rosepack-example#typegen',
          'rosepack-example-http#typegen',
          'rosepack-example-starter#typegen'
        ],
        output: []
      },
      test: {
        command: 'vp test',
        dependsOn: [
          'build',
          'rosepack-example#typegen',
          'rosepack-example-http#typegen',
          'rosepack-example-starter#typegen'
        ],
        output: []
      }
    }
  }
})
