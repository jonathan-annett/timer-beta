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
    try { $Server = 'wss://' + ([Uri]$Link.Trim()).Host + ':8443/' } catch { $Server = $null }
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
$script:Ppt = $null           # PowerPoint.Application (COM), when available
$script:Pres = $null          # the presentation being shown (COM)
$script:Proc = $null          # fallback without COM: the PowerPoint process we started
$script:Current = ''          # file name (in Show) being shown
$script:Copy = $null          # a copy in progress: @{ ps; async; req; name; temp; dest; src }
$script:LastState = ''
$script:PinCode = $null

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
        inbox = $Inbox; token = (Get-Token); current = $st.current; showing = $st.showing; slide = $st.slide; slides = $st.slides;
        simulate = [bool]$Simulate }
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
function Get-Ppt {
    if ($Simulate) { return $null }
    if ($script:Ppt) {
        try { [void]$script:Ppt.Version; return $script:Ppt } catch { $script:Ppt = $null; $script:Pres = $null }
    }
    try { $script:Ppt = New-Object -ComObject PowerPoint.Application } catch { $script:Ppt = $null }
    return $script:Ppt
}

function Close-Show {
    if ($script:Pres) { try { $script:Pres.Close() } catch {} }
    $script:Pres = $null
    if ($script:Proc -and -not $script:Proc.HasExited) {
        try { [void]$script:Proc.CloseMainWindow() } catch {}
        if (-not $script:Proc.WaitForExit(3000)) { try { $script:Proc.Kill() } catch {} }
    }
    $script:Proc = $null
    $script:Current = ''
}

