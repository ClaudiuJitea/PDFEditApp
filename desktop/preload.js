const { contextBridge, ipcRenderer } = require('electron');

async function blobToArrayBuffer(blob) {
  if (blob instanceof ArrayBuffer) return blob;
  if (ArrayBuffer.isView(blob)) return blob.buffer;
  return blob.arrayBuffer();
}

contextBridge.exposeInMainWorld('pdfEditDesktop', {
  isDesktop: true,
  getVersion: () => ipcRenderer.invoke('desktop:get-version'),
  getAuthToken: () => ipcRenderer.invoke('desktop:get-auth-token'),
  openFile: async (options) => {
    const files = await ipcRenderer.invoke('desktop:open-file', options);
    return files.map((entry) => new File([entry.data], entry.name, { type: entry.type }));
  },
  saveFile: async (blob, filename) => {
    const data = await blobToArrayBuffer(blob);
    return ipcRenderer.invoke('desktop:save-file', {
      defaultPath: filename,
      data,
      mimeType: blob.type || 'application/octet-stream',
    });
  },
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  quit: () => ipcRenderer.invoke('desktop:quit'),
});
