const { contextBridge, ipcRenderer } = require('electron');

async function blobToArrayBuffer(blob) {
  if (blob instanceof ArrayBuffer) return blob;
  if (ArrayBuffer.isView(blob)) {
    return blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength);
  }
  return blob.arrayBuffer();
}

contextBridge.exposeInMainWorld('pdfEditDesktop', {
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke('desktop:get-version'),
  getAuthToken: () => ipcRenderer.invoke('desktop:get-auth-token'),
  openFile: async (options) => {
    const files = await ipcRenderer.invoke('desktop:open-file', options);
    return files.map((entry) => ({
      file: new File([entry.data], entry.name, { type: entry.type || 'application/pdf' }),
      path: entry.path || null,
      name: entry.name,
    }));
  },
  saveFile: async (blob, filename, options = {}) => {
    const data = await blobToArrayBuffer(blob);
    return ipcRenderer.invoke('desktop:save-file', {
      defaultPath: filename,
      data,
      mimeType: blob.type || 'application/octet-stream',
      filePath: options.filePath || null,
      filters: options.filters || null,
    });
  },
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  openPath: (targetPath) => ipcRenderer.invoke('desktop:open-path', targetPath),
  showItemInFolder: (targetPath) => ipcRenderer.invoke('desktop:show-item-in-folder', targetPath),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
});
