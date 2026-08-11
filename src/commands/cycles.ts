import { Command } from 'commander';
import type { LinearClient } from '@linear/sdk';
import { getClient } from '../client.js';
import { NotFoundError, resolveIssueId, resolveTeamId } from '../resolve.js';
import { errorMessage, outputData, outputError, outputSuccess } from '../output.js';

export const cyclesCommand = new Command('cycles')
  .description('Manage cycles (sprints)');

const PAGE_MAX = 250;

const CYCLE_FIELDS = `
  id
  number
  name
  description
  startsAt
  endsAt
  completedAt
  progress
`;

const COMPLETED_STATE_TYPES = new Set(['completed', 'canceled']);

interface CycleTally {
  total: number;
  completed: number;
}

/**
 * Linear exposes no scalar issue counts on Cycle. The history arrays
 * (`issueCountHistory` etc.) are only sampled periodically, so a cycle whose
 * membership changed today reports stale zeros.
 *
 * Counts come from the issues themselves instead — in one flat, paginated
 * query rather than nested under each cycle, which would multiply out past
 * Linear's query-complexity limit as soon as a team has a few cycles.
 */
async function tallyCycleIssues(
  client: LinearClient,
  cycleIds: string[]
): Promise<Map<string, CycleTally>> {
  const tallies = new Map<string, CycleTally>(
    cycleIds.map((id) => [id, { total: 0, completed: 0 }])
  );
  if (cycleIds.length === 0) return tallies;

  let after: string | null = null;
  for (;;) {
    const data: any = await (client.client as any).request(
      `query CycleIssues($ids: [ID!], $after: String) {
        issues(first: ${PAGE_MAX}, after: $after, filter: { cycle: { id: { in: $ids } } }) {
          nodes { cycle { id } state { type } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { ids: cycleIds, after }
    );
    for (const issue of data.issues.nodes) {
      const tally = tallies.get(issue.cycle?.id);
      if (!tally) continue;
      tally.total += 1;
      if (COMPLETED_STATE_TYPES.has(issue.state?.type)) tally.completed += 1;
    }
    if (!data.issues.pageInfo.hasNextPage) break;
    after = data.issues.pageInfo.endCursor;
  }
  return tallies;
}

function shapeCycle(c: any, tally: CycleTally | undefined): Record<string, unknown> {
  const { total, completed } = tally ?? { total: 0, completed: 0 };
  return {
    id: c.id,
    number: c.number,
    name: c.name ?? null,
    description: c.description ?? null,
    startsAt: c.startsAt,
    endsAt: c.endsAt,
    completedAt: c.completedAt ?? null,
    progress: c.progress,
    issueCountTotal: total,
    issueCountCompleted: completed,
    issueCountIncompleted: total - completed,
  };
}

cyclesCommand
  .command('list')
  .description('List cycles for a team')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG)')
  .action(async (opts: { team: string }) => {
    try {
      const client = getClient();
      const data: any = await (client.client as any).request(
        `query TeamCycles($id: String!) {
          team(id: $id) { cycles(first: ${PAGE_MAX}) { nodes { ${CYCLE_FIELDS} } } }
        }`,
        { id: opts.team }
      );
      const cycles = data.team.cycles.nodes;
      const tallies = await tallyCycleIssues(client, cycles.map((c: any) => c.id));
      outputData(cycles.map((c: any) => shapeCycle(c, tallies.get(c.id))));
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch cycles'),
        'FETCH_FAILED'
      );
    }
  });

cyclesCommand
  .command('get <id>')
  .description('Get a cycle by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      let data: any;
      try {
        data = await (client.client as any).request(
          `query Cycle($id: String!) { cycle(id: $id) { ${CYCLE_FIELDS} } }`,
          { id }
        );
      } catch {
        outputError(`Cycle '${id}' not found`, 'NOT_FOUND');
      }
      const tallies = await tallyCycleIssues(client, [data.cycle.id]);
      outputData(shapeCycle(data.cycle, tallies.get(data.cycle.id)));
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch cycle'),
        'FETCH_FAILED'
      );
    }
  });

cyclesCommand
  .command('create')
  .description('Create a new cycle')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG)')
  .requiredOption('--starts <date>', 'Start date (ISO 8601, e.g. 2024-01-01)')
  .requiredOption('--ends <date>', 'End date (ISO 8601, e.g. 2024-01-14)')
  .option('--name <name>', 'Custom cycle name')
  .option('--description <text>', 'Cycle description')
  .action(async (opts: {
    team: string;
    starts: string;
    ends: string;
    name?: string;
    description?: string;
  }) => {
    try {
      const client = getClient();
      const payload = await client.createCycle({
        teamId: await resolveTeamId(client, opts.team),
        startsAt: new Date(opts.starts),
        endsAt: new Date(opts.ends),
        ...(opts.name && { name: opts.name }),
        ...(opts.description && { description: opts.description }),
      });
      const cycle = await payload.cycle;
      if (!cycle) {
        outputError('Failed to create cycle', 'CREATE_FAILED');
      }
      outputSuccess('Cycle created', {
        id: cycle!.id,
        number: cycle!.number,
        name: cycle!.name ?? null,
        startsAt: cycle!.startsAt.toISOString(),
        endsAt: cycle!.endsAt.toISOString(),
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create cycle'),
        'CREATE_FAILED'
      );
    }
  });

cyclesCommand
  .command('update <id>')
  .description('Update a cycle')
  .option('--name <name>', 'New cycle name')
  .option('--description <text>', 'New description')
  .option('--starts <date>', 'New start date (ISO 8601)')
  .option('--ends <date>', 'New end date (ISO 8601)')
  .action(async (id: string, opts: {
    name?: string;
    description?: string;
    starts?: string;
    ends?: string;
  }) => {
    try {
      const client = getClient();
      const updates: Record<string, unknown> = {};
      if (opts.name !== undefined) updates['name'] = opts.name;
      if (opts.description !== undefined) updates['description'] = opts.description;
      if (opts.starts) updates['startsAt'] = new Date(opts.starts);
      if (opts.ends) updates['endsAt'] = new Date(opts.ends);

      if (Object.keys(updates).length === 0) {
        outputError('No update fields provided', 'MISSING_FIELDS');
      }

      const payload = await client.updateCycle(id, updates);
      const cycle = await payload.cycle;
      if (!cycle) {
        outputError('Failed to update cycle', 'UPDATE_FAILED');
      }
      outputSuccess('Cycle updated', {
        id: cycle!.id,
        number: cycle!.number,
        name: cycle!.name ?? null,
        startsAt: cycle!.startsAt.toISOString(),
        endsAt: cycle!.endsAt.toISOString(),
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to update cycle'),
        'UPDATE_FAILED'
      );
    }
  });

cyclesCommand
  .command('add-issues <id>')
  .description('Add issues to a cycle')
  .option('--issue <id>', 'Issue ID or identifier (repeatable)', (v: string, arr: string[]) => [...arr, v], [] as string[])
  .action(async (id: string, opts: { issue: string[] }) => {
    try {
      if (opts.issue.length === 0) {
        outputError('At least one --issue is required', 'MISSING_FIELDS');
      }
      const client = getClient();

      let issueIds: string[];
      try {
        issueIds = await Promise.all(opts.issue.map((v) => resolveIssueId(client, v)));
      } catch (err) {
        if (err instanceof NotFoundError) {
          outputError(err.message, 'NOT_FOUND');
        }
        throw err;
      }
      const results = await Promise.allSettled(
        issueIds.map(issueId => client.updateIssue(issueId, { cycleId: id }))
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failedCount = results.filter(r => r.status === 'rejected').length;
      outputData({ cycleId: id, succeeded, failedCount });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to add issues to cycle'),
        'UPDATE_FAILED'
      );
    }
  });

cyclesCommand
  .command('remove-issues <id>')
  .description('Remove issues from a cycle')
  .option('--issue <id>', 'Issue ID or identifier (repeatable)', (v: string, arr: string[]) => [...arr, v], [] as string[])
  .action(async (id: string, opts: { issue: string[] }) => {
    try {
      if (opts.issue.length === 0) {
        outputError('At least one --issue is required', 'MISSING_FIELDS');
      }
      const client = getClient();

      let issueIds: string[];
      try {
        issueIds = await Promise.all(opts.issue.map((v) => resolveIssueId(client, v)));
      } catch (err) {
        if (err instanceof NotFoundError) {
          outputError(err.message, 'NOT_FOUND');
        }
        throw err;
      }
      const results = await Promise.allSettled(
        issueIds.map(issueId => client.updateIssue(issueId, { cycleId: null }))
      );

      const succeeded = results.filter(r => r.status === 'fulfilled').length;
      const failedCount = results.filter(r => r.status === 'rejected').length;
      outputData({ cycleId: id, succeeded, failedCount });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to remove issues from cycle'),
        'UPDATE_FAILED'
      );
    }
  });
