export class ReportPreview {
  private view: HTMLElement;
  private iframe: HTMLIFrameElement;
  private onClose: () => void;

  constructor(onClose: () => void) {
    this.view = document.getElementById('report-preview-view')!;
    this.iframe = document.getElementById('report-iframe') as HTMLIFrameElement;
    this.onClose = onClose;

    document.addEventListener('keydown', (e) => {
      if (!this.view.classList.contains('hidden') && e.key === 'Escape') {
        this.hide();
      }
    });
  }

  show(html: string): void {
    this.iframe.srcdoc = html;
    this.view.classList.remove('hidden');
    document.getElementById('terminal-view')?.classList.add('hidden');
    document.getElementById('grid-view')?.classList.add('hidden');
    document.getElementById('editor-view')?.classList.add('hidden');
    document.getElementById('form-view')?.classList.add('hidden');
  }

  hide(): void {
    this.view.classList.add('hidden');
    this.iframe.srcdoc = '';
    this.onClose();
  }
}
