const { app, BrowserWindow } = require('electron');
const path = require('path');
const http = require('http');

let nextServer;
let mainWindow;

const HTTP_PORT = Number(process.env.NAV_HTTP_PORT || 3000);

async function startServers() {
  const appDir = app.getAppPath();

  // Wheelhouse default. Override with AIS_PORT env var if needed.
  process.env.AIS_PORT = process.env.AIS_PORT || 'COM4';
  process.env.AIS_BAUD = process.env.AIS_BAUD || '38400';
  process.env.AIS_WS_PORT = process.env.AIS_WS_PORT || '8081';

  // Start AIS/WebSocket server inside Electron, no npm/cmd shell required.
  require(path.join(appDir, 'server', 'ais-server.js'));

  // Start Next production server inside Electron, no external Node/npm required.
  const next = require('next');
  const nextApp = next({ dev: false, dir: appDir, hostname: '0.0.0.0', port: HTTP_PORT });
  const handle = nextApp.getRequestHandler();

  await nextApp.prepare();

  nextServer = http.createServer((req, res) => handle(req, res));

  await new Promise((resolve, reject) => {
    nextServer.once('error', reject);
    nextServer.listen(HTTP_PORT, '0.0.0.0', resolve);
  });

  console.log(`[NAV] HTTP server running at http://0.0.0.0:${HTTP_PORT}`);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Nav Console',
    width: 1600,
    height: 950,
    autoHideMenuBar: true,
    fullscreenable: true,
    backgroundColor: '#071019',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${HTTP_PORT}`);
}

app.whenReady().then(async () => {
  try {
    await startServers();
    createWindow();
  } catch (error) {
    console.error('[NAV] Startup failed:', error);
    const { dialog } = require('electron');
    dialog.showErrorBox('Nav Console startup failed', String(error && error.stack ? error.stack : error));
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (nextServer) nextServer.close();
  app.quit();
});
