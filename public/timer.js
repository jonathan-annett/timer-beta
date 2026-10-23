/*!
 * timer.js
 * Copyright(c) 2023 Jonathan Annett
 * MIT Licensed
 */

/*jshint maxerr: 10000 */

/* global fs_api,ace,timerAPI,setupPip,timeProvider,tab_id */


const oneSecond		= 1000;
const oneMinute		= 60 * oneSecond;
const skip_granularity = 15 * oneSecond;

let bracketBump = oneMinute;

var timerWin;

if (
	(!!window.opener &&
		 ["timer_control_window","remote_timer_window"].indexOf(window.name)>=0
	) // companion / local hosted mode 
		 ||
	(window.location.protocol==="https:") // hosted single page mode
   ) {
	console.log("page load mode confirmed",document.referrer,location.origin);
} else {
	location.replace(location.origin);
}


window.addEventListener ("unload",onControlUnload);

const wc_canvas = document.getElementById('wc_canvas');
const wc_canvas2 = document.getElementById('wc_canvas2');
const wc_canvas3 = document.getElementById('wc_canvas3');
const wc_videoElement = document.getElementById('webcam');
      
wc_canvas.width = 1270;
wc_canvas.height = 720;
  
let wc_viewer ;

let doc = document;
let qs = doc.querySelector.bind(doc);
let getEl = doc.getElementById.bind(doc);

let tabCount = 1;

let shifting = false;
let controlling = false;
let alting = false;
let powerPointMode = false;

let nudgeFactor  = controlling ? 60000 : 1000;
	
let endDelta	 =  controlling ? 60000 : 0;
let seekEndDelta =  controlling ? 60000 : 1000;


let stylesheet1= getEl ("style_1");
let stylesheet1_obj;
replaceStylesheet(stylesheet1,function(ev){
	stylesheet1_obj = ev;
});

let aceScript;
let elapsedDisp  = getEl("elapsed_disp");
let remainDisp   = getEl("remain_disp");
let startedDisp  = getEl("started_disp");
let endsDisp	 = getEl("ends_disp");

let remainInfoDisp = getEl("remain_info_message");


let custom_message  = getEl("custom_message");


let durationDisp = getEl("duration_disp");
let extraTimeDisp = getEl("extra_time_disp");


 

let nowDisp	  = getEl("now_disp");
let keyDisp	  = getEl("key_disp");
let dispNextMins = getEl("disp_next_mins");
let html		 = qs("html");
let progress	 = qs('.progress');
let pausedAt;
let pauseAcum = 0;
  
let runMode = "controller";

let togglePIPMode ;

const isLinked = window.location.search.indexOf("&linked")>0;

  if (window.location.search.startsWith("?presenter")) {

	  html.classList.add("reduced");
	  runMode = "presenter";
	  if (fs_api.isFullscreen()) {
		 document.title = "Presentation Timer - Remote Screen (Fullscreen)";
	  } else {
		 document.title = "Presentation Timer - Remote Screen";
	  }

  } else {

	 if (fs_api.isFullscreen()) {
		 document.title = "Presentation Timer - Control Screen (Fullscreen)";
	 } else {
		 document.title = "Presentation Timer - Control Screen";
	 }

	 togglePIPMode = setupPip(
		"remain_disp",
		"remain_disp_video",
		192*2,108*2,
		'100px "Lucida", sans-serif',
		"#remain_disp_video_text",
		"overlay",
		"#remain_disp_video_text",
		'40px "Lucida", sans-serif'
	);

	if (!togglePIPMode) {
		setHtmlClass('nooverlay');
	}

  }
  
let defaultDuration = readNumber ( "defaultDuration", 10 * oneMinute ); 
let thisDuration = defaultDuration;
let startedAt	   = readNumber ( "startedAt",	   timeProvider.now()	 );
let endsAt		  = readNumber ( "endsAt",		  startedAt + defaultDuration  ) ;
let seekEndsAt	  = readNumber ( "seekEndsAt",	  endsAt		);


let lastUpdateTick = 0;
let lastTimeText   = "";
let lastEndsAtText = "";
let enterTimeText  = "";
let enterHoursText = "";
window.tab_id = "tab_"+timeProvider.now().toString(); 

