/* global timerAPI,onKey_Pause,onKey_UndoPause,catchUpNow,announceCustomMessage,captureTimerState,restoreTimerState*/

function processTimerApiMessage(msg) {
    const { error,cmd, code } = msg ;
    //console.log(error, cmd, msg, code);
    switch (cmd.toLowerCase()) {

        case "start" : {
            restartTimer(msg.msecs);
            break;
        } 

        case "default" : {
            setDefaultDuration(msg.msecs);
            break;
        } 

        case "pause": {
            press(onKey_Pause);
            break;
        }


        case "undopause": {
            press(onKey_UndoPause);
            break;
        }


        case "bar" : {
            press(onKey_B);
            break;
        }

        case "time" : {
            press(onKey_T);
            break;
        }

        case "presenter" : {
            press(onKey_P);
            break;
        }

        case "messages" : {
            press(onKey_M);
            break;
        }

        case "keys": {
            msg.keys.forEach(function (key) {
                if (key.startsWith('~')) {
                    onDocKeyUp({ key: key.substring(1), preventDefault: function () { } });
                } else {
                    onDocKeyDown({ key: key, preventDefault: function () { } });
                }

            });
            break;
        }

        // Run sheet support: snapshot returns the timer state; restore puts it back
        // (including the on-screen message). See captureTimerState() in timer.js.
        case "snapshot":
            return captureTimerState();

        case "restore": {
            restoreTimerState(msg.state);
            if (msg.state) processTimerApiMessage({ cmd: 'custommessage', text: msg.state.message || '' });
            break;
        }

        case "runsheetnext": {
            if (window.runsheet) window.runsheet.next();
            break;
        }

        case "runsheetprev": {
            if (window.runsheet) window.runsheet.back();
            break;
        }

        case "catchup": {
            catchUpNow();
            break;
        }

        // Video player (dropPlayer.js): play the cued video, stop, rewind to the start
        case "videoplay":   { if (window.videoPlayer) return window.videoPlayer.play(); break; }
        case "videostop":   { if (window.videoPlayer) return window.videoPlayer.stop(); break; }
        case "videorewind": { if (window.videoPlayer) return window.videoPlayer.rewind(); break; }
        // PowerPoint computers (pptx-hub.js): close every slide show, so the holding slide shows
        case "pptxclose":   { if (window.pptxHub) window.pptxHub.close(); break; }

        case "adjust": {
            if (msg.addtime) {
                bumpEnd(msg.msecs, msg.msecs);
            } else {
                bumpEnd(0 - msg.msecs, 0 - msg.msecs);
            }
            durationDisp.textContent = secToStr((seekEndsAt - startedAt) / 1000);
            displayUpdate();
            break;
        }

        case "nudge": {
            if (msg.addtime) {
                bumpEnd(msg.msecs, 0);
            } else {
                bumpEnd(0 - msg.msecs, 0);
            }
            durationDisp.textContent = secToStr((seekEndsAt - startedAt) / 1000);
            lastTimeText = "";
            displayUpdate();
            break;
        }

        case "custommessage": {

            html.classList.remove("edit_custom_message");
            html.classList.remove("show_custom_message");
            custom_message.innerText = msg.text.trim();
            custom_message.contentEditable = false;


            if (custom_message.innerText.length > 0) {
                html.classList.add("show_custom_message");
            }
            localStorage.setItem("custom_message", custom_message.innerText);
            break;
        }

        case "settimercolor": {

            const oldColor = setCustomColor(msg.name, msg.color);


            break;
        }

        case "settimercolors": {

            setCustomColors(msg.colors);

            break;
        }

        case "gettimercolor": {
            if (timerAPI && msg.name) {
                const colorName = msg.name;
                const reply = { setTimerColors: {} };
                const color = getCustomColor(colorName);
                if (color) {
                    reply.setTimerColors[colorName] = color;
                    timerAPI.send(reply);
                }
            }
            break;
        }

        case "gettimercolors": {
            getTimerColors();

            break;
        }

        case "redirect": {
            if (typeof msg.url === 'number') {
                const url = new URL(location.href);
                url.port = msg.url.toString();
                msg.url = url.toString();
            }
            if (msg.url &&
                (msg.url.startsWith('/') ||
                    msg.url.startsWith(location.origin.replace(/\:.*$/, ''))
                ) && msg.url !== location.href

            ) {
                if (msg.delay) {
                    setTimeout(function () {
                        location.replace(msg.url);
                    }, msg.delay)
                } else {
                    location.replace(msg.url);
                }
            }
            break;
        }

        case "presentermode": {
            if (runMode !== "presenter") {
                location.replace("/?presenter");
            }
            break;
        }

        case "controlmode": {
            if (runMode === "presenter") {
                location.replace("/");
            }
            break;
        }

        case "opened": {
            if (timerAPI) {
                console.log("sending startup values", dispNextMins.textContent);
                let pausedMsec = pausedAt ? Date.now() - pausedAt : 0;

                timerAPI.send({
                    setVariableValues: {
                        default: secToStr(defaultDuration / 1000),
                        endsAt: endsDisp.textContent,
                        startedAt: startedDisp.textContent,
                        showtimenow: localStorage.getItem('showtimenow') || '0',
                        showbar: localStorage.getItem('showbar') || '0',
                        showmessages: localStorage.getItem('showmessages') || '0',
                        barpct: String(Math.floor(Number(localStorage.getItem('barpct')) || 0)),
                        htmlclass: document.documentElement.className,
                        paused: secToStr(pausedMsec / 1000),
                        pauses: secToStr((pausedMsec + pauseAcum) / 1000),
                    }
                });
                lastTimeText = "";
                announceCustomMessage(true);
                if (window.runsheet) window.runsheet.announce(true);
                if (window.pptxHub) window.pptxHub.opened();
                if (togglePIPMode) togglePIPMode.lastContent = "";
                getTimerColors();
            }

            break;
        }
    }

    function press(fn) {
        tabCount = getTabCount() ;     
        nudgeFactor  =   1000;
        
        endDelta     =   0;
        seekEndDelta =   1000;
        fn({});
        controlling = false;
        shifting = false;

        html.classList.remove("controlling");           
        html.classList.remove("shifting");
    }
}

