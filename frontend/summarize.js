/*
 * Snag - summarize page logic
 *
 * Three-step pipeline:
 *   1. Paste a YouTube URL (video, playlist or channel) -> fetch the transcript
 *      (backend runs yt-transcribe.py; collections are enumerated and combined)
 *   2. Review the transcript (downloadable as .md)
 *   3. Summarize it into an AI article (backend runs summarize.py against the
 *      configured OpenAI-compatible endpoint)
 *
 * State (url, transcript, article, options) is persisted to localStorage so a
 * page refresh or navigation does not lose work. "Clear" wipes it.
 *
 * On first run (no endpoint saved) a config card is shown to set the endpoint,
 * model and optional api key. Settings persist in the backend (meta table).
 */

const $ = id => document.getElementById(id);
const handle401 = r => { if (r.status === 401) { window.location.href = '/login'; return true; } return false; };

const LS_KEY = 'snag_summarize_state';

let lastTranscript = '';
let lastArticle = '';
let settings = {};
let summarizing = false;   // true while a summarize request is in flight
let transcripting = false; // true while a transcript request is in flight

// ---- Persistence ---------------------------------------------------------

function saveState(extra) {
    try {
        const state = {
            url: $('yt-url').value,
            type: $('yt-type').value,
            count: $('yt-count').value,
            langs: $('yt-langs').value,
            timestamps: $('yt-timestamps').checked,
            transcript: lastTranscript,
            article: lastArticle,
            model: $('model-select').value,
            temperature: $('temperature').value,
        };
        if (summarizing) state.in_progress = 'summarize';
        if (transcripting) state.in_progress = 'transcript';
        if (extra) Object.assign(state, extra);
        localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) { /* storage full or unavailable - ignore */ }
}

// Render a Markdown article as sanitized HTML. The article is AI-generated
// from arbitrary transcript content, so raw innerHTML (even from marked,
// which does NOT sanitize) would be an injection vector. We use an explicit
// allowlist (text + links only - no images, forms, iframes, scripts) so a
// crafted transcript can't smuggle active content into the page. Falls back
// to plain text when the vendored libs are unavailable.
function renderArticle(text) {
    const el = $('article');
    if (window.marked && window.DOMPurify) {
        try {
            el.innerHTML = DOMPurify.sanitize(marked.parse(text), {
            ALLOWED_TAGS: [
                'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
                'p', 'a', 'ul', 'ol', 'li', 'strong', 'em', 'del',
                'code', 'pre', 'blockquote', 'hr', 'br',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'span', 'div',
            ],
            ALLOWED_ATTR: ['href', 'title', 'class'],
            FORBID_TAGS: ['img', 'script', 'iframe', 'form', 'input', 'button',
                          'style', 'svg', 'math', 'audio', 'video', 'source'],
            FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover', 'onfocus', 'style'],
            });
        } catch (e) {
            el.textContent = text;   // sanitizer/parser failed: degrade to plain text
        }
    } else {
        el.textContent = text;
    }
}

function restoreState() {
    if (s.url) $('yt-url').value = s.url;
    if (s.type) $('yt-type').value = s.type;
    if (s.count) $('yt-count').value = s.count;
    if (s.langs) $('yt-langs').value = s.langs;
    if (typeof s.timestamps === 'boolean') $('yt-timestamps').checked = s.timestamps;
    if (s.temperature) $('temperature').value = s.temperature;

    if (s.transcript) {
        lastTranscript = s.transcript;
        $('transcript-text').textContent = s.transcript;
        $('transcript-card').style.display = '';
        $('summarize-card').style.display = '';
        $('transcript-meta').textContent = s.transcript.length.toLocaleString() + ' chars';
    }
    if (s.article) {
        lastArticle = s.article;
        renderArticle(s.article);
        $('result-meta').textContent = s.article.length.toLocaleString() + ' chars';
        $('result-card').style.display = '';
    }

    // A refresh (or navigation) can interrupt an in-flight request. The
    // backend job keeps running and will finish on its own, so the only thing
    // lost is the live status line. Restore a "still working" state so the
    // user sees the job is ongoing instead of a blank page that looks like
    // it restarted from scratch.
    if (s.in_progress) {
        if (s.in_progress === 'summarize') {
            summarizing = true;
            $('btn-summarize').disabled = true;
            setStatus('summarize-status', 'Summarize still running\u2026 it will appear here when done.', 'info', true);
        } else {
            transcripting = true;
            $('btn-transcript').disabled = true;
            setStatus('transcript-status', 'Transcript still fetching\u2026 it will appear here when done.', 'info', true);
        }
    }
}