custom_message.addEventListener('focus', function(){
  setTimeout(function(){
	 document.execCommand('selectAll',false,null);
  },2);
});


  progress.style.width = '0%';
	
  dispNextMins.textContent = secToStr(defaultDuration/1000);
  
  let restartNeeded = isNaN (startedAt) || isNaN (endsAt);
  if (!restartNeeded) {
	  
	  let overshoot = 1000 * 60 * 10;
	  if ((timeProvider.now () > endsAt + overshoot) || (timeProvider.now() > seekEndsAt+ overshoot) ) {
		  restartNeeded=true;
	  } 

  }
  
  if ( restartNeeded) {
	 restartTimer() ;
  } else {
	  
	  if ((timeProvider.now () > endsAt) || (timeProvider.now() > seekEndsAt) ) {
		  endsAt = seekEndsAt;
		  setHtmlClass("over");
	  } 
	   startedDisp.textContent =  local24HourTime (timeProvider.date(startedAt));
	   endsDisp.textContent	=  local24HourTime ( timeProvider.date(endsAt) );
	   durationDisp.textContent = secToStr((endsAt-startedAt) / 1000);
	   
	   
	   pausedAt = readNumber("pausedAt",pausedAt);
	   pauseAcum = readNumber("pauseAcum",pauseAcum);
	   
	   
	   
	   if (pausedAt!==undefined) {
		   setHtmlClass("paused");
	   }
	
	   
	   displayUpdate();
	   
	   if ( readNumber("showbar",0) === 1) {
		   setHtmlClass("showbar");
	   } else {
		   clearHtmlClass("showbar");
	   }
	   
		if ( readNumber("showtimenow",0) === 1 ) {
		   setHtmlClass("showtimenow");
		 } else {
		   clearHtmlClass("showtimenow");			
		 } 
		 
		 
		if ( readNumber("showmessages",0) === 1 ) {
		   setHtmlClass("showmessages");
		 } else {
		   clearHtmlClass("showmessages");
		 } 

	   
	   
	   localStorage.setItem("remainDispClass",html.className);
  }

  dispNextMins.textContent = secToStr( defaultDuration / oneSecond );

  // Show the current message on load. Without this, a presenter window opened after a
  // message was set (or a reloaded controller) stayed blank until the message changed.
  (function restoreStoredMessage() {
	  const msg = localStorage.getItem("custom_message");
	  if (msg) {
		  custom_message.textContent = msg;
		  setHtmlClass("show_custom_message");
	  }
  })();
  
  setInterval(displayUpdate,100);
  doc.addEventListener("keyup",onDocKeyUp);
  doc.addEventListener("keydown",onDocKeyDown);
  
  doc.addEventListener("contextmenu",function(e){ e.preventDefault();});
  addEventListener('storage',onLocalStorage);
  
		   // Only key-macro buttons; others (deck, share) have their own click handlers
		   [].forEach.call(document.querySelectorAll('div.buttons div.btn[data-keys]'),function(el){
			  el.addEventListener('pointerdown',keyMacroClick);
		  });

		  
 
		  function keyMacroClick(e) {
			  if (e.pointerType === "mouse") {
				  if (e.button !== 0) {
					  return;
				  }
			  }
			  let keys = this.dataset.keys.split(",").map(function(code){
				  
				  if (code.startsWith('!')) {
					  
					  return {key : code.substr(1),__up:true};
				  } else {
					return {key : code};  
				  }
			  });
			  
			  if (e.shiftKey && keys[0].key===" ") {
				  
				  if (enterTimeText !== "") {
					  this.dataset.keys = ' ,'+enterTimeText.split('').join(',')+', ';
					  this.innerHTML = enterTimeText;
					  clearHtmlClass("editing");
					  dispNextMins.textContent = secToStr(defaultDuration/1000);
					  enterTimeText = "";
					  return;

				  } else {
					  keys = this.dataset.keys.split(",").map(function(code){
						  if (code===" ")  {
							  return { key :"Enter" };
						  }
						  return {key : code};  
					  });
					}
			  }
			  
			  keys.forEach(function(e){
				  if (e.__up) { 
					onDocKeyUp(e);
				  } else {
					onDocKeyDown(e);
				  }
			  });
		  }
		  
  
   function openTimerWindow(close) {
	  if (close===true) {
		 if (timerWin) timerWin.close();
		 if (window.opener) window.close();
		 timerWin = undefined;
	  } else {
		 timerWin = open("timer.html?presenter", 'remote_timer_window', "location=0");
		 if (timerWin) {
			timerWin.addEventListener ("load",function(){
				console.log("timer win loaded");
				timerWin.addEventListener ("unload",onTimerWinUnload);
			});
		 }
	  }
	  return false;
  }
  
  
  // The message currently on screen ('' when none). Messages are set from several places
  // (C key, custommessage command, remote-json, storage sync), so it is announced from one point.
  function currentCustomMessage() {
	  return html.classList.contains("show_custom_message") ? custom_message.textContent.trim() : "";
  }
  var lastAnnouncedMessage = null;   // var: displayUpdate runs before later lines execute
  function announceCustomMessage(force) {
	  const msg = currentCustomMessage();
	  if (!force && msg === lastAnnouncedMessage) return;
	  lastAnnouncedMessage = msg;
	  // Long messages (e.g. run sheet item names) get a smaller font so they don't run into the countdown
	  if (msg.length > 90) { setHtmlClass("msg-xlong"); clearHtmlClass("msg-long"); }
	  else if (msg.length > 28) { setHtmlClass("msg-long"); clearHtmlClass("msg-xlong"); }
	  else { clearHtmlClass("msg-long"); clearHtmlClass("msg-xlong"); }
	  if (timerAPI) timerAPI.send({ setVariableValues: { custommsg: msg } });
  }

  function displayUpdate() {
	  
	  let timeNow =  timeProvider.now() ; 
	  announceCustomMessage();
	  tabCount = getTabCount();
	  let controllerCount = getTabCount(true);
	  let pausing = false;

	  let adjusting_down = false;
	  let adjusting_up = false;
	  let adjusting_delta = '0';
	  let remain_actual ;
	  
	  if (tabCount===1) {
		  clearHtmlClass("twoplus");
	  } else {
		  setHtmlClass("twoplus");
	  }
	  
	  let docTitle = document.title;

	  if (!fs_api.isFullscreen()) {
			if (runMode === "presenter") {
				if (tabCount===1) {
					docTitle = "Presentation Timer - Single Window";
				} else { 
					docTitle = "Presentation Timer - Remote Screen";
				}
			} else  {
				if (runMode==="controller" ) {
					docTitle = "Presentation Timer - Control Screen";
				} else {
				   docTitle = "Presentation Timer";
				}
			}
	  } else {
			 if (runMode === "presenter") {
						document.title = "Presentation Timer - Remote Screen (Fullscreen)";
			 } else  {
					if (runMode==="controller" ) {
						docTitle = "Presentation Timer - Control Screen (Fullscreen)";
					} else {
						docTitle = "Presentation Timer (Fullscreen)";
					}
			}  
	  } 
	  if (	document.title !== docTitle )  {
	          	document.title = docTitle;
	  }
	  
	  if ((runMode==="controller" || tabCount=== 1) && !isLinked ) {
		 
		 let pausedMsec = pausedAt ? timeNow-pausedAt : 0;
		  
		 let actualRemain =  (seekEndsAt - timeNow) / oneSecond ;
		 if (actualRemain>0) actualRemain++;
		 remain_actual = secToStr(actualRemain);
		 if (seekEndsAt < endsAt - 500) {
			 
			 if (seekEndsAt < endsAt - skip_granularity) {
				 //endsAt -= skip_granularity;
			 }
			 
			 endsAt -= 25;
			 clearRemainClass("adjustingDown");
			 setRemainClass("adjusting") ;
			 setHtmlClass("adjusting_time");
			 adjusting_delta = Number ( (endsAt -seekEndsAt) / oneSecond).toFixed(1);
			 
			 keyDisp.textContent = "speeding up to match actual time ("+remain_actual+")  "+adjusting_delta+" seconds offset";
			 writeNumber("endsAt",endsAt);
			 adjusting_up = true;
			
		 } else {
			  if (seekEndsAt > endsAt + 500) {
				  if (seekEndsAt > endsAt + skip_granularity) {
					  //endsAt += skip_granularity;
				  }
				  endsAt += 25;
				  clearRemainClass("adjusting");
				  setRemainClass("adjustingDown") ;
				  setHtmlClass("adjusting_time");
				  adjusting_delta = Number ( (endsAt -seekEndsAt) / oneSecond).toFixed(1)
				  keyDisp.textContent = "slowing down to match actual time ("+remain_actual+")  "+adjusting_delta+" seconds offset";
				  writeNumber("endsAt",endsAt);
				  adjusting_down = true;
			  }  else {
				  endsAt = seekEndsAt;
				  clearRemainClass("adjusting") ;
				  clearRemainClass("adjustingDown") ;
				  clearHtmlClass("adjusting_time");
				  remain_actual = undefined;
				  keyDisp.textContent = tabCount === 1  ? "" : controllerCount > 1 ? "MULTIPLE CONTROLLERS TABS ARE OPEN. CLOSE ONE!" : pausedMsec === 0 ? "remote display active" : "countdown was paused at "+ local24HourTime (timeProvider.date(pausedAt));
				  writeNumber("endsAt",endsAt);
			  }
		 }
		 	 
		 let elapsedMsecAbs,remainMsecAbs = ((endsAt - timeNow) + (pausedMsec));
		  
		 let secondsRemain = remainMsecAbs / oneSecond;
		 let timeText,elapsedText;
		 
		 
		 if (pausedMsec!=0) {
			 const pausedTimeStr = secToStr(pausedMsec / oneSecond);
			 remainInfoDisp.textContent =  runMode === "presenter" ? "Paused" : pausedTimeStr;
			 endsDisp.textContent =  local24HourTime ( timeProvider.date(seekEndsAt+pausedMsec) );
			 const accumTimeStr = secToStr((pauseAcum+pausedMsec) / oneSecond);
			 extraTimeDisp.textContent = "+ "+accumTimeStr+" pauses";
			 pausing = true;
			 if (timerAPI && lastEndsAtText !== endsDisp.textContent) {
				lastEndsAtText = endsDisp.textContent;
				timerAPI.send({
					setVariableValues:{
						adjusting_up,
						adjusting_down,
						adjusting_delta,
						remain_actual: remain_actual,
						endsAt:lastEndsAtText,
						paused:pausedTimeStr,
						pauses:accumTimeStr,
						pausing}
					});
			 }

			
			 
		 } else {
			 remainInfoDisp.textContent = "";
			 if (pauseAcum===0) {
				 extraTimeDisp.textContent = "";
			 } else {
				 extraTimeDisp.textContent = "+ "+secToStr(pauseAcum / oneSecond)+" pauses";
			 }
		 }
		 
		 
		 
		
		 let elapsedMSec = (timeNow-startedAt) - (pausedMsec+pauseAcum);
	
		 if (elapsedMSec < 0) {
			 
			setHtmlClass("future");
			if (elapsedMSec > -60000) {
				setHtmlClass("impending");
			} else {
				clearHtmlClass("impending");
			}
			seekEndsAt = startedAt + thisDuration;
			bumpEnd(0,0);
			endsAt = seekEndsAt;
			elapsedMsecAbs = (0-elapsedMSec);
			elapsedText = secToStr( elapsedMsecAbs / oneSecond);
			elapsedDisp.textContent = elapsedText;
			timeText = secToStr(thisDuration/1000);
			localStorage.setItem("elapsedDisp",elapsedText);
				
			 
			
		 } else {
			 
			clearHtmlClass("future");
			if (secondsRemain >= 0 ) {
				  timeText =  secToStr(secondsRemain+1);
				 
			} else {
				  timeText =  secToStr((0-secondsRemain));
				
			}
			elapsedMsecAbs = elapsedMSec;
			elapsedText = secToStr( elapsedMsecAbs / oneSecond);

		 }
		 
		 if (lastTimeText !== timeText) {
				 if (lastUpdateTick===0 || timeNow - lastUpdateTick > 750) {
					 lastUpdateTick = timeNow;
					 remainDisp.textContent = timeText;
					 elapsedDisp.textContent = elapsedText;
					 
					 
					 lastTimeText = timeText;
					 let expired = false;
					 let impending = false;
				   
					 if (secondsRemain >=  0 ) {
						 
						clearHtmlClass("over");
						
						if (elapsedMSec >= 0) {
							if (secondsRemain <= 60 ) {
								setHtmlClass("impending");
								impending=true;
							} else {
								clearHtmlClass("impending");								
							}
						}
						
						setBar(elapsedMSec,thisDuration);
					 } else {
						expired = true;
						setHtmlClass("over");
						clearHtmlClass("impending");	
						setBarPct(100);
					 }
					 localStorage.setItem("remainDisp",timeText);
					 if (timerAPI) {
						timerAPI.send({
							setVariableValues:{
								adjusting_up,
								adjusting_down,
								adjusting_delta,
								remain_actual: remain_actual||timeText,
								expired,impending,pausing,
								remain:timeText,
								elapsed:elapsedText}});
					 }
					 
					 
					 if (wc_viewer && wc_viewer.updateFlyoutVideoFrame) {
                        wc_viewer.updateFlyoutVideoFrame (undefined,undefined,elapsedMsecAbs,remainMsecAbs);
					 }
				  }
		 }
		 localStorage.setItem("remainDispClass",html.className);
		 
	  } else {
		  keyDisp.textContent = tabCount+" tabs open";
	  }
	   nowDisp.textContent = timeNowStr();
  }
  
  function updateEnteredTimeText () {
		 if (enterHoursText === "") {
			dispNextMins.textContent = secToStr(Number(enterTimeText) * 60);
		 } else {
			dispNextMins.textContent = secToStr((Number(enterHoursText) * 3600) + (Number(enterTimeText) * 60)); 
		 } 
  }


 function replaceStylesheet(el,cb) {
	 
	 let src = el.href;
	 let xhr = new XMLHttpRequest(),
		 css = '';//Empty string variable intended for the XMLHttpRequest response data...

		function processRequest(){
			if (xhr.readyState == 4){
				css = this.responseText;
				let editor,editorPre;
				let sheet = document.createElement('style');
				sheet.innerHTML = css;
				let storedCss = localStorage.getItem("custom_css");
				if (storedCss) {
					sheet.innerHTML = storedCss;
				}
				document.body.appendChild(sheet);
				el.parentNode.removeChild(el);
				if (cb) {
					cb(Object.defineProperties({},{
						sheet : {value: sheet},
						css : { 
							set : function(newCss){
								sheet.innerHTML = newCss;
							},
							get : function () {
								return sheet.innerHTML;
							}
						},
						reset : {value : function(){
							sheet.innerHTML = css;
							localStorage.removeItem("custom_css");
						}},
						editToggle : {
							
							value : function(){
							if (editor) {
								sheet.innerHTML = editor.getValue();
								localStorage.setItem("custom_css",sheet.innerHTML);
								editorPre.parentNode.removeChild(editorPre);
								editor=undefined;
							} else {
								   let startEditor = function(){
									  
									  editorPre = document.createElement("pre");
									  editorPre.id="css_editor";
									  document.body.appendChild(editorPre);
									  
									  setTimeout(function(){
										  editor = ace.edit("css_editor");
										  editor.setTheme("ace/theme/chrome");
										  editor.session.setMode("ace/mode/css");
										  editor.setValue(sheet.innerHTML);
										  editor.focus();							
										  editor.gotoLine(1);
									  },10);
								};
								
								if (aceScript) {
									
								   
								  let iv = setInterval(function(){
									  if (window.ace) {
										 clearInterval(iv);
										 startEditor();
									  }
								  },100);
									
								} else {
									
									aceScript = document.createElement("script");
									aceScript.setAttribute('integrity',"sha512-NSbvq6xPdfFIa2wwSh8vtsPL7AyYAYRAUWRDCqFH34kYIjQ4M7H2POiULf3CH11TRcq3Ww6FZDdLZ8msYhMxjg==");
									aceScript.setAttribute('crossorigin',"anonymous" );
									aceScript.setAttribute('referrerpolicy',"no-referrer");
									aceScript.setAttribute('src',"https://cdnjs.cloudflare.com/ajax/libs/ace/1.15.2/ace.js");
									document.body.appendChild(aceScript);
									
									let iv = setInterval(function(){
										if (window.ace) {
										   clearInterval(iv);
										   startEditor();
										}
									},100);
								
								}
								
							}	   
						}},
						editing : {
							get : function() {
								return !!editor;
							}
						}
					}));
				}
			 }
		}

		xhr.responseType = 'text';
		xhr.open('GET', src);
		xhr.onreadystatechange = processRequest;
		xhr.send();

 }

  
  function restartTimer(useDuration) {
	thisDuration = useDuration ===undefined ? defaultDuration : useDuration;
	lastUpdateTick = 0;
	startedAt  = timeProvider.now();  
	if (wc_viewer) {
	    wc_viewer.reset();
	    setHtmlClass('video-track');
	} else {
	    clearHtmlClass('video-track');
	}
	endsAt	 = startedAt + thisDuration;
	pausedAt=undefined;
	pauseAcum=0;
	//thisDuration = defaultDuration;
	seekEndsAt = endsAt;
	startedDisp.textContent = local24HourTime ( timeProvider.date(startedAt) ); 
	endsDisp.textContent	=  local24HourTime ( timeProvider.date(endsAt) ); 
	durationDisp.textContent = secToStr(thisDuration / 1000);
	extraTimeDisp.textContent = "";
	
	
	writeNumber("pausedAt",pausedAt);
	writeNumber("pauseAcum",pauseAcum);
	
	writeNumber("startedAt",startedAt);
	writeNumber("endsAt",endsAt);
	writeNumber("seekEndsAt",seekEndsAt);
	clearHtmlClass("countup-override");
	clearHtmlClass("paused");
	setBarPct(0);

	if (timerAPI) {
		timerAPI.send( {
			setVariableValues:{
				startedAt:startedDisp.textContent,
				endsAt:endsDisp.textContent,
				default:durationDisp.textContent,
				paused:'0:00',
				pauses:'0:00',
				pausing:false,
				expired:false,
				showpresenter: html.classList.contains("reduced") ? '1' : '0',
				impending:thisDuration<=60000}
			});
	  }
  }
  
  // ─── Snapshot / restore (run sheet "Back") ─────────────────────────────────
  // Everything that defines the running countdown. Timestamps are absolute, so a
  // restored countdown carries on as if the change after the snapshot never happened.
  function captureTimerState() {
	  return {
		  startedAt, endsAt, seekEndsAt, thisDuration, defaultDuration,
		  pausedAt: pausedAt === undefined ? null : pausedAt,
		  pauseAcum,
		  message: currentCustomMessage(),
	  };
  }

  // Restores the countdown. The message is restored separately by the `restore`
  // API command (via `custommessage`), so it reaches the presenter screen too.
  function restoreTimerState(s) {
	  if (!s || !isFinite(s.startedAt)) return;
	  setDefaultDuration(s.defaultDuration);          // first: it may also set thisDuration
	  startedAt    = s.startedAt;
	  endsAt       = s.endsAt;
	  seekEndsAt   = s.seekEndsAt;
	  thisDuration = s.thisDuration;
	  pauseAcum    = s.pauseAcum || 0;
	  pausedAt     = (s.pausedAt === null || s.pausedAt === undefined) ? undefined : s.pausedAt;

	  writeNumber("startedAt", startedAt);
	  writeNumber("endsAt", endsAt);
	  writeNumber("seekEndsAt", seekEndsAt);
	  writeNumber("pauseAcum", pauseAcum);
	  writeNumber("pausedAt", pausedAt);
	  if (pausedAt !== undefined) setHtmlClass("paused"); else clearHtmlClass("paused");

	  startedDisp.textContent  = local24HourTime(timeProvider.date(startedAt));
	  endsDisp.textContent     = local24HourTime(timeProvider.date(seekEndsAt));
	  durationDisp.textContent = secToStr((seekEndsAt - startedAt) / 1000);
	  extraTimeDisp.textContent = "";
	  clearRemainClass("adjusting");
	  clearRemainClass("adjustingDown");
	  clearHtmlClass("adjusting_time");

	  lastUpdateTick = 0;
	  lastTimeText = "";                              // next tick re-derives over/impending and re-sends state
	  if (togglePIPMode) togglePIPMode.lastContent = "";
	  if (timerAPI) {
		  timerAPI.send({ setVariableValues: {
			  startedAt: startedDisp.textContent,
			  endsAt: endsDisp.textContent,
			  default: secToStr(defaultDuration / 1000),
			  pausing: pausedAt !== undefined,
		  }});
	  }
	  displayUpdate();
  }

  function setPresenterMode() {
	  runMode = "presenter";
	  html.classList.add("reduced");
	  if (timerAPI) {
		timerAPI.send( {setVariableValues:{showpresenter:  '1' }})   ;
	}
  }
  
  function setControllerMode() {
	  runMode = "controller";
	  html.classList.remove("reduced");
	  if (timerAPI) {
		timerAPI.send( {setVariableValues:{showpresenter:  '0' }});
	}
  }
 
 



