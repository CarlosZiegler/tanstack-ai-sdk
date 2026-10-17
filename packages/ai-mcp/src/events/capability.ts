import type { ClientCapabilities } from '@modelcontextprotocol/client'
import { isRecord } from './value'

/**
 * MCP Events extension id from SEP-3415.
 *
 * @experimental
 */
export const MCP_EVENTS_EXTENSION = 'io.modelcontextprotocol/events'

/**
 * SEP-3415 draft revision this package implements
 * (`modelcontextprotocol/modelcontextprotocol@2ec39b9`).
 *
 * @experimental
 */
export const SEP_REVISION = '2ec39b9'

/**
 * True when the server advertised Events support.
 *
 * Checks `extensions["io.modelcontextprotocol/events"]` first, then
 * `experimental.events` so AI SDK example servers still interoperate.
 *
 * @experimental
 */
export function serverSupportsEvents(
  caps: Record<string, unknown> | undefined,
): boolean {
  if (caps === undefined) return false
  const extensions = caps.extensions
  if (isRecord(extensions) && MCP_EVENTS_EXTENSION in extensions) return true
  const experimental = caps.experimental
  return isRecord(experimental) && 'events' in experimental
}

/**
 * Merge the Events client capability into `capabilities.extensions`.
 *
 * @experimental
 */
export function withEventsClientCapability(
  caps?: ClientCapabilities,
): ClientCapabilities {
  return {
    ...caps,
    extensions: {
      ...caps?.extensions,
      [MCP_EVENTS_EXTENSION]: {},
    },
  }
}
