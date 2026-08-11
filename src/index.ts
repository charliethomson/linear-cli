import { Command } from 'commander';
import { setHumanMode } from './output.js';
import { setRetryEnabled } from './retry.js';
import { authCommand } from './commands/auth.js';
import { meCommand } from './commands/me.js';
import { teamsCommand } from './commands/teams.js';
import { projectsCommand } from './commands/projects.js';
import { issuesCommand } from './commands/issues.js';
import { statesCommand } from './commands/states.js';
import { labelsCommand } from './commands/labels.js';
import { usersCommand } from './commands/users.js';
import { cyclesCommand } from './commands/cycles.js';

const program = new Command();

program
  .name('linear')
  .description('CLI tool for interacting with Linear, optimized for AI consumption')
  .version('1.0.0')
  .option('--human', 'Enable human-friendly output with colors and tables')
  .option('--no-retry', 'Fail fast instead of retrying rate-limited or transient failures')
  .hook('preAction', (thisCommand) => {
    const opts = thisCommand.opts() as { human?: boolean; retry?: boolean };
    if (opts.human) {
      setHumanMode(true);
    }
    if (opts.retry === false) {
      setRetryEnabled(false);
    }
  });

program.addCommand(authCommand);
program.addCommand(meCommand);
program.addCommand(teamsCommand);
program.addCommand(projectsCommand);
program.addCommand(issuesCommand);
program.addCommand(statesCommand);
program.addCommand(labelsCommand);
program.addCommand(usersCommand);
program.addCommand(cyclesCommand);

program.parse(process.argv);
