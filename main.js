const { app, BrowserWindow, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');

// Linux'ta şeffaf pencere için gerekli
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
  app.disableHardwareAcceleration();
}

/* ---------------- Ayarların kaydedilmesi ---------------- */
const defaults = {
  mode: 'snow',
  density: 'medium',
  speed: 'normal',
  opacity: 1,
  accumulate: true,
  interactive: true,   // fareyle kar uçurma / kartopu yuvarlama
  windowAware: true,   // Windows: açık pencerelerin kenarında birikme, pencerelerin arkasında yağma
  paused: false,
};
let settings = { ...defaults };
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try {
    settings = { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) };
  } catch (e) { /* ilk açılış, dosya yok */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings)); } catch (e) {}
}

/* ---------------- Pencereler (her ekrana bir tane) ---------------- */
let entries = []; // { win, display, bounds }
let tray = null;

function sendConfig(entry) {
  const { win, display } = entry;
  if (win.isDestroyed()) return;
  const wb = win.getBounds();
  const wa = display.workArea;
  // Görev çubuğu / Dock yüksekliği: kar bunların üstünde birikir
  let floorOffset = (wb.y + wb.height) - (wa.y + wa.height);
  floorOffset = Math.max(0, Math.min(floorOffset, 200));
  win.webContents.send('config', {
    mode: settings.mode,
    density: settings.density,
    speed: settings.speed,
    opacity: settings.opacity,
    accumulate: settings.accumulate,
    interactive: settings.interactive,
    floorOffset,
  });
  sendWindows(entry);
}

function pushConfig() { entries.forEach(sendConfig); }

function destroyWindows() {
  entries.forEach(({ win }) => { if (!win.isDestroyed()) win.destroy(); });
  entries = [];
}

