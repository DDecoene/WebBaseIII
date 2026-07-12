import type { FormField } from '../shared/types';

// Character-cell dimensions (must match CSS --char-w / --char-h)
const CW = 8.4;
const CH = 21;

type GetControl = HTMLInputElement | HTMLSelectElement;

export class FormLayout {
  private canvas: HTMLElement;
  private footer: HTMLElement;
  private getInputs: Map<string, GetControl> = new Map();
  private onSubmit: (values: Map<string, string>) => void;
  private onCancel: () => void;
  private boundKey: (e: KeyboardEvent) => void;

  constructor(
    onSubmit: (values: Map<string, string>) => void,
    onCancel: () => void,
  ) {
    this.canvas = document.getElementById('form-canvas')!;
    this.footer = document.getElementById('form-footer')!;
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.boundKey = this.handleKey.bind(this);
  }

  render(fields: FormField[]) {
    this.canvas.innerHTML = '';
    this.getInputs.clear();

    fields.forEach(f => {
      const x = Math.round(f.col * CW);
      const y = Math.round(f.row * CH);

      if (f.label) {
        const el = document.createElement('span');
        el.className = 'f-say';
        el.textContent = f.label;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
        this.canvas.appendChild(el);
      }

      if (f.varName) {
        const labelWidth = f.label.length * CW + 8;
        let ctl: GetControl;
        if (f.options && f.options.length) {
          // A resolved lookup renders as a dropdown — the picker IS the
          // client-side validation; the server still re-checks on submit.
          const sel = document.createElement('select');
          sel.className = 'f-get';
          const blank = document.createElement('option');
          blank.value = ''; blank.textContent = '';
          sel.appendChild(blank);
          for (const o of f.options) {
            const op = document.createElement('option');
            op.value = o.value;
            op.textContent = o.label === o.value ? o.value : `${o.label} (${o.value})`;
            sel.appendChild(op);
          }
          sel.value = f.value ?? '';
          ctl = sel;
        } else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'f-get';
          inp.value = f.value ?? '';
          inp.setAttribute('autocomplete', 'off');
          inp.setAttribute('spellcheck', 'false');
          ctl = inp;
        }
        ctl.dataset.var = f.varName;
        ctl.style.left = (x + labelWidth) + 'px';
        ctl.style.top  = y + 'px';
        ctl.addEventListener('input', () => this.clearError(ctl));
        this.canvas.appendChild(ctl);
        this.getInputs.set(f.varName, ctl);
      }
    });

    document.addEventListener('keydown', this.boundKey, true);
    this.focusFirst();
  }

  /** Server rejected the submit: outline the offending controls, keep the form. */
  showErrors(errors: { varName: string; message: string }[]) {
    // Clear every prior mark first — a field valid in this attempt must not
    // keep a stale outline from an earlier rejection the user never touched.
    this.getInputs.forEach(ctl => this.clearError(ctl));
    for (const { varName, message } of errors) {
      const ctl = this.getInputs.get(varName);
      if (!ctl) continue;
      ctl.classList.add('f-invalid');
      ctl.title = message;
    }
    this.footer.textContent = errors.map(e => e.message).join('  ·  ');
    const first = errors[0] && this.getInputs.get(errors[0].varName);
    first?.focus();
  }

  private clearError(ctl: GetControl) {
    ctl.classList.remove('f-invalid');
    ctl.removeAttribute('title');
  }

  unmount() {
    document.removeEventListener('keydown', this.boundKey, true);
    this.canvas.innerHTML = '';
    this.getInputs.clear();
    this.footer.textContent = '';
  }

  private focusFirst() {
    const first = this.canvas.querySelector<HTMLElement>('.f-get');
    first?.focus();
  }

  private collect(): Map<string, string> {
    const values = new Map<string, string>();
    this.getInputs.forEach((ctl, varName) => values.set(varName, ctl.value));
    return values;
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      this.unmount();
      this.onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
        e.preventDefault(); e.stopPropagation();
        // Move to next control, or submit if on last
        const ctls = Array.from(this.canvas.querySelectorAll<HTMLElement>('.f-get'));
        const idx = ctls.indexOf(target);
        if (idx >= 0 && idx < ctls.length - 1) {
          ctls[idx + 1].focus();
        } else {
          this.submit();
        }
      }
    }
  }

  private submit() {
    // Do NOT unmount here: the server validates and either sends view-terminal
    // (Terminal closes the form) or form-error (the form stays for correction).
    this.onSubmit(this.collect());
  }
}
