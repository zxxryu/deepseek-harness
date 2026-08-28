import { unlink } from 'node:fs/promises'
import { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsInfo, FsTarget } from '@deepseek-ai/dsh-fs'
import type { SandboxExecutionPolicy } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-session'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {
  UndoFileChangeRequest,
  UndoFileChangeResult,
  UndoFileDiff,
} from './types.ts'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    fileChanges: FileChangesService
  }
}

function fail(code: Exclude<UndoFileChangeResult, { ok: true }>['code'], message: string): UndoFileChangeResult {
  return { ok: false, code, message }
}

function occurrences(haystack: string, needle: string): number[] {
  if (needle.length === 0) return []
  const result: number[] = []
  let at = 0
  while (at <= haystack.length - needle.length) {
    const next = haystack.indexOf(needle, at)
    if (next < 0) break
    result.push(next)
    at = next + Math.max(1, needle.length)
  }
  return result
}

function reverseDiffs(current: string, diffs: readonly UndoFileDiff[]): string | UndoFileChangeResult {
  let value = current
  for (const diff of [...diffs].reverse()) {
    if (diff.oldText === null || diff.newText.length === 0) {
      return fail('unsupported', 'This change has no unambiguous reversible before-image.')
    }
    const matches = occurrences(value, diff.newText)
    if (matches.length === 0) {
      return fail('changed-since-agent', 'The file no longer contains the Agent-applied text exactly; undo was not applied.')
    }
    if (matches.length > 1) {
      return fail('ambiguous-reverse', 'The Agent-applied text now appears more than once; undo would be ambiguous.')
    }
    const at = matches[0]!
    value = value.slice(0, at) + diff.oldText + value.slice(at + diff.newText.length)
  }
  return value
}

function staleFailure(error: unknown): UndoFileChangeResult | undefined {
  if (error instanceof FsError && error.code === 'FS_STALE_VERSION') {
    return fail('changed-since-agent', 'The file changed while undo was being applied; no content was overwritten.')
  }
  return undefined
}

export class FileChangesService extends TypertRemoteService {
  static inject = ['fs', 'sessions', 'sandboxPolicy']

  constructor(ctx: Context) {
    super(ctx, 'fileChanges')
  }

  @Remote('undo')
  async undo(request: UndoFileChangeRequest): Promise<UndoFileChangeResult> {
    const live = this.ctx.sessions.get(request.sessionId)
    if (live === undefined) {
      return fail('session-not-live', 'The session is not live, so its workspace cannot be resolved safely for undo.')
    }
    // The undo mutates files the Agent produced, so it runs under the SAME
    // per-call sandbox policy as that session: its resolved mode and its cwd
    // as the workspace-write root. Without an explicit policy the sandboxed
    // filesystem falls back to the agentless deployment default, which denies
    // the write (`FS_SANDBOX_DENIED`) even though the session owns the path.
    const policy = this.ctx.sandboxPolicy.resolve({ session: live })
    const cwd = live.header.cwd
    const resolveOptions = cwd === undefined ? {} : { cwd }
    const target = await this.ctx.fs.resolve(request.path, resolveOptions)
    const info = await this.ctx.fs.stat(target)

    if (request.after !== undefined && request.created !== undefined) {
      return await this.undoSnapshot(policy, request.path, resolveOptions, target, info, request.created, request.before, request.after)
    }
    if (request.diffs === undefined || request.diffs.length === 0) {
      return fail('unsupported', 'No reversible diff data was recorded for this file.')
    }
    return await this.undoFragments(policy, target, info, request.diffs)
  }

  private async undoSnapshot(
    policy: SandboxExecutionPolicy,
    requestPath: string,
    resolveOptions: { cwd?: string },
    target: FsTarget,
    info: FsInfo | undefined,
    created: boolean,
    before: string | null | undefined,
    after: string,
  ): Promise<UndoFileChangeResult> {
    if (created) {
      if (before !== null) return fail('unsupported', 'Invalid created-file undo snapshot.')
      if (info === undefined) return { ok: true, path: target.displayPath, action: 'deleted' }
      if (info.type !== 'file') return fail('not-file', `${target.displayPath} is no longer a regular file.`)
      const pathInfo = await this.ctx.fs.lstat(requestPath, resolveOptions)
      if (pathInfo?.type === 'symlink') {
        return fail('changed-since-agent', 'The produced path is now a symbolic link; undo refused to delete through it.')
      }
      const current = await this.ctx.fs.readText(target)
      if (current !== after) {
        return fail('changed-since-agent', 'The file changed after the Agent finished; undo was not applied.')
      }
      const fresh = await this.ctx.fs.stat(target)
      if (fresh === undefined || fresh.type !== 'file' || fresh.version !== info.version) {
        return fail('changed-since-agent', 'The file changed while undo was being prepared; undo was not applied.')
      }
      try {
        await unlink(this.ctx.fs.processPath(target))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return fail('delete-failed', `Unable to remove the Agent-created file: ${message}`)
      }
      return { ok: true, path: target.displayPath, action: 'deleted' }
    }

    if (typeof before !== 'string') {
      return fail('unsupported', 'The original file content was not recorded, so this overwrite cannot be safely undone.')
    }
    if (info === undefined) return fail('missing', `${target.displayPath} no longer exists.`)
    if (info.type !== 'file') return fail('not-file', `${target.displayPath} is no longer a regular file.`)
    const current = await this.ctx.fs.readText(target)
    if (current !== after) {
      return fail('changed-since-agent', 'The file changed after the Agent finished; undo was not applied.')
    }
    try {
      await this.ctx.fs.writeText(target, before, { kind: 'replaceIfVersion', version: info.version }, undefined, policy)
    } catch (error) {
      const stale = staleFailure(error)
      if (stale !== undefined) return stale
      throw error
    }
    return { ok: true, path: target.displayPath, action: 'restored' }
  }

  private async undoFragments(
    policy: SandboxExecutionPolicy,
    target: FsTarget,
    info: FsInfo | undefined,
    diffs: readonly UndoFileDiff[],
  ): Promise<UndoFileChangeResult> {
    if (info === undefined) return fail('missing', `${target.displayPath} no longer exists.`)
    if (info.type !== 'file') return fail('not-file', `${target.displayPath} is no longer a regular file.`)
    const current = await this.ctx.fs.readText(target)
    const reversed = reverseDiffs(current, diffs)
    if (typeof reversed !== 'string') return reversed
    try {
      await this.ctx.fs.writeText(target, reversed, { kind: 'replaceIfVersion', version: info.version }, undefined, policy)
    } catch (error) {
      const stale = staleFailure(error)
      if (stale !== undefined) return stale
      throw error
    }
    return { ok: true, path: target.displayPath, action: 'restored' }
  }
}

export default FileChangesService