function Start-Show([string]$Leaf) {
    $path = Join-Path $ShowFolder $Leaf
    if ($Simulate) { $script:Current = $Leaf; Log "[simulate] showing $Leaf" 'Cyan'; return }
    $app = Get-Ppt
    if ($app) {
        # Open the new deck and start it before closing the old one: no desktop in between
        $old = $script:Pres
        $pres = $app.Presentations.Open($path, -1, 0, 0)      # read-only, not untitled, no editing window
        $settings = $pres.SlideShowSettings
        $settings.ShowType = 1                                 # presenter (full screen)
        [void]$settings.Run()
        $script:Pres = $pres
        $script:Current = $Leaf
        if ($old) { try { $old.Close() } catch {} }
        return
    }
    # No COM (PowerPoint Viewer, unusual installs): start it as a program instead
    Close-Show
    $before = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $p = Start-Process -FilePath 'powerpnt.exe' -ArgumentList '/S', "`"$path`"" -PassThru
    Start-Sleep -Seconds 3
    if ($p -and -not $p.HasExited) { $script:Proc = $p }
    else { $script:Proc = Get-Process -Name POWERPNT -ErrorAction SilentlyContinue | Where-Object { $before -notcontains $_.Id } | Select-Object -First 1 }
    $script:Current = $Leaf
}

# What's on screen: the deck, whether its slide show is still running, and the slide
function Get-ShowState {
    $st = @{ current = $script:Current; showing = $false; slide = 0; slides = 0 }
    if (-not $script:Current) { return $st }
    if ($Simulate) { $st.showing = $true; return $st }
    if ($script:Pres) {
        try {
            $view = $script:Pres.SlideShowWindow.View
            $st.showing = $true
            $st.slide = [int]$view.CurrentShowPosition
            $st.slides = [int]$script:Pres.Slides.Count
        } catch { $st.showing = $false }       # the show was ended (Esc, or the last slide)
        return $st
    }
    $st.showing = [bool]($script:Proc -and -not $script:Proc.HasExited)
    return $st
}

function Set-Slide([string]$Arg) {
    if (-not $script:Pres) { throw 'no slide show' }
    $view = $script:Pres.SlideShowWindow.View
    switch -regex ($Arg) {
        '^next$'   { $view.Next(); break }
        '^prev$'   { $view.Previous(); break }
        '^first$'  { $view.First(); break }
        '^last$'   { $view.Last(); break }
        '^black$'  { $view.State = 3; break }          # ppSlideShowBlackScreen
        '^white$'  { $view.State = 4; break }
        '^resume$' { $view.State = 1; break }
        '^\d+$'    { $view.GotoSlide([int]$Arg); break }
        default    { throw "unknown slide action: $Arg" }
    }
}

function Set-Wallpaper([string]$Path) {
    if (-not ('Win32.Native' -as [type])) {
        Add-Type -Name Native -Namespace Win32 -MemberDefinition '[DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)] public static extern bool SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);'
    }
    Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name WallpaperStyle -Value '10'
    Set-ItemProperty -Path 'HKCU:\Control Panel\Desktop' -Name TileWallpaper -Value '0'
    [void][Win32.Native]::SystemParametersInfo(0x0014, 0, $Path, 0x03)
}

# ---- Commands from the timer: {t:'pp', req, verb, arg, keep} -----------------------
function Invoke-TimerCommand($Cmd) {
    $verb = ([string]$Cmd.verb).ToLower()
    try {
        switch ($verb) {
            'check'  { Send-Ack $Cmd $true @{ result = (Get-PairId) } }
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
            'stop'   { Log 'Slide show closed'; Close-Show; Send-Ack $Cmd $true $null }
            'slide'  { Set-Slide ([string]$Cmd.arg); Send-Ack $Cmd $true $null }
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
                    if (-not $keep.ContainsKey($_.Name.ToLower()) -and $_.Name -ine $script:Current -and -not $_.Name.EndsWith('.partial')) {
                        try { Remove-Item -LiteralPath $_.FullName -Force; $removed++ } catch {}
                    }
                }
                Send-Ack $Cmd $true @{ result = [string]$removed }
            }
            'wallpaper' {
                $leaf = Get-Leaf $Cmd.arg
                $path = if ($leaf) { Join-Path $ShowFolder $leaf } else { $null }
                if (-not $path -or -not (Test-Path -LiteralPath $path)) { Send-Ack $Cmd $false @{ error = "not found: $leaf" }; return }
                Set-Wallpaper $path; Send-Ack $Cmd $true @{ result = $leaf }
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
            if (-not $script:PinCode) { $script:PinCode = '{0:D4}' -f (Get-Random -Minimum 1000 -Maximum 10000) }
            Write-Host ''
            Write-Host ("   The timer needs a PIN. On the timer, type:   {0}" -f $script:PinCode) -ForegroundColor Black -BackgroundColor Yellow
            Write-Host ''
            Send-Timer @{ t = 'pin'; code = $script:PinCode }
        }
        'pin-ok' {
            $script:PinCode = $null
            if ($d.token) { Save-Token ([string]$d.token) }
            Log 'Let in by the timer' 'Green'
            Send-Hello
        }
        'pin-rejected' {
            Log 'The timer refused this computer (PIN). Start this script again to try again.' 'Red'
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
if ($Simulate) { Write-Host '  Simulating: PowerPoint will not be opened.' -ForegroundColor Yellow }
elseif (-not (Get-Ppt)) { Write-Host '  PowerPoint automation not available: decks will be started as programs instead.' -ForegroundColor Yellow }

while ($script:Running) {
    $script:Retry = 5
    try {
        $script:ws = New-Object Net.WebSockets.ClientWebSocket
        $script:ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(10)
        if ($AllowSelfSignedCert -and $script:ws.Options.PSObject.Properties['RemoteCertificateValidationCallback']) {
            $script:ws.Options.RemoteCertificateValidationCallback = { $true }
        }
        Log "Connecting to $Server"
        $script:ws.ConnectAsync([Uri]$Server, [Threading.CancellationToken]::None).Wait()
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
            # Tell the timer when what's on screen changes (a show ended, the slide moved)
            if (([DateTime]::UtcNow - $lastPoll).TotalMilliseconds -ge 1000) {
                $lastPoll = [DateTime]::UtcNow
                $st = Get-ShowState
                $sig = '{0}|{1}|{2}|{3}' -f $st.current, $st.showing, $st.slide, $st.slides
                if ($sig -ne $script:LastState) {
                    $script:LastState = $sig
                    Send-Timer @{ t = 'pp-state'; current = $st.current; showing = $st.showing; slide = $st.slide; slides = $st.slides }
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
