(function(){
  try {
    // Inject a small inline script into the page so the page context can see the bridge
    const s = document.createElement('script');
    s.textContent = [
      "window.__EXTENSION_BRIDGE__ = true;",
      "document.documentElement.setAttribute('data-extension-hook','1');",
      "console && console.log && console.log('Kosh extension bridge injected');"
    ].join("\\n");
    (document.head || document.documentElement).appendChild(s);
    // Also log from content script for debugging
    console.log('Kosh content script ran and injected bridge.');
  } catch (e) {
    console.error('Kosh content script error', e);
  }
})();