function extendDefaultToCurrentTimer() {
	lastUpdateTick = 0;
	endsAt = startedAt + defaultDuration;
	thisDuration = defaultDuration;
	seekEndsAt = endsAt;
	writeNumber("endsAt",endsAt);
	writeNumber("seekEndsAt",seekEndsAt);
	durationDisp.textContent = secToStr(defaultDuration / 1000);
	displayUpdate();
}


function onLocalStorage(ev){
	 
	 if ((ev.key=== "remote-json") && ((runMode==="controller" || tabCount=== 1) && !isLinked ) ){
	     
	     const json =  localStorage.getItem("remote-json");
	     if (json) {
	         localStorage.removeItem("remote-json");
	         try {
	            const {cmd, msg, msecs, endTime } = JSON.parse(json);
	            
	            const doMsg = (msg)=>{
	                 if (typeof msg==='string') {
                        html.classList.remove("edit_custom_message");
                        if (msg.length===0) {
                            html.classList.remove("show_custom_message");
                        } else {
                        	html.classList.add("show_custom_message");
                        }
                    	custom_message.innerText=msg;
                    	custom_message.contentEditable=false;
                    }
	            };
	            
	            switch (cmd) {
	                
	                case 'custom' : 
	                    if (msg && msg.length>0) {
	                        html.classList.remove("edit_custom_message");
                        	html.classList.add("show_custom_message");
                        	custom_message.innerText=msg;
                        	custom_message.contentEditable=false;
	                    } else {
	                         html.classList.remove("edit_custom_message");
	                         html.classList.remove("show_custom_message");
	                         custom_message.innerText="";
                        	 custom_message.contentEditable=false;
	                    }
	                    break;
	                case 'restart' :
	                    restartTimer(msecs);
	                    doMsg (msg);
	                    
	                    break;
	                    
	                case 'timerTo' : {
    	                    const msecs = endTime - timeProvider.now();
    	                    restartTimer( msecs );
    	                    doMsg (msg);
        	                 
    	                }
	                    break;
	                case 'pause' : 
	                       onKey_Pause ();
	                       break;
	                case 'undoPause' : 
	                    onKey_UndoPause ();
	                    break;
	                    
	            }
	         } catch (error) {
	             
	             
	         }
	     }
	     
	     return;
	     
	 }
	 
	 if (runMode==="presenter" && (ev.key==="showbar"  ||  ev.key.startsWith("remainDisp"))){
		 
	   remainDisp.textContent = localStorage.getItem("remainDisp");
	   html.className  = localStorage.getItem("remainDispClass")+" reduced";
	   if ( readNumber("showbar",0)===1) {
		  setHtmlClass("showbar");
		  setBarPct(Number(localStorage.getItem("barpct")));
	   } else {
		   clearHtmlClass("showbar");
	   }	  
	 }  
	  
	 if (ev.key === "elapsedDisp"){
		elapsedDisp.textContent = localStorage.getItem("elapsedDisp");
	 }
	 
	 if (ev.key==="showtimenow" ) {
	 
		 if ( readNumber("showtimenow",0) === 1 ) {
		   setHtmlClass("showtimenow");
		 } else {
		   clearHtmlClass("showtimenow");
		   
		   
		 } 

	}
	
	  if (ev.key==="showmessages" ) {
	 
		 if ( readNumber("showmessages",0) === 1 ) {
		   setHtmlClass("showmessages");
		 } else {
		   clearHtmlClass("showmessages");
		 } 

	  }
	  
	  if (ev.key==="custom_message") {
		  let msg = localStorage.getItem("custom_message");
		  custom_message.textContent=msg;
		  if (msg==="") {
			  clearHtmlClass("show_custom_message");
		  } else {
			  setHtmlClass("show_custom_message");
		  }	
		  
	  }
	  
	  if (stylesheet1_obj && !stylesheet1_obj.editing && ev.key==="custom_css") {
		  
			let storedCss = localStorage.getItem("custom_css");
			if (storedCss) {
				stylesheet1_obj.css = storedCss;
			} else {
				stylesheet1_obj.reset();
			}
			
	  }
}

