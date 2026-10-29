<#
    Pptx-WsController.ps1  -  Presentation Timer PowerPoint player (EXPERIMENTAL)

    Runs on the computer that shows the slides. It joins the timer through the timer's pairing
    server (the same way a phone does) and opens decks in PowerPoint when the timer's run sheet
    reaches them. The deck files themselves arrive in the Inbox folder through the timer's
    receiver page (pptx.html), open in Chrome or Edge on this same computer.

    Usage (the receiver page shows this line with your link filled in):
        powershell -ExecutionPolicy Bypass -File .\Pptx-WsController.ps1 -Link "https://.../pptx.html#r=...&p=..."

    Options:
        -Link        The PowerPoint link from the timer's share panel (required)
        -WorkFolder  Where decks are kept (default: Documents\Presentation Timer). It holds:
                       Inbox  the receiver page saves decks here (choose this folder in the page)
                       Show   decks are copied here and opened from here
        -Inbox       Use another folder as the inbox
        -Name        This computer's name in the timer (default: the computer name)
        -NoPresenterView   Show decks without Presenter View (it's on by default)
        -EditMode    Rehearsal: open decks as normal (editable) PowerPoint windows, then F5. Also
                     switched on and off from the receiver page while running.
        -AllowSelfSignedCert   For a test pairing server only
        -Simulate    Don't open PowerPoint; just log what would happen (testing)

    Works with Windows PowerShell 5.1 (built into Windows 10/11) and PowerShell 7.
    Protocol: docs/powerpoint.md in the timer's repository.
    MIT Licensed
#>

param(
    [Parameter(Mandatory = $true)][string]$Link,
    [string]$WorkFolder = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Presentation Timer'),
    [string]$Inbox,
    [string]$Name = $env:COMPUTERNAME,
    [switch]$NoPresenterView,
    [switch]$EditMode,
    [switch]$AllowSelfSignedCert,
    [switch]$Simulate
)

$ErrorActionPreference = 'Stop'
$Version = '2.0'

# ---- Folders ---------------------------------------------------------------
$WorkFolder = [IO.Path]::GetFullPath($WorkFolder)
if (-not $Inbox) { $Inbox = Join-Path $WorkFolder 'Inbox' }
$Inbox = [IO.Path]::GetFullPath($Inbox)
$ShowFolder = Join-Path $WorkFolder 'Show'
foreach ($d in @($WorkFolder, $Inbox, $ShowFolder)) {
    if (-not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}
$TokenFile = Join-Path $WorkFolder '.timer-token'
$PairFile = Join-Path $Inbox '.timer-pair'          # written by the receiver page: pairs it with us
if (-not $Name) { $Name = 'PowerPoint' }

function Log([string]$Text, [string]$Colour = 'Gray') {
    Write-Host ('{0}  {1}' -f (Get-Date -Format 'HH:mm:ss'), $Text) -ForegroundColor $Colour
}

# ---- The link: https://host/path/pptx.html#r=ROOM&p=KEY[&s=wss://server:port/] -----
function Get-LinkPart([string]$Fragment, [string]$Key) {
    foreach ($pair in $Fragment.Split('&')) {
        $i = $pair.IndexOf('=')
        if ($i -gt 0 -and $pair.Substring(0, $i) -eq $Key) {
            return [Uri]::UnescapeDataString($pair.Substring($i + 1).Replace('+', ' '))
        }
    }
    return $null
}
$frag = $Link.Trim()
$hashAt = $frag.IndexOf('#')
if ($hashAt -ge 0) { $frag = $frag.Substring($hashAt + 1) }
$Room = Get-LinkPart $frag 'r'
$Key = Get-LinkPart $frag 'p'
$Server = Get-LinkPart $frag 's'
if (-not $Server -and $hashAt -ge 0) {
    # As the timer's pages work it out: the VPS (sophtwhere.com) runs the server on port 8443, a Cloudflare site at /ws
    try {
        $u = [Uri]$Link.Trim()
        if ($u.Host -match '(^|\.)sophtwhere\.com$') { $Server = 'wss://' + $u.Host + ':8443/' } else { $Server = 'wss://' + $u.Authority + '/ws' }
    } catch { $Server = $null }
}
if (-not $Room -or -not $Key -or -not $Server) {
    Write-Host 'That link is not a PowerPoint link from the timer. In the timer, click share, choose PowerPoint, and copy the link.' -ForegroundColor Red
    exit 1
}

if ($AllowSelfSignedCert) {
    # PowerShell 5.1 (.NET Framework). PowerShell 7 uses the socket option below instead.
    try { [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } } catch {}
}

# ---- State -------------------------------------------------------------------
$script:ws = $null
$script:Running = $true
$script:Current = ''          # file name (in Show) being shown
$script:Copy = $null          # a copy in progress: @{ ps; async; req; name; temp; dest; src }
$script:LastState = ''
$script:PinCode = $null
$script:Edit = [bool]$EditMode    # rehearsal: decks open for editing, shows started with F5

function Get-Token {
    try {
        if (Test-Path -LiteralPath $TokenFile) {
            $t = Get-Content -LiteralPath $TokenFile -Raw | ConvertFrom-Json
            if ($t.room -eq $Room) { return [string]$t.token }
        }
    } catch {}
    return ''
}
function Save-Token([string]$Token) {
    try { (@{ room = $Room; token = $Token } | ConvertTo-Json -Compress) | Set-Content -LiteralPath $TokenFile -Encoding UTF8 } catch {}
}
function Get-PairId {
    try { if (Test-Path -LiteralPath $PairFile) { return (Get-Content -LiteralPath $PairFile -Raw).Trim() } } catch {}
    return ''
}

# ---- WebSocket ---------------------------------------------------------------
function Send-Raw($Object) {
    if (-not $script:ws -or $script:ws.State -ne 'Open') { return }
    $json = $Object | ConvertTo-Json -Compress -Depth 6
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $bytes)
    $script:ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
}
# A message for the timer: through the pairing server, wrapped as the phones' messages are
function Send-Timer($Data) { Send-Raw @{ type = 'up'; msg = @{ k = 'data'; d = $Data } } }

function Send-Hello {
    $st = Get-ShowState
    Send-Timer @{ t = 'hello'; kind = 'player'; name = $Name; version = $Version; pair = (Get-PairId);
        inbox = $Inbox; token = (Get-Token); current = $st.current; showing = $st.showing;
        simulate = [bool]$Simulate; presenter = -not $NoPresenterView; edit = $script:Edit }
}

function Send-Ack($Cmd, [bool]$Ok, $Extra) {
    $a = @{ t = 'pp-ack'; req = [string]$Cmd.req; verb = [string]$Cmd.verb; ok = $Ok }
    if ($Extra) { foreach ($k in $Extra.Keys) { $a[$k] = $Extra[$k] } }
    Send-Timer $a
}

# ---- Files -------------------------------------------------------------------
function Get-Leaf([string]$Arg) {
    # Only plain file names: no folders, so nothing outside our folders can be touched
    if ([string]::IsNullOrWhiteSpace($Arg)) { return $null }
    $leaf = [IO.Path]::GetFileName($Arg)
    if ($leaf -match '^\.+$' -or $leaf.StartsWith('.')) { return $null }
    return $leaf
}
function Get-FreeName([string]$Leaf) {
    $base = [IO.Path]::GetFileNameWithoutExtension($Leaf); $ext = [IO.Path]::GetExtension($Leaf)
    $n = 2
    while (Test-Path -LiteralPath (Join-Path $ShowFolder ('{0} v{1}{2}' -f $base, $n, $ext))) { $n++ }
    return ('{0} v{1}{2}' -f $base, $n, $ext)
}
function Test-SameFile([string]$A, [string]$B) {
    $fa = Get-Item -LiteralPath $A; $fb = Get-Item -LiteralPath $B
    return ($fa.Length -eq $fb.Length -and [Math]::Abs(($fa.LastWriteTimeUtc - $fb.LastWriteTimeUtc).TotalSeconds) -lt 2)
}

# 'send': copy Inbox\<name> into Show. Runs in the background (a big deck can take a while)
# so we keep answering the server; the ack goes when it's done.
function Start-CopyIn($Cmd) {
    $leaf = Get-Leaf $Cmd.arg
    if (-not $leaf) { Send-Ack $Cmd $false @{ error = 'missing arg' }; return }
    if ($script:Copy) { Send-Ack $Cmd $false @{ error = 'busy' }; return }
    $src = Join-Path $Inbox $leaf
    if (-not (Test-Path -LiteralPath $src -PathType Leaf)) { Send-Ack $Cmd $false @{ error = "not in the inbox: $leaf" }; return }
    $main = Join-Path $ShowFolder $leaf
    if (Test-Path -LiteralPath $main -PathType Leaf) {
        if (Test-SameFile $src $main) { Send-Ack $Cmd $true @{ result = $leaf; note = 'unchanged' }; return }
        # Edited here (rehearsal): the copy in Show is newer than the one the timer sent. Keep it.
        if ((Get-Item -LiteralPath $main).LastWriteTimeUtc -gt (Get-Item -LiteralPath $src).LastWriteTimeUtc.AddSeconds(2)) {
            Send-Ack $Cmd $true @{ result = $leaf; note = 'edited here' }; return
        }
        $leaf = Get-FreeName $leaf          # never overwrite a deck that may be on screen
    }
    $dest = Join-Path $ShowFolder $leaf
    $temp = $dest + '.partial'
    $ps = [PowerShell]::Create()
    [void]$ps.AddScript({
        param($s, $t, $d)
        [IO.File]::Copy($s, $t, $true)
        (Get-Item -LiteralPath $t).LastWriteTimeUtc = (Get-Item -LiteralPath $s).LastWriteTimeUtc
        if (Test-Path -LiteralPath $d) { Remove-Item -LiteralPath $d -Force }
        Move-Item -LiteralPath $t -Destination $d
    }).AddArgument($src).AddArgument($temp).AddArgument($dest)
    $script:Copy = @{ ps = $ps; async = $ps.BeginInvoke(); cmd = $Cmd; name = $leaf; temp = $temp; dest = $dest }
    Log "Copying $leaf"
}
function Watch-Copy {
    $c = $script:Copy
    if (-not $c -or -not $c.async.IsCompleted) { return }
    $script:Copy = $null
    try {
        $c.ps.EndInvoke($c.async) | Out-Null
        if ($c.ps.HadErrors) { throw ($c.ps.Streams.Error | Select-Object -First 1).ToString() }
        # Files saved by a browser are marked as downloaded from the internet, and PowerPoint
        # would open them in Protected View (no slide show). They come from the operator's timer.
        try { Unblock-File -LiteralPath $c.dest } catch {}
        Log "Ready: $($c.name)" 'Green'
        Send-Ack $c.cmd $true @{ result = $c.name }
    } catch {
        Remove-Item -LiteralPath $c.temp -Force -ErrorAction SilentlyContinue
        Log "Copy failed: $($_.Exception.Message)" 'Red'
        Send-Ack $c.cmd $false @{ error = "copy failed: $($_.Exception.Message)" }
    } finally { $c.ps.Dispose() }
}

# ---- PowerPoint --------------------------------------------------------------
# No COM: decks are started as "powerpnt.exe /S <file>" (a full-screen show, no editor), and
# everything else is done to the show's window: Presenter View is the window's context menu
# then R (the only way into Presenter View from the command line), closing is WM_CLOSE.
# Slides are advanced on this machine itself (clicker, operator), never from the timer. The show is tracked by its window handles, not by process: PowerPoint is
# single-instance, so a second /S is handed to the copy that's already running.

if ($env:OS -eq 'Windows_NT' -and -not ('TimerWin' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TimerWin {
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll", CharSet = CharSet.Auto)] public static extern bool SystemParametersInfo(int a, int b, string c, int d);

    // Visible top-level windows of the given processes: "handle|class|title"
    public static string[] List(int[] pids) {
        List<string> res = new List<string>();
        HashSet<uint> want = new HashSet<uint>();
        foreach (int p in pids) want.Add((uint)p);
        EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint pid; GetWindowThreadProcessId(h, out pid);
            if (want.Contains(pid) && IsWindowVisible(h)) {
                StringBuilder c = new StringBuilder(256), t = new StringBuilder(512);
                GetClassName(h, c, 256); GetWindowText(h, t, 512);
                res.Add(h.ToInt64() + "|" + c + "|" + t);
            }
            return true;
        }, IntPtr.Zero);
        return res.ToArray();
    }
    // Bring a window to the front. Windows only lets the foreground app do that; a tap of Alt
    // first is the usual way round it.
    public static bool Focus(IntPtr h) {
        if (IsIconic(h)) ShowWindow(h, 9);
        keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
        SetForegroundWindow(h);
        return GetForegroundWindow() == h;
    }
    // The window that has focus: "handle|class|title|pid"
    public static string Foreground() {
        IntPtr h = GetForegroundWindow();
        if (h == IntPtr.Zero) return "";
        uint pid; GetWindowThreadProcessId(h, out pid);
        StringBuilder c = new StringBuilder(256), t = new StringBuilder(512);
        GetClassName(h, c, 256); GetWindowText(h, t, 512);
        return h.ToInt64() + "|" + c + "|" + t + "|" + pid;
    }
    [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, EnumProc f, IntPtr l);
    // Windows inside a window that have a title, or a dialog-like class: "class|title" (diagnostics)
    public static string[] Children(IntPtr parent) {
        List<string> res = new List<string>();
        EnumChildWindows(parent, delegate (IntPtr h, IntPtr l) {
            if (res.Count >= 40) return false;
            StringBuilder c = new StringBuilder(256), t = new StringBuilder(512);
            GetClassName(h, c, 256); GetWindowText(h, t, 512);
            string cs = c.ToString(), ts = t.ToString();
            if (IsWindowVisible(h) && (ts.Length > 0 || cs.IndexOf("Dialog", StringComparison.OrdinalIgnoreCase) >= 0 || cs == "#32770"))
                res.Add(cs + "|" + ts);
            return true;
        }, IntPtr.Zero);
        return res.ToArray();
    }
    // A key with Ctrl held (Ctrl+Q)
    public static void CtrlKey(byte vk) {
        keybd_event(0x11, 0, 0, UIntPtr.Zero); keybd_event(vk, 0, 0, UIntPtr.Zero);
        keybd_event(vk, 0, 2, UIntPtr.Zero); keybd_event(0x11, 0, 2, UIntPtr.Zero);
    }
    public static void Key(byte vk, bool extended) {
        uint f = extended ? 1u : 0u;
        keybd_event(vk, 0, f, UIntPtr.Zero); keybd_event(vk, 0, f | 2u, UIntPtr.Zero);
    }
}
'@
}

