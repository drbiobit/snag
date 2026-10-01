/*
 * Snag - frontend logic
 *
 * Talks to the Flask backend (Main.py):
 *   - validates the URL as the user types
 *   - starts a download and polls for progress once per second
 *   - shows the result (or an error) when the job finishes
 */

// Short helper to grab an element by id.
const $ = id => document.getElementById(id);

// Grab every element we touch, once, into a single object for easy access.
const els = ['url', 'type', 'format', 'video-format', 'audio-format', 'audio-quality',
             'audio-only', 'output-template', 'resume', 'fragments', 'metadata', 'thumbnails',
             'subtitles', 'sub-langs', 'sub-embed', 'sub-options',
             'trim-start', 'trim-end', 'playlist-items', 'playlist-items-group',
             'cookies', 'playlist-index', 'download-btn', 'cancel-btn', 'preview-btn',
             'status-section', 'progress-fill', 'progress-text', 'status-message',
             'file-counter', 'file-list',
             'error-box', 'preview-box', 'preview-title', 'preview-meta', 'preview-tags',
             'results-section', 'file-name', 'file-size']
  .reduce((o, id) => (o[id] = $(id), o), {});

// Where the user's saved defaults live (set on the Settings page).
const DEFAULTS_KEY = 'snag-defaults';

// The id of the job currently running (null when idle) and its poll timer.
let jobId = null, timer = null;

// Show or hide an element.
const show = (el, on) => el.style.display = on ? '' : 'none';

// Update the connection status indicator if one is present on the page.
// (The sidebar no longer shows a status dot, so this is a no-op today,
//  but kept so the running/idle state can be wired back in easily.)
function setPill(running) {
    const pill = $('conn-pill');
    if (!pill) return;
    pill.style.color = running ? 'var(--accent)' : 'var(--muted)';
    pill.title = running ? 'running' : 'ready';
}

/*
 * Show/hide the format + bitrate controls based on the "Audio Only" checkbox.
 *  - audio only  -> show audio format + bitrate, hide video format
 *  - video       -> show video format, hide audio format + bitrate
 */
function toggleFormats() {
    const audioOnly = els['audio-only'].checked;
    show($('video-format-group'), !audioOnly);
    show($('audio-format-group'), audioOnly);
    show($('audio-quality-group'), audioOnly);
}

/*
 * Show/hide the output-template field. It only applies to single downloads,
 * so it's hidden whenever the type is "bulk" or the URL is a collection
 * (playlist / channel / user).
 */
function toggleTemplate() {
    const type = els.type.value;
    const url = els.url.value.trim().toLowerCase();
    const isBulkUrl = url.includes('/playlist') || url.includes('/channel/')
        || url.includes('/user/') || url.includes('/c/') || url.includes('/@');
    const bulk = type === 'bulk' || isBulkUrl;
    // Output template is single-only; playlist index + item picker are bulk-only.
    show($('template-group'), !bulk);
    show($('playlist-group'), bulk);
    show(els['playlist-items-group'], bulk);
}

/*
 * Show/hide the subtitle language + embed options, which only make sense
 * when the "subtitles" checkbox is ticked.
 */
function toggleSubs() {
    show(els['sub-options'], els.subtitles.checked);
}

/*
 * When "thumbnails only" is checked, the media format / quality / audio
 * controls are irrelevant (we're only grabbing cover images), so hide them.
 * Unchecking restores them. We also force the type to "bulk" hint by showing
 * the playlist item picker, since whole-channel thumb grabs are the main use.
 */
function toggleThumbs() {
    const on = els.thumbnails.checked;
    show($('video-format-group'), !on);
    show($('audio-format-group'), !on);
    show($('audio-quality-group'), !on);
    show($('template-group'), !on);
    // Hide the quality selector's row too (it's part of the type row).
    const fmtRow = els.format.closest('.row');
    if (fmtRow) {
        const fmtField = els.format.closest('.field');
        if (fmtField) fmtField.style.display = on ? 'none' : '';
    }
}

/*
 * Load the user's saved defaults (from the Settings page) into the form.
 * Called once on load, before the initial validation.
 */
