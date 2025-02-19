const { app, BrowserWindow, session, Tray, Menu, globalShortcut, screen, ipcMain, shell } = require('electron');
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  return;
}
const path = require('path');
const fs = require('fs');
const Registry = require('winreg');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');

const config = require('./config');
const { 
  defaultUrl, 
  defaultUserAgent, 
  defaultBackgroundColor, 
  appName
} = config;

const whitelist = [
  new URL(defaultUrl).host,
  "openwebui.com"
];

const userDataPath = path.join(app.getPath('userData'), appName);
const configPath = path.join(userDataPath, 'window-config.json');
const companionWindowConfigPath = path.join(userDataPath, 'companion-window-config.json');
const hotkeyConfigPath = path.join(userDataPath, 'hotkey-config.json');
const defaultUrlConfigPath = path.join(userDataPath, 'default-url.json');

app.setPath('userData', userDataPath);

let mainWindow, installerWindow;
let tray;
let isMainWindowVisible = false;
let companionWindow;
let isCompanionWindowVisible = false;
let trayContextMenu;
let isAutoLaunchEnabled = false;
let hotkeyWindow;

let currentCompanionHotkey = "Ctrl+Space";
let serviceReady = false;

app.setAppUserModelId(appName);

function isAllowedURL(url) {
  try {
    const parsed = new URL(url);
    return whitelist.some(allowedDomain => parsed.hostname === allowedDomain || parsed.hostname.endsWith('.' + allowedDomain));
  } catch (error) {
    return false;
  }
}

const autoLaunchKey = new Registry({
  hive: Registry.HKCU,
  key: '\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
});

function addToStartupWithArgs() {
  autoLaunchKey.set(appName, Registry.REG_SZ, `"${app.getPath('exe')}" --tray`, err => {
    if (err) console.error('Error adding to startup:', err);
  });
}

function removeFromStartup() {
  autoLaunchKey.remove(appName, err => {
    if (err) console.error('Error removing from startup:', err);
  });
}

function checkStartupStatus(callback) {
  autoLaunchKey.get(appName, (err, item) => {
    if (err) callback(false);
    else callback(item && item.value && item.value.includes('--tray'));
  });
}

function saveWindowConfig(win, confPath) {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const data = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y, lastUrl: win.webContents.getURL() };
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(confPath, JSON.stringify(data));
}

function loadWindowConfig(confPath) {
  try {
    return JSON.parse(fs.readFileSync(confPath, 'utf8'));
  } catch (e) {
    return confPath === companionWindowConfigPath ?
      { width: 600, height: 800, lastUrl: getEffectiveUrl(), x: undefined, y: undefined } :
      { width: 1280, height: 900, lastUrl: getEffectiveUrl(), x: undefined, y: undefined };
  }
}

function getEffectiveUrl() {
  if (fs.existsSync(defaultUrlConfigPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(defaultUrlConfigPath, 'utf8'));
      if (data.defaultUrl) return data.defaultUrl;
    } catch (err) {
      console.error("Error reading defaultUrl:", err);
    }
  }
  return defaultUrl;
}

function getEffectiveUrlParams() {
  const effectiveUrl = getEffectiveUrl();
  try {
    const parsed = new URL(effectiveUrl);
    return { host: parsed.hostname, port: parsed.port ? parseInt(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80) };
  } catch (err) {
    console.error('URL parse error:', effectiveUrl, err);
    const fallback = new URL(defaultUrl);
    return { host: fallback.hostname, port: fallback.port ? parseInt(fallback.port) : (fallback.protocol === 'https:' ? 443 : 80) };
  }
}

function getBatFilePath(batFileName) {
  return path.join(process.resourcesPath, 'app', batFileName);
}

