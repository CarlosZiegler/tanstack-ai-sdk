import {
  McpServer,
  Server,
  createMcpHandler,
  isLegacyRequest,
  legacyStatelessFallback,
} from '@modelcontextprotocol/server'
import { passThroughSchema } from './pass-through-schema'

const EVENTS_EXTENSION = 'io.modelcontextprotocol/events'

const listEvent = {
  name: 'incident.created',
  delivery: ['webhook'] as Array<'webhook'>,
  inputSchema: {},
  payloadSchema: true,
}

/**
 * Test-only MCP Events server. Task 1 registers `events/list` and the
 * extension capability. Later tasks add subscribe, unsubscribe, and delivery.
 */
export function createTestEventsServer() {
  const capturedClientCapabilities: Array<unknown> = []
  const server = new Server(
    { name: 'events-test', version: '1.0.0' },
    {
      capabilities: {
        extensions: { [EVENTS_EXTENSION]: {} },
      },
    },
  )

  attachEventsList(server, capturedClientCapabilities)

  return {
    server,
    capturedClientCapabilities,
    capabilities: {
      extensions: { [EVENTS_EXTENSION]: {} },
    },
    attach: (target: Server) => {
      attachEventsList(target, capturedClientCapabilities)
    },
  }
}

function attachEventsList(
  server: Server,
  capturedClientCapabilities: Array<unknown>,
) {
  server.setRequestHandler(
    'events/list',
    { params: passThroughSchema },
    async () => {
      capturedClientCapabilities.push(server.getClientCapabilities())
      return { events: [listEvent] }
    },
  )
}

/** Streamable HTTP fetch handler around a test events server. */
export function eventsHttpFetch(events: ReturnType<typeof createTestEventsServer>) {
  const factory = () => {
    const mcp = new McpServer(
      { name: 'events-test', version: '1.0.0' },
      { capabilities: events.capabilities },
    )
    events.attach(mcp.server)
    return mcp
  }
  const modern = createMcpHandler(factory, {
    legacy: 'reject',
    keepAliveMs: 0,
  })
  const stateless = legacyStatelessFallback(factory)
  return async (request: Request) => {
    if (await isLegacyRequest(request)) return stateless(request)
    return modern.fetch(request)
  }
}
