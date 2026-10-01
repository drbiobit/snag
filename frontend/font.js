/*
 * Snag - font management
 *
 * Reads the saved font from localStorage and applies it to the page by
 * setting a data-font attribute on <html>. Loaded in the <head> so the
 * font is applied before first paint (no flash of the default font).
 *
 * "ubuntu" is the default (the app's original face), so it needs no
 * attribute - the base --font in style.css is already Ubuntu Mono.
 *
 * Mirrors theme.js, which does the same for colour themes.
 */
(function () {
    var KEY = 'snag-font';

    // Apply a font by setting the data-font attribute on <html>.
    function apply(name) {
        var root = document.documentElement;
        if (name && name !== 'ubuntu') {
            root.setAttribute('data-font', name);
        } else {
            root.removeAttribute('data-font');
        }
    }

    // Apply whatever the user saved (or the default ubuntu).
    try {
        apply(localStorage.getItem(KEY));
    } catch (e) { /* localStorage unavailable - fall back to default */ }

    // Public API: set + persist a font.
    window.snagSetFont = function (name) {
        try { localStorage.setItem(KEY, name); } catch (e) {}
        apply(name);
    };

    // Public API: read the current font name.
    window.snagGetFont = function () {
        try { return localStorage.getItem(KEY) || 'ubuntu'; } catch (e) { return 'ubuntu'; }
    };
})();
