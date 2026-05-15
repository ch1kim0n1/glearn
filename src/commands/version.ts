/**
 * Version command for GLearn
 * Display version information
 */

import { Command } from './command-registry.js';

export const versionCommand: Command = {
  name: 'version',
  description: 'Display version information',
  handler: async () => {
    console.log('GLearn version 0.1.0');
  },
  aliases: ['--version', '-v'],
};
