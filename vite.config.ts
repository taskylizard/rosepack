import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    dts: {
      tsgo: true
    },
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
        dependsOn: ['build'],
        output: []
      },
      test: {
        command: 'vp test',
        dependsOn: ['build'],
        output: []
      }
    }
  }
})
