#!/usr/bin/env -S npx tsx
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { init } from './commands/init.ts';
import { deploy } from './commands/deploy.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };

const program = new Command();

program
  .name('doxie')
  .description('Ship code and docs in one go — AI-driven documentation for your codebase.')
  .version(pkg.version);

program
  .command('init')
  .description('Scaffold docs/ in the current directory')
  .option('-f, --force', 'Overwrite existing files in the target directory')
  .action((opts: { force?: boolean }) => init({ force: opts.force }));

program
  .command('deploy')
  .description('Publish doxie-docs/ to Google Drive')
  .option('--dry-run', 'Preview without making Drive writes')
  .action(async (opts: { dryRun?: boolean }) => {
    await deploy({ dryRun: opts.dryRun });
  });

await program.parseAsync();
