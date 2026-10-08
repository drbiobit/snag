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

    // --- AI / summarize settings -----------------------------------------
    // These are saved to the backend (meta table), not localStorage, so they
    // are shared across browsers and used by the /summarize page.
    var AI_FIELDS = [
        ['ai-endpoint', 'ai_endpoint'],
        ['ai-model', 'ai_model'],
        ['ai-key', 'ai_api_key'],
        ['ai-temperature', 'ai_temperature'],
        ['ai-timeout', 'ai_timeout'],
        ['ai-langs', 'ai_langs'],
    ];

    function aiNote(msg) {
        var note = $('ai-note');
        note.textContent = msg;
        setTimeout(function () { note.textContent = ''; }, 3000);
    }

    // Pull the saved AI settings from the backend and fill the form.
    async function loadAi() {
        try {
            var r = await fetch('/api/ai/settings');
            if (r.status === 401) { window.location.href = '/login'; return; }
            var d = await r.json();
            var s = d.settings || {};
            AI_FIELDS.forEach(function (pair) {
                var el = $(pair[0]), key = pair[1];
                if (s[key] != null) el.value = s[key];
            });
            // System prompt (textarea) and timestamps (checkbox) are handled
            // separately because they don't use .value the same way.
            if (s.ai_system_prompt != null) $('ai-system-prompt').value = s.ai_system_prompt;
            if (s.ai_timestamps != null) $('ai-timestamps').checked = s.ai_timestamps !== '0';
        } catch (e) {}
    }

    // Save the AI form back to the backend.
    async function saveAi() {
        var body = {};
        AI_FIELDS.forEach(function (pair) {
            body[pair[1]] = $(pair[0]).value;
        });
        body.ai_system_prompt = $('ai-system-prompt').value;
        body.ai_timestamps = $('ai-timestamps').checked ? '1' : '0';
        try {
            var r = await fetch('/api/ai/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (r.status === 401) { window.location.href = '/login'; return; }
            var d = await r.json();
            aiNote(d.success ? 'Saved.' : (d.error || 'Save failed.'));
        } catch (e) {
            aiNote('Save failed: ' + e.message);
        }
    }

    // Fetch the model list for the endpoint currently in the form, and show
    // it as a comma-separated hint under the model field.
    async function loadAiModels() {
        var endpoint = $('ai-endpoint').value.trim();
        if (!endpoint) { aiNote('Enter an endpoint first.'); return; }
        var note = $('ai-note');
        note.textContent = 'Loading models…';
        try {
            var r = await fetch('/api/ai/models?endpoint=' + encodeURIComponent(endpoint));
            if (r.status === 401) { window.location.href = '/login'; return; }
            var d = await r.json();
            if (!d.success || !d.models.length) {
                note.textContent = d.error || 'No models found at that endpoint.';
            } else {
                note.textContent = 'Models: ' + d.models.join(', ');
            }
        } catch (e) {
            note.textContent = 'Failed: ' + e.message;
        }
    }

    loadAi();
    $('ai-save').addEventListener('click', saveAi);
    $('ai-load-models').addEventListener('click', loadAiModels);
})();
