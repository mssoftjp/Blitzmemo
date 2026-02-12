import { app, Menu, type MenuItemConstructorOptions } from 'electron';

export type SetupDockMenuOptions = {
  buildMenuTemplate: () => MenuItemConstructorOptions[];
};

export type DockMenuApi = {
  updateDockMenu: () => void;
};

export function setupDockMenu(opts: SetupDockMenuOptions): DockMenuApi {
  function updateDockMenu(): void {
    if (process.platform !== 'darwin') return;
    if (!app.dock) return;

    // user-note: macOS Dock menus always include a built-in "Quit" item.
    // Avoid adding our own Quit entry (the tray menu has it as the last item).
    const template = opts.buildMenuTemplate();
    const dockTemplate = template.length > 0 ? template.slice(0, -1) : template;

    try {
      app.dock.setMenu(Menu.buildFromTemplate(dockTemplate));
    } catch {
      // ignore
    }
  }

  return { updateDockMenu };
}

