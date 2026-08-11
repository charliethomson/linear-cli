import { Command } from 'commander';
import { getClient } from '../client.js';
import { errorMessage, outputData, outputError } from '../output.js';

export const usersCommand = new Command('users')
  .description('Manage users');

usersCommand
  .command('list')
  .description('List users')
  .option('--team <id>', 'Filter by team ID or key (e.g. ENG)')
  .action(async (opts: { team?: string }) => {
    try {
      const client = getClient();
      let userNodes;

      if (opts.team) {
        const team = await client.team(opts.team);
        const members = await team.members();
        userNodes = members.nodes;
      } else {
        const users = await client.users();
        userNodes = users.nodes;
      }

      outputData(
        userNodes.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          displayName: u.displayName,
          active: u.active,
          admin: u.admin,
          avatarUrl: u.avatarUrl ?? null,
        }))
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch users'),
        'FETCH_FAILED'
      );
    }
  });
