import { Command } from 'commander';
import * as fs from 'fs';
import * as readline from 'readline';
import { getClient } from '../client.js';
import { isUuid, resolveIssueId, resolveTeamId } from '../resolve.js';
import { errorMessage, isHumanMode, outputData, outputError, outputSuccess } from '../output.js';

export const issuesCommand = new Command('issues')
  .description('Manage issues');

// Linear caps `first` at 250 per page; anything larger is paginated below.
const PAGE_MAX = 250;

const LIST_QUERY = `query Issues($first: Int!, $after: String, $filter: IssueFilter) {
  issues(first: $first, after: $after, filter: $filter, orderBy: updatedAt) {
    nodes {
      id
      identifier
      title
      priority
      priorityLabel
      estimate
      url
      branchName
      createdAt
      updatedAt
      dueDate
      trashed
      archivedAt
      state { id name type }
      assignee { id name email }
      project { id name }
      labels { nodes { id name } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

issuesCommand
  .command('list')
  .description('List issues with optional filters')
  .option('--team <id>', 'Filter by team ID or key')
  .option('--project <id>', 'Filter by project ID')
  .option('--assignee <id>', 'Filter by assignee user ID')
  .option('--state <id>', 'Filter by workflow state ID')
  .option('--priority <0-4>', 'Filter by priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)')
  .option('--label <id>', 'Filter by label ID')
  .option('--cycle <id>', 'Filter by cycle ID')
  .option('--search <text>', 'Search issues by text')
  .option('--limit <n>', 'Maximum number of issues to return (auto-paginates above 250)', '50')
  .action(async (opts: {
    team?: string;
    project?: string;
    assignee?: string;
    state?: string;
    priority?: string;
    label?: string;
    cycle?: string;
    search?: string;
    limit?: string;
  }) => {
    try {
      const client = getClient();
      const filter: Record<string, unknown> = {};

      if (opts.team) {
        // Support both team key (like ENG) and team ID (UUID)
        filter['team'] = isUuid(opts.team)
          ? { id: { eq: opts.team } }
          : { key: { eq: opts.team.toUpperCase() } };
      }
      if (opts.project) filter['project'] = { id: { eq: opts.project } };
      if (opts.assignee) filter['assignee'] = { id: { eq: opts.assignee } };
      if (opts.state) filter['state'] = { id: { eq: opts.state } };
      if (opts.priority) filter['priority'] = { eq: parseInt(opts.priority, 10) };
      if (opts.label) filter['labels'] = { some: { id: { eq: opts.label } } };
      if (opts.cycle) filter['cycle'] = { id: { eq: opts.cycle } };
      if (opts.search) filter['or'] = [
        { title: { containsIgnoreCase: opts.search } },
        { description: { containsIgnoreCase: opts.search } },
      ];

      const limit = parseInt(opts.limit ?? '50', 10);
      if (!Number.isFinite(limit) || limit < 1) {
        outputError('--limit must be a positive integer', 'INVALID_INPUT');
      }

      const nodes: Record<string, unknown>[] = [];
      let after: string | null = null;
      while (nodes.length < limit) {
        const data: any = await (client.client as any).request(LIST_QUERY, {
          first: Math.min(PAGE_MAX, limit - nodes.length),
          after,
          ...(Object.keys(filter).length ? { filter } : {}),
        });
        nodes.push(...data.issues.nodes);
        if (!data.issues.pageInfo.hasNextPage) break;
        after = data.issues.pageInfo.endCursor;
      }

      outputData(
        nodes.map((i: any) => ({
          id: i.id,
          identifier: i.identifier,
          title: i.title,
          priority: i.priority,
          priorityLabel: i.priorityLabel,
          estimate: i.estimate ?? null,
          state: i.state ? { id: i.state.id, name: i.state.name, type: i.state.type } : null,
          assignee: i.assignee
            ? { id: i.assignee.id, name: i.assignee.name, email: i.assignee.email }
            : null,
          project: i.project ? { id: i.project.id, name: i.project.name } : null,
          labels: i.labels.nodes.map((l: any) => ({ id: l.id, name: l.name })),
          url: i.url,
          branchName: i.branchName,
          createdAt: i.createdAt,
          updatedAt: i.updatedAt,
          dueDate: i.dueDate ?? null,
          trashed: i.trashed ?? false,
          archivedAt: i.archivedAt ?? null,
        }))
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch issues'),
        'FETCH_FAILED'
      );
    }
  });

issuesCommand
  .command('get <identifier>')
  .description('Get an issue by identifier (e.g. ENG-123) or UUID')
  .action(async (identifier: string) => {
    try {
      const client = getClient();
      // Linear's issue(id:) query accepts both a UUID and a human identifier
      // (ENG-123, case-insensitive) — no client-side branching needed.
      let issue;
      try {
        issue = await client.issue(identifier);
      } catch {
        outputError(`Issue '${identifier}' not found`, 'NOT_FOUND');
      }

      const state = await issue!.state;
      const assignee = await issue!.assignee;
      const project = await issue!.project;
      const relationsConn = await issue!.relations();
      const relations = await Promise.all(
        relationsConn.nodes.map(async (r) => {
          const relatedIssue = await r.relatedIssue;
          return {
            id: r.id,
            type: r.type,
            relatedIssue: relatedIssue
              ? { id: relatedIssue.id, identifier: relatedIssue.identifier, title: relatedIssue.title, url: relatedIssue.url }
              : null,
          };
        })
      );

      outputData({
        id: issue!.id,
        identifier: issue!.identifier,
        title: issue!.title,
        description: issue!.description ?? null,
        priority: issue!.priority,
        priorityLabel: issue!.priorityLabel,
        estimate: issue!.estimate ?? null,
        state: state ? { id: state.id, name: state.name, type: state.type } : null,
        assignee: assignee ? { id: assignee.id, name: assignee.name, email: assignee.email } : null,
        project: project ? { id: project.id, name: project.name } : null,
        url: issue!.url,
        branchName: issue!.branchName,
        createdAt: issue!.createdAt.toISOString(),
        updatedAt: issue!.updatedAt.toISOString(),
        dueDate: issue!.dueDate ?? null,
        // `issue(id:)` resolves trashed and archived issues too, so surface both
        // — otherwise a deleted issue is indistinguishable from a live one.
        trashed: issue!.trashed ?? false,
        archivedAt: issue!.archivedAt ? issue!.archivedAt.toISOString() : null,
        relations,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch issue'),
        'FETCH_FAILED'
      );
    }
  });

issuesCommand
  .command('create')
  .description('Create a new issue')
  .requiredOption('--team <id>', 'Team ID or key (e.g. ENG)')
  .requiredOption('--title <title>', 'Issue title')
  .option('--description <text>', 'Issue description (use "-" to read from stdin)')
  .option('--description-file <path>', 'Read description from file')
  .option('--priority <0-4>', 'Priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)')
  .option('--state <id>', 'Workflow state ID')
  .option('--assignee <id>', 'Assignee user ID')
  .option('--project <id>', 'Project ID')
  .option('--label <id>', 'Label ID (can be used multiple times)', (v, arr: string[]) => [...arr, v], [] as string[])
  .option('--estimate <n>', 'Story point estimate')
  .action(async (opts: {
    team: string;
    title: string;
    description?: string;
    descriptionFile?: string;
    priority?: string;
    state?: string;
    assignee?: string;
    project?: string;
    label: string[];
    estimate?: string;
  }) => {
    try {
      const client = getClient();

      let description = opts.description;
      if (opts.descriptionFile) {
        description = fs.readFileSync(opts.descriptionFile, 'utf-8');
      } else if (description === '-') {
        description = fs.readFileSync('/dev/stdin', 'utf-8');
      }

      const payload = await client.createIssue({
        teamId: await resolveTeamId(client, opts.team),
        title: opts.title,
        ...(description && { description }),
        ...(opts.priority && { priority: parseInt(opts.priority, 10) }),
        ...(opts.state && { stateId: opts.state }),
        ...(opts.assignee && { assigneeId: opts.assignee }),
        ...(opts.project && { projectId: opts.project }),
        ...(opts.label.length > 0 && { labelIds: opts.label }),
        ...(opts.estimate && { estimate: parseInt(opts.estimate, 10) }),
      });

      const issue = await payload.issue;
      if (!issue) {
        outputError('Failed to create issue', 'CREATE_FAILED');
      }
      outputSuccess('Issue created', {
        id: issue!.id,
        identifier: issue!.identifier,
        title: issue!.title,
        url: issue!.url,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create issue'),
        'CREATE_FAILED'
      );
    }
  });

issuesCommand
  .command('update <id>')
  .description('Update an issue by identifier (e.g. ENG-123) or UUID')
  .option('--title <title>', 'New title')
  .option('--description <text>', 'New description (use "-" to read from stdin)')
  .option('--description-file <path>', 'Read description from file')
  .option('--priority <0-4>', 'New priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)')
  .option('--state <id>', 'New workflow state ID')
  .option('--assignee <id>', 'New assignee user ID')
  .option('--project <id>', 'New project ID')
  .option('--label <id>', 'Label ID (replaces all labels)', (v, arr: string[]) => [...arr, v], [] as string[])
  .option('--estimate <n>', 'New story point estimate')
  .action(async (id: string, opts: {
    title?: string;
    description?: string;
    descriptionFile?: string;
    priority?: string;
    state?: string;
    assignee?: string;
    project?: string;
    label: string[];
    estimate?: string;
  }) => {
    try {
      const client = getClient();

      let description = opts.description;
      if (opts.descriptionFile) {
        description = fs.readFileSync(opts.descriptionFile, 'utf-8');
      } else if (description === '-') {
        description = fs.readFileSync('/dev/stdin', 'utf-8');
      }

      const updates: Record<string, unknown> = {};
      if (opts.title) updates['title'] = opts.title;
      if (description !== undefined) updates['description'] = description;
      if (opts.priority) updates['priority'] = parseInt(opts.priority, 10);
      if (opts.state) updates['stateId'] = opts.state;
      if (opts.assignee) updates['assigneeId'] = opts.assignee;
      if (opts.project) updates['projectId'] = opts.project;
      if (opts.label.length > 0) updates['labelIds'] = opts.label;
      if (opts.estimate) updates['estimate'] = parseInt(opts.estimate, 10);

      if (Object.keys(updates).length === 0) {
        outputError('No update fields provided', 'MISSING_FIELDS');
      }

      const payload = await client.updateIssue(await resolveIssueId(client, id), updates);
      const issue = await payload.issue;
      if (!issue) {
        outputError('Failed to update issue', 'UPDATE_FAILED');
      }
      outputSuccess('Issue updated', {
        id: issue!.id,
        identifier: issue!.identifier,
        title: issue!.title,
        url: issue!.url,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to update issue'),
        'UPDATE_FAILED'
      );
    }
  });

issuesCommand
  .command('comment <id>')
  .description('Add a comment to an issue by identifier (e.g. ENG-123) or UUID')
  .requiredOption('--body <text>', 'Comment body text')
  .action(async (id: string, opts: { body: string }) => {
    try {
      const client = getClient();
      const payload = await client.createComment({
        issueId: await resolveIssueId(client, id),
        body: opts.body,
      });
      const comment = await payload.comment;
      if (!comment) {
        outputError('Failed to create comment', 'CREATE_FAILED');
      }
      outputSuccess('Comment added', {
        id: comment!.id,
        body: comment!.body,
        createdAt: comment!.createdAt.toISOString(),
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create comment'),
        'CREATE_FAILED'
      );
    }
  });

issuesCommand
  .command('archive <id>')
  .description('Archive an issue by identifier (e.g. ENG-123) or UUID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const issueId = await resolveIssueId(client, id);
      await client.archiveIssue(issueId);
      outputSuccess('Issue archived', { id: issueId });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to archive issue'),
        'ARCHIVE_FAILED'
      );
    }
  });

issuesCommand
  .command('bulk-create')
  .description('Create multiple issues from a JSON file')
  .requiredOption('--file <path>', 'Path to JSON file (use "-" for stdin)')
  .option('--concurrency <n>', 'Number of concurrent creates', '5')
  .action(async (opts: { file: string; concurrency: string }) => {
    try {
      const client = getClient();

      let raw: string;
      if (opts.file === '-') {
        raw = fs.readFileSync('/dev/stdin', 'utf-8');
      } else {
        raw = fs.readFileSync(opts.file, 'utf-8');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        outputError('Invalid JSON input', 'INVALID_INPUT');
        return;
      }

      if (!Array.isArray(parsed)) {
        outputError('Input must be a JSON array', 'INVALID_INPUT');
        return;
      }

      const items = parsed as Record<string, unknown>[];
      const concurrency = parseInt(opts.concurrency, 10);
      const created: Array<{ id: string; identifier: string; title: string; url: string }> = [];
      const failed: Array<{ input: unknown; error: string }> = [];

      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          chunk.map(async (entry) => {
            if (!entry['team']) throw new Error('Each entry must have a "team" field (ID or key)');
            if (!entry['title']) throw new Error('Each entry must have a "title" field');

            const input: Record<string, unknown> = {
              teamId: await resolveTeamId(client, entry['team'] as string),
              title: entry['title'] as string,
            };
            if (entry['description']) input['description'] = entry['description'];
            if (entry['priority'] !== undefined) input['priority'] = entry['priority'];
            if (entry['state']) input['stateId'] = entry['state'];
            if (entry['assignee']) input['assigneeId'] = entry['assignee'];
            if (entry['project']) input['projectId'] = entry['project'];
            if (Array.isArray(entry['labels']) && entry['labels'].length > 0) input['labelIds'] = entry['labels'];
            if (entry['estimate'] !== undefined) input['estimate'] = entry['estimate'];

            const payload = await client.createIssue(input as any);
            const issue = await payload.issue;
            if (!issue) throw new Error('No issue returned from API');
            return { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url };
          })
        );

        results.forEach((result, j) => {
          if (result.status === 'fulfilled') {
            created.push(result.value);
          } else {
            failed.push({
              input: chunk[j],
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
          }
        });
      }

      outputData({
        total: items.length,
        succeeded: created.length,
        failedCount: failed.length,
        created,
        failed,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to bulk create issues'),
        'CREATE_FAILED'
      );
    }
  });

issuesCommand
  .command('bulk-update')
  .description('Update multiple issues from a JSON file')
  .requiredOption('--file <path>', 'Path to JSON file (use "-" for stdin)')
  .option('--concurrency <n>', 'Number of concurrent updates', '5')
  .action(async (opts: { file: string; concurrency: string }) => {
    try {
      const client = getClient();

      let raw: string;
      if (opts.file === '-') {
        raw = fs.readFileSync('/dev/stdin', 'utf-8');
      } else {
        raw = fs.readFileSync(opts.file, 'utf-8');
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        outputError('Invalid JSON input', 'INVALID_INPUT');
        return;
      }

      if (!Array.isArray(parsed)) {
        outputError('Input must be a JSON array', 'INVALID_INPUT');
        return;
      }

      const items = parsed as Record<string, unknown>[];
      const concurrency = parseInt(opts.concurrency, 10);
      const updated: Array<{ id: string; identifier: string; title: string; url: string }> = [];
      const failed: Array<{ input: unknown; error: string }> = [];

      for (let i = 0; i < items.length; i += concurrency) {
        const chunk = items.slice(i, i + concurrency);
        const results = await Promise.allSettled(
          chunk.map(async (entry) => {
            // Resolve id or identifier
            const rawId = (entry['id'] ?? entry['identifier']) as string | undefined;
            if (!rawId) throw new Error('Each entry must have an "id" or "identifier" field');

            const issueId = await resolveIssueId(client, rawId);

            const updates: Record<string, unknown> = {};
            if (entry['title'] !== undefined) updates['title'] = entry['title'];
            if (entry['description'] !== undefined) updates['description'] = entry['description'];
            if (entry['priority'] !== undefined) updates['priority'] = entry['priority'];
            if (entry['state'] !== undefined) updates['stateId'] = entry['state'];
            if (entry['assignee'] !== undefined) updates['assigneeId'] = entry['assignee'];
            if (entry['project'] !== undefined) updates['projectId'] = entry['project'];
            if (Array.isArray(entry['labels']) && entry['labels'].length > 0) updates['labelIds'] = entry['labels'];
            if (entry['estimate'] !== undefined) updates['estimate'] = entry['estimate'];

            const payload = await client.updateIssue(issueId, updates);
            const issue = await payload.issue;
            if (!issue) throw new Error('No issue returned from API');
            return { id: issue.id, identifier: issue.identifier, title: issue.title, url: issue.url };
          })
        );

        results.forEach((result, j) => {
          if (result.status === 'fulfilled') {
            updated.push(result.value);
          } else {
            failed.push({
              input: chunk[j],
              error: result.reason instanceof Error ? result.reason.message : String(result.reason),
            });
          }
        });
      }

      outputData({
        total: items.length,
        succeeded: updated.length,
        failedCount: failed.length,
        updated,
        failed,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to bulk update issues'),
        'UPDATE_FAILED'
      );
    }
  });

issuesCommand
  .command('unarchive <id>')
  .description('Unarchive an issue by identifier (e.g. ENG-123) or UUID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      const issueId = await resolveIssueId(client, id);
      await client.unarchiveIssue(issueId);
      outputSuccess('Issue unarchived', { id: issueId });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to unarchive issue'),
        'UPDATE_FAILED'
      );
    }
  });

issuesCommand
  .command('delete <id>')
  // issueDelete is a soft delete: it sets trashed + archivedAt and Linear purges
  // the issue after its retention window. It is recoverable from Trash in the UI.
  .description('Move an issue to Trash by identifier or UUID')
  .action(async (id: string) => {
    try {
      if (isHumanMode()) {
        const confirmed = await new Promise<boolean>((resolve) => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
          rl.question(`Move issue ${id} to Trash? (y/N) `, (answer) => {
            rl.close();
            resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
          });
        });
        if (!confirmed) {
          process.stdout.write('Cancelled.\n');
          process.exit(0);
        }
      }
      const client = getClient();
      const issueId = await resolveIssueId(client, id);
      await client.deleteIssue(issueId);
      outputSuccess('Issue moved to Trash', { id: issueId, trashed: true });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to delete issue'),
        'DELETE_FAILED'
      );
    }
  });

const issueRelationsCommand = new Command('relations')
  .description('Manage issue relations');

issueRelationsCommand
  .command('list <identifier>')
  .description('List all relations for an issue')
  .action(async (identifier: string) => {
    try {
      const client = getClient();

      let issueId: string;
      try {
        issueId = await resolveIssueId(client, identifier);
      } catch {
        outputError(`Issue '${identifier}' not found`, 'NOT_FOUND');
      }

      const data = await (client.client as any).request(
        `query IssueRelations($id: String!) {
          issue(id: $id) {
            relations {
              nodes {
                id
                type
                relatedIssue { identifier title url }
              }
            }
          }
        }`,
        { id: issueId }
      );

      outputData(
        (data as any).issue.relations.nodes.map((r: any) => ({
          id: r.id,
          type: r.type,
          relatedIssueIdentifier: r.relatedIssue.identifier,
          relatedIssueTitle: r.relatedIssue.title,
          relatedIssueUrl: r.relatedIssue.url,
        }))
      );
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch issue relations'),
        'FETCH_FAILED'
      );
    }
  });

issueRelationsCommand
  .command('create')
  .description('Create an issue relation')
  .requiredOption('--issue <id>', 'Issue ID or identifier (e.g. ENG-123)')
  .requiredOption('--related <id>', 'Related issue ID or identifier')
  // `blocks` means --issue blocks --related; there is no blocked_by, invert instead.
  .requiredOption('--type <type>', 'Relation type (blocks, duplicate, related)')
  .action(async (opts: { issue: string; related: string; type: string }) => {
    try {
      const client = getClient();

      let issueId: string;
      let relatedIssueId: string;
      try {
        [issueId, relatedIssueId] = await Promise.all([
          resolveIssueId(client, opts.issue),
          resolveIssueId(client, opts.related),
        ]);
      } catch (err) {
        outputError(errorMessage(err, 'Issue not found'), 'NOT_FOUND');
      }

      const payload = await client.createIssueRelation({
        issueId,
        relatedIssueId,
        type: opts.type as any,
      });
      const relation = await payload.issueRelation;
      if (!relation) {
        outputError('Failed to create issue relation', 'CREATE_FAILED');
      }
      outputSuccess('Issue relation created', {
        id: relation!.id,
        type: relation!.type,
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to create issue relation'),
        'CREATE_FAILED'
      );
    }
  });

issueRelationsCommand
  .command('delete <id>')
  .description('Delete an issue relation by its relation ID')
  .action(async (id: string) => {
    try {
      const client = getClient();
      await client.deleteIssueRelation(id);
      outputSuccess('Issue relation deleted', { success: true });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to delete issue relation'),
        'DELETE_FAILED'
      );
    }
  });

issuesCommand.addCommand(issueRelationsCommand);
