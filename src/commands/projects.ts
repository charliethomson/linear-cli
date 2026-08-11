import { Command } from 'commander';
import type { LinearClient } from '@linear/sdk';
import { getClient } from '../client.js';
import { isUuid, resolveTeamId } from '../resolve.js';
import { fetchAll, parseLimit } from '../paginate.js';
import { errorMessage, outputData, outputError, outputSuccess } from '../output.js';

export const projectsCommand = new Command('projects')
  .description('Manage projects');

// Project workflow is modelled by ProjectStatus. `Project.state` and the
// `state` fields on ProjectFilter/ProjectUpdateInput are deprecated — the
// filter is accepted but silently ignored by the API, so both paths below go
// through ProjectStatus instead.
const STATUS_TYPES = ['backlog', 'planned', 'started', 'paused', 'completed', 'canceled'];

interface ProjectStatusRef {
  id: string;
  name: string;
  type: string;
}

const PROJECT_FIELDS = `
  id
  name
  description
  color
  icon
  progress
  startDate
  targetDate
  createdAt
  updatedAt
  status { id name type }
  lead { id name }
`;

function shapeProject(p: any): Record<string, unknown> {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    // `state` is deprecated on Project; mirror the status type so existing
    // consumers keep working while `status` carries the real value.
    state: p.status?.type ?? null,
    status: p.status ? { id: p.status.id, name: p.status.name, type: p.status.type } : null,
    lead: p.lead ? { id: p.lead.id, name: p.lead.name } : null,
    color: p.color,
    icon: p.icon ?? null,
    progress: p.progress,
    startDate: p.startDate ?? null,
    targetDate: p.targetDate ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

async function listProjectStatuses(client: LinearClient): Promise<ProjectStatusRef[]> {
  const data: any = await (client.client as any).request(
    `query { projectStatuses { nodes { id name type } } }`
  );
  return data.projectStatuses.nodes;
}

/** Resolve a status type (`started`), display name (`In Progress`), or UUID to a status ID. */
async function resolveProjectStatusId(client: LinearClient, ref: string): Promise<string> {
  if (isUuid(ref)) return ref;
  const statuses = await listProjectStatuses(client);
  const needle = ref.toLowerCase();
  const match =
    statuses.find((s) => s.type.toLowerCase() === needle) ??
    statuses.find((s) => s.name.toLowerCase() === needle);
  if (!match) {
    throw new Error(
      `Project status '${ref}' not found. Available: ${statuses
        .map((s) => `${s.name} (${s.type})`)
        .join(', ')}`
    );
  }
  return match.id;
}

projectsCommand
  .command('list')
  .description('List projects')
  .option('--team <id>', 'Filter by team ID or key (e.g. ENG)')
  .option(
    '--state <state>',
    `Filter by status type (${STATUS_TYPES.join(', ')}) or status name`
  )
  .option('--limit <n>', 'Maximum number of projects to return', '250')
  .action(async (opts: { team?: string; state?: string; limit?: string }) => {
    try {
      const client = getClient();
      const limit = parseLimit(opts.limit, 250);
      const filter: Record<string, unknown> = {};
      // ProjectFilter exposes the team relation as `accessibleTeams`, not `teams`.
      if (opts.team) {
        filter['accessibleTeams'] = { some: { id: { eq: await resolveTeamId(client, opts.team) } } };
      }
      if (opts.state) {
        const needle = opts.state.toLowerCase();
        filter['status'] = STATUS_TYPES.includes(needle)
          ? { type: { eq: needle } }
          : { name: { eqIgnoreCase: opts.state } };
      }

      const nodes = await fetchAll<any>(
        async ({ first, after }) => {
          const data: any = await (client.client as any).request(
            `query Projects($first: Int!, $after: String, $filter: ProjectFilter) {
              projects(first: $first, after: $after, filter: $filter) {
                nodes { ${PROJECT_FIELDS} }
                pageInfo { hasNextPage endCursor }
              }
            }`,
            { first, after, ...(Object.keys(filter).length ? { filter } : {}) }
          );
          return data.projects;
        },
        limit
      );
      outputData(nodes.map(shapeProject));
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch projects'),
        'FETCH_FAILED'
      );
    }
  });

projectsCommand
  .command('statuses')
  .description('List the workspace project statuses accepted by --state')
  .action(async () => {
    try {
      const client = getClient();
      outputData(await listProjectStatuses(client));
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch project statuses'),
        'FETCH_FAILED'
      );
    }
  });

projectsCommand
  .command('get <id>')
  .description('Get a project by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      let data: any;
      try {
        data = await (client.client as any).request(
          `query Project($id: String!) { project(id: $id) { ${PROJECT_FIELDS} } }`,
          { id }
        );
      } catch {
        outputError(`Project '${id}' not found`, 'NOT_FOUND');
      }
      if (!data.project) {
        outputError(`Project '${id}' not found`, 'NOT_FOUND');
      }
      outputData(shapeProject(data.project));
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch project'),
        'FETCH_FAILED'
      );
    }
  });

