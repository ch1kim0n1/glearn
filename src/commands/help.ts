/**
 * Help command for GLearn
 * Display help information
 */

import { Command } from './command-registry.js';
import { getAllCommands } from './command-registry.js';

export const helpCommand: Command = {
  name: 'help',
  description: 'Display help information',
  handler: async () => {
    console.log('GLearn - Meta-learning and reflective layer for the G-Stack');
    console.log('');
    console.log('Usage: glearn <command> [subcommand] [options]');
    console.log('');
    console.log('Available commands:');
    const commands = getAllCommands();
    for (const cmd of commands) {
      console.log(`  ${cmd.name.padEnd(20)} ${cmd.description}`);
    }
    console.log('');
    console.log('For more information on a specific command:');
    console.log('  glearn <command> --help');
  },
  aliases: ['--help', '-h'],
};
