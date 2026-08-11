import { Command } from 'commander';
import type { Team } from '@linear/sdk';
import { getClient } from '../client.js';
import { errorMessage, outputData, outputError } from '../output.js';
import { fetchAll, parseLimit } from '../paginate.js';

export const teamsCommand = new Command('teams')
  .description('Manage teams');

// Linear exposes no `memberCount` scalar on Team, so it is counted from the
// members connection. Capped at MEMBER_COUNT_CAP; larger teams report the cap.
const MEMBER_COUNT_CAP = 250;

async function memberCount(team: Team): Promise<number> {
  const members = await team.members({ first: MEMBER_COUNT_CAP });
  return members.nodes.length;
}

teamsCommand
  .command('list')
  .description('List all teams')
  .option('--limit <n>', 'Maximum number of teams to return', '250')
  .action(async (opts: { limit?: string }) => {
    try {
      const client = getClient();
      const limit = parseLimit(opts.limit, 250);
      const nodes = await fetchAll(
        ({ first, after }) => client.teams({ first, ...(after ? { after } : {}) }),
        limit
      );
      outputData(
        await Promise.all(
          nodes.map(async (t) => ({
            id: t.id,
            name: t.name,
            key: t.key,
            description: t.description ?? null,
            timezone: t.timezone,
            private: t.private,
            issueCount: t.issueCount,
            memberCount: await memberCount(t),
          }))
        )
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch teams'),
        'FETCH_FAILED'
      );
    }
  });

teamsCommand
  .command('get <id-or-key>')
  .description('Get a single team by ID or key')
  .action(async (idOrKey: string) => {
    try {
      const client = getClient();
      // Try by key first if it looks like a short key (e.g. ENG)
      // Linear's team(id:) query resolves a UUID or a team key (case-insensitive).
      let team;
      try {
        team = await client.team(idOrKey);
      } catch {
        outputError(`Team '${idOrKey}' not found`, 'NOT_FOUND');
      }
      outputData({
        id: team.id,
        name: team.name,
        key: team.key,
        description: team.description ?? null,
        timezone: team.timezone,
        private: team.private,
        issueCount: team.issueCount,
        memberCount: await memberCount(team),
        createdAt: team.createdAt.toISOString(),
        updatedAt: team.updatedAt.toISOString(),
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch team'),
        'FETCH_FAILED'
      );
    }
  });