function updateGlobalHotkeys() {
  if (!serviceReady) return;
  if (currentCompanionHotkey && !globalShortcut.isRegistered(currentCompanionHotkey)) {
    globalShortcut.register(currentCompanionHotkey, toggleCompanionWindow);
  }

  const mainFocused = mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused();
  const companionFocused = companionWindow && !companionWindow.isDestroyed() && companionWindow.isFocused();
  const hotkeyFocused = hotkeyWindow && !hotkeyWindow.isDestroyed() && hotkeyWindow.isFocused();
  const anyFocused = mainFocused || companionFocused || hotkeyFocused;

  if (anyFocused) {
    if (!globalShortcut.isRegistered('Ctrl+N')) {
      globalShortcut.register('Ctrl+N', () => {
        if (mainWindow && mainWindow.isFocused()) {
          mainWindow.webContents.executeJavaScript(`
            document.getElementById('sidebar-new-chat-button').click();
            document.getElementById('chat-input').focus();
          `);
        } else if (companionWindow && companionWindow.isFocused()) {
          companionWindow.webContents.executeJavaScript(`
            document.getElementById('sidebar-new-chat-button').click();
            document.getElementById('chat-input').focus();
          `);
        }
      });
    }
    if (!globalShortcut.isRegistered('Ctrl+W')) {
      globalShortcut.register('Ctrl+W', () => {
        if (mainWindow && mainWindow.isFocused()) {
          mainWindow.close();
        } else if (companionWindow && companionWindow.isFocused()) {
          companionWindow.close();
        }
      });
    }
    if (!globalShortcut.isRegistered('Ctrl+Q')) {
      globalShortcut.register('Ctrl+Q', quitApp);
    }
  } else {
    if (globalShortcut.isRegistered('Ctrl+N')) globalShortcut.unregister('Ctrl+N');
    if (globalShortcut.isRegistered('Ctrl+W')) globalShortcut.unregister('Ctrl+W');
    if (globalShortcut.isRegistered('Ctrl+Q')) globalShortcut.unregister('Ctrl+Q');
  }
}

function attachFocusBlurListeners(win) {
  if (!win) return;
  win.on('focus', updateGlobalHotkeys);
  win.on('blur', () => setTimeout(updateGlobalHotkeys, 100));
}

let batProcesses = [];
function runPythonScript(batFileName) {
  const batPath = getBatFilePath(batFileName);
  const proc = spawn('cmd.exe', ['/c', batPath], {
    cwd: path.dirname(batPath),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
  });
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  
  proc.stdout.on('data', data => console.log(`${batFileName} STDOUT: ${data}`));
  proc.stderr.on('data', data => console.error(`${batFileName} STDERR: ${data}`));
  proc.on('close', code => console.log(`${batFileName} exited with ${code}`));
  batProcesses.push(proc);
}

function runAllPythonScripts() {
  ['start_ui.bat'].forEach(runPythonScript);
}

function quitApp() {
  app.isQuiting = true;
  if (mainWindow) { mainWindow.removeAllListeners(); mainWindow.close(); mainWindow = null; }
  if (companionWindow) { companionWindow.removeAllListeners(); companionWindow.close(); companionWindow = null; }
  if (hotkeyWindow) { hotkeyWindow.close(); hotkeyWindow = null; }
  app.quit();
}

app.on('before-quit', () => {
  console.log('Terminating all BAT processes...');
  batProcesses.forEach(proc => { if (proc) treeKill(proc.pid, 'SIGTERM', err => { if (err) console.error(err); }); });
  if (companionWindow && !companionWindow.isDestroyed()) saveWindowConfig(companionWindow, companionWindowConfigPath);
  if (mainWindow && !mainWindow.isDestroyed()) saveWindowConfig(mainWindow, configPath);
  globalShortcut.unregisterAll();
});

const net = require('net');
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise(resolve => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}
async function waitForService(retryInterval = 500) {
  const { host, port } = getEffectiveUrlParams();
  let up = false;
  console.log(`Waiting for Open WebUI service to start on ${host}:${port}...`);
  while (!up) {
    up = await isPortOpen(port, host);
    if (!up) {
      console.log(`Service not ready on ${host}:${port}. Retrying in ${retryInterval / 1000} seconds...`);
      await new Promise(r => setTimeout(r, retryInterval));
    }
  }
  console.log(`Service is up on ${host}:${port}.`);
}

ipcMain.on('remote-installation', (event, remoteUrl) => {
  if (installationInProgress) {
    return;
  }
  installationInProgress = true;
  try {
    const startOwebuiPath = getBatFilePath('installed.txt');
    const startUiPath = getBatFilePath('start_ui.bat');
    fs.writeFileSync(startOwebuiPath, '');
    fs.writeFileSync(startUiPath, '');
    fs.writeFileSync(defaultUrlConfigPath, JSON.stringify({ defaultUrl: remoteUrl }, null, 2));
    event.sender.send('installation-result', true);
  } catch (error) {
    console.error('Error during remote installation:', error);
    event.sender.send('installation-result', false);
  } finally {
    installationInProgress = false;
  }
});

