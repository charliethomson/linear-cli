import * as http from 'http';
import type { AddressInfo } from 'net';

/**
 * A minimal stand-in for Linear's GraphQL endpoint.
 *
 * The suite runs the real built CLI against this rather than mocking the SDK
 * object, so the tests exercise the SDK's actual request construction and
 * response parsing. That is the whole point: an SDK upgrade that changes how a
 * query is shaped or a payload is unwrapped shows up here, where a hand-rolled
 * SDK mock would silently keep passing.
 */

export interface GraphQLRequest {
  query: string;
  variables: Record<string, unknown>;
  operationName?: string;
}

export interface GraphQLError {
  message: string;
  extensions?: Record<string, unknown>;
}

/** What to send back. Exactly one of `data` / `sequence` / `errors` / `raw`. */
export interface Reply {
  /** Substring the incoming query must contain for this rule to fire. */
  contains: string;
  /** Same response every time. */
  data?: unknown;
  /** One response per successive matching call; the last repeats once exhausted. */
  sequence?: unknown[];
  /** Respond with GraphQL errors instead of data. */
  errors?: GraphQLError[];
  /** Respond with a raw status + body, for transport-level failures (429, 500). */
  raw?: { status: number; body: string; headers?: Record<string, string> };
}

interface Rule extends Reply {
  calls: number;
}

export class FakeLinear {
  private server: http.Server;
  private rules: Rule[] = [];
  /** Every request received, in order, for assertions. */
  readonly requests: GraphQLRequest[] = [];
  url = '';

  private constructor(server: http.Server) {
    this.server = server;
  }

  static async start(): Promise<FakeLinear> {
    const fake = new FakeLinear(
      http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => fake.handle(body, res));
      })
    );
    await new Promise<void>((resolve) => fake.server.listen(0, '127.0.0.1', resolve));
    const { port } = fake.server.address() as AddressInfo;
    fake.url = `http://127.0.0.1:${port}/graphql`;
    return fake;
  }

  /** Register a response rule. Later rules win over earlier ones on a tie. */
  reply(rule: Reply): this {
    this.rules.push({ ...rule, calls: 0 });
    return this;
  }

  /** Requests whose query contains `needle`. */
  requestsMatching(needle: string): GraphQLRequest[] {
    return this.requests.filter((r) => r.query.includes(needle));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  private handle(body: string, res: http.ServerResponse): void {
    let parsed: GraphQLRequest;
    try {
      parsed = JSON.parse(body) as GraphQLRequest;
    } catch {
      res.writeHead(400).end('bad request body');
      return;
    }
    this.requests.push(parsed);

    // Last matching rule wins, so a test can override a suite-level default.
    const rule = [...this.rules].reverse().find((r) => parsed.query.includes(r.contains));
    if (!rule) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          errors: [{ message: `fake-linear: no rule matched query: ${parsed.query.slice(0, 200)}` }],
        })
      );
      return;
    }

    const call = rule.calls++;

    if (rule.raw) {
      res.writeHead(rule.raw.status, {
        'content-type': 'application/json',
        ...rule.raw.headers,
      });
      res.end(rule.raw.body);
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    if (rule.errors) {
      res.end(JSON.stringify({ data: null, errors: rule.errors }));
      return;
    }
    const data = rule.sequence
      ? rule.sequence[Math.min(call, rule.sequence.length - 1)]
      : rule.data;
    res.end(JSON.stringify({ data }));
  }
}

/**
 * An issue node complete enough for the SDK's `Issue` class to construct.
 *
 * The SDK does real work in that constructor — notably `data.reactions.map()`,
 * and `state`/`team` are dereferenced by the accessors — so a stub with only
 * the fields the CLI prints throws a TypeError deep inside the SDK. Keeping the
 * minimum documented here means an upgrade that changes those requirements
 * fails loudly in one place rather than mysteriously across the suite.
 */
export function sdkIssue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'i1',
    identifier: 'ENG-1',
    title: 'An issue',
    description: null,
    number: 1,
    priority: 0,
    priorityLabel: 'No priority',
    estimate: null,
    url: 'https://linear.app/x/issue/ENG-1',
    branchName: 'eng-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    dueDate: null,
    trashed: false,
    archivedAt: null,
    boardOrder: 0,
    sortOrder: 0,
    customerTicketCount: 0,
    labelIds: [],
    previousIdentifiers: [],
    reactionData: [],
    // Fields the SDK's Issue constructor dereferences without a guard. This
    // set grows between SDK majors — v89 added `sharedAccess` and `syncedWith`
    // on top of v32's `reactions`. A TypeError from deep inside the SDK on
    // upgrade usually means another one has been added here.
    reactions: [],
    syncedWith: [],
    sharedAccess: {
      isShared: false,
      sharedWithCount: 0,
      viewerHasOnlySharedAccess: false,
      disallowedIssueFields: [],
      sharedWithUsers: [],
    },
    state: { id: 's1', name: 'Todo', type: 'unstarted' },
    team: { id: 't1', key: 'ENG', name: 'Engineering' },
    ...over,
  };
}

/** Build `issues` connection page data for the raw LIST_QUERY shape. */
export function issuePage(
  issues: Array<Partial<Record<string, unknown>>>,
  pageInfo: { hasNextPage: boolean; endCursor?: string | null }
): unknown {
  return {
    issues: {
      nodes: issues.map((i, n) => ({
        id: `id-${n}`,
        identifier: `ENG-${n}`,
        title: `Issue ${n}`,
        priority: 0,
        priorityLabel: 'No priority',
        estimate: null,
        url: `https://linear.app/x/issue/ENG-${n}`,
        branchName: `eng-${n}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        dueDate: null,
        trashed: false,
        archivedAt: null,
        state: { id: 's1', name: 'Todo', type: 'unstarted' },
        assignee: null,
        project: null,
        labels: { nodes: [] },
        ...i,
      })),
      pageInfo: { hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor ?? null },
    },
  };
}
