/* One-time, optional AI setup prompt on the home page.
 *
 * Shown once after the user has an account, until they either save an
 * endpoint or explicitly skip. The decision is remembered server-side
 * (meta key ai_setup_done), so it never nags again. AI is fully optional.
 */
(function () {
    'use strict';

    const overlay = document.getElementById('ai-setup-overlay');
    if (!overlay) return;

    const $ = (id) => document.getElementById(id);
    const endpointEl = $('ai-setup-endpoint');
    const modelEl = $('ai-setup-model');
    const keyEl = $('ai-setup-key');
    const saveBtn = $('ai-setup-save');
    const skipBtn = $('ai-setup-skip');
    const closeBtn = $('ai-setup-close');

    function close() { overlay.classList.remove('open'); }

    async function markDone() {
        try { await fetch('/api/ai/setup-done', { method: 'POST' }); } catch (e) { /* ignore */ }
    }

    async function save() {
        const endpoint = endpointEl.value.trim();
        if (!endpoint) { endpointEl.focus(); return; }
        saveBtn.disabled = true;
        saveBtn.textContent = 'saving…';
        try {
            const r = await fetch('/api/ai/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ai_endpoint: endpoint,
                    ai_model: modelEl.value.trim(),
                    ai_api_key: keyEl.value,
                }),
            });
            const d = await r.json();
            if (d.success) { close(); }
            else { alert('Could not save: ' + (d.error || 'unknown error')); }
        } catch (e) {
            alert('Could not save: ' + e.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'save';
        }
    }

    async function skip() {
        await markDone();
        close();
    }

    saveBtn.addEventListener('click', save);
    skipBtn.addEventListener('click', skip);
    closeBtn.addEventListener('click', skip);
    // Enter in any field saves.
    [endpointEl, modelEl, keyEl].forEach((el) => {
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
    });

    // Only show if the backend says setup is not done yet.
    (async function init() {
        try {
            const r = await fetch('/api/ai/settings');
            const d = await r.json();
            if (!d.success || d.setup_done) return;
            // Pre-fill any partially-saved values so re-opening is easy.
            const s = d.settings || {};
            if (s.ai_endpoint) endpointEl.value = s.ai_endpoint;
            if (s.ai_model) modelEl.value = s.ai_model;
            overlay.classList.add('open');
            endpointEl.focus();
        } catch (e) { /* not logged in or offline - do nothing */ }
    })();
})();