ipcMain.handle('get-translations', (event) => {
  const locale = app.getLocale().split('-')[0].toLowerCase();
  try {
    return require(`./locales/${locale}.json`);
  } catch (error) {
    return require('./locales/en.json');
  }
});

let installationInProgress = false;
ipcMain.on('local-installation', (event, options) => {
  console.log('DEBUG local-installation options:', options);

  if (installationInProgress) {
    return;
  }
  installationInProgress = true;

  try {
    const {
      host,
      port,
      chatSave,
      webuiAuth,
      telemetry,
      scarfAnalytics,
      ollamaUrl,
      openaiApiBase,
      openaiApiKey,
      updateEnabled
    } = options;
    const updateLine = updateEnabled ? 'call update_ui.bat' : '';

    const batContent = `@echo off
SET "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%" || exit /b
@set "PATH=%~dp0embpy;%~dp0embpy\\Scripts;%PATH%"

SETLOCAL ENABLEDELAYEDEXPANSION
${updateLine}
SET "KEY_FILE=.webui_secret_key"
IF "%PORT%"=="" SET PORT=${port}
IF "%HOST%"=="" SET HOST=${host}

IF "%WEBUI_SECRET_KEY%%WEBUI_JWT_SECRET_KEY%"=="" (
    IF NOT EXIST "%KEY_FILE%" (
        (
            for /L %%i in (1,1,12) do (
                <nul set /p ="!random!"
            )
        ) > "%KEY_FILE%"
        echo Key generated.
    )
    <nul set /p WEBUI_SECRET_KEY=<"%KEY_FILE%"
)

SET "ENABLE_REALTIME_CHAT_SAVE=${chatSave}"
SET "OLLAMA_BASE_URL=${ollamaUrl}"
SET "OPENAI_API_BASE_URL=${openaiApiBase}"
SET "OPENAI_API_KEY=${openaiApiKey}"
SET "WEBUI_AUTH=${webuiAuth}"
SET "SCARF_NO_ANALYTICS=${scarfAnalytics}"
SET "DO_NOT_TRACK=true"
SET "ANONYMIZED_TELEMETRY=${telemetry}"

open-webui serve --host "%HOST%" --port "%PORT%"
`;
    const startUiPath = path.join(__dirname, 'start_ui.bat');
    fs.writeFileSync(startUiPath, batContent, 'utf8');
    fs.writeFileSync(
      defaultUrlConfigPath,
      JSON.stringify({ defaultUrl: `http://127.0.0.1:${port}` }, null, 2)
    );
    const batPath = path.join(__dirname, 'owebui_init.bat');
    const batProcess = spawn('cmd.exe', ['/c', batPath], { windowsHide: true });

    batProcess.stdout.on('data', (data) => {
      event.sender.send('installation-log', data.toString());
    });

    batProcess.stderr.on('data', (data) => {
      event.sender.send('installation-log', data.toString());
    });

    batProcess.on('close', (code) => {
      const startOwebuiPath = path.join(__dirname, 'installed.txt');
      const success = fs.existsSync(startOwebuiPath);
      event.sender.send('installation-result', success);
      installationInProgress = false;
    });

    batProcess.on('error', (err) => {
      event.sender.send('installation-log', err.toString());
      event.sender.send('installation-result', false);
      installationInProgress = false;
    });
  } catch (error) {
    console.error('Error during local installation:', error);
    event.sender.send('installation-result', false);
    installationInProgress = false;
  }
});

ipcMain.on('restart-app', () => {
  app.relaunch(); 
  app.exit(0);
});

app.on('ready', async () => {
  try {
    if (!fs.existsSync(path.join(__dirname, 'installed.txt'))) { 
      createInstallerWindow(); 
      return; 
    }
    runAllPythonScripts();
    await createMainWindow();
    const args = process.argv;
    if (args.includes('--tray')) { 
      mainWindow.hide(); 
      isMainWindowVisible = false; 
    } else { 
      mainWindow.show(); 
      isMainWindowVisible = true; 
    }
    console.log('User data path:', app.getPath('userData'));
    checkStartupStatus(enabled => { 
      isAutoLaunchEnabled = enabled; 
      updateAutoLaunchMenuItem(enabled); 
    });
    await waitForService();
    serviceReady = true;
    const savedHotkey = fs.existsSync(hotkeyConfigPath)
      ? JSON.parse(fs.readFileSync(hotkeyConfigPath, 'utf8')).hotkey || "Ctrl+Space"
      : "Ctrl+Space";
    currentCompanionHotkey = savedHotkey;
    updateGlobalHotkeys();
    const effectiveUrl = getEffectiveUrl();
    mainWindow.loadURL(effectiveUrl);
  } catch (error) {
    console.error('Error during app ready:', error);
  }
});