$ShowClass = 'screenClass'           # a slide show window (one per running show)
$PvClass = 'PodiumParent'            # Presenter View (PowerPoint may hand it from one deck to the next)
$EditClass = 'PPTFrameClass'         # a normal PowerPoint (editing) window: rehearsal mode
$SettleMs = 1000                     # after the new show's window appears, before Presenter View is turned on
$script:Wallpaper = ''               # the holding slide (file in Show) set as wallpaper

# PowerPoint windows: objects {h, cls, title}
function Get-PptWindows {
    $pids = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    if (-not $pids.Count) { return @() }
    foreach ($line in [TimerWin]::List([int[]]$pids)) {
        $parts = $line.Split('|', 3)
        [pscustomobject]@{ h = [long]$parts[0]; cls = $parts[1]; title = $parts[2] }
    }
}
function Test-Names([string]$Title, [string]$Leaf) {
    return $Title.IndexOf([IO.Path]::GetFileNameWithoutExtension($Leaf), [StringComparison]::OrdinalIgnoreCase) -ge 0
}
# A deck's slide show windows, found by class and its name in the title, every time (never by a
# remembered handle: PowerPoint reuses windows between decks)
function Get-ShowWindows([string]$Leaf) {
    @(Get-PptWindows | Where-Object { $_.cls -eq $ShowClass -and (Test-Names $_.title $Leaf) })
}
# Presenter View windows: by class, or "Presenter View" in the title (the class name isn't confirmed)
function Get-PvWindows { @(Get-PptWindows | Where-Object { $_.cls -eq $PvClass -or $_.title -match 'Presenter View' }) }
# Is Presenter View up? Cautious: a Presenter View window, or two show windows for the deck
# (pressing the toggle when it's already up closes it, which is worse than not pressing)
function Test-PvUp([string]$Leaf) {
    if ((Get-PvWindows).Count) { return $true }
    if ($Leaf -and (Get-ShowWindows $Leaf).Count -ge 2) { return $true }
    return $false
}
function Test-Alive([long]$H) { return [TimerWin]::IsWindow([IntPtr]$H) }
function Close-Windows([long[]]$Handles) {
    foreach ($h in $Handles) { if (Test-Alive $h) { [void][TimerWin]::PostMessage([IntPtr]$h, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) } }   # WM_CLOSE
}
function Wait-Gone([long[]]$Handles, [int]$Seconds) {
    $until = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $until -and @($Handles | Where-Object { Test-Alive $_ }).Count) { Start-Sleep -Milliseconds 200 }
    return @($Handles | Where-Object { Test-Alive $_ })
}
function Focus-Window([long]$H) {
    if (-not [TimerWin]::Focus([IntPtr]$H)) { Start-Sleep -Milliseconds 150; [void][TimerWin]::Focus([IntPtr]$H) }
    Start-Sleep -Milliseconds 150
}

