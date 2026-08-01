import type { PathTreeDialogRequest, WebviewDialogRequest } from '@git4vsc/shared-types';

type DialogDefinition = WebviewDialogRequest extends infer Request ? Request extends WebviewDialogRequest ? Omit<Request, 'id'> : never : never;
type SingleValueDialog = Exclude<WebviewDialogRequest, PathTreeDialogRequest>;
type SingleValueDefinition = SingleValueDialog extends infer Request ? Request extends SingleValueDialog ? Omit<Request, 'id'> : never : never;
type DialogValue = string | string[] | null;

export class WebviewDialogController {
  private nextId = 1;
  private active: { id: number; resolve(value: DialogValue): void } | null = null;

  constructor(private readonly postMessage: (message: unknown) => PromiseLike<boolean>) {}

  show(dialog: Omit<PathTreeDialogRequest, 'id'>): Promise<string[] | null>;
  show(dialog: SingleValueDefinition): Promise<string | null>;
  async show(dialog: DialogDefinition): Promise<DialogValue> {
    this.cancel();
    const id = this.nextId++;
    const result = new Promise<DialogValue>(resolve => { this.active = { id, resolve }; });
    if (!await this.postMessage({ type: 'dialog:open', dialog: { ...dialog, id } })) this.cancel();
    return result;
  }

  resolve(id: unknown, value: unknown): boolean {
    if (typeof id !== 'number' || this.active?.id !== id) return false;
    const active = this.active;
    this.active = null;
    active.resolve(typeof value === 'string' || Array.isArray(value) && value.every(item => typeof item === 'string') ? value : null);
    return true;
  }

  isActive(id: unknown): id is number {
    return typeof id === 'number' && this.active?.id === id;
  }

  cancel(): void {
    const active = this.active;
    this.active = null;
    active?.resolve(null);
  }
}
