/*
 * Snag - frontend logic
 *
 * Talks to the Flask backend (snag.py):
 *   - validates the URL as the user types
 *   - starts a download and polls for progress once per second
 *   - shows the result (or an error) when the job finishes
 */

// Short helper to grab an element by id.
const $ = id => document.getElementById(id);

// Redirect to the login page if the session has expired.
const handle401 = r => { if (r.status === 401) { window.location.href = '/login'; return true; } return false; };

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

// Where the active job id lives so a running download survives a page
// refresh or a trip to another sidebar page (the server keeps the job
// going in a background thread; we just need to keep polling it).
const ACTIVE_JOB_KEY = 'snag-active-job';

// The id of the job currently running (null when idle) and its poll timer.
let jobId = null, timer = null;

// Persist / restore the active job id across page loads.
const saveActiveJob = id => {
    if (id) localStorage.setItem(ACTIVE_JOB_KEY, id);
    else localStorage.removeItem(ACTIVE_JOB_KEY);
};
const loadActiveJob = () => {
    try { return localStorage.getItem(ACTIVE_JOB_KEY); } catch (e) { return null; }
};

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
    const hint = $('url-hint');
    if (!url) {
        els['download-btn'].disabled = true;
        els.url.classList.remove('success', 'error');
        els.url.removeAttribute('aria-invalid');
        if (hint) hint.textContent = '';
        return;
    }
    try {
        const r = await fetch('/api/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        if (handle401(r)) return;
        const d = await r.json();
        els.url.classList.toggle('success', d.valid);
        els.url.classList.toggle('error', !d.valid);
        els.url.setAttribute('aria-invalid', d.valid ? 'false' : 'true');
        if (hint) hint.textContent = d.valid ? 'valid link' : 'this link doesn\u2019t look right';
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
    if (handle401(r)) return;
    const d = await r.json();
    if (!d.success) { alert(d.error); return; }

    // Remember the job (and persist it so a refresh keeps tracking it) and
    // switch the UI into "downloading" mode.
    jobId = d.job_id;
    saveActiveJob(jobId);
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
    if (handle401(r)) return;
    const d = await r.json();
    if (!d.success) {
        // Job is gone (server restarted): stop polling, don't leak the timer.
        if (timer) { clearInterval(timer); timer = null; }
        reset();
        return;
    }
    const job = d.job;

    // Update the progress bar and text.
    els['progress-fill'].style.width = `${job.progress}%`;
    els['progress-text'].textContent = `${job.progress.toFixed(0)}%`;
    els['status-message'].textContent = job.message;
    const bar = $('progress-bar');
    if (bar) bar.setAttribute('aria-valuenow', Math.round(job.progress));

    // Bulk downloads: show the per-file progress list (file 1, file 2, ...).
    renderFileList(job);

    // Handle the terminal states.
    if (['completed', 'error', 'cancelled'].includes(job.status)) {
        clearInterval(timer);
        timer = null;
        setPill(false);
        if (job.status === 'completed') {
            // Show the results panel with the file(s) this job produced.
            // job.files holds the exact paths yt-dlp wrote (newest last);
            // fall back to the newest file in the downloads folder if the
            // backend didn't report any (e.g. an older server).
            show(els['status-section'], false);
            show(els['results-section'], true);
            let files = job.files || [];      // names of the files this job wrote
            let newestSize = null;           // size of the newest file (fallback case only)
            if (!files.length) {
                // Older server that doesn't report job.files: use the newest
                // file in the downloads folder instead.
                const dlRes = await fetch('/api/downloads');
                if (handle401(dlRes)) return;
                const all = (await dlRes.json()).downloads;
                all.sort((a, b) => b.mtime - a.mtime);
                files = all.map(f => f.name);
                newestSize = all[0] ? all[0].size : null;
            }
            const newest = files[files.length - 1];
            if (newest) {
                els['file-name'].textContent = newest;
                els['file-size'].textContent = newestSize != null
                    ? `size: ${formatSize(newestSize)}`
                    : files.length > 1 ? `${files.length} files downloaded` : '';
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
 * Render the per-file progress list for a bulk download. The backend tracks
 * how many files have started (file_index), the current file's title, and the
 * latest percent per file (file_progress). Single downloads (no file_index)
 * hide the list and just show a file counter.
 */
function renderFileList(job) {
    const list = els['file-list'];
    const counter = els['file-counter'];
    if (!job.file_index) {
        // Not a bulk job: hide the list, clear the counter.
        list.style.display = 'none';
        list.innerHTML = '';
        counter.textContent = '';
        return;
    }

    const total = job.file_index;               // files that have started
    const progress = job.file_progress || {};
    counter.textContent = `file ${total}`;

    // Rebuild the rows. We keep the current title in a module-level cache so
    // the title persists even on polls that don't carry it.
    if (!renderFileList._titles) renderFileList._titles = {};
    const titles = renderFileList._titles;
    if (job.current_file) titles[total] = job.current_file;

    let html = '';
    for (let i = 1; i <= total; i++) {
        const pct = progress[i];
        const done = pct != null && pct >= 100;
        const title = titles[i] || `file ${i}`;
        const pctText = pct != null ? `${Math.round(pct)}%` : (done ? '✓' : '…');
        html += `<li class="file-row${done ? ' done' : ''}" title="${title.replace(/"/g, '&quot;')}">`
              + `<span class="file-idx">${i}</span>`
              + `<span class="file-title">${title}</span>`
              + `<span class="file-pct">${pctText}</span>`
              + `</li>`;
    }
    list.innerHTML = html;
    list.style.display = '';
}

/*
 * Re-attach to a download that was already running before a page refresh or
 * a trip to another page. The server kept the job alive in a background
 * thread; we just need to remember its id and resume polling. If the job is
 * already gone (finished/cancelled since we left), the first poll clears it.
 */
function restoreActiveJob() {
    const id = loadActiveJob();
    if (!id) return;
    jobId = id;
    // Show the progress panel immediately so the user isn't left staring at
    // an empty form while we wait for the first status update.
    show(els['status-section'], true);
    show(els['results-section'], false);
    els['download-btn'].style.display = 'none';
    els['cancel-btn'].style.display = '';
    setPill(true);
    timer = setInterval(poll, 1000);
    poll();
}

/*
 * Reset the UI back to its initial, idle state.
 */
function reset() {
    jobId = null;
    saveActiveJob(null);
    if (renderFileList._titles) renderFileList._titles = {};
    els['status-section'].style.display = 'none';
    els['results-section'].style.display = 'none';
    els['download-btn'].style.display = '';
    els['cancel-btn'].style.display = 'none';
    els['progress-fill'].style.width = '0%';
    els['progress-text'].textContent = '0%';
    els['status-message'].textContent = 'starting…';
    els['error-box'].style.display = 'none';
    els['file-list'].style.display = 'none';
    els['file-list'].innerHTML = '';
    els['file-counter'].textContent = '';
}

/*
 * Ask the backend to cancel the running job.
 */
async function cancelDownload() {
    if (!jobId) return;
    const r = await fetch(`/api/cancel/${jobId}`, { method: 'POST' });
    handle401(r);
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
        if (handle401(r)) return;
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
// Re-attach to a download that was running before a refresh / page change.
restoreActiveJob();