# Close the deck on screen; with -All, every PowerPoint slide show (one opened by hand too), so
# the holding slide (the wallpaper) shows. Only slide show windows are closed: Presenter View
# goes with its show (it's closed directly only if one is left over afterwards).
function Close-Show([switch]$All) {
    if (-not $Simulate) {
        $hs = if ($All) { @(Get-PptWindows | Where-Object { $_.cls -eq $ShowClass } | ForEach-Object { $_.h }) }
              elseif ($script:Current) { @(Get-ShowWindows $script:Current | ForEach-Object { $_.h }) } else { @() }
        Close-Windows $hs
        $left = @(Wait-Gone $hs 3)
        if ($left.Count) { Focus-Window $left[0]; [TimerWin]::Key(0x1B, $false); [void](Wait-Gone $left 2) }   # Esc
        if ($All) {
            $pv = @(Get-PvWindows | ForEach-Object { $_.h })
            if ($pv.Count) { Start-Sleep -Milliseconds 500; Close-Windows @(Get-PvWindows | ForEach-Object { $_.h }) }
        }
    }
    $script:Current = ''
}

# Presenter View on/off: the show's context menu (the Menu key), then R. It's a toggle, so only
# when it isn't already as wanted. Returns whether Presenter View is up afterwards.
function Set-PresenterView([string]$Leaf, [bool]$On) {
    $has = Test-PvUp $Leaf
    if ($On -and -not $has) {
        # It may still be coming up (PowerPoint can open it by itself): look for a while first
        $until = (Get-Date).AddSeconds(3)
        while ((Get-Date) -lt $until -and -not $has) { Start-Sleep -Milliseconds 250; $has = Test-PvUp $Leaf }
    }
    if ($has -eq $On) { return $has }
    # Turning it off: send the keys to the Presenter View window itself (same menu, and safer).
    # Turning it on: there's no Presenter View window yet, so to the deck's slide show window.
    $target = if (-not $On) { @(Get-PvWindows) | Select-Object -First 1 } else { $null }
    if (-not $target) { $target = @(Get-ShowWindows $Leaf) | Select-Object -First 1 }
    if (-not $target) { $target = @(Get-PptWindows | Where-Object { $_.cls -eq $ShowClass }) | Select-Object -First 1 }
    if (-not $target) { return $has }
    Focus-Window $target.h
    [TimerWin]::Key(0x5D, $true)                  # VK_APPS: the show's context menu
    Start-Sleep -Milliseconds 400
    [TimerWin]::Key(0x52, $false)                 # R: Show / Hide Presenter View
    $until = (Get-Date).AddSeconds(3)
    while ((Get-Date) -lt $until) {
        Start-Sleep -Milliseconds 200
        $has = Test-PvUp $Leaf
        if ($has -eq $On) { break }
    }
    return $has
}

