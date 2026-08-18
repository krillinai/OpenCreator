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
    const size = process.platform === 'darwin' ? 18 : 20;
    const icon = nativeImage.createFromPath(input.iconPath).resize({
      width: size,
      height: size
    });
    if (process.platform === 'darwin') icon.setTemplateImage(true);
    const tray = new Tray(icon);
    tray.setToolTip('OpenCreator');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开 OpenCreator', click: input.open },
      { type: 'separator' },
      { label: '新建任务', click: () => input.navigate('#/') },
      { label: '查看运行中任务', click: () => input.navigate('#/tasks') },
      { type: 'separator' },
      { label: '退出 OpenCreator', click: input.quit }
    ]));
    tray.on('click', input.open);
    this.tray = tray;
  }

  destroy(): void {
    this.tray?.destroy();
    this.tray = undefined;
  }
}
