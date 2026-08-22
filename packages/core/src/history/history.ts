/**
 * Undo/redo.
 *
 * Commands carry the data needed to reverse themselves rather than the whole
 * document, so a hundred-step history of a heavy sketch stays cheap. The stack
 * is bounded — a tablet has no business holding an unbounded undo buffer.
 */

import { type SketchDocument } from '../document/types.js';

export interface Command {
  /** Shown in the UI, e.g. "Draw stroke". */
  readonly label: string;
  apply(doc: SketchDocument): void;
  revert(doc: SketchDocument): void;
  /**
   * Optional merge with the immediately preceding command, for things like
   * dragging a slider that would otherwise flood the stack. Return true if
   * `this` absorbed `previous`.
   */
  mergeWith?(previous: Command): boolean;
}

export interface HistoryState {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  depth: number;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private listeners = new Set<(state: HistoryState) => void>();

  constructor(
    private readonly doc: SketchDocument,
    private readonly maxDepth = 100,
  ) {}

  /** Runs a command and records it. This is the only way to mutate the document. */
  run(command: Command): void {
    command.apply(this.doc);

    const previous = this.undoStack[this.undoStack.length - 1];
    if (previous && command.mergeWith?.(previous)) {
      this.undoStack[this.undoStack.length - 1] = command;
    } else {
      this.undoStack.push(command);
      if (this.undoStack.length > this.maxDepth) this.undoStack.shift();
    }

    // Any new action invalidates the redo branch.
    this.redoStack.length = 0;
    this.emit();
  }

  undo(): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;
    command.revert(this.doc);
    this.redoStack.push(command);
    this.emit();
    return true;
  }

  redo(): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;
    command.apply(this.doc);
    this.undoStack.push(command);
    this.emit();
    return true;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.emit();
  }

  get state(): HistoryState {
    const undoTop = this.undoStack[this.undoStack.length - 1];
    const redoTop = this.redoStack[this.redoStack.length - 1];
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      undoLabel: undoTop?.label ?? null,
      redoLabel: redoTop?.label ?? null,
      depth: this.undoStack.length,
    };
  }

  subscribe(listener: (state: HistoryState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }
}
