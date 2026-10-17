import {
  McpServer,
  ProtocolError,
  createMcpHandler,
} from '@modelcontextprotocol/server'
import { createMCPClient, InMemoryTransport } from '@tanstack/ai-mcp'
import {
  createMCPEventWebhook,
  inMemoryMCPEventStore,
} from '@tanstack/ai-mcp/events'
import type { MCPEventOccurrence } from '@tanstack/ai-mcp/events'
import { createServerFn } from '@tanstack/react-start'

const EVENTS_EXTENSION = 'io.modelcontextprotocol/events'

const passThrough = {
  '~standard': {
    version: 1 as const,
    vendor: 'mcp-events-example',
    validate(value: unknown) {
      return { value }
    },
  },
}

type StoredSub = {
  id: string
  name: string
  url: string
  secret: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hmacKeyBytes(secret: string): Uint8Array {
  if (!secret.startsWith('whsec_')) {
    throw new Error('Webhook secret must start with whsec_')
  }
  const encoded = secret.slice('whsec_'.length)
  const padded = encoded + '='.repeat((4 - (encoded.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function signWebhook(input: {
  secret: string
  messageId: string
  timestamp: number
  body: Uint8Array
}): Promise<string> {
  const keyBytes = hmacKeyBytes(input.secret)
  const keyBuffer = new ArrayBuffer(keyBytes.byteLength)
  new Uint8Array(keyBuffer).set(keyBytes)
  const key = await crypto.subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const prefix = new TextEncoder().encode(
    `${input.messageId}.${input.timestamp}.`,
  )
  const payload = new Uint8Array(prefix.byteLength + input.body.byteLength)
  payload.set(prefix)
  payload.set(input.body, prefix.byteLength)
  const payloadBuffer = new ArrayBuffer(payload.byteLength)
  new Uint8Array(payloadBuffer).set(payload)
  const signature = await crypto.subtle.sign('HMAC', key, payloadBuffer)
  let binary = ''
  for (const byte of new Uint8Array(signature)) {
    binary += String.fromCharCode(byte)
  }
  return `v1,${btoa(binary)}`
}

const subscriptions = new Map<string, StoredSub>()
const received: Array<MCPEventOccurrence> = []
const store = inMemoryMCPEventStore()

const webhook = createMCPEventWebhook({
  store,
  onEvent: ({ event }) => {
    received.push(event)
  },
})

function attachEvents(server: McpServer['server']) {
  server.setRequestHandler(
    'events/list',
    { params: passThrough },
    async () => ({
      events: [
        {
          name: 'incident.created',
          delivery: ['webhook'],
          inputSchema: { type: 'object' },
          payloadSchema: true,
        },
      ],
    }),
  )

  server.setRequestHandler(
    'events/subscribe',
    { params: passThrough },
    async (params) => {
      const body = isRecord(params) ? params : {}
      const name = typeof body.name === 'string' ? body.name : ''
      if (name !== 'incident.created') {
        throw new ProtocolError(-32023, 'Event not found')
      }
      const delivery = isRecord(body.delivery) ? body.delivery : {}
      const url = typeof delivery.url === 'string' ? delivery.url : ''
      const secret = typeof delivery.secret === 'string' ? delivery.secret : ''
      hmacKeyBytes(secret)
      const id = 'sub_desk'
      subscriptions.set(id, { id, name, url, secret })
      return {
        id,
        refreshBefore: new Date(Date.now() + 3_600_000).toISOString(),
        cursor: null,
        truncated: false,
      }
    },
  )

  server.setRequestHandler(
    'events/unsubscribe',
    { params: passThrough },
    async () => {
      subscriptions.delete('sub_desk')
      return {}
    },
  )
}

function createServer() {
  const mcp = new McpServer(
    { name: 'desk-events', version: '1.0.0' },
    {
      capabilities: {
        extensions: {
          [EVENTS_EXTENSION]: {},
        },
      },
    },
  )
  attachEvents(mcp.server)
  return mcp
}

const mcpFetch = createMcpHandler(createServer, { keepAliveMs: 0 }).fetch

export function handleMcp(request: Request) {
  return mcpFetch(request)
}

export function handleWebhook(request: Request) {
  return webhook(request)
}

async function signAndDeliver(sub: StoredSub, bodyObj: unknown) {
  const raw = new TextEncoder().encode(JSON.stringify(bodyObj))
  const timestamp = Math.floor(Date.now() / 1000)
  const messageId =
    typeof bodyObj === 'object' &&
    bodyObj !== null &&
    'eventId' in bodyObj &&
    typeof bodyObj.eventId === 'string'
      ? bodyObj.eventId
      : `msg_${crypto.randomUUID()}`
  const signature = await signWebhook({
    secret: sub.secret,
    messageId,
    timestamp,
    body: raw,
  })
  await webhook(
    new Request(sub.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'webhook-id': messageId,
        'webhook-timestamp': String(timestamp),
        'webhook-signature': signature,
      },
      body: raw,
    }),
  )
}

export type DeskSnapshot = {
  names: Array<string>
  subscriptionId: string | null
  events: Array<MCPEventOccurrence>
}

export const subscribeDesk = createServerFn({ method: 'POST' }).handler(
  async (): Promise<DeskSnapshot> => {
    const mcp = createServer()
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await mcp.server.connect(serverTransport)
    const client = await createMCPClient({
      transport: clientTransport,
      experimental_events: { store },
    })
    try {
      const listed = await client.experimental_events.list()
      const sub = await client.experimental_events.subscribe({
        name: 'incident.created',
        delivery: {
          mode: 'webhook',
          url: 'http://127.0.0.1/api/mcp-events',
          allowInsecureLocalhost: true,
        },
      })
      return {
        names: listed.map((event) => event.name),
        subscriptionId: sub.id,
        events: [...received],
      }
    } finally {
      await client.close()
    }
  },
)

export const emitDesk = createServerFn({ method: 'POST' }).handler(
  async (): Promise<DeskSnapshot> => {
    const sub = subscriptions.get('sub_desk')
    if (sub === undefined) {
      throw new Error('Subscribe before you emit.')
    }
    const eventId = `evt_${crypto.randomUUID()}`
    await signAndDeliver(sub, {
      eventId,
      name: 'incident.created',
      timestamp: new Date().toISOString(),
      data: { id: 'inc_desk', summary: 'Disk is full' },
    })
    return {
      names: ['incident.created'],
      subscriptionId: sub.id,
      events: [...received],
    }
  },
)