function loadDefaults() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(DEFAULTS_KEY)) || {}; } catch (e) {}
    const map = {
        format: 'format', 'video-format': 'video-format', 'audio-format': 'audio-format',
        'audio-quality': 'audio-quality', 'playlist-index': 'playlist-index',
        'output-template': 'output-template'
    };
    for (const [key, id] of Object.entries(map)) {
        if (saved[key] != null && els[id]) els[id].value = saved[key];
    }
    if (saved['audio-only'] != null) els['audio-only'].checked = !!saved['audio-only'];
    if (saved.resume != null) els.resume.checked = !!saved.resume;
    if (saved.fragments != null) els.fragments.value = String(saved.fragments);
    if (saved.metadata != null) els.metadata.checked = !!saved.metadata;
}

/*
 * Ask the backend whether the current text is a valid YouTube URL.
 * Colours the input (green/red) and enables the Download button only
 * when the URL is valid.
 */
async function validateUrl() {
    const url = els.url.value.trim();
    if (!url) {
        els['download-btn'].disabled = true;
        els.url.classList.remove('success', 'error');
        return;
    }
    try {
        const r = await fetch('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const d = await r.json();
        els.url.classList.toggle('success', d.valid);
        els.url.classList.toggle('error', !d.valid);
        els['download-btn'].disabled = !d.valid;
    } catch {
        els['download-btn'].disabled = true;
    }
}

/*
 * Send the download request to the backend, then start polling for progress.
 */
async function startDownload() {
    // Collect the user's choices from the form.
    const body = {
        url: els.url.value.trim(),
        type: els.type.value,
        format: els.format.value,
        audio_only: els['audio-only'].checked,
        audio_format: els['audio-format'].value,
        audio_quality: parseInt(els['audio-quality'].value, 10),
        output_format: els['video-format'].value,
        output_template: els['output-template'].value.trim(),
        resume: els.resume.checked,
        fragments: parseInt(els.fragments.value, 10),
        metadata: els.metadata.checked,
        playlist_index: els['playlist-index'].value,
        subtitles: els.subtitles.checked,
        sub_langs: els['sub-langs'].value,
        sub_embed: els['sub-embed'].checked,
        trim_start: els['trim-start'].value.trim(),
        trim_end: els['trim-end'].value.trim(),
        playlist_items: els['playlist-items'].value.trim(),
        cookies: els.cookies.value,
        thumbnails: els.thumbnails.checked
    };

    const r = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const d = await r.json();
    if (!d.success) { alert(d.error); return; }

    // Remember the job and switch the UI into "downloading" mode.
    jobId = d.job_id;
    setPill(true);
    show(els['status-section'], true);
    show(els['results-section'], false);
    show(els['preview-box'], false);
    els['error-box'].style.display = 'none';
    els['download-btn'].style.display = 'none';
    els['cancel-btn'].style.display = '';

    // Poll the backend once per second.
    timer = setInterval(poll, 1000);
}

/*
 * One poll: fetch the job's status, update the progress bar, and handle
 * the finished states (completed / error / cancelled).
 */
async function poll() {
    const r = await fetch(`/api/status/${jobId}`);
    const d = await r.json();
    if (!d.success) return; // job already cleaned up - stop silently
    const job = d.job;

    // Update the progress bar and text.
    els['progress-fill'].style.width = `${job.progress}%`;
    els['progress-text'].textContent = `${job.progress.toFixed(0)}%`;
    els['status-message'].textContent = job.message;

    // Handle the terminal states.
    if (['completed', 'error', 'cancelled'].includes(job.status)) {
        clearInterval(timer);
        timer = null;
        setPill(false);
        if (job.status === 'completed') {
            // Show the results panel with the most recently downloaded file.
            show(els['status-section'], false);
            show(els['results-section'], true);
            const files = (await (await fetch('/api/downloads')).json()).downloads;
            const newest = files.sort((a, b) => b.size - a.size)[0];
            if (newest) {
                els['file-name'].textContent = newest.name;
                els['file-size'].textContent = `size: ${formatSize(newest.size)}`;
            }
        } else if (job.status === 'error') {
            // Surface the real yt-dlp error (last few lines of its output).
            els['status-message'].textContent = job.message;
            if (job.error) {
                els['error-box'].textContent = job.error;
                els['error-box'].style.display = 'block';
            }
        }
        // Cancelled: just reset, no error box.
        reset();
    }
}

/*
 * Reset the UI back to its initial, idle state.
 */
function reset() {
    jobId = null;
    els['status-section'].style.display = 'none';
    els['results-section'].style.display = 'none';
    els['download-btn'].style.display = '';
    els['cancel-btn'].style.display = 'none';
    els['progress-fill'].style.width = '0%';
    els['progress-text'].textContent = '0%';
    els['status-message'].textContent = 'starting…';
    els['error-box'].style.display = 'none';
}

/*
 * Ask the backend to cancel the running job.
 */
async function cancelDownload() {
    if (!jobId) return;
    await fetch(`/api/cancel/${jobId}`, { method: 'POST' });
}

/*
 * Format a byte count as a human-readable string (e.g. "5.12 MB").
 */
function formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`;
}

/*
 * Preview what's available for the current URL without downloading.
 * Calls /api/preview and shows the title, item count, resolutions and
 * audio formats in a small panel below the form.
 */
async function preview() {
    const url = els.url.value.trim();
    if (!url) return;
    const box = els['preview-box'];
    box.style.display = 'block';
    els['preview-title'].textContent = 'checking…';
    els['preview-meta'].textContent = '';
    els['preview-tags'].innerHTML = '';
    try {
        const r = await fetch('/api/preview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const d = await r.json();
        if (!d.success) {
            els['preview-title'].textContent = d.error;
            return;
        }
        els['preview-title'].textContent = d.title || 'unknown title';
        const bits = [];
        if (d.bulk) {
            // Collection: we only know the item count (flat read has no per-item formats).
            bits.push(`${d.count} item${d.count === 1 ? '' : 's'}`);
            els['preview-meta'].textContent = bits.join(' · ');
            els['preview-tags'].innerHTML =
                '<span class="tag">playlist / channel / user</span>';
            return;
        }
        // Single video: show the real resolutions + audio codecs.
        if (d.heights && d.heights.length) bits.push(`up to ${d.heights[0]}p`);
        els['preview-meta'].textContent = bits.join(' · ');
        const tags = [...d.heights.map(h => `${h}p`), ...d.formats];
        els['preview-tags'].innerHTML = tags
            .map(t => `<span class="tag">${t}</span>`).join('');
    } catch {
        els['preview-title'].textContent = 'could not reach the server';
    }
}

/* ---------------------------------------------------------------------------
 * Wire up event listeners and run initial state.
 * ------------------------------------------------------------------------- */

// Re-validate the URL and re-check the template visibility as the user types.
els.url.addEventListener('input', () => { validateUrl(); toggleTemplate(); });
// Toggle the format/bitrate controls when "audio only" changes.
els['audio-only'].addEventListener('change', toggleFormats);
// Toggle the template field when the type changes (bulk hides it).
els.type.addEventListener('change', toggleTemplate);
// Toggle the subtitle options when the subtitles checkbox changes.
els.subtitles.addEventListener('change', toggleSubs);
// Hide the media format controls when "thumbnails only" is checked.
els.thumbnails.addEventListener('change', toggleThumbs);
// Start / cancel / preview downloads.
els['download-btn'].addEventListener('click', startDownload);
els['cancel-btn'].addEventListener('click', cancelDownload);
els['preview-btn'].addEventListener('click', preview);

// Keyboard shortcuts: Enter to start, Esc to cancel, "/" to focus the URL box.
document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) {
        e.preventDefault();
        els.url.focus();
    } else if (e.key === 'Enter' && !typing) {
        if (!els['download-btn'].disabled) startDownload();
    } else if (e.key === 'Escape' && jobId) {
        cancelDownload();
    }
});
// Result buttons: open the file or show its path.
$('open-btn').addEventListener('click', () =>
    window.open(`/downloads/${encodeURIComponent(els['file-name'].textContent)}`, '_blank'));
$('show-path-btn').addEventListener('click', () =>
    alert(`/downloads/${els['file-name'].textContent}`));

// Initial state: apply saved defaults, then validate + sync visibility.
loadDefaults();
toggleFormats();
toggleTemplate();
toggleSubs();
toggleThumbs();
validateUrl();