// Re-run restoreState() once a request that survived a page refresh
// completes. Input fields are left alone (the user may have edited them,
// and the completed request already wrote fresh state) but the transcript
// and article are re-rendered, so a refresh that interrupted an in-flight
// job shows the result as soon as it lands.
function refreshState() {
    let s;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s) return;
    if (s.transcript) {
        lastTranscript = s.transcript;
        $('transcript-text').textContent = s.transcript;
        $('transcript-card').style.display = '';
        $('summarize-card').style.display = '';
        $('transcript-meta').textContent = s.transcript.length.toLocaleString() + ' chars';
    }
    if (s.article) {
        lastArticle = s.article;
        renderArticle(s.article);
        $('result-meta').textContent = s.article.length.toLocaleString() + ' chars';
        $('result-card').style.display = '';
    }
    // Drop the in-progress flags now that the request has completed.
    if (s.in_progress) {
        if (s.in_progress === 'summarize') {
            summarizing = false;
            $('btn-summarize').disabled = false;
        } else {
            transcripting = false;
            $('btn-transcript').disabled = false;
        }
    }
}

function clearState() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
}

// ---- Status helpers ------------------------------------------------------

function setStatus(id, msg, kind = 'info', spinner = false) {
    const el = $(id);
    el.className = 'status-line show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
    el.textContent = '';
    if (spinner) {
        const s = document.createElement('span');
        s.className = 'spinner';
        el.appendChild(s);
    }
    el.appendChild(document.createTextNode(msg));
}
function hideStatus(id) { $(id).className = 'status-line'; }

// ---- Settings ------------------------------------------------------------

async function loadSettings() {
    const r = await fetch('/api/ai/settings');
    if (handle401(r)) return;
    const d = await r.json();
    settings = d.settings || {};
    if (settings.ai_langs && !$('yt-langs').value) $('yt-langs').value = settings.ai_langs;
    if (settings.ai_temperature) $('temperature').value = settings.ai_temperature;
    $('system-prompt').value = settings.ai_system_prompt || '';
    // Timestamps default comes from settings unless the user already chose.
    if (settings.ai_timestamps !== undefined && !localStorage.getItem(LS_KEY)) {
        $('yt-timestamps').checked = settings.ai_timestamps !== '0';
    }
    if (!d.has_endpoint) showConfig();
}

function showConfig() {
    $('config-card').style.display = '';
    $('cfg-endpoint').value = settings.ai_endpoint || '';
    $('cfg-model').value = settings.ai_model || '';
    $('cfg-key').value = settings.ai_api_key || '';
    $('cfg-system-prompt').value = settings.ai_system_prompt || '';
}

// The system prompt auto-saves to the DB a moment after the user stops
// typing - no save button needed.
let spTimer = null;
function scheduleSavePrompt() {
    clearTimeout(spTimer);
    spTimer = setTimeout(savePrompt, 800);
}

async function savePrompt() {
    const val = $('system-prompt').value;
    try {
        const r = await fetch('/api/ai/settings', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ai_system_prompt: val })
        });
        if (handle401(r)) return;
        const d = await r.json();
        if (d.success) {
            settings.ai_system_prompt = val;
            $('sp-note').textContent = 'Saved \u2713';
        }
    } catch (e) { /* offline - the text stays in the field */ }
}

