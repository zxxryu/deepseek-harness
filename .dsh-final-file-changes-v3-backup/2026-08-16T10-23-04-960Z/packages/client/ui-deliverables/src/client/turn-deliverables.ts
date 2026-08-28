/**
 * Turn-scoped final-file-change projection.
 *
 * Native mutation tools keep writing the real workspace. This projection only
 * remembers their durable presentation metadata so the closing assistant turn
 * can render a compact file table with inline diffs and per-file undo.
 */
import type {
  ConversationNodeDefinition, ToolResultNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

export interface FileChangeSnapshot {
  readonly created: boolean
  readonly before: string | null
  readonly after: string
}

interface FileDiff {
  readonly path: string
  readonly oldText: string | null
  readonly newText: string
}

interface ProducedMutation {
  readonly seq: number
  readonly path: string
  /** Absent on Turn data produced by pre-V3 replays/caches. */
  readonly diffs?: readonly FileDiff[]
  readonly snapshot?: FileChangeSnapshot
}

/** One file row rendered below a closing assistant answer. */
export interface ProducedFileChange {
  readonly path: string
  readonly diffs: readonly FileDiff[]
  /** Present only when every mutation in the path's turn-local chain retained a full snapshot. */
  readonly snapshot?: FileChangeSnapshot
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedMutation[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    deliverables: DeliverablesTurnData
  }
}

interface CallFact {
  readonly name: string
  readonly view: ToolResultNode['callView']
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, CallFact>
}

function callPaths(view: ToolResultNode['callView']): readonly string[] {
  if (view === null) return []
  if (view.card === 'diff') return (view.locations ?? view.diffs.map(diff => ({ path: diff.path }))).map(location => location.path)
  if (view.card === 'generic' && view.kind === 'edit') return (view.locations ?? []).map(location => location.path)
  return []
}

function resultDiffs(matchView: unknown, fallback: ToolResultNode['callView']): readonly FileDiff[] {
  if (typeof matchView === 'object' && matchView !== null && 'card' in matchView) {
    const view = matchView as { card?: unknown; diffs?: unknown }
    if (view.card === 'diff' && Array.isArray(view.diffs)) return view.diffs as FileDiff[]
  }
  return fallback?.card === 'diff' ? fallback.diffs : []
}

function snapshotFromMeta(meta: unknown): { path: string; snapshot: FileChangeSnapshot } | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const candidate = (meta as Record<string, unknown>).fileChange
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return undefined
  const record = candidate as Record<string, unknown>
  if (typeof record.path !== 'string' || typeof record.after !== 'string' || typeof record.created !== 'boolean') return undefined
  if (!(record.before === null || typeof record.before === 'string')) return undefined
  if (record.created && record.before !== null) return undefined
  if (!record.created && typeof record.before !== 'string') return undefined
  return { path: record.path, snapshot: { created: record.created, before: record.before, after: record.after } }
}

function sameSnapshotBoundary(previous: FileChangeSnapshot, next: FileChangeSnapshot): boolean {
  return previous.after === next.before
}

/** Aggregate a turn's mutations by path: first before-image, final after-image, one row. */
export function changesForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly ProducedFileChange[] {
  if (data === undefined) return []
  const order: string[] = []
  const rows = new Map<string, {
    diffs: FileDiff[]
    snapshot?: FileChangeSnapshot
    snapshotBroken: boolean
  }>()

  for (const mutation of data.produced) {
    if (mutation.seq > seq) continue
    let row = rows.get(mutation.path)
    if (row === undefined) {
      row = { diffs: [], snapshotBroken: false }
      rows.set(mutation.path, row)
      order.push(mutation.path)
    }
    row.diffs.push(...(mutation.diffs ?? []))
    if (mutation.snapshot === undefined) {
      row.snapshotBroken = true
      delete row.snapshot
      continue
    }
    if (row.snapshot === undefined) {
      if (!row.snapshotBroken) row.snapshot = mutation.snapshot
      continue
    }
    if (!sameSnapshotBoundary(row.snapshot, mutation.snapshot)) {
      row.snapshotBroken = true
      delete row.snapshot
      continue
    }
    row.snapshot = { created: row.snapshot.created, before: row.snapshot.before, after: mutation.snapshot.after }
  }

  return order.map(path => {
    const row = rows.get(path)!
    return {
      path,
      diffs: row.diffs,
      ...row.snapshotBroken || row.snapshot === undefined ? {} : { snapshot: row.snapshot },
    }
  })
}

/** Backward-compatible path reader used by prose file mentions and tests. */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  return changesForClosing(data, seq).map(change => change.path)
}

/** V3 selector used by the rendered turn-tail table. */
export function selectProducedChanges(owner: TurnTailOwnerProps): readonly ProducedFileChange[] | null {
  const changes = changesForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return changes.length === 0 ? null : changes
}

/** Backward-compatible selector retained for existing package consumers/tests. */
export function selectProducedFiles(owner: TurnTailOwnerProps): readonly string[] | null {
  const paths = producedForClosing(owner.turn.data.get('deliverables'), owner.seq)
  return paths.length === 0 ? null : paths
}

/** Turn-local successful mutation accumulator; it publishes no chat node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(String(match.event.data.callId), {
        name: match.event.data.name,
        view: match.view?.for === 'call' ? match.view.view : null,
      })
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state

    const callId = String(match.event.data.message.source.callId)
    const call = context.state.calls.get(callId)
    const view = call?.view ?? null
    const exactSnapshot = snapshotFromMeta(match.event.data.meta)
    const diffs = resultDiffs(match.view?.for === 'result' ? match.view.view : null, view)
    const paths = new Set<string>([
      ...callPaths(view),
      ...diffs.map(diff => diff.path),
      ...(exactSnapshot === undefined ? [] : [exactSnapshot.path]),
    ])
    const additions: ProducedMutation[] = []
    for (const path of paths) {
      const pathDiffs = diffs.filter(diff => diff.path === path)
      additions.push({
        seq: match.event.seq,
        path,
        diffs: pathDiffs,
        ...(exactSnapshot?.path === path ? { snapshot: exactSnapshot.snapshot } : {}),
      })
    }
    return additions.length === 0
      ? context.state
      : { ...context.state, produced: [...context.state.produced, ...additions] }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced },
    },
}

export function basename(path: string): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return at === -1 ? path : path.slice(at + 1)
}

export function producedFileMentions(
  paths: readonly string[],
  openFile: (path: string) => void,
  label: (path: string) => string,
): MarkdownFileMentions {
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      if (path === undefined) return undefined
      return { open: () => { openFile(path) }, label: label(path), title: path }
    },
  }
}

function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
