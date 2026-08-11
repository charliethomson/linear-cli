import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveTeamId } from '../resolve.js';
import { fetchAll, parseLimit } from '../paginate.js';
import { errorMessage, outputData, outputError, outputSuccess } from '../output.js';

export const labelsCommand = new Command('labels')
  .description('Manage issue labels');

labelsCommand
  .command('list')
  .description('List issue labels')
  .option('--team <id>', 'Filter by team ID or key (e.g. ENG)')
  .option('--limit <n>', 'Maximum number of labels to return', '250')
  .action(async (opts: { team?: string; limit?: string }) => {
    try {
      const client = getClient();
      const limit = parseLimit(opts.limit, 250);
      const filter: Record<string, unknown> = {};
      if (opts.team) filter['team'] = { id: { eq: await resolveTeamId(client, opts.team) } };

      const nodes = await fetchAll(
        ({ first, after }) =>
          client.issueLabels({
            first,
            ...(after ? { after } : {}),
            ...(Object.keys(filter).length ? { filter } : {}),
          }),
        limit
      );
      outputData(
        nodes.map((l) => ({
          id: l.id,
          name: l.name,
          color: l.color,
          description: l.description ?? null,
        }))
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch labels'),
        'FETCH_FAILED'
      );
    }
  });

labelsCommand
  .command('create')
  .description('Create an issue label')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG)')
  .requiredOption('--name <name>', 'Label name')
  .requiredOption('--color <hex>', 'Label color (hex, e.g. #FF0000)')
  .option('--description <text>', 'Label description')
  .action(async (opts: {
    team: string;
    name: string;
    color: string;
    description?: string;
  }) => {
    try {
      const client = getClient();
      const payload = await client.createIssueLabel({
        teamId: await resolveTeamId(client, opts.team),
        name: opts.name,
        color: opts.color,
        ...(opts.description && { description: opts.description }),
      });
      const label = await payload.issueLabel;
      if (!label) {
        outputError('Failed to create label', 'CREATE_FAILED');
      }
      outputSuccess('Label created', {
        id: label!.id,
        name: label!.name,
        color: label!.color,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create label'),
        'CREATE_FAILED'
      );
    }
  });

labelsCommand
  .command('update <id>')
  .description('Update an issue label')
  .option('--name <name>', 'New label name')
  .option('--color <hex>', 'New color (hex)')
  .option('--description <text>', 'New description')
  .action(async (id: string, opts: {
    name?: string;
    color?: string;
    description?: string;
  }) => {
    try {
      const client = getClient();
      const updates: Record<string, unknown> = {};
      if (opts.name !== undefined) updates['name'] = opts.name;
      if (opts.color !== undefined) updates['color'] = opts.color;
      if (opts.description !== undefined) updates['description'] = opts.description;

      if (Object.keys(updates).length === 0) {
        outputError('No update fields provided', 'MISSING_FIELDS');
      }

      const payload = await client.updateIssueLabel(id, updates);
      const label = await payload.issueLabel;
      if (!label) {
        outputError('Failed to update label', 'UPDATE_FAILED');
      }
      outputSuccess('Label updated', {
        id: label!.id,
        name: label!.name,
        color: label!.color,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to update label'),
        'UPDATE_FAILED'
      );
    }
  });