function getHexColor(colorStr) {
    if (getHexColor.cache) {
        if (getHexColor.cache[colorStr] !== undefined) {
            return getHexColor.cache[colorStr];
        }
    } else {
        getHexColor.cache = {};
    }
    const a = document.createElement('div');
    a.style.color = colorStr;
    const colors = window.getComputedStyle(document.body.appendChild(a)).color.match(/\d+/g).map(function (a) { return parseInt(a, 10); });
    document.body.removeChild(a);
    getHexColor.cache[colorStr] = (colors.length >= 3) ? '#' + (((1 << 24) + (colors[0] << 16) + (colors[1] << 8) + colors[2]).toString(16).substr(1)) : false;
    return getHexColor.cache[colorStr];
}

function getTimerColors() {
    if (timerAPI) {
        const msg = {
            setTimerColors: {

            }
        };
        let shouldSend = false;
        (msg.names || getCustomColorNames()).forEach(function (n) {
            const color = getCustomColor(n);
            const hexColor = getHexColor(color);
            const colorName = w3color(color).toName();
            if (color) {
                msg.setTimerColors[n] = { color, hexColor, colorName };
                shouldSend = true;
            }
        });
        if (shouldSend) {
            timerAPI.send(msg);
        }
    }
}

function setCustomColor(name, newColor, notify) {

    let shouldSend = false;

    const current = getCustomColor(name);
    if (current === '') return null;
    if (current === newColor) return false;
    document.documentElement.style.setProperty(`--color-${name}`, newColor);

    if (notify !== false && timerAPI) {
        const msg = {
            setTimerColors: {

            }
        };

        msg.setTimerColors[name] = newColor;
        timerAPI.send(msg);
    }

    return current;
}

function getCustomColorNames() {

    return Array.from(document.styleSheets).filter(
        function (sheet) {
            return sheet.href === null || sheet.href.startsWith(window.location.origin);
        }
    )
        .reduce(
            function (acc, sheet) {
                return (acc = [
                    ...acc,
                    ...Array.from(sheet.cssRules).reduce(
                        function (def, rule) {
                            return (def =
                                rule.selectorText === ":root"
                                    ? [
                                        ...def,
                                        ...Array.from(rule.style).filter(function (name) {
                                            return name.startsWith("--");
                                        }
                                        )
                                    ]
                                    : def);
                        },
                        []
                    )
                ]);
            },
            []
        ).map(function (n) {
            return n.replace(/^--color-/, '');
        });
}

function getCustomColors(names) {
    const result = {};
    (names || getCustomColorNames()).forEach(function (n) {
        result[n] = getCustomColor(n);
    });
    return result;
}

function setCustomColors(colors, notify) {
    const changed = {};
    const msg = notify !== false && timerAPI ? {
        setTimerColors: {

        }
    } : false;
    let shouldSend = false;
    Object.keys(colors).forEach(function (n) {
        const newColor = colors[n];
        const was = setCustomColor(n, newColor, false);
        if (was) {
            changed[n] = was;
            if (msg) {
                msg.setTimerColors[n] = newColor;
                shouldSend = true;
            }
        }
    });

    if (shouldSend) {
        timerAPI.send(msg);
    }

    return changed;
}

function getCustomColor(name) {
    return window.getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`);
}
