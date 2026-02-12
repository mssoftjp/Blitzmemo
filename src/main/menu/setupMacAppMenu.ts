import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export type SetupMacAppMenuOptions = {
  openPreferences: () => void;
};

// user-note: We intentionally keep the macOS menu minimal (Blitzmemo/File/Edit only) to avoid Electron/Chromium zoom
// and reload/devtools commands conflicting with Blitzmemo's own shortcut/system.
export function setupMacAppMenu(opts: SetupMacAppMenuOptions): void {
  if (process.platform !== 'darwin') return;

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences…',
          accelerator: 'CommandOrControl+,',
          click: () => opts.openPreferences()
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [{ role: 'close' }]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