function createMainWindow() {
  const { width, height, x, y } = loadWindowConfig(configPath);
  const ses = session.fromPartition('persist:app', { cache: false });
  mainWindow = new BrowserWindow({
    width, height, x, y, backgroundColor: defaultBackgroundColor,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, enableRemoteModule: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      nativeWindowOpen: true, sandbox: true, session: ses
    }
  });
  mainWindow.webContents.setUserAgent(defaultUserAgent);
  mainWindow.loadFile('index.html');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedURL(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', e => {
    if (!app.isQuiting) { 
      e.preventDefault(); 
      mainWindow.hide(); 
      isMainWindowVisible = false; 
      rebuildTrayContextMenu(); 
    }
  });
  mainWindow.on('show', () => { 
    isMainWindowVisible = true; 
    rebuildTrayContextMenu(); 
  });
  mainWindow.on('resize', () => saveWindowConfig(mainWindow, configPath));
  mainWindow.on('move', () => saveWindowConfig(mainWindow, configPath));
  Menu.setApplicationMenu(null);
  tray = new Tray(path.join(__dirname, 'app.ico'));
  trayContextMenu = Menu.buildFromTemplate(getLocalizedMenuTemplate());
  tray.setContextMenu(trayContextMenu);
  tray.setToolTip(appName);
  tray.on('click', toggleCompanionWindow);
  checkStartupStatus(enabled => { 
    isAutoLaunchEnabled = enabled; 
    updateAutoLaunchMenuItem(enabled); 
  });
  attachFocusBlurListeners(mainWindow);
}

function createInstallerWindow() {
  installerWindow = new BrowserWindow({
    width: 1024, height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false, contextIsolation: true, enableRemoteModule: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
      nativeWindowOpen: true, sandbox: true
    }
  });
  Menu.setApplicationMenu(null);
  installerWindow.loadFile('installer.html');
  installerWindow.on('closed', () => { installerWindow = null; });
}

function createCompanionWindow() {
  const { width, height, x, y } = loadWindowConfig(companionWindowConfigPath);
  const { workArea } = screen.getPrimaryDisplay();
  const finalX = x !== undefined ? x : Math.floor((workArea.width - width) / 2);
  const finalY = workArea.y + workArea.height - height;
  const ses = mainWindow ? mainWindow.webContents.session : session.fromPartition('persist:companion-window');
  companionWindow = new BrowserWindow({
    width,
    height,
    x: finalX,
    y: finalY,
    backgroundColor: defaultBackgroundColor,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      nativeWindowOpen: true,
      sandbox: true,
      session: ses
    }
  });
  companionWindow.loadURL(getEffectiveUrl());
  companionWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedURL(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  companionWindow.on('close', e => {
    e.preventDefault();
    companionWindow.hide();
    isCompanionWindowVisible = false;
  });
  companionWindow.on('show', () => {
    isCompanionWindowVisible = true;
    attachFocusBlurListeners(companionWindow);
  });
  companionWindow.on('hide', () => {
    isCompanionWindowVisible = false;
    updateGlobalHotkeys();
  });
}

function getLocalizedMenuTemplate() {
  const locale = app.getLocale().split('-')[0].toLowerCase();
  let translations;
  try { translations = require(`./locales/${locale}.json`); }
  catch (e) { translations = require('./locales/en.json'); }
  const label = isMainWindowVisible ? translations.hideMainWindow : translations.showMainWindow;
  return [
    { label, id: 'toggle-main-window', click: toggleMainWindow },
    { label: translations.reload, click: () => reloadWindow() },
    { label: translations.hotkeyWindow, id: 'hotkey-window', click: openHotkeyWindow },
    { id: 'auto-launch', label: translations.autoLaunch, type: 'checkbox', checked: isAutoLaunchEnabled, click: toggleAutoLaunch },
    { type: 'separator' },
    { label: translations.quit, click: quitApp }
  ];
}

