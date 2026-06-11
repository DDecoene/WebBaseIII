export interface ShellButtons {
  okLabel: string;
  onOk: () => void;
  extraLabel?: string;        // e.g. "Save & run"
  onExtra?: () => void;
}

/** Shared wizard chrome: title, body, live W3Script preview, error line, OK/Cancel, Esc. */
export class WizardShell {
  private static current: WizardShell | null = null;
  private closed = false;

  readonly view: HTMLElement;
  readonly body: HTMLElement;
  private previewEl: HTMLElement;
  private errorEl: HTMLElement;
  private okBtn: HTMLButtonElement;
  private extraBtn: HTMLButtonElement | null = null;
  private keyHandler: (e: KeyboardEvent) => void;

  constructor(
    title: string,
    subtitle: string,
    buttons: ShellButtons,
    private onClose: () => void,
  ) {
    WizardShell.current?.detach();
    WizardShell.current = this;

    this.view = document.getElementById('wizard-view')!;
    this.view.innerHTML = '';

    const h = document.createElement('h2');
    h.textContent = title;
    const sub = document.createElement('p');
    sub.className = 'wz-sub';
    sub.textContent = subtitle;
    this.body = document.createElement('div');

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'wz-preview';
    this.errorEl = document.createElement('div');
    this.errorEl.className = 'wz-error';

    const btns = document.createElement('div');
    btns.className = 'wz-buttons';
    this.okBtn = document.createElement('button');
    this.okBtn.textContent = buttons.okLabel;
    this.okBtn.addEventListener('click', () => buttons.onOk());
    btns.appendChild(this.okBtn);
    if (buttons.extraLabel && buttons.onExtra) {
      this.extraBtn = document.createElement('button');
      this.extraBtn.textContent = buttons.extraLabel;
      this.extraBtn.addEventListener('click', () => buttons.onExtra!());
      btns.appendChild(this.extraBtn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel (Esc)';
    cancel.addEventListener('click', () => this.close());
    btns.appendChild(cancel);

    this.view.append(h, sub, this.body, this.previewEl, this.errorEl, btns);

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  /** preview === null means "not well-formed yet": clears preview, disables OK. */
  setPreview(preview: string | null, error = '') {
    this.previewEl.textContent = preview ?? '';
    this.errorEl.textContent = error;
    this.okBtn.disabled = preview === null;
    if (this.extraBtn) this.extraBtn.disabled = preview === null;
  }

  field(labelText: string, input: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wz-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.append(label, input);
    this.body.appendChild(wrap);
    return wrap;
  }

  /** Remove the Esc listener without firing onClose — used when a newer shell supersedes this one. */
  private detach() {
    this.closed = true;
    document.removeEventListener('keydown', this.keyHandler);
  }

  close() {
    if (this.closed) return;
    this.detach();
    if (WizardShell.current === this) WizardShell.current = null;
    this.view.innerHTML = '';
    this.onClose();
  }
}
