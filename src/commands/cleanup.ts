/**
 * Cleanup command for GLearn
 * Cleanup old data and receipts
 */

import { Command } from './command-registry.js';

export const cleanupCommand: Command = {
  name: 'cleanup',
  description: 'Cleanup old data and receipts',
  handler: async (args: string[]) => {
    console.log('Cleanup');
  },
  subcommands: [
    {
      name: 'receipts',
      description: 'Cleanup old receipts',
      handler: async (args: string[]) => {
        const days = args[0] ? parseInt(args[0]) : 30;
        console.log(`Cleaning up receipts older than ${days} days...`);
      },
    },
    {
      name: 'patterns',
      description: 'Cleanup old patterns',
      handler: async (args: string[]) => {
        const days = args[0] ? parseInt(args[0]) : 90;
        console.log(`Cleaning up patterns older than ${days} days...`);
      },
    },
    {
      name: 'all',
      description: 'Cleanup all old data',
      handler: async () => {
        console.log('Cleaning up all old data...');
      },
    },
  ],
};
