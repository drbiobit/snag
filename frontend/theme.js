/*
 * Snag - theme management
 *
 * Reads the saved theme from localStorage and applies it to the page by
 * setting a data-theme attribute on <html>. Loaded in the <head> so the
 * theme is applied before first paint (no flash of the default theme).
 *
 * Also exposes window.snagSetTheme(name) so the settings page can change
 * the theme and persist it.
 */

// The themes are defined in style.css via [data-theme="..."] selectors.
// "black" (pure black) is the default and needs no attribute, so it maps to
// the :root defaults. "light" is the warm-paper variant.
(function () {
    var KEY = 'snag-theme';

    // Apply a theme by setting the data-theme attribute on <html>.
    function apply(name) {
        var root = document.documentElement;
        name = name || 'black';
        if (name !== 'black') {
            root.setAttribute('data-theme', name);
        } else {
            root.removeAttribute('data-theme');
        }
    }

    // Apply whatever the user saved (or the default black theme).
    try {
        apply(localStorage.getItem(KEY));
    } catch (e) { /* localStorage unavailable - fall back to default */ }

    // Public API: set + persist a theme.
    window.snagSetTheme = function (name) {
        try { localStorage.setItem(KEY, name); } catch (e) {}
        apply(name);
    };

    // Public API: read the current theme name.
    window.snagGetTheme = function () {
        try { return localStorage.getItem(KEY) || 'black'; } catch (e) { return 'black'; }
    };
})();