function createWindows() {
  destroyWindows();
  for (const display of screen.getAllDisplays()) {
    const b = display.bounds;
    const height = process.platform === 'win32' ? b.height - 1 : b.height;

    const win = new BrowserWindow({
      x: b.x, y: b.y, width: b.width, height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    win.setIgnoreMouseEvents(true);               // tıklamalar alttaki programa geçer
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setBounds({ x: b.x, y: b.y, width: b.width, height });
    win.loadFile(path.join(__dirname, 'index.html'));

    const entry = { win, display, bounds: win.getBounds() };
    win.webContents.on('did-finish-load', () => {
      sendConfig(entry);
      if (!settings.paused) win.showInactive();
    });
    entries.push(entry);
  }
  if (process.platform === 'darwin' && app.dock) app.dock.hide();
}

/* ---------------- Fare konumu (60 kez/sn) ---------------- */
let cursorTimer = null;
function startCursorTimer() {
  if (cursorTimer) return;
  cursorTimer = setInterval(() => {
    if (!settings.interactive || settings.paused || entries.length === 0) return;
    const p = screen.getCursorScreenPoint();
    for (const e of entries) {
      if (e.win.isDestroyed()) continue;
      e.win.webContents.send('cursor', { x: p.x - e.bounds.x, y: p.y - e.bounds.y });
    }
  }, 16);
}

/* ---------------- Açık pencereleri izleme (isteğe bağlı, sadece Windows) ----------------
   window-tracker.js dosyası kurulum paketinde yoksa bu özellik kapalı kalır,
   uygulama sadece ekranın altına biriktirir. */
let winRects = []; // DIP, ekran koordinatı: [id, x, y, w, h] (üstteki pencere önce)
let tracker = null;
try {
  tracker = require('./window-tracker').create({
    screen,
    isEnabled: () => settings.windowAware && !settings.paused,
    onRects: (rects) => { winRects = rects; broadcastWindows(); },
  });
} catch (e) { tracker = null; }

function sendWindows(entry) {
  const { win, bounds: b } = entry;
  if (win.isDestroyed()) return;
  const list = winRects
    .filter((r) => r[1] < b.x + b.width && r[1] + r[3] > b.x && r[2] < b.y + b.height && r[2] + r[4] > b.y)
    .map((r) => [r[0], r[1] - b.x, r[2] - b.y, r[3], r[4]]);
  win.webContents.send('windows', list);
}

function broadcastWindows() { entries.forEach(sendWindows); }

function startWindowTracker() { if (tracker) tracker.start(); }
function stopWindowTracker() { if (tracker) tracker.stop(); }

/* ---------------- Tepsi (tray) menüsü ---------------- */
function buildMenu() {
  const set = (key, value) => () => {
    settings[key] = value;
    saveSettings();
    pushConfig();
    buildMenu();
  };

  const template = [
    { label: 'Mevsim Efekti', enabled: false },
    { type: 'separator' },
    { label: '❄️  Kar', type: 'radio', checked: settings.mode === 'snow', click: set('mode', 'snow') },
    { label: '🍂  Sonbahar yaprakları', type: 'radio', checked: settings.mode === 'autumn', click: set('mode', 'autumn') },
    { type: 'separator' },
    {
      label: 'Yoğunluk',
      submenu: [
        { label: 'Az', type: 'radio', checked: settings.density === 'low', click: set('density', 'low') },
        { label: 'Orta', type: 'radio', checked: settings.density === 'medium', click: set('density', 'medium') },
        { label: 'Çok', type: 'radio', checked: settings.density === 'high', click: set('density', 'high') },
      ],
    },
    {
      label: 'Yağış hızı',
      submenu: [
        { label: 'Yavaş', type: 'radio', checked: settings.speed === 'slow', click: set('speed', 'slow') },
        { label: 'Normal', type: 'radio', checked: settings.speed === 'normal', click: set('speed', 'normal') },
        { label: 'Hızlı', type: 'radio', checked: settings.speed === 'fast', click: set('speed', 'fast') },
      ],
    },
    {
      label: 'Saydamlık',
      submenu: [100, 75, 50, 25].map((p) => ({
        label: '%' + p,
        type: 'radio',
        checked: Math.abs(settings.opacity - p / 100) < 0.01,
        click: set('opacity', p / 100),
      })),
    },
    {
      label: 'Yerde birikme',
      type: 'checkbox',
      checked: settings.accumulate,
      click: (item) => { settings.accumulate = item.checked; saveSettings(); pushConfig(); },
    },
    {
      label: 'Fareyle etkileşim (kar uçur / kartopu yuvarla)',
      type: 'checkbox',
      checked: settings.interactive,
      click: (item) => { settings.interactive = item.checked; saveSettings(); pushConfig(); },
    },
    ...(process.platform === 'win32' && tracker ? [{
      label: 'Pencerelerin kenarında biriksin',
      type: 'checkbox',
      checked: settings.windowAware,
      click: (item) => {
        settings.windowAware = item.checked;
        saveSettings();
        if (settings.windowAware) { tracker.resetRestarts(); startWindowTracker(); } else { stopWindowTracker(); }
      },
    }] : []),
    {
      label: 'Duraklat',
      type: 'checkbox',
      checked: settings.paused,
      click: (item) => {
        settings.paused = item.checked;
        saveSettings();
        entries.forEach(({ win }) => {
          if (win.isDestroyed()) return;
          settings.paused ? win.hide() : win.showInactive();
        });
        if (settings.paused) stopWindowTracker(); else { if (tracker) tracker.resetRestarts(); startWindowTracker(); }
      },
    },
    {
      label: 'Bilgisayar açılınca başlat',
      type: 'checkbox',
      enabled: app.isPackaged,
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    { label: 'Çıkış', click: () => app.quit() },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

function createTray() {
  let icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (process.platform === 'darwin') icon = icon.resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('Mevsim Efekti');
  if (process.platform === 'win32') tray.on('click', () => tray.popUpContextMenu());
  buildMenu();
}

/* ---------------- Uygulama yaşam döngüsü ---------------- */
// Pencereleri yeniden oluştururken uygulamanın kapanmasını engeller
app.on('window-all-closed', () => {});

app.on('before-quit', () => {
  if (cursorTimer) clearInterval(cursorTimer);
  if (tracker) tracker.quit();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    loadSettings();
    createWindows();
    createTray();
    startCursorTimer();
    startWindowTracker();

    // Monitör takılıp çıkarılınca / çözünürlük değişince yeniden kur
    let timer = null;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(createWindows, 500); };
    screen.on('display-added', refresh);
    screen.on('display-removed', refresh);
    screen.on('display-metrics-changed', refresh);
  });
}
