var fs_api = (function() {

  const  fs_notifiers = new Map( );

  // function to detect if this window is currently in fullscreen mode
  const is_fs = function(){
    return !!document.fullscreenElement;
  };
  // save initial fullscreen state of this window 
  let was_fs = is_fs();

  let notify_fs = function(f){fs_notifiers.forEach(function(fn){fn(f);})};

  const  fs_add_notifier=function(fn){
    if (typeof fn==='function') {
      fs_notifiers.set(fn,fn);
      fn(is_fs());
    }
  };
  const  fs_remove_notifier=function(fn){
    if (typeof fn==='function') {
       fs_notifiers.delete(fn);
    } else {
      if (fn ===null) {
        fs_notifiers.clear();
      }
    }
  };
  
  fs_add_notifier(function(f){console.log(f?"entered fullscreen":"exited fs")});
  
  var fs_api = makeFullScreenApi(document.body, function(api) {
    var persistent = false,
      trigger = false,
      api_enterFullscreen = api.enterFullscreen,
      api_exitFullscreen = api.exitFullscreen,
      trigger_func = function(ev) {
        if (trigger) {
          api_enterFullscreen();
        }
      },
      bdy = document.body,
      add = function(x) {
        bdy.classList.add(x);
      },
      remove = function(x) {
        bdy.classList.remove(x);
      };

    api.on("enter", function() {
      trigger = false;
      add("fullscreen");
      remove("fullscreen_temp_off");
    });

    api.on("exit", function() {
      if (persistent) {
        trigger = true;
        add("fullscreen_temp_off");
      } else {
        trigger = false;
        if (persistent) {
          document.removeEventListener("keydown", trigger_func);
          document.removeEventListener("keyup", trigger_func);
          document.removeEventListener("mousedown", trigger_func);
          document.removeEventListener("mouseup", trigger_func);
          document.removeEventListener("touchstart", trigger_func);
        }
        remove("fullscreen_temp_off");
        remove("fullscreen");
      }
    });

    api.enterFullscreen = function(persist) {
      persistent = !!persist;
      trigger = false;
      if (persistent) {
        document.addEventListener("keydown", trigger_func);
        document.addEventListener("keyup", trigger_func);
        document.addEventListener("mousedown", trigger_func);
        document.addEventListener("mouseup", trigger_func);
        document.addEventListener("touchstart", trigger_func);
      }

      api_enterFullscreen();
    };

    api.exitFullscreen = function() {
      persistent = false;
      trigger = false;
      remove("fullscreen_temp_off");
      remove("fullscreen");
      api_exitFullscreen();
    };
  });
  fs_api.newApi = makeFullScreenApi;

  window.onresize = function (event) {
 
      if (is_fs()) {
          notify_fs((was_fs = true));
      } else {
        if (was_fs) {
          notify_fs((was_fs = false));
        }
      }
  };

  return fs_api;

  function makeFullScreenApi(element, cb) {
    var notify = function(evs, isFs) {
        evs.forEach(function(fn) {
          fn(element, isFs);
        });
      },

      debounce = null,
      fs_cb = function(isFs) {
          if (isFs===debounce) return;
          debounce=isFs;
          notify(isFs ? fs_api.__events.enter : fs_api.__events.exit, isFs);
          notify(fs_api.__events.toggle, isFs);
      } ,     
        
      
      fs_api = {
        isFullscreen: function() {
          return false;
        },
        exitFullscreen: function() {
          if (document.exitFullscreen) {
            document.exitFullscreen();
          } else if (document.mozCancelFullScreen) {
            document.mozCancelFullScreen();
          } else if (document.webkitCancelFullScreen) {
            document.webkitCancelFullScreen();
          } else if (document.msExitFullscreen) {
            document.msExitFullscreen();
          }
        },
        __events: {
          enter: [],
          exit: [],
          toggle: []
        },
        on: function(e, f) {
          var fns = fs_api.__events[e];
          if (
            typeof f === "function" &&
            typeof fns === "object" &&
            fns.constructor === Array &&
            fns.indexOf(f) < 0
          ) {
            fns.push(f);
          }
        }
      },
      setNotifiers = function(ev, flag) {
        fs_api.isFullscreen = function() {
          return is_fs();
        };

 
        document.addEventListener(
          ev,
          function() {
            fs_cb(fs_api.isFullscreen());
          },
          false
        );

      
        
      };

    if (element.requestFullscreen) {
      fs_api.enterFullscreen = function() {
        var attempts = 0,
          fallback = 50;
        var tryit = function() {
          element.requestFullscreen().catch(function(err) {
            if (attempts++ < 3) {
              fallback *= 2;
              setTimeout(tryit, fallback);
            }
          });
        };
        tryit();
      };
      setNotifiers("fullscreenchange", "fullscreen");

     fs_add_notifier(fs_cb);
      
    } else if (element.msRequestFullscreen) {
      fs_api.enterFullscreen = function() {
        return element.msRequestFullscreen();
      };
      setNotifiers("msfullscreenchange", "msFullscreenElement");
    } else if (element.mozRequestFullScreen) {
      fs_api.enterFullscreen = function() {
        return element.mozRequestFullScreen();
      };
      setNotifiers("mozfullscreenchange", "mozFullScreen");
    } else if (element.webkitRequestFullscreen) {
      fs_api.enterFullscreen = function() {
        return element.webkitRequestFullscreen();
      };
      setNotifiers("webkitfullscreenchange", "webkitIsFullScreen");
    } else {
      fs_api.enterFullscreen = console.log.bind(
        console,
        "Fullscreen API is not supported"
      );
      fs_api.exitFullscreen = fs_api.enterFullscreen;
    }
    if (typeof cb === "function") cb(fs_api);
    return fs_api;
  }
})();