# Starting a deck, from a clean slate each time (like an operator would, only faster; a seamless
# switch isn't needed, and handing Presenter View from one deck to the next proved fragile):
#   1. close every slide show (Presenter View goes with its show); if decks we opened for editing
#      (rehearsal) are open, quit PowerPoint (Ctrl+Q, S to each save prompt); wait until they've gone, and for
#      PowerPoint to finish quitting if it's doing so
#   2. open the new deck and wait for its slide show
#   3. Presenter View on with the keys (only if it isn't already)
function Clear-Shows {
    $hs = @(Get-PptWindows | Where-Object { $_.cls -eq $ShowClass } | ForEach-Object { $_.h })
    if ($hs.Count) {
        Close-Windows $hs
        $left = @(Wait-Gone $hs 5)
        if ($left.Count) { Focus-Window $left[0]; [TimerWin]::Key(0x1B, $false); [void](Wait-Gone $left 3) }   # Esc
    }
    # Our decks open for editing (rehearsal mode): an editor window whose title names a file in the
    # Show folder. If there are any, PowerPoint is quit with Ctrl+Q (Ctrl+W closed the deck but left
    # PowerPoint's empty window behind), which closes everything open in it; each "Save changes to
    # this file?" prompt is answered S (Save), and only once it has appeared. A big deck takes a
    # while to save (it's a zip file), so wait as long as that takes: until PowerPoint has quit.
    $ours = @(Get-ChildItem -LiteralPath $ShowFolder -File -ErrorAction SilentlyContinue | Where-Object { -not $_.Name.EndsWith('.partial') } |
              ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.Name) })
    $eds = @(Get-PptWindows | Where-Object { $_.cls -eq $EditClass } | Where-Object {
        $t = $_.title; @($ours | Where-Object { $t.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count })
    if ($eds.Count) {
        $known = @($ShowClass, $PvClass, $EditClass)
        $before = @(Get-PptWindows | ForEach-Object { $_.h })
        Log 'Closing PowerPoint (Ctrl+Q), saving decks edited in rehearsal'
        Focus-Window $eds[0].h
        [TimerWin]::Key(0x1B, $false)                # Esc: out of any text box or menu
        Start-Sleep -Milliseconds 150
        [TimerWin]::CtrlKey(0x51)                    # Ctrl+Q: quit PowerPoint
        # The save prompt takes focus when it appears: S to the focused PowerPoint window (if
        # there's nothing to save, PowerPoint just quits and the S goes nowhere)
        Start-Sleep -Milliseconds 300
        $answered = @{}
        $fg = [TimerWin]::Foreground().Split('|')
        $pids = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Id })
        if ($fg.Count -ge 4 -and $pids -contains $fg[3]) {
            $answered[[long]$fg[0]] = $true
            [TimerWin]::Key(0x53, $false)            # S: Save
            Log ("Answered the save prompt (S) in: {0} | {1}" -f $fg[1], $fg[2])
        }
        # More edited decks mean more prompts: a new PowerPoint window, or a new focused one, is one
        $until = (Get-Date).AddMinutes(3); $nextNote = (Get-Date).AddSeconds(10); $diag = (Get-Date).AddSeconds(3)
        while ((Get-Date) -lt $until -and @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count) {
            Start-Sleep -Milliseconds 150
            $prompt = @(Get-PptWindows | Where-Object { $before -notcontains $_.h -and $known -notcontains $_.cls -and -not $answered.ContainsKey($_.h) }) | Select-Object -First 1
            $fg = [TimerWin]::Foreground().Split('|')
            $pids = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.Id })
            if (-not $prompt -and $fg.Count -ge 4 -and $pids -contains $fg[3] -and $before -notcontains [long]$fg[0] -and -not $answered.ContainsKey([long]$fg[0])) {
                $prompt = [pscustomobject]@{ h = [long]$fg[0]; cls = $fg[1]; title = $fg[2] }
            }
            if ($prompt) {
                $answered[$prompt.h] = $true
                Focus-Window $prompt.h
                Start-Sleep -Milliseconds 100
                [TimerWin]::Key(0x53, $false)        # S: Save
                Log ("Answered a save prompt (S) in: {0} | {1}" -f $prompt.cls, $prompt.title)
            }
            if ($diag -and (Get-Date) -ge $diag) {
                # Still running after a few seconds: show what's there, to see what the prompt looks like
                $diag = $null
                Log ("   focused: " + ([TimerWin]::Foreground() -replace '^\d+\|', '')) 'DarkGray'
                foreach ($w in @(Get-PptWindows)) {
                    Log ("   window: {0} | {1}" -f $w.cls, $w.title) 'DarkGray'
                    foreach ($c in [TimerWin]::Children([IntPtr]$w.h)) { Log ("      inside: " + $c) 'DarkGray' }
                }
            }
            if ((Get-Date) -ge $nextNote) { $nextNote = (Get-Date).AddSeconds(10); Log 'Still closing PowerPoint (saving)...' }
        }
        if (@(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count) { Log 'PowerPoint did not quit: it may be asking something (check its window)' 'Yellow' }
    }
    # Closing the last /S deck makes PowerPoint quit: let it finish, so the new deck isn't handed
    # to a copy that's on its way out. (A PowerPoint with other windows, e.g. an editor, stays.)
    $until = (Get-Date).AddSeconds(8)
    while ((Get-Date) -lt $until) {
        $procs = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
        if (-not $procs.Count -or @(Get-PptWindows).Count) { break }
        Start-Sleep -Milliseconds 250
    }
    $script:Current = ''
}

