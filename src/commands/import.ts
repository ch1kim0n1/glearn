/**
 * Import command for GLearn
 * Import patterns, proposals, and data
 */

import { Command } from './command-registry.js';

export const importCommand: Command = {
  name: 'import',
  description: 'Import patterns, proposals, and data',
  handler: async (args: string[]) => {
    console.log('Import data');
  },
  subcommands: [
    {
      name: 'patterns',
      description: 'Import patterns from file',
      handler: async (args: string[]) => {
        const filepath = args[0];
        if (!filepath) {
          console.error('Error: Missing file path');
          return;
        }
        console.log(`Importing patterns from ${filepath}...`);
      },
    },
    {
      name: 'proposals',
      description: 'Import proposals from file',
      handler: async (args: string[]) => {
        const filepath = args[0];
        if (!filepath) {
          console.error('Error: Missing file path');
          return;
        }
        console.log(`Importing proposals from ${filepath}...`);
      },
    },
  ],
};