var lastHeartbeat = 0; // var (not let): getTabCount() is called before this line executes

function getTabCount(cont) {
	let dead = [];
	let count=1,tickNow = timeProvider.now(),oldest=tickNow - 3000;
   
	if (!cont && tickNow - lastHeartbeat > 1000) {
		lastHeartbeat = tickNow;
		writeNumber (tab_id,tickNow);
		if (runMode==="controller") {
			writeNumber ("controller_"+tab_id,tickNow);
		} else {
		   localStorage.removeItem ("controller_"+tab_id);
		}
	}
	
	for (let i=0; i< localStorage.length; i++) {
	   let key = localStorage.key(i);
	   if (key !== tab_id && key.startsWith("tab_")) {
			if (Number(localStorage.getItem(key)) < oldest ) {
			   dead.push(key);
			} else {
				if (cont) {
					if (readNumber ("controller_"+key,0)>0) {
					   count ++; 
					} 
				} else {
				   count ++;
				}
			}		   
		  
	   } else {
		   
			if ( key.startsWith("controller_tab_")) {
				if (Number(localStorage.getItem(key)) < oldest ) {
				  dead.push(key);
				} 
			}
	   } 
	   
	}
	dead.forEach(function(key){
	  localStorage.removeItem(key);
	});
	return count;
}

