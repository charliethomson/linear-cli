import { Command } from 'commander';
import { getClient } from '../client.js';
import { errorMessage, outputData, outputError } from '../output.js';

export const meCommand = new Command('me')
  .description('Show current authenticated user')
  .action(async () => {
    try {
      const client = getClient();
      const viewer = await client.viewer;
      outputData({
        id: viewer.id,
        name: viewer.name,
        email: viewer.email,
        displayName: viewer.displayName,
        active: viewer.active,
        admin: viewer.admin,
        avatarUrl: viewer.avatarUrl ?? null,
        createdAt: viewer.createdAt.toISOString(),
      });
    } catch (err) {
      outputError(
        errorMessage(err, 'Failed to fetch current user'),
        'FETCH_FAILED'
      );
    }
  });
