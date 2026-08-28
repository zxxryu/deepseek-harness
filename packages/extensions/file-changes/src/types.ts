import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One diff fragment preserved by the client turn projection. */
export interface UndoFileDiff {
  readonly oldText: string | null
  readonly newText: string
}

/** Undo one produced file from a completed turn. */
export interface UndoFileChangeRequest {
  readonly sessionId: SessionId
  readonly path: string
  /** True only when the Agent created a previously absent text file. */
  readonly created?: boolean
  /** Full first-before / final-after snapshot when native write/edit metadata provides it. */
  readonly before?: string | null
  readonly after?: string
  /** Fallback reversible fragments, ordered as originally applied. */
  readonly diffs?: readonly UndoFileDiff[]
}

export type UndoFileChangeFailureCode =
  | 'session-not-live'
  | 'missing'
  | 'not-file'
  | 'changed-since-agent'
  | 'ambiguous-reverse'
  | 'unsupported'
  | 'delete-failed'

export type UndoFileChangeResult =
  | {
    readonly ok: true
    readonly path: string
    readonly action: 'restored' | 'deleted'
  }
  | {
    readonly ok: false
    readonly code: UndoFileChangeFailureCode
    readonly message: string
  }
