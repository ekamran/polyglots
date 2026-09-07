#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()

program
  .name('polyglots')
  .description('Translate WordPress .po files with machine drafts and AI review')
  .version('0.1.0')

program.parse(process.argv)

if (program.args.length === 0) {
  program.outputHelp()
}
