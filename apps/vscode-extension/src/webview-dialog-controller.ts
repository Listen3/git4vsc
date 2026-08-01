import type { WebviewDialogRequest } from '@git4vsc/shared-types';

type DialogDefinition = WebviewDialogRequest extends infer Request ? Request extends WebviewDialogRequest ? Omit<Request, 'id'> : never : never;

export class WebviewDialogController {
  private nextId = 1;
  private active: { id: number; resolve(value: string | null): void } | null = null;

  constructor(private readonly postMessage: (message: unknown) => PromiseLike<boolean>) {}

  async show(dialog: DialogDefinition): Promise<string | null> {
    this.cancel();
    const id = this.nextId++;
    const result = new Promise<string | null>(resolve => { this.active = { id, resolve }; });
    if (!await this.postMessage({ type: 'dialog:open', dialog: { ...dialog, id } })) this.cancel();
    return result;
  }

  resolve(id: unknown, value: unknown): boolean {
    if (typeof id !== 'number' || this.active?.id !== id) return false;
    const active = this.active;
    this.active = null;
    active.resolve(typeof value === 'string' ? value : null);
    return true;
  }

  cancel(): void {
    const active = this.active;
    this.active = null;
    active?.resolve(null);
  }
}
