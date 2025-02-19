const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  receive: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(event, ...args));
  },
  invoke: (channel, data) => {
    return ipcRenderer.invoke(channel, data);
  },
  runInstallScript: () => {
    ipcRenderer.send('run-install-script');
  },
  restartApp: () => {
    ipcRenderer.send('restart-app');
  }
});