async function saveConfig() {
    const endpoint = $('cfg-endpoint').value.trim();
    if (!endpoint) { setStatus('cfg-status', 'Endpoint is required.', 'err'); return; }
    const body = {
        ai_endpoint: endpoint,
        ai_model: $('cfg-model').value.trim(),
        ai_api_key: $('cfg-key').value.trim(),
        ai_system_prompt: $('cfg-system-prompt').value,
    };
    const r = await fetch('/api/ai/settings', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (handle401(r)) return;
    const d = await r.json();
    if (!d.success) { setStatus('cfg-status', d.error || 'Save failed.', 'err'); return; }
    settings = d.settings;
    hideStatus('cfg-status');
    $('config-card').style.display = 'none';
    loadModels();
}

async function loadModels() {
    const sel = $('model-select');
    if (!settings.ai_endpoint) { sel.innerHTML = '<option value="">no endpoint set</option>'; return; }
    sel.innerHTML = '<option value="">loading\u2026</option>';
    try {
        const r = await fetch('/api/ai/models?endpoint=' + encodeURIComponent(settings.ai_endpoint));
        if (handle401(r)) return;
        const d = await r.json();
        sel.innerHTML = '';
        if (!d.success || !d.models.length) {
            const o = document.createElement('option');
            o.value = ''; o.textContent = '\u2014 no models found \u2014';
            sel.appendChild(o);
        } else {
            for (const m of d.models) {
                const o = document.createElement('option');
                o.value = m; o.textContent = m;
                if (m === settings.ai_model) o.selected = true;
                sel.appendChild(o);
            }
        }
    } catch {
        sel.innerHTML = '<option value="">\u2014 failed to load \u2014</option>';
    }
}

// ---- STEP 1: transcript --------------------------------------------------

async function getTranscript() {
    const url = $('yt-url').value.trim();
    if (!url) { setStatus('transcript-status', 'Enter a YouTube URL.', 'err'); return; }
    const body = {
        url,
        type: $('yt-type').value,
        count: $('yt-count').value.trim(),
        languages: $('yt-langs').value.trim() || 'en',
        timestamps: $('yt-timestamps').checked,
    };
    const isCollection = body.type !== 'video';
    setStatus('transcript-status',
        isCollection ? 'Enumerating and fetching transcripts\u2026 this can take a while.' : 'Fetching transcript\u2026',
        'info', true);
    $('btn-transcript').disabled = true;
    transcripting = true;
    saveState();
    try {
        const r = await fetch('/api/ai/transcript', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (handle401(r)) return;
        const d = await r.json();
        if (!d.success) { setStatus('transcript-status', d.error || 'Transcript failed.', 'err'); return; }
        lastTranscript = d.transcript;
        $('transcript-text').textContent = d.transcript;
        let meta = d.transcript.length.toLocaleString() + ' chars';
        if (d.count) meta = d.count + ' video(s) \u00b7 ' + meta;
        if (d.skipped) meta += ' \u00b7 ' + d.skipped + ' skipped (no captions)';
        $('transcript-meta').textContent = meta;
        $('transcript-card').style.display = '';
        $('summarize-card').style.display = '';
        setStatus('transcript-status', 'Transcript ready.', 'ok');
        saveState();
        loadModels();
    } catch (e) {
        setStatus('transcript-status', 'Request failed: ' + e.message, 'err');
    } finally {
        transcripting = false;
        $('btn-transcript').disabled = false;
        refreshState();
    }
}

// ---- STEP 3: summarize ---------------------------------------------------

async function summarize() {
    if (!lastTranscript) { setStatus('summarize-status', 'No transcript to summarize.', 'err'); return; }
    if (!settings.ai_endpoint) { showConfig(); setStatus('summarize-status', 'Configure the endpoint first.', 'err'); return; }
    const model = $('model-select').value;
    if (!model) { setStatus('summarize-status', 'Select or set a model.', 'err'); return; }
    const temperature = $('temperature').value;
    setStatus('summarize-status', 'Summarizing\u2026 this can take a while.', 'info', true);
    $('btn-summarize').disabled = true;
    summarizing = true;
    saveState();
    try {
        // The field is the source of truth - send it explicitly so the
        // article always uses what the user sees on screen.
        const r = await fetch('/api/ai/summarize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                transcript: lastTranscript, model, temperature,
                system_prompt: $('system-prompt').value
            })
        });
        if (handle401(r)) return;
        const d = await r.json();
        if (!d.success) { setStatus('summarize-status', d.error || 'Summarize failed.', 'err'); return; }
        lastArticle = d.article;
        renderArticle(d.article);
        $('result-meta').textContent = d.article.length.toLocaleString() + ' chars';
        $('result-card').style.display = '';
        setStatus('summarize-status', 'Done.', 'ok');
        saveState();
        $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        setStatus('summarize-status', 'Request failed: ' + e.message, 'err');
    } finally {
        summarizing = false;
        $('btn-summarize').disabled = false;
        refreshState();
    }
}

