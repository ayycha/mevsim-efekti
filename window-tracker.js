// Windows: açık pencerelerin konumlarını doğrudan Windows API'sinden okur (koffi ile).
// PowerShell ya da ek bir program ÇALIŞTIRMAZ; antivirüs uyarısı çıkarmaması için böyle yapıldı.
// Bir sorun olursa uygulama çökmez, sadece pencere özellikleri kapanır ve nedeni log.txt'ye yazılır.

const BLOCKED_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Shell_SecondaryTrayWnd']);

function create({ screen, isEnabled, onRects, log }) {
  const say = (m) => { try { if (log) log(m); } catch (e) { /* yoksay */ } };
  let api = null;
  let timer = null;
  let lastJson = '';
  let fails = 0;
  let broken = false;
  let quitting = false;
  let firstScanLogged = false;

  // "__stdcall" yazımı kabul edilmezse onsuz dener (64 bit Windows'ta ikisi aynıdır)
  function decl(lib, ret, name, args) {
    try { return lib.func(ret + ' __stdcall ' + name + '(' + args + ')'); }
    catch (e) { return lib.func(ret + ' ' + name + '(' + args + ')'); }
  }
  function declProto(koffi, ret, name, args) {
    try { return koffi.proto(ret + ' __stdcall ' + name + '(' + args + ')'); }
    catch (e) { return koffi.proto(ret + ' ' + name + '(' + args + ')'); }
  }

  function load() {
    if (api) return api;
    const koffi = require('koffi');
    const user32 = koffi.load('user32.dll');
    const dwm = koffi.load('dwmapi.dll');
    declProto(koffi, 'int', 'MevsimEnumProc', 'intptr_t hwnd, intptr_t lparam');
    api = {
      EnumWindows: decl(user32, 'int', 'EnumWindows', 'MevsimEnumProc *cb, intptr_t lparam'),
      IsWindowVisible: decl(user32, 'int', 'IsWindowVisible', 'intptr_t hwnd'),
      IsIconic: decl(user32, 'int', 'IsIconic', 'intptr_t hwnd'),
      GetWindowTextLengthW: decl(user32, 'int', 'GetWindowTextLengthW', 'intptr_t hwnd'),
      GetWindowLongW: decl(user32, 'int', 'GetWindowLongW', 'intptr_t hwnd, int index'),
      GetWindowThreadProcessId: decl(user32, 'uint32_t', 'GetWindowThreadProcessId', 'intptr_t hwnd, void *pid'),
      GetClassNameW: decl(user32, 'int', 'GetClassNameW', 'intptr_t hwnd, void *buf, int max'),
      DwmGetWindowAttribute: decl(dwm, 'int32_t', 'DwmGetWindowAttribute', 'intptr_t hwnd, uint32_t attr, void *out, uint32_t size'),
    };
    return api;
  }

  // Görünen pencerelerin listesi, üstteki pencere önce: [[id, x, y, w, h], ...] (fiziksel piksel)
  function snapshot() {
    const a = load();
    const out = [];
    const ownPid = process.pid;
    const pidBuf = Buffer.alloc(4);
    const rectBuf = Buffer.alloc(16);
    const intBuf = Buffer.alloc(4);
    const clsBuf = Buffer.alloc(160);

    a.EnumWindows((hwnd) => {
      try {
        const h = Number(hwnd);
        if (!a.IsWindowVisible(h) || a.IsIconic(h)) return 1;
        a.GetWindowThreadProcessId(h, pidBuf);
        if (pidBuf.readUInt32LE(0) === ownPid) return 1;               // kendi efekt pencerelerimiz
        if (a.DwmGetWindowAttribute(h, 14, intBuf, 4) === 0 && intBuf.readInt32LE(0) !== 0) return 1;   // gizlenmiş (cloaked)
        if ((a.GetWindowLongW(h, -20) & 0x80) !== 0) return 1;         // araç penceresi
        if (a.GetWindowTextLengthW(h) === 0) return 1;                 // başlıksız
        const n = a.GetClassNameW(h, clsBuf, 80);
        const cn = clsBuf.toString('utf16le', 0, Math.max(0, n) * 2);
        if (BLOCKED_CLASSES.has(cn)) return 1;                         // masaüstü, görev çubuğu
        if (a.DwmGetWindowAttribute(h, 9, rectBuf, 16) !== 0) return 1;   // gölgesiz gerçek çerçeve
        const l = rectBuf.readInt32LE(0), t = rectBuf.readInt32LE(4);
        const w = rectBuf.readInt32LE(8) - l, ht = rectBuf.readInt32LE(12) - t;
        if (w < 100 || ht < 40) return 1;
        out.push([h, l, t, w, ht]);
      } catch (e) { /* bu pencereyi atla */ }
      return 1;
    }, 0);
    return out;
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

  function tick() {
    if (quitting || !isEnabled()) return;
    try {
      const raw = snapshot();
      fails = 0;
      if (!firstScanLogged) { firstScanLogged = true; say('ilk tarama: ' + raw.length + ' pencere bulundu'); }
      const json = JSON.stringify(raw);
      if (json === lastJson) return;
      lastJson = json;
      onRects(raw.map(toDip));
    } catch (e) {
      fails++;
      say('pencere izleme hatası: ' + ((e && e.stack) || e));
      if (fails >= 5) { say('pencere izleme durduruldu (üst üste 5 hata)'); broken = true; stop(); }
    }
  }

  function start() {
    if (process.platform !== 'win32' || timer || quitting || broken || !isEnabled()) return;
    try { load(); } catch (e) {
      say('pencere izleme başlatılamadı (koffi yüklenemedi): ' + ((e && e.stack) || e));
      broken = true;
      return;
    }
    say('pencere izleme başladı');
    timer = setInterval(tick, 60);
    tick();
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    lastJson = '';
    onRects([]);
  }

  return {
    start,
    stop,
    resetRestarts() { fails = 0; broken = false; },
    quit() { quitting = true; stop(); },
  };
}

module.exports = { create };