function Start-Show([string]$Leaf) {
    $path = Join-Path $ShowFolder $Leaf
    if ($Simulate) { $script:Current = $Leaf; Log "[simulate] showing $Leaf$(if ($NoPresenterView) { '' } else { ' (Presenter View)' })" 'Cyan'; return }

    # 1. Clean slate
    Clear-Shows

    # 2. Open the new deck and wait for its slide show window
    $new = @()
    if ($script:Edit) {
        # Rehearsal: open it as a normal, editable window, then F5 once it has focus. (Step 1
        # saved and closed the decks opened for editing before.)
        Start-Process -FilePath 'powerpnt.exe' -ArgumentList ('"' + $path + '"')
        $ed = $null
        $until = (Get-Date).AddSeconds(30)
        while ((Get-Date) -lt $until) {
            $ed = @(Get-PptWindows | Where-Object { $_.cls -eq $EditClass -and (Test-Names $_.title $Leaf) }) | Select-Object -First 1
            if ($ed) { break }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ed) {
            Log 'The deck''s window did not appear. PowerPoint windows now:' 'Red'
            Get-PptWindows | ForEach-Object { Log ("   {0} | {1}" -f $_.cls, $_.title) 'Red' }
            throw 'the deck did not open (is a PowerPoint dialog waiting for a click?)'
        }
        Start-Sleep -Milliseconds 1500                  # let it finish loading
        for ($try = 0; $try -lt 2 -and -not $new.Count; $try++) {
            Focus-Window $ed.h
            [TimerWin]::Key(0x1B, $false)               # Esc: nothing selected, no key tips
            Start-Sleep -Milliseconds 150
            [TimerWin]::Key(0x74, $false)               # F5: slide show from the start
            $until = (Get-Date).AddSeconds(10)
            while ((Get-Date) -lt $until) {
                $new = @(Get-ShowWindows $Leaf)
                if ($new.Count) { break }
                Start-Sleep -Milliseconds 250
            }
        }
    } else {
        Start-Process -FilePath 'powerpnt.exe' -ArgumentList '/S', ('"' + $path + '"')
        $until = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $until) {
            $new = @(Get-ShowWindows $Leaf)
            if ($new.Count) { break }
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $new.Count) {
        Log 'The slide show window did not appear. PowerPoint windows now:' 'Red'
        Get-PptWindows | ForEach-Object { Log ("   {0} | {1}" -f $_.cls, $_.title) 'Red' }
        throw 'the slide show did not start (is a PowerPoint dialog waiting for a click?)'
    }
    $script:Current = $Leaf
    Start-Sleep -Milliseconds $SettleMs

    # 3. Presenter View (or off, with -NoPresenterView), only if it isn't already. Not in rehearsal
    #    mode: F5 from the editor already follows PowerPoint's own Presenter View setting.
    if ($script:Edit) {
        $pvUp = Test-PvUp $Leaf
        $until = (Get-Date).AddSeconds(3)
        while ((Get-Date) -lt $until -and -not $pvUp) { Start-Sleep -Milliseconds 250; $pvUp = Test-PvUp $Leaf }   # PowerPoint opens it a moment after the show
        Log ("Rehearsal: Presenter View is " + $(if ($pvUp) { 'up' } else { 'not up' }) + ' (as PowerPoint''s own setting has it)')
    } else {
        $wantPv = -not $NoPresenterView
        $hasPv = Set-PresenterView $Leaf $wantPv
        if ($hasPv -ne $wantPv) { Log ("Presenter View may not have {0} (check the screen)" -f $(if ($wantPv) { 'opened' } else { 'closed' })) 'Yellow' }
    }
    # While this is new: list PowerPoint's windows (class | title), to check the class names used above
    Get-PptWindows | ForEach-Object { Log ("   window: {0} | {1}" -f $_.cls, $_.title) 'DarkGray' }
}

