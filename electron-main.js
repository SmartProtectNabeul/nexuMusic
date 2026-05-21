const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const { fork } = require('child_process');

let serverProcess = null;

function startBackend() {
  const serverPath = path.join(__dirname, 'server.js');
  console.log('[Electron] Starting local backend server:', serverPath);
  serverProcess = fork(serverPath, [], {
    env: { ...process.env, PORT: '3000' }
  });

  serverProcess.on('error', (err) => {
    console.error('[Electron] Failed to start backend:', err);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'NexoMusic',
    icon: path.join(__dirname, 'logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    }
  });

  // Load the local self-contained NexoMusic application
  win.loadURL('http://localhost:3000');

  // Remove the menu bar for a premium, clean, frameless look
  Menu.setApplicationMenu(null);
}

app.whenReady().then(() => {
  startBackend();
  
  // Wait a brief moment for the Node server to bind to the port
  setTimeout(createWindow, 800);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  if (serverProcess) {
    console.log('[Electron] Shutting down backend server...');
    serverProcess.kill();
  }
});
