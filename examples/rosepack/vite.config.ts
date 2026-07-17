import { defineConfig } from 'vite-plus'
import { rosepack } from 'rosepack/vite'

export default defineConfig({
  plugins: [
    rosepack({
      prefixCommands: {
        directory: 'src/prefix-commands',
        scope: 'src/framework.ts'
      },
      slashCommands: {
        directory: 'src/commands'
      }
    })
  ],
  build: {
    outDir: 'dist'
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
    tasks: {
      build: {
        command: 'vp build',
        dependsOn: ['rosepack#build'],
        input: [{ auto: true }, '!dist/**'],
        output: ['dist/**']
      },
      check: {
        command: 'vp check',
        dependsOn: ['rosepack#build'],
        output: []
      },
      test: {
        command: 'vp test',
        dependsOn: ['rosepack#build'],
        output: []
      }
    }
  }
})