# What's on screen: the deck, and whether its show is still up (ended by hand: Esc, last slide)
function Get-ShowState {
    $st = @{ current = $script:Current; showing = $false }
    if (-not $script:Current) { return $st }
    if ($Simulate) { $st.showing = $true; return $st }
    $st.showing = [bool](Get-ShowWindows $script:Current).Count
    return $st
}

function Set-Wallpaper([string]$Path) {
    Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name WallpaperStyle -Value '10'
    Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name TileWallpaper -Value '0'
    [void][TimerWin]::SystemParametersInfo(0x0014, 0, $Path, 0x03)
}

# ---- Commands from the timer: {t:'pp', req, verb, arg, keep} -----------------------
function Invoke-TimerCommand($Cmd) {
    $verb = ([string]$Cmd.verb).ToLower()
    try {
        switch ($verb) {
            'check'  { Send-Ack $Cmd $true @{ result = (Get-PairId) } }
            'mode'   {
                $script:Edit = ([string]$Cmd.arg -eq 'edit')
                Log ("Mode: " + $(if ($script:Edit) { 'rehearsal (decks open for editing, shows start with F5)' } else { 'show (decks open straight into the slide show)' })) 'Cyan'
                Send-Ack $Cmd $true @{ result = $(if ($script:Edit) { 'edit' } else { 'show' }) }
            }
            'send'   { Start-CopyIn $Cmd }
            'start'  {
                $leaf = Get-Leaf $Cmd.arg
                if (-not $leaf) { Send-Ack $Cmd $false @{ error = 'missing arg' }; return }
                # A deck that isn't here never takes the current one off the screen
                if (-not (Test-Path -LiteralPath (Join-Path $ShowFolder $leaf))) { Send-Ack $Cmd $false @{ error = "not found: $leaf" }; return }
                Log "Showing $leaf" 'Green'
                Start-Show $leaf
                Send-Ack $Cmd $true @{ result = $leaf }
            }
            'stop'   {
                if ([string]$Cmd.arg -eq 'all') { Log 'Closing every slide show'; if ($Simulate) { $script:Current = '' } else { Clear-Shows } } else { Log 'Slide show closed'; Close-Show }
                Send-Ack $Cmd $true $null
            }
            'status' { $st = Get-ShowState; Send-Ack $Cmd $true $st }
            'delete' {
                $leaf = Get-Leaf $Cmd.arg
                if (-not $leaf) { Send-Ack $Cmd $false @{ error = 'missing arg' }; return }
                if ($script:Current -ieq $leaf) { Close-Show }
                $path = Join-Path $ShowFolder $leaf
                if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force; Send-Ack $Cmd $true @{ result = $leaf } }
                else { Send-Ack $Cmd $true @{ result = $leaf; note = 'file not on disk' } }
            }
            'tidy'   {
                # Remove decks in Show the run sheet no longer uses (never the one on screen)
                $keep = @{}
                foreach ($k in @($Cmd.keep)) { if ($k) { $keep[([string]$k).ToLower()] = $true } }
                $removed = 0
                Get-ChildItem -LiteralPath $ShowFolder -File | ForEach-Object {
                    if (-not $keep.ContainsKey($_.Name.ToLower()) -and $_.Name -ine $script:Current -and $_.Name -ine $script:Wallpaper -and -not $_.Name.EndsWith('.partial')) {
                        try { Remove-Item -LiteralPath $_.FullName -Force; $removed++ } catch {}
                    }
                }
                Send-Ack $Cmd $true @{ result = [string]$removed }
            }
            'wallpaper' {
                $leaf = Get-Leaf $Cmd.arg
                $path = if ($leaf) { Join-Path $ShowFolder $leaf } else { $null }
                if (-not $path -or -not (Test-Path -LiteralPath $path)) { Send-Ack $Cmd $false @{ error = "not found: $leaf" }; return }
                if ($Simulate) { Log "[simulate] holding slide $leaf" 'Cyan' } else { Log "Holding slide: $leaf" 'Green'; Set-Wallpaper $path }
                $script:Wallpaper = $leaf
                Send-Ack $Cmd $true @{ result = $leaf }
            }
            'quit'   { Send-Ack $Cmd $true $null; $script:Running = $false }
            default  { Send-Ack $Cmd $false @{ error = 'unknown verb' } }
        }
    } catch {
        Log "$verb failed: $($_.Exception.Message)" 'Red'
        Send-Ack $Cmd $false @{ error = $_.Exception.Message }
    }
}