let custom_msg_timeout;

function onKey_Pause(ev) {
		const timeNow = timeProvider.now();
		html.classList.toggle("paused");
		lastTimeText="";
		if (togglePIPMode) togglePIPMode.lastContent="";
		if (html.classList.contains("paused")) {
			pausedAt = timeProvider.now();
			writeNumber("pausedAt",pausedAt);
			endsAt = seekEndsAt;
			const pauseAccumText = secToStr(pauseAcum / oneSecond);
			extraTimeDisp.textContent = "+ "+pauseAccumText+" pauses";
			if (timerAPI) {

				timerAPI.send( {
					setVariableValues:{
						default:secToStr(defaultDuration/1000),
						pausing:true,
						pauses:pauseAccumText,
						paused:'0:00'
					}
				} );
			}
		} else {
			let pausedMsec = pausedAt ? timeNow-pausedAt : 0;
			pausedAt = undefined;
			seekEndsAt += pausedMsec;
			pauseAcum += pausedMsec;
			writeNumber("pausedAt",pausedAt);
			writeNumber("pauseAcum",pauseAcum);

			const pauseAccumText = secToStr(pauseAcum / oneSecond);

			extraTimeDisp.textContent = "+ "+pauseAccumText+" pauses";
	 
			endsAt = seekEndsAt;
			endsDisp.textContent = local24HourTime ( timeProvider.date(seekEndsAt) );
			if (timerAPI) {

				timerAPI.send( {
					setVariableValues:{
						default:secToStr(defaultDuration/1000),
						endsAt:endsDisp.textContent,
						pausing:false,
						pauses:pauseAccumText,
						paused:'0:00'
					}
				} );

			}
			
		}
}

function onKey_UndoPause (ev) {
	// Guard: nothing to undo if not paused and no accumulated pause time
	if (!html.classList.contains("paused") && pauseAcum === 0) return;
	   
	clearHtmlClass("paused");
	pausedAt = undefined;
	pauseAcum = 0;
	writeNumber("pausedAt",pausedAt);
	writeNumber("pauseAcum",pauseAcum);
	extraTimeDisp.textContent = "";
	
	seekEndsAt = startedAt + thisDuration;
	endsAt = seekEndsAt;
	endsDisp.textContent = local24HourTime( timeProvider.date(seekEndsAt) ) ;

	if (timerAPI) {
		timerAPI.send ( {
			setVariableValues:{
				endsAt:endsDisp.textContent,
				pauses:'0:00',
				paused:'0:00'}} );
	}
		
}

function  onKey_ArrowDown(ev) {
    
			  
		bumpEnd(0-seekEndDelta,0-endDelta);
		durationDisp.textContent = secToStr((seekEndsAt-startedAt) / 1000);
		displayUpdate();
	
}

function  onKey_Shift_ArrowDown(ev) {
				  
	bumpStart(nudgeFactor);
	durationDisp.textContent = secToStr((seekEndsAt-startedAt) / 1000);
	displayUpdate();

}

function  onKey_ArrowUp(ev) {
	 bumpEnd(seekEndDelta,endDelta);
	 durationDisp.textContent = secToStr((seekEndsAt-startedAt) / 1000);
	 displayUpdate();
}

function  onKey_Shift_ArrowUp(ev) {
	 bumpStart(0-nudgeFactor);
	 durationDisp.textContent = secToStr((seekEndsAt-startedAt) / 1000);
	 displayUpdate();
}

function onKey_ArrowLeft(ev) {

	bumpStart(0-nudgeFactor);
	bumpEnd(0-seekEndDelta,0-endDelta);
	
	durationDisp.textContent = secToStr((seekEndsAt-startedAt) / 1000);
	displayUpdate();

}
 
function onKey_ArrowRight(ev) {



	bumpStart(nudgeFactor); 
	bumpEnd(seekEndDelta,endDelta);
	
	durationDisp.textContent = secToStr((seekEndsAt-startedAt) / 1000);
	displayUpdate();
}

 
function onKey_Ctrl_Q(ev) {
   
	if (is_nwjs()) {
		require('nw.gui').App.quit();
	}
	
}


function onKey_Space(ev) {
 
	const preserve_default = defaultDuration;
		
	saveEditedTime();
	restartTimer();
		
	if (defaultDuration !== preserve_default) {
		defaultDuration = preserve_default;
		dispNextMins.textContent = secToStr(defaultDuration/1000);
		clearHtmlClass("editing");
		writeNumber("defaultDuration",defaultDuration);
	}
	

}

function onKey_Shift_Space(ev) {
 
	const preserve_default = defaultDuration;
	
	saveEditedTime();
	
	extendDefaultToCurrentTimer();
	
	if (defaultDuration !== preserve_default) {
		defaultDuration = preserve_default;
		dispNextMins.textContent = secToStr(defaultDuration/1000);
		clearHtmlClass("editing");
		writeNumber("defaultDuration",defaultDuration);
	}
	
}

function onKey_Control_Space(ev) {
	catchUpNow();
}

// "Catch up": jump straight to the adjusted end time instead of easing towards it.
// Used by Ctrl+Enter, Ctrl+Space, the catch up button and the `catchup` API command.
function catchUpNow() {
	lastUpdateTick = 0;
	endsAt = seekEndsAt;
	clearRemainClass("adjusting") ;
	clearRemainClass("adjustingDown") ;
	clearHtmlClass("adjusting_time");
	keyDisp.textContent = tabCount+" tabs open";
	lastTimeText="";   // force the next tick to re-send state (clears adjusting flags downstream)
	writeNumber("endsAt",endsAt);
}

let videoFrameTimer;

function hideFSVideoAfterTimeout () {
    if (videoFrameTimer) {
        clearTimeout(videoFrameTimer);
        videoFrameTimer = undefined;
    }
    clearHtmlClass("video-live-fullscreen");
	clearHtmlClass("video-start-fullscreen");
	if (wc_viewer) {
        wc_viewer.updateTimestamp(wc_viewer.getTimestamp());
	}
    clearHtmlClass("video-live-fullscreen");
	clearHtmlClass("video-start-fullscreen");}

function onVideoUpdate () {
    if (videoFrameTimer) {
		clearTimeout(videoFrameTimer);
		videoFrameTimer = undefined;
    }
	if (wc_viewer.showingLive() &&  html.classList.contains("video-auto") ) {	
        clearHtmlClass("video-live-fullscreen");
        setHtmlClass("video-start-fullscreen");
	    videoFrameTimer = setTimeout(hideFSVideoAfterTimeout,2000);
	}
	
}

function onVideoReset () {
    onVideoUpdate ();
}

