import type { WsClient } from '../ws/WsClient';

export class ProgramEditor {
  private view: HTMLElement;
  private filenameEl: HTMLElement;
  private textarea: HTMLTextAreaElement;
  private name: string = '';
  private boundKey: (e: KeyboardEvent) => void;

  constructor(private ws: WsClient, private onClose: () => void) {
    this.view      = document.getElementById('editor-view')!;
    this.filenameEl = document.getElementById('editor-filename')!;
    this.textarea  = document.getElementById('editor-textarea') as HTMLTextAreaElement;
    this.boundKey  = this.handleKey.bind(this);
  }

  open(name: string, content: string) {
    this.name = name;
    this.filenameEl.textContent = `${name}.prg`;
    this.textarea.value = content;
    this.view.classList.remove('hidden');
    document.addEventListener('keydown', this.boundKey, true);
    this.textarea.focus();
  }

  /** Detach the key listener and hide the view without invoking onClose. */
  unmount() {
    document.removeEventListener('keydown', this.boundKey, true);
    this.view.classList.add('hidden');
  }

  close() {
    this.unmount();
    this.onClose();
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close();
    } else if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      this.save();
    }
  }

  private save() {
    this.ws.send({ type: 'save-program', name: this.name, content: this.textarea.value });
  }
}
