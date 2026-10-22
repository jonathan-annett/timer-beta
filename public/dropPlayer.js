/*
  jshint maxerr: 1000000
*/ 
/*

global processTimerApiMessage

*/


function onDroppedVideoURL(dropzone,handleURL) {
    
    let revokeable;

    // Prevent default behavior for drag and drop events on the dropzone
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, preventDefaults, false);
        // Only prevent body-level drop to stop browser opening files accidentally
        if (eventName === 'drop') {
            document.body.addEventListener(eventName, preventDefaults, false);
        }
    });

    function preventDefaults (e) {
        e.preventDefault()
        e.stopPropagation()
    }
    
    if (dropzone!==document.body) {
        // Highlight dropzone when file dragged over
        dropzone.addEventListener('dragenter', () => {
            dropzone.style.borderColor = '#333';
        });
    
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '#aaa';
        });
    }
    
    // Handle dropped files or URL
    dropzone.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        
        if (revokeable) {
          URL.revokeObjectURL(revokeable);
          revokeable=null;
        }
        
        let dataTransfer = e.dataTransfer;
        const files = dataTransfer.files;
    
        // Filter dropped files to accept only video types
        const videoFiles = Array.from(files).filter(file => file.type.startsWith('video/'));
    
        if (videoFiles.length > 0) {
            handleFiles(videoFiles);
        } else if (dataTransfer.getData('URL')) {
            handleURL(dataTransfer.getData('URL'));
        }
        if (dropzone!==document.body) {
            dropzone.style.borderColor = '#aaa';
        }
    }

    function handleFiles(files) {
        const file = files[0];
        
       
        revokeable = URL.createObjectURL(file);
        
        handleURL( revokeable );

    }
    
    window.addEventListener('unload',function(){
        if (revokeable) {
          URL.revokeObjectURL(revokeable);
          revokeable=null;
        }
    });


}


window.top.setupPlayerButtons = setupPlayerButtons;

onDroppedVideoURL(document.body,function(url) {
    openPlayerWindow(url);
});


function openPlayerWindow(videoUrl) {
 
  if (window.top.flyoutPlayerWin && window.top.loadVideoURL) {
     window.top.loadVideoURL(videoUrl);
  } else {
      
     const htmlContent = `
<html>

    <head>
    <style>
    
	    :root {
            --color-main-background : black;
	    }
        
        body {

            background-color:var(--color-main-background);
            background:var(--color-main-background);
            overflow: hidden; 
            user-select: none;    
        }
        
        body.fullscreen {
            cursor: none;
            
        }

         :backdrop { background-color:var(--color-main-background); background:var(--color-main-background);} 
         ::backdrop { background-color:var(--color-main-background); background:var(--color-main-background);} 
         :-ms-fullscreen { background-color:var(--color-main-background); background:var(--color-main-background);} 
         :-moz-full-screen { background-color:var(--color-main-background); background:var(--color-main-background);} 
         :-webkit-full-screen { background-color:var(--color-main-background); background:var(--color-main-background);} 
         ::fullscreen { background-color:var(--color-main-background); background:var(--color-main-background);} 
         :fullscreen { background-color:var(--color-main-background); background:var(--color-main-background);} 


        video {
            position : absolute;
            left : 0;
            top : 0;
            width : 100vw;
            height : auto;
        }
        
       

        
    </style>
    </head>
    <body>
    <script src="fsapi.js"></script>
     <video></video>
        
              
        <script>
        
       
        
        ${onDroppedVideoURL.toString()}
        
        ${openDatabase.toString()}
        ${storeBlob.toString()}
        ${retrieveBlob.toString()}
        

        window.opener.top.flyoutPlayer=document.querySelector("video");

        document.addEventListener('keydown', function(event) {
        
              
		   if (fs_api) {
				   if (event.key.toLowerCase() === "f"  ) {
				   if (!(event.ctrlKey || event.shiftKey)) {	  
					   event.preventDefault();
					   event.stopPropagation();
					 if (fs_api.isFullscreen()) {
						 fs_api.exitFullscreen();
					 } else {
						 fs_api.enterFullscreen();  
					 } 
				   }
			   }
			   
		   }
		   

             // Capture the keystroke
             var keystroke = {
                key      : event.key,
                shiftKey : event.shiftKey,
                ctrlKey  : event.ctrlKey,
                altKey   : event.altKey
             };
            
             // Send the keystroke to the parent window
             window.opener.top.postMessage({ type: 'keydown', value: keystroke }, '*');
             
        });
        
        document.addEventListener('keyup', function(event) {
        
             // Capture the keystroke
             var keystroke = {
                key      : event.key,
                shiftKey : event.shiftKey,
                ctrlKey  : event.ctrlKey,
                altKey   : event.altKey
             };
            
             // Send the keystroke to the parent window
             window.opener.top.postMessage({ type: 'keyup', value: keystroke }, '*');
             
        });
        
        onDroppedVideoURL(document.body,loadVideoURL);
        
        window.opener.top.loadVideoURL = loadVideoURL;
        
        loadVideoURL("${videoUrl}");
		
		
        function loadVideoURL(url){

            window.opener.top.flyoutPlayer.src = url;
			window.opener.top.setupPlayerButtons();

		}
		
		function blobToDataURL(blob, callback) {
		  var reader = new FileReader();
		  reader.onload = function(e) {
			callback(e.target.result);
		  };
		  reader.readAsDataURL(blob);
		}
		
		
        </script>
    </body>
</html>
   
`; 
      
	 window.top.flyoutPlayerWin = open("", 'video_player_window', "location=0");
	 if (window.top.flyoutPlayerWin) {
	    window.top.flyoutPlayerWin.document.open();
        window.top.flyoutPlayerWin.document.write(htmlContent);
        window.top.flyoutPlayerWin.document.close();
		window.top.flyoutPlayerWin.addEventListener ("load",function(){
			console.log("player win loaded");
			window.top.flyoutPlayerWin.addEventListener ("unload",onPlayerWinUnload);
		});
		
		 window.addEventListener('message', function(event) {
            // Check if the message is from the child window and contains keystroke data
            if (event.source === window.top.flyoutVideoWin && [ 'keydown', 'keyup' ].indexOf( event.data.type)>=0 ) {
                // Dispatch the simulated event on a specific element in the opener window
                document.dispatchEvent( new KeyboardEvent(event.data.type,  event.data.value ));
            }
        });
        
	 }
	 
	 
 }
 

 
  return false;
}