// ---- Downloads / copy ----------------------------------------------------

function downloadBlob(text, filename, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

function downloadTranscript() {
    if (!lastTranscript) return;
    downloadBlob(lastTranscript, 'snag-transcript.md', 'text/markdown');
}

function downloadArticle() {
    if (!lastArticle) return;
    downloadBlob(lastArticle, 'snag-summary.md', 'text/markdown');
}

async function copyArticle() {
    if (!lastArticle) return;
    try {
        await navigator.clipboard.writeText(lastArticle);
        const btn = $('btn-copy');
        btn.textContent = 'copied \u2713';
        setTimeout(() => { btn.textContent = 'copy markdown'; }, 1500);
    } catch {
        setStatus('summarize-status', 'Copy failed.', 'err');
    }
}

// ---- Reset ---------------------------------------------------------------

function clearAll() {
    lastTranscript = '';
    lastArticle = '';
    $('yt-url').value = '';
    $('yt-count').value = '';
    $('yt-type').value = 'auto';
    $('yt-timestamps').checked = true;
    $('transcript-card').style.display = 'none';
    $('summarize-card').style.display = 'none';
    $('result-card').style.display = 'none';
    hideStatus('transcript-status');
    hideStatus('summarize-status');
    clearState();
}

// ---- Wire up -------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
    $('btn-transcript').addEventListener('click', getTranscript);
    $('btn-summarize').addEventListener('click', summarize);
    $('btn-copy').addEventListener('click', copyArticle);
    $('btn-download').addEventListener('click', downloadArticle);
    $('btn-dl-transcript').addEventListener('click', downloadTranscript);
    $('btn-clear-all').addEventListener('click', clearAll);
    $('btn-refresh-models').addEventListener('click', loadModels);
    $('cfg-save').addEventListener('click', saveConfig);
    $('cfg-load-models').addEventListener('click', loadModels);

    // Auto-save the system prompt shortly after the user stops typing.
    $('system-prompt').addEventListener('input', scheduleSavePrompt);

    // The count field is only meaningful for collections.
    const typeSel = $('yt-type');
    const countField = $('count-field');
    function syncCountField() {
        const show = typeSel.value !== 'video';
        countField.style.display = show ? '' : 'none';
    }
    typeSel.addEventListener('change', syncCountField);
    syncCountField();

    // Persist options as they change (cheap, debounced by the browser).
    ['yt-url', 'yt-type', 'yt-count', 'yt-langs', 'temperature'].forEach(id => {
        $(id).addEventListener('change', saveState);
    });
    $('yt-timestamps').addEventListener('change', saveState);

    restoreState();
    loadSettings();
});
