function getInheritedBackgroundColor(el) {
    // get default style for current browser
    const defaultStyle = getDefaultBackground(); // typically "rgba(0, 0, 0, 0)"
    
    // get computed color for el
    const backgroundColor = window.getComputedStyle(el).backgroundColor;
    
    // if we got a real value, return it
    if (backgroundColor != defaultStyle) return backgroundColor;
  
    // if we've reached the top parent el without getting an explicit color, return default
    if (!el.parentElement) return defaultStyle;
    
    // otherwise, recurse and try again on parent element
    return getInheritedBackgroundColor(el.parentElement);
  }
  
  function getDefaultBackground() {
    // have to add to the document in order to use getComputedStyle
    const div = document.createElement("div");
    document.head.appendChild(div);
    const bg = window.getComputedStyle(div).backgroundColor;
    document.head.removeChild(div);
    return bg;
  }


  function getInheritedColor(el) {
    // get default style for current browser
    const defaultStyle = getDefaultColor(); // typically "rgba(0, 0, 0, 0)"
    
    // get computed color for el
    const color = window.getComputedStyle(el).color;
    
    // if we got a real value, return it
    if (color != defaultStyle) return color;
  
    // if we've reached the top parent el without getting an explicit color, return default
    if (!el.parentElement) return defaultStyle;
    
    // otherwise, recurse and try again on parent element
    return getInheritedColor(el.parentElement);
  }
  
  function getDefaultColor() {
    // have to add to the document in order to use getComputedStyle
    const div = document.createElement("div");
    document.head.appendChild(div);
    const bg = window.getComputedStyle(div).color;
    document.head.removeChild(div);
    return bg;
  }