# ---- Messages from the pairing server and the timer --------------------------------
$script:Retry = 5
function On-ServerMessage([string]$Text) {
    try { $m = $Text | ConvertFrom-Json } catch { return }
    switch ([string]$m.type) {
        'joined' {
            $script:Retry = 5
            if ($m.hostOnline) { Log 'Connected to the timer' 'Green'; Send-Hello } else { Log 'Joined; waiting for the timer to open' 'Yellow' }
        }
        'host-online'  { Log 'The timer is back' 'Green'; Send-Hello }
        'host-offline' { Log 'The timer closed (or lost its connection); waiting' 'Yellow' }
        'error' {
            $reason = [string]$m.reason
            if ($reason -eq 'not-found' -or $reason -eq 'room-closed') {
                Log 'No timer with this link right now (is the timer open, with share on?). Trying again in 15 s.' 'Yellow'
                $script:Retry = 15
            } elseif ($reason -eq 'room-full') { Log 'Too many devices are connected to the timer.' 'Red'; $script:Retry = 30 }
            else { Log "The server said: $reason" 'Red'; $script:Retry = 30 }
        }
        'down' {
            $msg = $m.msg
            if ($msg -and $msg.k -eq 'data' -and $msg.d) { On-TimerMessage $msg.d }
            # {k:'sig'}: the timer offers a direct WebRTC link; we use the server, which is all this needs
        }
    }
}