function onKey_V(ev) {
   // V by itself = toggle live view
    if (!wc_viewer) {   
			wc_viewer = createTimestampViewer(wc_videoElement,wc_canvas,wc_canvas2,wc_canvas3);
			wc_viewer.on('update',onVideoUpdate);
			wc_viewer.on('reset',onVideoReset);
		    setHtmlClass('video-track');
		    clearHtmlClass("video-auto");
	} else {
		wc_viewer.showLive(!wc_viewer.showingLive());
		setHtmlClass('video-track');
		clearHtmlClass("video-auto");
    }
    clearHtmlClass("video-live-fullscreen");
    clearHtmlClass("video-start-fullscreen");
}

function onKey_Shift_V(ev) {
	if (!wc_viewer) {   
		
			wc_viewer = createTimestampViewer(wc_videoElement,wc_canvas,wc_canvas2,wc_canvas3);
			wc_viewer.on('update',onVideoUpdate);
			wc_viewer.on('reset',onVideoReset);
			clearHtmlClass("video-live-fullscreen");
			clearHtmlClass("video-start-fullscreen");
			setHtmlClass('video-track');
	
	} else {
		// shift V = choose next camera
		wc_viewer.nextCamera();
	}
}



function onKey_Control_V(ev) {
	if (!wc_viewer) {   
		wc_viewer = createTimestampViewer(wc_videoElement,wc_canvas,wc_canvas2,wc_canvas3);
		wc_viewer.on('update',onVideoUpdate);
		wc_viewer.on('reset',onVideoReset);
		clearHtmlClass("video-start-fullscreen");
		setHtmlClass("video-live-fullscreen");
		wc_viewer.showLive(true);
		setHtmlClass("video-auto");
		setHtmlClass('video-track');
	} else {
	
		if (wc_viewer.getTimestamp()) {
		    
		    if (html.classList.contains("video-auto")) {
                clearHtmlClass("video-auto");
                hideFSVideoAfterTimeout ();
		    } else {
		        setHtmlClass("video-auto");
		        wc_viewer.showLive(true);
		
		    }

	        onVideoUpdate ();
	
		} else {
	    	setHtmlClass("video-live-fullscreen");
	    	clearHtmlClass("video-start-fullscreen");
    		setHtmlClass('video-track');
	    	toggleHtmlClass('video-auto');
	    	if (html.classList.contains('video-auto')) {
	            wc_viewer.showLive(true);
	    	}	
    		onVideoUpdate ();
		}
	}
}

function onKey_Control_Shift_V(ev) {
	if (wc_viewer) {   
		// ctrl-shift-v = stop using video mode
		hideFSVideoAfterTimeout ();
		 wc_viewer.stop();
		 wc_viewer=undefined;
		 
	 }
	 
	 if (window.top.flyoutVideoWin) {
		 window.top.flyoutVideoWin.close();
		 window.top.flyoutVideoWin = undefined;
	 }
	  
	clearHtmlClass("video-live-fullscreen");
	clearHtmlClass("video-start-fullscreen");
	clearHtmlClass('video-track');
	clearHtmlClass('video-auto');
	wc_canvas.style.display="none";
	wc_canvas2.style.display="none";
	wc_canvas3.style.display="none";
	
}

function onKey_Control_Shift_W(ev) {
	if (wc_viewer) {   
		// ctrl-shift-v = stop using video mode
		hideFSVideoAfterTimeout ();
		 wc_viewer.stop();
		 wc_viewer=undefined;
		 
	 }
	 clearHtmlClass('video-track');
}
function onKey_Shift_W(ev) {
    if (!wc_viewer) {   
		wc_viewer = createTimestampViewer(wc_videoElement,wc_canvas,wc_canvas2,wc_canvas3,true);
		wc_viewer.on('update',onVideoUpdate);
		wc_viewer.on('reset',onVideoReset);
		clearHtmlClass("video-live-fullscreen");
		clearHtmlClass("video-start-fullscreen");
	    setHtmlClass('video-track');
	} else {
	    wc_viewer.useScreenCapture();
        clearHtmlClass("video-live-fullscreen");
        clearHtmlClass("video-start-fullscreen");
	}
}

function onKey_W (ev) {

}

function onKey_Control_W (ev) {

}


function onKey_M (ev) {
	html.classList.toggle("showmessages");
	writeNumber("showmessages",html.classList.contains("showmessages") ? 1 : 0);
	if (togglePIPMode) togglePIPMode.lastContent="";
	lastTimeText = "";
}

function onKey_B(ev) {
	const toggledState = html.classList.contains("showbar") ? 0 : 1;
	html.classList.toggle("showbar");
	writeNumber("showbar",toggledState);
}

function onKey_T(ev) {
	const toggledState = html.classList.contains("showtimenow") ? 0 : 1;
	html.classList.toggle("showtimenow");
	writeNumber("showtimenow",toggledState);
}

function onKey_O (ev) {
	if (togglePIPMode) togglePIPMode();
}

function onKey_P (ev) {
   

	if (window.location.search !== "?presenter" &&  tabCount === 1) {
		html.classList.toggle("reduced");
		const isPres = html.classList.contains("reduced");
		runMode = isPres ? "presenter":"controller";

		if (timerAPI) {
			timerAPI.send(  {setVariableValues:{showpresenter: isPres ? '1' : '0' }});
		}
	}
	html.classList[ html.classList.contains("reduced") ? "remove" : "add"]("showbuttons");

}

function onKey_S (ev) {
 
	if (window.location.search !== "?presenter" &&  tabCount === 1) {
		html.classList.add("reduced");
		html.classList.add("showbuttons");
		runMode = "presenter";
		if (!fs_api.isFullscreen()) {
			fs_api.enterFullscreen();  
			}

		if (timerAPI) {
			timerAPI.send({setVariableValues:{showpresenter: '1' }});
		}
	}

			
}

function onKey_Control_S (ev) {
 
			
  
	if (stylesheet1_obj) {
	   stylesheet1_obj.editToggle();
	}
	ev.preventDefault();
  
	
}

function onKey_Control_Shift_S (ev) {
 
	if (stylesheet1_obj) {
		stylesheet1_obj.reset();
		if (stylesheet1_obj.editing) {
			stylesheet1_obj.editToggle();
		}
	}
	ev.preventDefault();
	
}

function onKey_X (ev) {
	extendDefaultToCurrentTimer();
}

function onKey_C (ev) {
				 
	html.classList.add("edit_custom_message");
	html.classList.remove("show_custom_message");
	custom_message.innerText="custom message";
	custom_message.contentEditable=true;
	custom_message.focus();
	ev.preventDefault();			
		 
}

function onKey_R ( ev ) {

	if (!controlling) {
		ev.preventDefault();
		if (!isSingleScreenMode() && !(runMode === "presenter" && tabCount===1)) {
			openTimerWindow(tabCount>1);
		}
	}
}


