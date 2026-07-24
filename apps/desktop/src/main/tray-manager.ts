import {
  Menu,
  Tray,
  nativeImage
} from 'electron';

export class TrayManager {
  private tray: Tray | undefined;

  create(input: {
    iconPath: string;
    open(): void;
    navigate(route: string): void;
    quit(): void;
  }): void {
    if (this.tray !== undefined) return;
    const icon = nativeImage.createFromPath(input.iconPath).resize({
      width: process.platform === 'darwin' ? 18 : 20,
      height: process.platform === 'darwin' ? 12 : 20
    });
    const tray = new Tray(icon);
    tray.setToolTip('Clawee');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 Clawee', click: input.open },
      { type: 'separator' },
      { label: '新建任务', click: () => input.navigate('#/') },
      { label: '查看运行中任务', click: () => input.navigate('#/tasks') },
      { type: 'separator' },
      { label: '退出 Clawee', click: input.quit }
    ]));
    tray.on('click', input.open);
    this.tray = tray;
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}
