#!/usr/bin/env node

import { runRosepackCli } from './cli/index.ts'

await runRosepackCli(process.argv.slice(2))
