import { FormField } from '../interpreter/Executor';

// Character-cell dimensions (must match CSS --char-w / --char-h)
const CW = 8.4;
const CH = 21;

export class FormLayout {
  private canvas: HTMLElement;
  private footer: HTMLElement;
  private getInputs: Map<string, HTMLInputElement> = new Map();
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

  render(fields: FormField[], vars: Map<string, unknown>) {
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
        const inp = document.createElement('input');
        inp.type = 'text';
        inp.className = 'f-get';
        inp.value = String(vars.get(f.varName) ?? '');
        inp.dataset.var = f.varName;
        inp.style.left = (x + labelWidth) + 'px';
        inp.style.top  = y + 'px';
        inp.setAttribute('autocomplete', 'off');
        inp.setAttribute('spellcheck', 'false');
        this.canvas.appendChild(inp);
        this.getInputs.set(f.varName, inp);
      }
    });

    document.addEventListener('keydown', this.boundKey, true);
    this.focusFirst();
  }

  unmount() {
    document.removeEventListener('keydown', this.boundKey, true);
    this.canvas.innerHTML = '';
    this.getInputs.clear();
  }

  private focusFirst() {
    const first = this.canvas.querySelector<HTMLInputElement>('input.f-get');
    first?.focus();
  }

  private collect(): Map<string, string> {
    const values = new Map<string, string>();
    this.getInputs.forEach((inp, varName) => values.set(varName, inp.value));
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
      if (target.tagName === 'INPUT') {
        e.preventDefault(); e.stopPropagation();
        // Move to next input, or submit if on last
        const inputs = Array.from(this.canvas.querySelectorAll<HTMLInputElement>('input.f-get'));
        const idx = inputs.indexOf(target as HTMLInputElement);
        if (idx >= 0 && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        } else {
          this.submit();
        }
      }
    }
  }

  private submit() {
    const values = this.collect();
    this.unmount();
    this.onSubmit(values);
  }
}
