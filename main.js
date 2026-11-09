const { app, BrowserWindow, Tray, Menu, screen, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawn } = require('child_process');

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
let quitting = false;

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

/* ---------------- Açık pencereleri izleme (sadece Windows) ----------------
   Küçük bir PowerShell yardımcısı arka planda çalışır ve görünür pencerelerin
   konumlarını yazar. Çalışmazsa uygulama sadece ekranın altına biriktirir. */
let helper = null;
let helperRestarts = 0;
let lastLine = '';
let winRects = []; // DIP, ekran koordinatı: [id, x, y, w, h] (üstteki pencere önce)

function buildPsScript(pid) {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public static class WinList
{
    delegate bool EnumProc(IntPtr h, IntPtr l);

    [StructLayout(LayoutKind.Sequential)]
    struct RECT { public int L, T, R, B; }

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder sb, int n);
    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetRect(IntPtr h, int attr, out RECT r, int size);
    [DllImport("dwmapi.dll", EntryPoint = "DwmGetWindowAttribute")] static extern int DwmGetInt(IntPtr h, int attr, out int v, int size);

    public static void SetDpi()
    {
        try { SetProcessDpiAwarenessContext(new IntPtr(-4)); }
        catch (Exception) { try { SetProcessDPIAware(); } catch (Exception) { } }
    }

    public static string Snapshot(uint ownPid)
    {
        StringBuilder sb = new StringBuilder("[");
        bool first = true;
        EnumWindows(delegate (IntPtr h, IntPtr l)
        {
            if (!IsWindowVisible(h) || IsIconic(h)) return true;
            uint pid;
            GetWindowThreadProcessId(h, out pid);
            if (pid == ownPid) return true;
            int cloaked;
            if (DwmGetInt(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
            if (GetWindowTextLength(h) == 0) return true;
            StringBuilder cn = new StringBuilder(80);
            GetClassName(h, cn, 80);
            string c = cn.ToString();
            if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
            RECT r;
            if (DwmGetRect(h, 9, out r, 16) != 0) return true;
            int w = r.R - r.L;
            int ht = r.B - r.T;
            if (w < 100 || ht < 40) return true;
            if (!first) sb.Append(',');
            first = false;
            sb.Append('[').Append(h.ToInt64()).Append(',').Append(r.L).Append(',').Append(r.T).Append(',').Append(w).Append(',').Append(ht).Append(']');
            return true;
        }, IntPtr.Zero);
        sb.Append(']');
        return sb.ToString();
    }
}
'@
[WinList]::SetDpi()
$ownPid = ${pid}
$n = 0
while ($true) {
  [Console]::Out.WriteLine([WinList]::Snapshot([uint32]$ownPid))
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds 60
  $n++
  if ($n % 25 -eq 0) {
    if (-not (Get-Process -Id $ownPid -ErrorAction SilentlyContinue)) { break }
  }
}
`;
}

function toDip(r) {
  const [id, x, y, w, h] = r;
  let d;
  try {
    d = screen.screenToDipRect(null, { x, y, width: w, height: h });
  } catch (e) {
    const f = screen.getPrimaryDisplay().scaleFactor || 1;
    d = { x: x / f, y: y / f, width: w / f, height: h / f };
  }
  return [id, Math.round(d.x), Math.round(d.y), Math.round(d.width), Math.round(d.height)];
}

function sendWindows(entry) {
  const { win, bounds: b } = entry;
  if (win.isDestroyed()) return;
  const list = winRects
    .filter((r) => r[1] < b.x + b.width && r[1] + r[3] > b.x && r[2] < b.y + b.height && r[2] + r[4] > b.y)
    .map((r) => [r[0], r[1] - b.x, r[2] - b.y, r[3], r[4]]);
  win.webContents.send('windows', list);
}

function broadcastWindows() { entries.forEach(sendWindows); }

function onWindowLine(line) {
  line = line.trim();
  if (!line || line === lastLine) return;
  lastLine = line;
  let arr;
  try { arr = JSON.parse(line); } catch (e) { return; }
  if (!Array.isArray(arr)) return;
  winRects = arr.filter((r) => Array.isArray(r) && r.length === 5).map(toDip);
  broadcastWindows();
}

function startWindowTracker() {
  if (process.platform !== 'win32' || helper || !settings.windowAware || settings.paused || quitting) return;
  const encoded = Buffer.from(buildPsScript(process.pid), 'utf16le').toString('base64');
  let proc;
  try {
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
  } catch (e) { return; }
  helper = proc;
  readline.createInterface({ input: proc.stdout }).on('line', onWindowLine);
  proc.on('error', () => { if (helper === proc) helper = null; });
  proc.on('exit', () => {
    if (helper === proc) helper = null;
    if (!quitting && settings.windowAware && !settings.paused && helperRestarts < 3) {
      helperRestarts++;
      setTimeout(startWindowTracker, 3000);
    }
  });
}

function stopWindowTracker() {
  const p = helper;
  helper = null;
  if (p) { try { p.kill(); } catch (e) {} }
  lastLine = '';
  winRects = [];
  broadcastWindows();
}

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
    ...(process.platform === 'win32' ? [{
      label: 'Pencerelerin kenarında biriksin',
      type: 'checkbox',
      checked: settings.windowAware,
      click: (item) => {
        settings.windowAware = item.checked;
        saveSettings();
        if (settings.windowAware) { helperRestarts = 0; startWindowTracker(); } else { stopWindowTracker(); }
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
        if (settings.paused) stopWindowTracker(); else { helperRestarts = 0; startWindowTracker(); }
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
  quitting = true;
  if (cursorTimer) clearInterval(cursorTimer);
  stopWindowTracker();
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
