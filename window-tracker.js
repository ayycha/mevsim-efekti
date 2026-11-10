// Windows: açık pencerelerin konumlarını izleyen yardımcı (PowerShell ile).
// NOT: Bu dosya bilerek kurulum paketine KONMUYOR (package.json -> "files" listesinde yok),
// çünkü antivirüsler arka planda PowerShell çalıştıran imzasız uygulamalara şüpheyle bakabiliyor.
// Etkinleştirmek için package.json -> build -> files listesine "window-tracker.js" ekleyin.
const readline = require('readline');
const { spawn } = require('child_process');

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

function create({ screen, isEnabled, onRects }) {
  let helper = null;
  let restarts = 0;
  let lastLine = '';
  let quitting = false;

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

  function onLine(line) {
    line = line.trim();
    if (!line || line === lastLine) return;
    lastLine = line;
    let arr;
    try { arr = JSON.parse(line); } catch (e) { return; }
    if (!Array.isArray(arr)) return;
    onRects(arr.filter((r) => Array.isArray(r) && r.length === 5).map(toDip));
  }

  function start() {
    if (process.platform !== 'win32' || helper || quitting || !isEnabled()) return;
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
    readline.createInterface({ input: proc.stdout }).on('line', onLine);
    proc.on('error', () => { if (helper === proc) helper = null; });
    proc.on('exit', () => {
      if (helper === proc) helper = null;
      if (!quitting && isEnabled() && restarts < 3) {
        restarts++;
        setTimeout(start, 3000);
      }
    });
  }

  function stop() {
    const p = helper;
    helper = null;
    if (p) { try { p.kill(); } catch (e) {} }
    lastLine = '';
    onRects([]);
  }

  return {
    start,
    stop,
    resetRestarts() { restarts = 0; },
    quit() { quitting = true; stop(); },
  };
}

module.exports = { create };