function On-TimerMessage($d) {
    switch ([string]$d.t) {
        'pp' { Invoke-TimerCommand $d }
        'pin-required' {
            if (-not $script:PinCode) { $script:PinCode = '{0:D3}' -f (Get-Random -Minimum 100 -Maximum 1000)   # 3 digits: the timer's proximity check }
            Write-Host ''
            Write-Host ("   The timer asks who this is. On the timer, type:   {0}   (one wrong try disconnects)" -f $script:PinCode) -ForegroundColor Black -BackgroundColor Yellow
            Write-Host ''
            Send-Timer @{ t = 'pin'; code = $script:PinCode; name = 'PowerPoint player' }
        }
        'pin-ok' {
            $script:PinCode = $null
            if ($d.token) { Save-Token ([string]$d.token) }
            Log 'Let in by the timer' 'Green'
            Send-Hello
        }
        'revoked' {
            Log 'The timer took this computer''s access away. Start this script again to ask again.' 'Red'
            $script:Running = $false
        }
        'pin-rejected' {
            Log 'The timer refused this computer (wrong number). Start this script again to try again.' 'Red'
            $script:Running = $false
        }
    }
}

# ---- Main loop: one receive always waiting, so the server's pings are answered -------
Write-Host "Presentation Timer PowerPoint player $Version" -ForegroundColor Cyan
Write-Host "  Server : $Server   Room: $Room   Name: $Name"
Write-Host "  Inbox  : $Inbox" -ForegroundColor White
Write-Host "           (in the receiver page in Chrome or Edge on this computer, choose this folder)"
Write-Host "  Show   : $ShowFolder"
Write-Host ("  Presenter View: " + $(if ($NoPresenterView) { 'off' } else { 'on (-NoPresenterView turns it off)' }))
Write-Host ("  Mode   : " + $(if ($script:Edit) { 'rehearsal (decks open for editing)' } else { 'show' }) + '  (the receiver page''s Rehearsal box switches it)')
if ($Simulate) { Write-Host '  Simulating: PowerPoint will not be opened.' -ForegroundColor Yellow }
elseif ($env:OS -ne 'Windows_NT') { Write-Host 'This needs Windows (or -Simulate).' -ForegroundColor Red; exit 1 }

while ($script:Running) {
    $script:Retry = 5
    try {
        $script:ws = New-Object Net.WebSockets.ClientWebSocket
        $script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(10)
        if ($AllowSelfSignedCert -and $script:ws.Options.PSObject.Properties['RemoteCertificateValidationCallback']) {
            $script:ws.Options.RemoteCertificateValidationCallback = { $true }
        }
        Log "Connecting to $Server"
        # ?room= lets the Cloudflare server route the connection (the VPS server ignores it)
        $sockUrl = $Server + $(if ($Server.Contains('?')) { '&' } else { '?' }) + 'room=' + [Uri]::EscapeDataString($Room)
        $script:ws.ConnectAsync([Uri]$sockUrl, [Threading.CancellationToken]::None).Wait()
        Send-Raw @{ type = 'join'; room = $Room; key = $Key }

        $buffer = New-Object byte[] 65536
        $stream = New-Object IO.MemoryStream
        $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList @(, $buffer)
        $recv = $script:ws.ReceiveAsync($seg, [Threading.CancellationToken]::None)
        $lastPoll = [DateTime]::MinValue
        while ($script:Running -and $script:ws.State -eq 'Open') {
            if ($recv.Wait(200)) {
                $res = $recv.Result
                if ($res.MessageType -eq 'Close') { break }
                $stream.Write($buffer, 0, $res.Count)
                if ($res.EndOfMessage) {
                    $text = [Text.Encoding]::UTF8.GetString($stream.ToArray())
                    $stream.SetLength(0)
                    On-ServerMessage $text
                }
                $recv = $script:ws.ReceiveAsync($seg, [Threading.CancellationToken]::None)
            }
            Watch-Copy
            # Tell the timer when what's on screen changes (a deck started, a show was ended)
            if (([DateTime]::UtcNow - $lastPoll).TotalMilliseconds -ge 1000) {
                $lastPoll = [DateTime]::UtcNow
                $st = Get-ShowState
                $sig = '{0}|{1}' -f $st.current, $st.showing
                if ($sig -ne $script:LastState) {
                    $script:LastState = $sig
                    Send-Timer @{ t = 'pp-state'; current = $st.current; showing = $st.showing }
                }
            }
        }
    } catch {
        $e = $_.Exception
        while ($e.InnerException) { $e = $e.InnerException }
        Log "Connection problem: $($e.Message)" 'Yellow'
    } finally {
        if ($script:ws) {
            try { if ($script:ws.State -eq 'Open') { $script:ws.CloseAsync('NormalClosure', 'bye', [Threading.CancellationToken]::None).Wait(2000) | Out-Null } } catch {}
            $script:ws.Dispose(); $script:ws = $null
        }
    }
    if ($script:Running) { Log "Reconnecting in $($script:Retry) s"; Start-Sleep -Seconds $script:Retry }
}
Log 'Player stopped (the slide show, if any, stays on screen).' 'Cyan'
