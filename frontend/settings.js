/*
 * Snag - settings page logic
 *
 * Two jobs:
 *   1. Theme swatches - apply + persist the chosen theme.
 *   2. Default download options - save them to localStorage so the app
 *      page pre-fills its form with the user's preferred settings.
 */

(function () {
    var KEY = 'snag-defaults';

    // --- Theme -----------------------------------------------------------
    var swatches = document.querySelectorAll('#theme-swatches .swatch');

    // Mark the currently-saved theme as active on load.
    function refresh() {
        var current = window.snagGetTheme();
        swatches.forEach(function (s) {
            s.classList.toggle('active', s.dataset.theme === current);
        });
    }

    // Click a swatch -> set the theme (theme.js persists it) and refresh.
    swatches.forEach(function (s) {
        s.addEventListener('click', function () {
            window.snagSetTheme(s.dataset.theme);
            refresh();
        });
    });

    refresh();

    // --- Default download options ---------------------------------------
    // The form fields on this page and the keys they map to in storage.
    var FIELDS = [
        ['def-format', 'format'],
        ['def-video-format', 'video-format'],
        ['def-audio-format', 'audio-format'],
        ['def-audio-quality', 'audio-quality'],
        ['def-fragments', 'fragments'],
        ['def-playlist-index', 'playlist-index'],
        ['def-output-template', 'output-template'],
        ['def-audio-only', 'audio-only'],
        ['def-resume', 'resume'],
        ['def-metadata', 'metadata'],
    ];

    var $ = function (id) { return document.getElementById(id); };

    // Load saved defaults into the form (or leave the HTML defaults).
    function loadDefaults() {
        var saved = {};
        try { saved = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) {}
        FIELDS.forEach(function (pair) {
            var el = $(pair[0]), key = pair[1];
            if (saved[key] == null) return;
            if (el.type === 'checkbox') el.checked = !!saved[key];
            else el.value = saved[key];
        });
    }

    // Collect the form into an object and save it.
    function saveDefaults() {
        var out = {};
        FIELDS.forEach(function (pair) {
            var el = $(pair[0]), key = pair[1];
            if (el.type === 'checkbox') out[key] = el.checked;
            else out[key] = el.value;
        });
        try { localStorage.setItem(KEY, JSON.stringify(out)); } catch (e) {}
        var note = $('save-note');
        note.textContent = 'Saved. These will pre-fill the app page.';
        setTimeout(function () { note.textContent = ''; }, 2500);
    }

    // Clear saved defaults so the app page falls back to its built-in values.
    function resetDefaults() {
        try { localStorage.removeItem(KEY); } catch (e) {}
        loadDefaults();
        var note = $('save-note');
        note.textContent = 'Cleared. The app page will use its defaults.';
        setTimeout(function () { note.textContent = ''; }, 2500);
    }

    loadDefaults();
    $('save-defaults').addEventListener('click', saveDefaults);
    $('reset-defaults').addEventListener('click', resetDefaults);
})();