function setupPlayerButtons() {
    
    if (!window.top.flyoutPlayerBtn) {
			window.top.flyoutPlayerBtn = window.top.document.createElement('button');
			window.top.flyoutPlayerBtn.textContent = "play";
			window.top.flyoutPlayerBtn.className = "flyoutPlayerBtn";
			window.top.document.body.appendChild(window.top.flyoutPlayerBtn);
	}
	
	if (!window.top.flyoutPlayerHideBtn) {
			window.top.flyoutPlayerHideBtn = window.top.document.createElement('button');
			window.top.flyoutPlayerHideBtn.textContent = "hide";
			window.top.flyoutPlayerHideBtn.className = "flyoutPlayerHideBtn";
			window.top.document.body.appendChild(window.top.flyoutPlayerHideBtn);
	}
	
	if (!window.top.flyoutPlayerCloseBtn) {
			window.top.flyoutPlayerCloseBtn = window.top.document.createElement('button');
			window.top.flyoutPlayerCloseBtn.textContent = "close";
			window.top.flyoutPlayerCloseBtn.className = "flyoutPlayerCloseBtn";
			window.top.document.body.appendChild(window.top.flyoutPlayerCloseBtn);
	}

		
		
	 window.top.flyoutPlayerBtn.onclick = function () {
		 window.top.flyoutPlayerOpacity = window.top.flyoutPlayer.style.opacity;
		 
		 window.top.flyoutPlayer.style.opacity=1;
		 window.top.flyoutPlayer.play();
		 processTimerApiMessage({cmd:"start",msecs:Math.floor(1000*window.top.flyoutPlayer.duration)});
		 processTimerApiMessage({cmd:"custommessage",text:"Video Playback"});
		  
		 window.top.flyoutPlayer.onended = function () {
			 
			   if (window.top.flyoutPlayer.src.startsWith('blob:')) {
				   URL.revokeObjectURL(window.top.flyoutPlayer.src);
				}
			 
				window.top.flyoutPlayer.src = '';
				processTimerApiMessage({cmd:"custommessage",text:""});
				processTimerApiMessage({cmd:"start",msecs:0});
				processTimerApiMessage({cmd:"pause"});
				
			   
		  };
		  
		 window.top.flyoutPlayerBtn.parentNode.removeChild(window.top.flyoutPlayerBtn); 
		 window.top.flyoutPlayerBtn = undefined;
		 window.top.flyoutPlayerHideBtn.parentNode.removeChild(window.top.flyoutPlayerHideBtn); 
		 window.top.flyoutPlayerHideBtn = undefined;
		 
		 window.top.flyoutPlayerCloseBtn.parentNode.removeChild(window.top.flyoutPlayerCloseBtn); 
		 window.top.flyoutPlayerCloseBtn = undefined;
		 
		 
		  if (!window.top.flyoutPlayerStopBtn) {
			window.top.flyoutPlayerStopBtn = window.top.document.createElement('button');
			window.top.flyoutPlayerStopBtn.textContent = "stop";
			window.top.flyoutPlayerStopBtn.className = "flyoutPlayerBtn";
			window.top.document.body.appendChild(window.top.flyoutPlayerStopBtn);
		  }
		  
		  window.top.flyoutPlayerStopBtn.onclick = function () {
				processTimerApiMessage({cmd:"custommessage",text:""});
				processTimerApiMessage({cmd:"start",msecs:0});
				processTimerApiMessage({cmd:"pause"});
				 window.top.flyoutPlayer.style.opacity=0;
				 window.top.flyoutPlayer.src='';
				 window.top.flyoutPlayerStopBtn.parentNode.removeChild(window.top.flyoutPlayerStopBtn); 
				 window.top.flyoutPlayerStopBtn = undefined;
				window.top.flyoutPlayerRewindBtn.parentNode.removeChild(window.top.flyoutPlayerRewindBtn); 
				window.top.flyoutPlayerRewindBtn = undefined;
		 };
		 
		 
		 
		  if (!window.top.flyoutPlayerRewindBtn) {
			window.top.flyoutPlayerRewindBtn = window.top.document.createElement('button');
			window.top.flyoutPlayerRewindBtn.textContent = "rewind";
			window.top.flyoutPlayerRewindBtn.className = "flyoutPlayerHideBtn";
			window.top.document.body.appendChild(window.top.flyoutPlayerRewindBtn);
		  }
		  
		  window.top.flyoutPlayerRewindBtn.onclick = function () {
			  
			  const url = window.top.flyoutPlayer.src;
			  const duration = window.top.flyoutPlayer.duration;
			  window.top.flyoutPlayerStopBtn.onclick();
			  openPlayerWindow(url);
			  window.top.flyoutPlayer.style.opacity = window.top.flyoutPlayerOpacity;
			  window.top.flyoutPlayerHideBtn.textContent = window.top.flyoutPlayerOpacity == "0" ?  "show" : "hide" ;
			  processTimerApiMessage({cmd:"custommessage",text:"Video Playback"});
			  processTimerApiMessage({cmd:"start",msecs:Math.floor(1000*duration)});
			  processTimerApiMessage({cmd:"pause"});
			  
		 };
		 
		 
		 
	};
	
	window.top.flyoutPlayerHideBtn.onclick = function () {
		window.top.flyoutPlayer.style.opacity = window.top.flyoutPlayerHideBtn.textContent === "hide" ? 0 : 1;
		window.top.flyoutPlayerHideBtn.textContent = window.top.flyoutPlayerHideBtn.textContent === "hide" ? "show" : "hide";
	};
	
	window.top.flyoutPlayerCloseBtn.onclick = function () {
		processTimerApiMessage({cmd:"custommessage",text:""});
		processTimerApiMessage({cmd:"start",msecs:0});
		processTimerApiMessage({cmd:"pause"});
		 window.top.flyoutPlayer.style.opacity=0;
		 window.top.flyoutPlayer.src='';
		 
		 window.top.flyoutPlayerBtn.parentNode.removeChild(window.top.flyoutPlayerBtn); 
		 window.top.flyoutPlayerBtn = undefined;
		 
		 window.top.flyoutPlayerHideBtn.parentNode.removeChild(window.top.flyoutPlayerHideBtn); 
		 window.top.flyoutPlayerHideBtn = undefined;

		 
		 window.top.flyoutPlayerCloseBtn.parentNode.removeChild(window.top.flyoutPlayerCloseBtn); 
		 window.top.flyoutPlayerCloseBtn = undefined;
		
	};
		 

  
}

function onPlayerWinUnload (ev) {
   window.top.flyoutPlayerWin = null;
   window.top.flyoutPlayer = null;
}

function comboBox(cls,id,items) {
  const select = document.createElement('select');
  if (cls) {
      cls.className = cls;
  }
  if (id) {
    select.id = id;
  }
  document.body.appendChild(select);
  
  function add(x) {
      
  }
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('blobDB', 1);

    request.onerror = () => {
      reject('Failed to open database');
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      db.createObjectStore('blobs', { keyPath: 'key' });
    };
  });
}

async function storeBlob(key, blob) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['blobs'], 'readwrite');
    const store = transaction.objectStore('blobs');
    const request = store.put({ key: key, data: blob });

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject('Failed to store blob');
    };
  });
}

async function retrieveBlob(key) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(['blobs'], 'readonly');
    const store = transaction.objectStore('blobs');
    const request = store.get(key);

    request.onsuccess = () => {
      const blobData = request.result;
      if (blobData) {
        resolve(blobData.data);
      } else {
        resolve(null);
      }
    };

    request.onerror = () => {
      reject('Failed to retrieve blob');
    };
  });
}
