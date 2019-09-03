#!/usr/bin/env node

import { createChangeSet, executeChangeSet, generateTemplate, updateTemplate } from './index';

const program = require('commander');
const knownCommands = ['init', 'update', 'create-change-set', 'execute-change-set'];

program
  .version('0.0.1')
  .description('aws organization formation');

program
  .command('init <outFile>')
  .option('--profile [profile]', 'aws profile to use')
  .option('--state-bucket-name [state-bucket-name]', 'bucket name that contains state file', 'organization-formation-${AWS::AccountId}')
  .option('--state-object [state-object]', 'key for object used to store state', 'state.json')
  .description('generate template & initialize organization')
  .action(async (outFile, cmd) => await generateTemplate(outFile, cmd));

program
  .command('update <templateFile>')
  .option('--profile [profile]', 'aws profile to use')
  .option('--state-bucket-name [state-bucket-name]', 'bucket name that contains state file', 'organization-formation-${AWS::AccountId}')
  .option('--state-object [state-object]', 'key for object used to store state', 'state.json')
  .description('update organization')
  .action(async (templateFile, cmd) => await updateTemplate(templateFile, cmd));

program
  .command('create-change-set <templateFile>')
  .option('--profile [profile]', 'aws profile to use')
  .option('--change-set-name [change-set-name]', 'change set name')
  .option('--state-bucket-name [state-bucket-name]', 'bucket name that contains state file', 'organization-formation-${AWS::AccountId}')
  .option('--state-object [state-object]', 'key for object used to store state', 'state.json')
  .description('create change set that can be reviewed and executed later')
  .action(async (templateFile, cmd) => await createChangeSet(templateFile, cmd));

program
  .command('execute-change-set <change-set-name>')
  .option('--profile [profile]', 'aws profile to use')
  .option('--state-bucket-name [state-bucket-name]', 'bucket name that contains state file', 'organization-formation-${AWS::AccountId}')
  .option('--state-object [state-object]', 'key for object used to store state', 'state.json')
  .description('execute previously created change set')
  .action(async (templateFile, cmd) => await executeChangeSet(templateFile, cmd));

let args = process.argv;
if (args.length === 2) {
  args = args.concat('--help');
} else if (knownCommands.indexOf(args[2]) === -1) {
  args = [args[0], args[1], '--help'];
}

program.parse(args);