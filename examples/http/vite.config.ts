import { defineConfig } from 'vite-plus'
import { rosepack } from 'rosepack/vite'

export default defineConfig({
  plugins: [
    rosepack({
      messageContextMenus: false,
      modals: false,
      prefixCommands: false,
      slashCommands: {
        directory: 'src/slash-commands'
      },
      userContextMenus: false
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
      typegen: {
        command: 'vp exec node ../../dist/cli.mjs prepare',
        dependsOn: ['rosepack#build'],
        input: [{ auto: true }, '!.rosepack/**', '!dist/**'],
        output: ['.rosepack/**']
      },
      check: {
        command: 'vp check',
        dependsOn: ['typegen'],
        output: []
      },
      test: {
        command: 'vp test',
        dependsOn: ['typegen'],
        output: []
      }
    }
  }
})