projectsCommand
  .command('create')
  .description('Create a new project')
  .requiredOption('--name <name>', 'Project name')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG) to associate the project with')
  .option('--description <description>', 'Project description')
  .option('--color <hex>', 'Project color (hex code, e.g. #FF0000)')
  .option('--icon <emoji>', 'Project icon (emoji)')
  .option('--state <state>', `Initial status type (${STATUS_TYPES.join(', ')}) or status name`)
  .action(async (opts: {
    name: string;
    team: string;
    description?: string;
    color?: string;
    icon?: string;
    state?: string;
  }) => {
    try {
      const client = getClient();
      const payload = await client.createProject({
        name: opts.name,
        teamIds: [await resolveTeamId(client, opts.team)],
        ...(opts.description && { description: opts.description }),
        ...(opts.color && { color: opts.color }),
        ...(opts.icon && { icon: opts.icon }),
        ...(opts.state && { statusId: await resolveProjectStatusId(client, opts.state) }),
      });
      const project = await payload.project;
      if (!project) {
        outputError('Failed to create project', 'CREATE_FAILED');
      }
      const status = await project!.status;
      outputSuccess('Project created', {
        id: project!.id,
        name: project!.name,
        state: status ? status.type : null,
        status: status ? { id: status.id, name: status.name, type: status.type } : null,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create project'),
        'CREATE_FAILED'
      );
    }
  });

projectsCommand
  .command('update <id>')
  .description('Update a project')
  .option('--name <name>', 'New project name')
  .option('--description <description>', 'New description')
  .option(
    '--state <state>',
    `New status type (${STATUS_TYPES.join(', ')}) or status name`
  )
  .option('--color <hex>', 'New color (hex code)')
  .action(async (id: string, opts: { name?: string; description?: string; state?: string; color?: string }) => {
    try {
      const client = getClient();
      const updates: Record<string, unknown> = {};
      if (opts.name) updates['name'] = opts.name;
      if (opts.description !== undefined) updates['description'] = opts.description;
      if (opts.state) updates['statusId'] = await resolveProjectStatusId(client, opts.state);
      if (opts.color) updates['color'] = opts.color;

      if (Object.keys(updates).length === 0) {
        outputError('No update fields provided', 'MISSING_FIELDS');
      }

      const payload = await client.updateProject(id, updates);
      const project = await payload.project;
      if (!project) {
        outputError('Failed to update project', 'UPDATE_FAILED');
      }
      const status = await project!.status;
      outputSuccess('Project updated', {
        id: project!.id,
        name: project!.name,
        state: status ? status.type : null,
        status: status ? { id: status.id, name: status.name, type: status.type } : null,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to update project'),
        'UPDATE_FAILED'
      );
    }
  });

projectsCommand
  .command('archive <id>')
  .description('Archive a project')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const payload = await client.archiveProject(id);
      if (!payload.success) {
        outputError('Failed to archive project', 'ARCHIVE_FAILED');
      }
      outputSuccess('Project archived', { id });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to archive project'),
        'ARCHIVE_FAILED'
      );
    }
  });

const projectRelationsCommand = new Command('relations')
  .description('Manage project relations');

projectRelationsCommand
  .command('list <id>')
  .description('List all relations for a project')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const data = await (client.client as any).request(`
        query {
          projectRelations(first: 250) {
            nodes {
              id
              type
              anchorType
              relatedAnchorType
              project { id }
              relatedProject { id name }
            }
          }
        }
      `);
      const relations = (data as any).projectRelations.nodes.filter((r: any) => r.project.id === id);
      outputData(
        relations.map((r: any) => ({
          id: r.id,
          type: r.type,
          anchorType: r.anchorType,
          relatedProjectId: r.relatedProject.id,
          relatedProjectName: r.relatedProject.name,
          relatedAnchorType: r.relatedAnchorType,
        }))
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch project relations'),
        'FETCH_FAILED'
      );
    }
  });

projectRelationsCommand
  .command('create')
  .description('Create a project relation')
  .requiredOption('--project <id>', 'Project ID')
  .requiredOption('--related <id>', 'Related project ID')
  // The API accepts exactly one relation type, and anchors are start/end/milestone
  // — not the startDate/endDate spelling used by the project date fields.
  .option('--type <type>', 'Relation type (dependency)', 'dependency')
  .option('--anchor <type>', 'Anchor for project (start, end, milestone)', 'start')
  .option('--related-anchor <type>', 'Anchor for related project (start, end, milestone)', 'start')
  .action(async (opts: {
    project: string;
    related: string;
    type: string;
    anchor: string;
    relatedAnchor: string;
  }) => {
    try {
      const client = getClient();
      const payload = await client.createProjectRelation({
        projectId: opts.project,
        relatedProjectId: opts.related,
        type: opts.type,
        anchorType: opts.anchor,
        relatedAnchorType: opts.relatedAnchor,
      });
      const relation = await payload.projectRelation;
      if (!relation) {
        outputError('Failed to create project relation', 'CREATE_FAILED');
      }
      outputSuccess('Project relation created', {
        id: relation!.id,
        type: relation!.type,
        anchorType: relation!.anchorType,
        relatedAnchorType: relation!.relatedAnchorType,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create project relation'),
        'CREATE_FAILED'
      );
    }
  });

projectRelationsCommand
  .command('delete <id>')
  .description('Delete a project relation by ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const payload = await client.deleteProjectRelation(id);
      if (!payload.success) {
        outputError('Failed to delete project relation', 'DELETE_FAILED');
      }
      outputSuccess('Project relation deleted', { success: true });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to delete project relation'),
        'DELETE_FAILED'
      );
    }
  });

projectsCommand.addCommand(projectRelationsCommand);
