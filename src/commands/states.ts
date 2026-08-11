import { Command } from 'commander';
import { getClient } from '../client.js';
import { resolveTeamId } from '../resolve.js';
import { fetchAll, parseLimit } from '../paginate.js';
import { errorMessage, outputData, outputError, outputSuccess } from '../output.js';

export const statesCommand = new Command('states')
  .description('Manage workflow states');

statesCommand
  .command('list')
  .description('List workflow states for a team')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG)')
  .option('--limit <n>', 'Maximum number of states to return', '250')
  .action(async (opts: { team: string; limit?: string }) => {
    try {
      const client = getClient();
      const limit = parseLimit(opts.limit, 250);
      const teamId = await resolveTeamId(client, opts.team);
      const nodes = await fetchAll(
        ({ first, after }) =>
          client.workflowStates({
            first,
            ...(after ? { after } : {}),
            filter: { team: { id: { eq: teamId } } },
          }),
        limit
      );
      outputData(
        nodes.map((s) => ({
          id: s.id,
          name: s.name,
          type: s.type,
          color: s.color,
          position: s.position,
          description: s.description ?? null,
        }))
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch states'),
        'FETCH_FAILED'
      );
    }
  });

statesCommand
  .command('create')
  .description('Create a workflow state')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG)')
  .requiredOption('--name <name>', 'State name')
  // Only these five are creatable; `triage` and `duplicate` are system-managed.
  .requiredOption('--type <type>', 'State type (backlog, unstarted, started, completed, canceled)')
  .requiredOption('--color <hex>', 'State color (hex, e.g. #FF0000)')
  .option('--description <text>', 'State description')
  .action(async (opts: {
    team: string;
    name: string;
    type: string;
    color: string;
    description?: string;
  }) => {
    try {
      const client = getClient();
      const payload = await client.createWorkflowState({
        teamId: await resolveTeamId(client, opts.team),
        name: opts.name,
        type: opts.type,
        color: opts.color,
        ...(opts.description && { description: opts.description }),
      });
      const state = await payload.workflowState;
      if (!state) {
        outputError('Failed to create state', 'CREATE_FAILED');
      }
      outputSuccess('State created', {
        id: state!.id,
        name: state!.name,
        type: state!.type,
        color: state!.color,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create state'),
        'CREATE_FAILED'
      );
    }
  });

statesCommand
  .command('update <id>')
  .description('Update a workflow state')
  .option('--name <name>', 'New state name')
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

      const payload = await client.updateWorkflowState(id, updates);
      const state = await payload.workflowState;
      if (!state) {
        outputError('Failed to update state', 'UPDATE_FAILED');
      }
      outputSuccess('State updated', {
        id: state!.id,
        name: state!.name,
        type: state!.type,
        color: state!.color,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to update state'),
        'UPDATE_FAILED'
      );
    }
  });
