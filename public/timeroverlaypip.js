/*
global getInheritedBackgroundColor,getInheritedColor
*/

function setupPip(sourceId,targetId,width,height,font,fgQuery,htmlClass,toplineQry,toplinefont) {
    const supported =  typeof document.exitPictureInPicture === 'function' || document.pictureInPictureElement===null;
    if (!supported) return null;

    const waitNextFrame =  window.safari ? waitNextFrameSafari : waitNextFrameChrome;
    const target =  createVideoElement( targetId );
    if (!target.requestPictureInPicture) return null;
    
    const content = document.getElementById(sourceId);
    const fgEl = fgQuery ? document.querySelector(fgQuery) : content;
    const topLineEl = toplineQry ? document.querySelector(toplineQry) : null;
    const bg = getInheritedBackgroundColor(fgEl);
    togglePictureInPicture.lastContent = "";
    const source = document.createElement('canvas');
    source.width = width;
    source.height = height;
    
    target.style.position = 'absolute';
    target.style.bottom=0;
    target.style.right=0;
    target.style.opacity=0;
    
    const ctx = source.getContext('2d');
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    refreshPIPFrame();
  
    const stream = source.captureStream();
    target.srcObject = stream;
    
    togglePictureInPicture.enterPIP = enterPIP;
    togglePictureInPicture.exitPIP  = exitPIP;

    

    return togglePictureInPicture;
    
    function refreshPIPFrame() {
        const str = content.textContent;
        if ( togglePictureInPicture.lastContent!==str ) { 
            ctx.fillStyle = getInheritedBackgroundColor(fgEl);
            ctx.fillRect( 0, 0, source.width, source.height );
            ctx.fillStyle = getInheritedColor(fgEl);
            ctx.font = font;
            ctx.fillText( str, source.width / 2, source.height / 2 );
            if (topLineEl) {            
                ctx.font = toplinefont;
                const text = window.getComputedStyle(topLineEl,':before')['content'];
                if (text !== 'none') {            
                    ctx.fillText( text.replace(/^\"|\"$/g,''), source.width / 2,32,source.width);
                }
            }
            togglePictureInPicture.lastContent = str;
        }
        waitNextFrame(  );
    }
  
    function togglePictureInPicture() {
      if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
        html.classList.remove(htmlClass);
      } else if (document.pictureInPictureEnabled) {
        target.requestPictureInPicture();
        html.classList.add(htmlClass);
      }
    }
    
    function enterPIP() {
     if (document.pictureInPictureElement) {
        html.classList.add(htmlClass);
        return false;
      } else if (document.pictureInPictureEnabled) {
        target.requestPictureInPicture();
        html.classList.add(htmlClass);
        return true;
      }
    }
    
    function exitPIP() {
     if (document.pictureInPictureElement) {
        document.exitPictureInPicture();
        html.classList.remove(htmlClass);
        return true;
      } else if (document.pictureInPictureEnabled) {
        html.classList.remove(htmlClass);
        return false;
      }
    }


    function waitNextFrameChrome () {
        requestAnimationFrame(refreshPIPFrame);
    }
    
    function waitNextFrameSafari () {
        setTimeout(refreshPIPFrame,33);// 30fps
    }
  }


  

function createVideoElement(id) {
    let el = document.querySelector(`#${id}`);
    if (!el) {
        const parentEl = document.createElement('div');
        parentEl.innerHTML =  `<video id="${id}" muted autoplay></video>`;
        el = parentEl.querySelector('video');
        parentEl.removeChild(el);
        document.body.appendChild(el);
    }
    return el;
}