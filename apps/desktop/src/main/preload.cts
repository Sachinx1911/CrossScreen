// `require`, not `import`: `verbatimModuleSyntax` means a .cts file has to be
// written the way it will be emitted, and this one is emitted as CommonJS.
import electron = require('electron');

const { contextBridge, ipcRenderer } = electron;

/**
 * The only surface the renderer has onto the main process.
 *
 * Two functions, both taking and returning plain data. The renderer stays
 * fully isolated — no Node, no require, no ipcRenderer of its own — because it
 * is a web page, and a web page that can reach the filesystem is one bug away
 * from being the problem.
 *
 * A `.cts` file, so TypeScript emits `.cjs`. Electron only loads an ESM
 * preload when `sandbox: false`, and giving up the sandbox to gain an import
 * statement is a bad trade.
 */
contextBridge.exposeInMainWorld('crossscreen', {
  listSources: () => ipcRenderer.invoke('capture:list-sources'),
  selectSource: (sourceId: string) => ipcRenderer.invoke('capture:select-source', sourceId),
});