function onDocKeyDown(ev){

	const checkModifiers = function(){
		controlling = ev.ctrlKey;
		html.classList[controlling?"add":"remove"]("controlling");
		shifting = ev.shiftKey;
		html.classList[shifting?"add":"remove"]("shifting");
		alting = ev.altKey;
		html.classList[alting?"add":"remove"]("alting");
		 
	};
   
   if (html.classList.contains("edit_custom_message")) {
	   
		if  ( ev.key === "Enter") {
			   custom_message.contentEditable=false;
			   html.classList.remove("edit_custom_message");
			   if (custom_message.textContent==="custom message") {
				   html.classList.remove("show_custom_message");
				   localStorage.setItem("custom_message","");
				   
			   } else {
				   html.classList.add("show_custom_message");
				   custom_msg_timeout = setTimeout(function(){
					   custom_msg_timeout = undefined;
					   localStorage.setItem("custom_message",custom_message.textContent);
				   },500);
			   }
		}
	   return checkModifiers();
   } else {
	   if (html.classList.contains("show_custom_message")) {

			if  ( ev.key ==="c" || ev.key==="C") {
			   html.classList.remove("edit_custom_message");
			   html.classList.remove("show_custom_message");
			   if (custom_msg_timeout) {
				   clearTimeout(custom_msg_timeout);
				   custom_msg_timeout = undefined;
			   }
			   localStorage.setItem("custom_message","");
			   return checkModifiers();		   
			   
			}

	   }
   }
   
   
   if (stylesheet1_obj && stylesheet1_obj.editing) {
	   
	   if ( (ev.key === "S" || ev.key === "s")  && ev.ctrlKey ) {
			ev.preventDefault();
			stylesheet1_obj.editToggle();
			if (ev.shiftKey) {
				stylesheet1_obj.reset();
			}
	   }
	   
	   return checkModifiers();
	   
   }
   
	tabCount = getTabCount()  ;
	 
	nudgeFactor = controlling ? 60000 : 1000;
	
	endDelta	 =  controlling ? 60000 : 0;
	seekEndDelta =  controlling ? 60000 : 1000;
	
	
	if (typeof ev.key === 'string' && ( ( ev.key >= 1 && ev.key <=9) || ev.key=== "0") ) {
	   enterTimeText = enterTimeText + "" + ev.key;
	   setHtmlClass("editing");
	   updateEnteredTimeText () ;
	} else {
		
		switch ( ev.key ) {
			
			case "/"://numkeypad
			case '"': return onKey_Pause(ev);
				
			case "Tab":  //numkeypad 
			case "'":  return onKey_UndoPause (ev);
				
			case ".":
				 if ( (enterTimeText !== "") && (enterTimeText.indexOf(".") <0 ) ) {
					 
					 enterTimeText = enterTimeText + ev.key;
					 setHtmlClass("editing");
					 updateEnteredTimeText () ;
					 
				}
				break;
				
			case ":":
				if (enterHoursText === "") {
					enterHoursText = enterTimeText;
					enterTimeText  = "";
					setHtmlClass("editing");
					dispNextMins.textContent = secToStr((Number(enterHoursText) * 3600) + (Number(enterTimeText) * 60));
				}
				break;
			case "Backspace" :
				if (enterTimeText !== "" ) {
					enterTimeText = enterTimeText.substr(0,enterTimeText.length-1);
					updateEnteredTimeText () ;
				} else {
					clearHtmlClass("editing");
					dispNextMins.textContent = secToStr(defaultDuration/1000);
					
				}
				break;
			case "Enter" : 
				
				if (controlling) {
					  catchUpNow();
				 } else {	  
					saveEditedTime();
				 }				
				
				break;

			case "q":
			case "Q":
					if (controlling) {
						onKey_Ctrl_Q(ev);
					}
	
					break;
				
			
			case "ArrowDown" : 
				
				if (!html.classList.contains("editing") ) {
					if (shifting) {
						onKey_Shift_ArrowDown(ev)
					} else {
						onKey_ArrowDown(ev)
					}					 
				} 

				break;
		   
			case "ArrowUp" : 
				 
				if (!html.classList.contains("editing") ) {
					if (shifting) {
						onKey_Shift_ArrowUp(ev);
					} else {
						onKey_ArrowUp(ev);
					}					 
				} 
				
				break;			
			
			case "ArrowLeft": 

				if (!html.classList.contains("editing") ) {
						onKey_ArrowLeft(ev);
				} 
				break; 

		   
			case "ArrowRight": 

				if (!html.classList.contains("editing") ) {
						onKey_ArrowRight(ev);
				} 
				
			  break;

			case "Shift" : {
				shifting = true; 
				setHtmlClass("shifting");
				

				break;
			}
			
			case "Control" : 
				controlling = true; 
				setHtmlClass("controlling");
				break ;
				
			case "Alt" : 
			    alting = true;
			    setHtmlClass("alting");
			    break;
			case "i":
			case "I":
				if (controlling && shifting) {
				   ev.preventDefault();
				}
				break;  
			case "F":
			case "f":  
				  if (!controlling) {	  
					 if (fs_api.isFullscreen()) {
						fs_api.exitFullscreen();
					} else {
						fs_api.enterFullscreen();  
					} 
				  }
				  break;
				  
			case "b":
			case "B": 
				if (!controlling) {onKey_B(ev);}
				break;
				
			case "PageDown":
			    if (!controlling && powerPointMode) {
			       onKey_Space(ev);   
			    }
			    break;
			case "*":// numkey pad use
			case " ":
				
				 if (controlling) {
					onKey_Control_Space(ev);
				 } else {	  
					if (shifting)  {
					   onKey_Shift_Space(ev);
					} else {
					   onKey_Space(ev);
					}
				 }

				break;
				
		   case "_" : 
		       if (bracketBump < oneMinute) {
		           bracketBump = oneMinute;
		       } else {
		           bracketBump = oneSecond;
		       }
		       break;
				
		  case "(" : 
		      nudgeDefaultDuration( - bracketBump );
		      break;
		  case ")" : 
		      nudgeDefaultDuration( bracketBump );
		      break;
								
		  case "{" : 
		      nudgeDefaultDuration( - 60000 );
		      break;
		  case "[" :
		      nudgeDefaultDuration( - 1000 );
		      break;
		  case "}" : 
		      nudgeDefaultDuration( 60000 );
		      break;
		  case "]" :
		      nudgeDefaultDuration( 1000 );
		      break;
				
			case "m":
			case "M":
				if (!controlling){ onKey_M (ev);}
				break;
				
			case "l":
			case "L": 
			     if (!controlling) {
			 	       if (shifting) {
			                timeProvider.useLocal();
			         } 
			     }
			    break;
				
			case "t":
			case "T": 
			    
			 	 if (!controlling) {
			 	     
			 	     if (shifting) {
			            timeProvider.resync();
    			     } else {
    			        onKey_T(ev) ;
    			     }
				
			    }
			    
				break;
				
			case "v":
			    
			case "V":
			    if (window.location.search !== "?presenter") {
			        
			        if (controlling) {
			            if (shifting) {
			                onKey_Control_Shift_V (ev);
						} else {
							onKey_Control_V (ev);
						}
			        } else {
			            if (shifting) {
			              
			                onKey_Shift_V (ev);
			                
			            } else {
			                onKey_V (ev);
			            }
			        }
			        
    			   

			    }			    
			    break;
			 case "w" :
			 case "W" :
			     
			     if (window.location.search !== "?presenter") {
					 
					 	 if (shifting) {
        				    onKey_Shift_W (ev);
            			 }
				 
					
 
				 }				
				 break;

			case "o":
			case "O":
				if (!controlling) {onKey_O (ev);}
				break;

			case "p":
			case "P":				
				if (!controlling) {onKey_P (ev);}
				break;

			case "s":
			case "S":
				
				if (controlling) {
				   
					if (shifting) {
						onKey_Control_Shift_S (ev);
					} else {
						onKey_Control_S (ev);
					}
				
				} else {
				
					onKey_S (ev);
				}
				break;
				
			case "x":
			case "X": // extend current timer to default time
				if (!controlling) { onKey_X (ev); }
				break;
				
			case "c":
			case "C":
				if (!controlling) { onKey_C (ev); }			  
				break;

			case "R":
			case "r":

				if (!controlling) {
					onKey_R ( ev ) ;
				}
				break;
				
			case "^" : powerPointMode = !powerPointMode;

	  
	}}
}


