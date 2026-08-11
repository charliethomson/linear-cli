import { Command } from 'commander';
import { getClient } from '../client.js';
import { errorMessage, outputData, outputError } from '../output.js';
import { fetchAll, parseLimit } from '../paginate.js';

export const usersCommand = new Command('users')
  .description('Manage users');

usersCommand
  .command('list')
  .description('List users')
  .option('--team <id>', 'Filter by team ID or key (e.g. ENG)')
  .option('--limit <n>', 'Maximum number of users to return', '250')
  .action(async (opts: { team?: string; limit?: string }) => {
    try {
      const client = getClient();
      const limit = parseLimit(opts.limit, 250);

      const userNodes = opts.team
        ? await (async () => {
            const team = await client.team(opts.team!);
            return fetchAll(
              ({ first, after }) => team.members({ first, ...(after ? { after } : {}) }),
              limit
            );
          })()
        : await fetchAll(
            ({ first, after }) => client.users({ first, ...(after ? { after } : {}) }),
            limit
          );

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
