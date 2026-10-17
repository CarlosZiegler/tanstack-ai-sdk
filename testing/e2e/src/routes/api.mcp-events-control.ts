import { createFileRoute } from '@tanstack/react-router'
import {
  getMcpEventsSession,
  mcpEventsClient,
  resetMcpEventsSession,
} from '@/lib/mcp-events-session'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function asObjectData(value: unknown): Record<string, unknown> {
  return asRecord(value) ?? {}
}

export const Route = createFileRoute('/api/mcp-events-control')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = asRecord(await request.json())
        if (body === undefined) {
          return Response.json({ error: 'JSON object required' }, { status: 400 })
        }
        const testId = typeof body.testId === 'string' ? body.testId : undefined
        const op = typeof body.op === 'string' ? body.op : undefined
        if (testId === undefined || op === undefined) {
          return Response.json(
            { error: 'testId and op are required' },
            { status: 400 },
          )
        }
        const origin = new URL(request.url).origin
        if (op === 'reset') {
          await resetMcpEventsSession(testId)
          return Response.json({ ok: true })
        }
        const session = getMcpEventsSession(testId)
        if (op === 'subscribe') {
          const client = await mcpEventsClient(session, origin, testId)
          const sub = await client.experimental_events.subscribe({
            name: 'incident.created',
            delivery: {
              mode: 'webhook',
              url: `${origin}/api/mcp-events-webhook?session=${encodeURIComponent(testId)}`,
              allowInsecureLocalhost: true,
            },
          })
          return Response.json(sub)
        }
        if (op === 'emit') {
          const data = asObjectData(body.data)
          const result = await session.events.emit('incident.created', data, {
            cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
          })
          return Response.json({ result })
        }
        if (op === 'gap') {
          const id = typeof body.id === 'string' ? body.id : undefined
          const cursor = typeof body.cursor === 'string' ? body.cursor : undefined
          if (id === undefined || cursor === undefined) {
            return Response.json(
              { error: 'id and cursor are required' },
              { status: 400 },
            )
          }
          const status = await session.events.gap(id, cursor)
          return Response.json({ status })
        }
        if (op === 'terminate') {
          const id = typeof body.id === 'string' ? body.id : undefined
          if (id === undefined) {
            return Response.json({ error: 'id is required' }, { status: 400 })
          }
          const status = await session.events.terminate(id, {
            code: -32023,
            message: 'terminated',
          })
          return Response.json({ status })
        }
        if (op === 'unsubscribe') {
          const key = typeof body.key === 'string' ? body.key : undefined
          if (key === undefined) {
            return Response.json({ error: 'key is required' }, { status: 400 })
          }
          const client = await mcpEventsClient(session, origin, testId)
          await client.experimental_events.unsubscribe({ key })
          return Response.json({ ok: true })
        }
        if (op === 'received') {
          return Response.json({
            events: session.received,
            gaps: session.gaps,
            terminations: session.terminations,
            subscriptions: session.events.subscriptions().map((item) => item.id),
          })
        }
        return Response.json({ error: `unknown op ${op}` }, { status: 400 })
      },
    },
  },
})