function isSingleScreenMode() {
	if ( window.location.search.startsWith("?presenter") )  {
		return false;
	}
	return html.classList.contains("reduced") && 
		   html.classList.contains("showbuttons") &&
		   runMode === "presenter";
}


	function setDefaultDuration(msecs) {
		defaultDuration = msecs;
		if (timeProvider.now()-startedAt<0) { 
			// if editing a future start time
			thisDuration = defaultDuration;
		}
		enterTimeText  = "";
		enterHoursText = "";
		
		dispNextMins.textContent = secToStr(defaultDuration/1000);
		clearHtmlClass("editing");
		writeNumber("defaultDuration",defaultDuration);

	}

	function saveEditedTime(){
		if (  (enterTimeText !== "" ) ) {
			setDefaultDuration  ( ((Number(enterHoursText) * 3600) + (Number(enterTimeText) * 60) ) * 1000);

			if (timerAPI) {
				timerAPI.send( {setVariableValues:{default:dispNextMins.textContent}});
			}

			
		 }
	}
	
	function nudgeDefaultDuration( msec ) {
	    if  (defaultDuration + msec >= 0) {
	        setDefaultDuration ( defaultDuration + msec);
	    }
	}
		
	function onDocKeyUp(ev){
		controlling = ev.ctrlKey;
		html.classList[controlling?"add":"remove"]("controlling");
		shifting = ev.shiftKey;
		html.classList[shifting?"add":"remove"]("shifting");
		alting = ev.altKey;
		html.classList[alting?"add":"remove"]("alting");
		
	 
	}

/* 
add milliseconds to the start time
 */
	function bumpStart(milliseconds){
		startedAt += milliseconds;   
		startedDisp.textContent = local24HourTime( timeProvider.date(startedAt) );
		writeNumber("startedAt",startedAt);
		lastTimeText="";
		if (timerAPI) {
			timerAPI.send ({setVariableValues:{startedAt:startedDisp.textContent}});
		}
		if (wc_viewer) {
		    wc_viewer.updateTimestamp(startedAt);
		}
	}
	
	function bumpEnd(seekEndDelta,endDelta) {
	   seekEndsAt += seekEndDelta;
	   endsAt	 += endDelta;
	   
	   thisDuration = seekEndsAt-startedAt;
	
	   endsDisp.textContent	= local24HourTime( timeProvider.date(seekEndsAt) );
	   writeNumber("seekEndsAt",seekEndsAt);
	   lastTimeText="";
	   if (timerAPI) {
		timerAPI.send( {setVariableValues:{endsAt:endsDisp.textContent}}) ;
	   }
   }


	function setBarPct(pct) {
		progress.style.width  = pct + '%';
		localStorage.setItem("barpct",pct.toString());
	}
	
	function setBar(elapsed,total) {
		let pct = Math.floor((elapsed/total) *100);
		setBarPct(pct);
	}
	   
  
  function readNumber(nm,def) {
	  let str =  localStorage.getItem(nm);
	  return str ? Number (str) : def;
  }
  
  function writeNumber(nm,val) {
	  if (val===undefined) {
		  localStorage.removeItem(nm);
	  } else {
		  localStorage.setItem(nm,val.toString());
	  }

	  if (timerAPI && ["showtimenow","showmessages","showbar"].indexOf(nm)>=0) {
		const vars = {};
		vars[nm]=val.toString()||'0';
		timerAPI.send( {setVariableValues:vars} ); 
	  }
  }
  
  function msecToStr(msec) {
      let sec = Math.floor(msec / 1000) % 86400;// convert to seconds, ignore any year/month/day component
	  return secToStr(sec);
  }

  function secToStr(sec) {
	  let prefix = sec < 0 ? "-" : "";
	  if (sec<0) {
		  sec=0-sec;
	  }
	  let min = Math.trunc(sec / 60 ) % 60;
	  let hr  = Math.trunc(sec / 3600 );
	  let sx  = Math.trunc(sec % 60);
	  
	 
	  let sx_  = (sx < 10 ? "0" : "") + sx.toString();
	  if (hr < 1 ) {
		   let min_ = min.toString();
		   return prefix + min_+":"+sx_;
	  }
	  let min_ = (min < 10 ? "0" : "") + min.toString();
	  let hr_  = hr.toString();
	  return prefix+hr_+":"+min_+":"+sx_;
  }

  function local24HourTime(dt) {
	 return dt.toLocaleTimeString('en-GB', {
	   hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
	 });
  }
  
  function timeNowStr() {
	  let when = timeProvider.date();
	  return local24HourTime(when);
  }
  
  function setRemainClass(cls) {
	  if ( ! remainDisp.classList.contains(cls) )remainDisp.classList.add(cls);
  }

  function clearRemainClass(cls) {
	  if ( remainDisp.classList.contains(cls) ) remainDisp.classList.remove(cls);
  }
  
  function toggleRemainClass(cls) {
	   remainDisp.classList.toggle(cls);
  }


  function setHtmlClass(cls) {
	  if ( ! html.classList.contains(cls) ) html.classList.add(cls);
  }

  function clearHtmlClass(cls) {
	  if ( html.classList.contains(cls) ) html.classList.remove(cls);
  }

  function toggleHtmlClass(cls) {
	  if ( ! html.classList.contains(cls) ) {
	      html.classList.add(cls);
	  } else {
	      html.classList.remove(cls);
	  } 
  }
  
 
  function onTimerWinUnload(){
	  localStorage.removeItem (timerWin.tab_id);
	  timerWin=undefined;
  }
  
  function onControlUnload () {
	 if (timerWin) {
		timerWin.close();
		timerWin = undefined;
	 }
	 
	 if (window.top.flyoutVideoWin) {
		window.top.flyoutVideoWin.close();
		window.top.flyoutVideoWin = undefined;
	 }
	 
	 if ( window.top.flyoutPlayerWin ) {
	     if (window.top.flyoutPlayer.src && window.top.flyoutPlayer.src.startsWith('blob:')) {
            URL.revokeObjectURL(window.top.flyoutPlayer.src);        
	     }
	   
	      window.top.flyoutPlayer.src='';
	      if (window.top.flyoutPlayerBtn) {
	        window.top.flyoutPlayerBtn.parentNode.removeChild(window.top.flyoutPlayerBtn);
	        window.top.flyoutPlayerBtn = undefined;
	      }
	      
	      if (window.top.flyoutPlayerHideBtn) {
	        window.top.flyoutPlayerHideBtn.parentNode.removeChild(window.top.flyoutPlayerHideBtn); 
            window.top.flyoutPlayerHideBtn = undefined;
	      }
	      
	      if (window.top.flyoutPlayerCloseBtn) {
			window.top.flyoutPlayerCloseBtn.parentNode.removeChild(window.top.flyoutPlayerCloseBtn); 
			window.top.flyoutPlayerCloseBtn = undefined;
		  }
		  
		  
		  
	 }
	 
	 localStorage.removeItem (tab_id);
	 localStorage.removeItem ("controller_"+tab_id);
  }
  

  function is_nwjs(){
	try{
		return (typeof require('nw.gui') !== "undefined");
	} catch (e){
		return false;
	}
 }

if (
	(runMode !== 'presenter') && 
	(location.protocol === 'http:' && !location.hostname.endsWith('.com')) &&
	(typeof startTimerApi === 'function') ) {
	startTimerApi();
}


 