function rebuildTrayContextMenu() {
  if (tray) { 
    trayContextMenu = Menu.buildFromTemplate(getLocalizedMenuTemplate()); 
    tray.setContextMenu(trayContextMenu); 
  }
}

function toggleCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    if (companionWindow.isFocused()) { 
      companionWindow.hide(); 
      isCompanionWindowVisible = false; 
    } else { 
      companionWindow.show(); 
      isCompanionWindowVisible = true; 
    }
  } else { 
    createCompanionWindow(); 
  }
}

function toggleMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed() && isMainWindowVisible) { 
    mainWindow.hide(); 
    isMainWindowVisible = false; 
  } else if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  } else { 
    mainWindow.show(); 
    mainWindow.focus(); 
    isMainWindowVisible = true; 
  }
}

function reloadWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
  else createMainWindow();
  if (companionWindow && !companionWindow.isDestroyed()) companionWindow.reload();
  else createCompanionWindow();
}

function toggleAutoLaunch(menuItem) {
  isAutoLaunchEnabled = menuItem.checked; 
  isAutoLaunchEnabled ? addToStartupWithArgs() : removeFromStartup(); 
  updateAutoLaunchMenuItem(isAutoLaunchEnabled);
}

function updateAutoLaunchMenuItem(enabled) {
  if (trayContextMenu) {
    const item = trayContextMenu.items.find(i => i.id === 'auto-launch');
    if (item) item.checked = enabled;
  }
}

function loadHotkeyConfig() {
  try {
    const content = fs.readFileSync(hotkeyConfigPath, 'utf8'); 
    return JSON.parse(content).hotkey || "Ctrl+Space";
  } catch (e) { 
    return "Ctrl+Space"; 
  }
}

function saveHotkeyConfig(hotkey) {
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  fs.writeFileSync(hotkeyConfigPath, JSON.stringify({ hotkey }));
  currentCompanionHotkey = hotkey;
  updateGlobalHotkeys();
}

function openHotkeyWindow() {
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) { 
    hotkeyWindow.focus(); 
    return; 
  }
  const locale = app.getLocale().split('-')[0].toLowerCase();
  let translations;
  try { translations = require(`./locales/${locale}.json`); }
  catch (e) { translations = require('./locales/en.json'); }
  hotkeyWindow = new BrowserWindow({ 
    width: 350, 
    height: 200, 
    title: translations.hotkeyWindow, 
    webPreferences: { 
      preload: path.join(__dirname, 'preload.js'), 
      nodeIntegration: false, 
      contextIsolation: true 
    }
  });
  hotkeyWindow.loadFile('hotkey.html');
  attachFocusBlurListeners(hotkeyWindow);
  hotkeyWindow.on('closed', () => { 
    hotkeyWindow = null; 
    updateGlobalHotkeys();
  });
}

ipcMain.on('save-hotkey', (event, keys) => {
  const accel = keys.join('+');
  saveHotkeyConfig(accel);
  event.sender.send('hotkey-saved', accel);
  if (hotkeyWindow && !hotkeyWindow.isDestroyed()) hotkeyWindow.close();
});

ipcMain.on('disable-global-hotkey', () => { 
  if (currentCompanionHotkey && globalShortcut.isRegistered(currentCompanionHotkey)) 
    globalShortcut.unregister(currentCompanionHotkey); 
});
ipcMain.on('enable-global-hotkey', () => { 
  if (currentCompanionHotkey && !globalShortcut.isRegistered(currentCompanionHotkey)) 
    globalShortcut.register(currentCompanionHotkey, toggleCompanionWindow); 
});
ipcMain.on('save-default-url', (event, newUrl) => {
  try {
    new URL(newUrl);
    fs.writeFileSync(defaultUrlConfigPath, JSON.stringify({ defaultUrl: newUrl }, null, 2));
    console.log('Default URL saved:', newUrl);
    event.sender.send('default-url-saved', newUrl);
  } catch (error) {
    console.error('Wrong URL:', newUrl, error);
    event.sender.send('default-url-error', 'Wrong URL');
  }
});
ipcMain.handle('get-default-url', () => getEffectiveUrl());
app.on('second-instance', (event, commandLine) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else createMainWindow();
});
app.on('window-all-closed', () => { 
  if (process.platform !== 'darwin') app.quit(); 
});
app.on('activate', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else createMainWindow();
});
