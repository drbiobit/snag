/*
 * Snag - summarize page logic
 *
 * Three-step pipeline:
 *   1. Paste a YouTube URL -> fetch the transcript (backend runs yt-transcribe.py)
 *   2. Review the transcript
 *   3. Summarize it into an AI article (backend runs summarize.py against the
 *      configured OpenAI-compatible endpoint)
 *
 * On first run (no endpoint saved) a config card is shown to set the endpoint,
 * model and optional api key. Settings persist in the backend (meta table).
 */

const $ = id => document.getElementById(id);
const handle401 = r => { if (r.status === 401) { window.location.href = '/login'; return true; } return false; };

let lastTranscript = '';
let lastArticle = '';
let settings = {};

// Show a status line (info / ok / err) with an optional spinner.
function setStatus(id, msg, kind = 'info', spinner = false) {
    const el = $(id);
    el.className = 'status-line show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
    el.innerHTML = (spinner ? '<span class="spinner"></span>' : '') + msg;
}
function hideStatus(id) { $(id).className = 'status-line'; }

// Load saved AI settings from the backend.
async function loadSettings() {
    const r = await fetch('/api/ai/settings');
    if (handle401(r)) return;
    const d = await r.json();
    settings = d.settings || {};
    if (settings.ai_langs) $('yt-langs').value = settings.ai_langs;
    if (settings.ai_temperature) $('temperature').value = settings.ai_temperature;
    if (!d.has_endpoint) showConfig();
}

function showConfig() {
    $('config-card').style.display = '';
    $('cfg-endpoint').value = settings.ai_endpoint || '';
    $('cfg-model').value = settings.ai_model || '';
    $('cfg-key').value = settings.ai_api_key || '';
}

// Save endpoint / model / key from the config card.
async function saveConfig() {
    const endpoint = $('cfg-endpoint').value.trim();
    if (!endpoint) { setStatus('cfg-status', 'Endpoint is required.', 'err'); return; }
    const body = {
        ai_endpoint: endpoint,
        ai_model: $('cfg-model').value.trim(),
        ai_api_key: $('cfg-key').value.trim(),
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

// Populate the model dropdown from the configured endpoint.
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

// STEP 1: fetch the transcript.
async function getTranscript() {
    const url = $('yt-url').value.trim();
    if (!url) { setStatus('transcript-status', 'Enter a YouTube URL or video id.', 'err'); return; }
    const langs = $('yt-langs').value.trim() || 'en';
    setStatus('transcript-status', 'Fetching transcript\u2026', 'info', true);
    $('btn-transcript').disabled = true;
    try {
        const r = await fetch('/api/ai/transcript', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, languages: langs })
        });
        if (handle401(r)) return;
        const d = await r.json();
        if (!d.success) { setStatus('transcript-status', d.error || 'Transcript failed.', 'err'); return; }
        lastTranscript = d.transcript;
        $('transcript-text').textContent = d.transcript;
        $('transcript-meta').textContent = (d.video_id ? '#' + d.video_id + ' \u00b7 ' : '') + d.transcript.length.toLocaleString() + ' chars';
        $('transcript-card').style.display = '';
        $('summarize-card').style.display = '';
        setStatus('transcript-status', 'Transcript ready.', 'ok');
        loadModels();
    } catch (e) {
        setStatus('transcript-status', 'Request failed: ' + e.message, 'err');
    } finally {
        $('btn-transcript').disabled = false;
    }
}

// STEP 3: summarize the transcript into an article.
async function summarize() {
    if (!lastTranscript) { setStatus('summarize-status', 'No transcript to summarize.', 'err'); return; }
    if (!settings.ai_endpoint) { showConfig(); setStatus('summarize-status', 'Configure the endpoint first.', 'err'); return; }
    const model = $('model-select').value;
    if (!model) { setStatus('summarize-status', 'Select or set a model.', 'err'); return; }
    const temperature = $('temperature').value;
    setStatus('summarize-status', 'Summarizing\u2026 this can take a while.', 'info', true);
    $('btn-summarize').disabled = true;
    try {
        const r = await fetch('/api/ai/summarize', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript: lastTranscript, model, temperature })
        });
        if (handle401(r)) return;
        const d = await r.json();
        if (!d.success) { setStatus('summarize-status', d.error || 'Summarize failed.', 'err'); return; }
        lastArticle = d.article;
        $('article').innerHTML = window.marked ? marked.parse(d.article) : d.article;
        $('result-meta').textContent = d.article.length.toLocaleString() + ' chars';
        $('result-card').style.display = '';
        setStatus('summarize-status', 'Done.', 'ok');
        $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        setStatus('summarize-status', 'Request failed: ' + e.message, 'err');
    } finally {
        $('btn-summarize').disabled = false;
    }
}

// Copy the raw markdown to the clipboard.
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

// Download the article as a .md file.
function downloadArticle() {
    if (!lastArticle) return;
    const blob = new Blob([lastArticle], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'snag-summary.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

// Reset the whole pipeline.
function clearAll() {
    lastTranscript = '';
    lastArticle = '';
    $('yt-url').value = '';
    $('transcript-card').style.display = 'none';
    $('summarize-card').style.display = 'none';
    $('result-card').style.display = 'none';
    hideStatus('transcript-status');
    hideStatus('summarize-status');
}

// Wire up the UI.
document.addEventListener('DOMContentLoaded', () => {
    $('btn-transcript').addEventListener('click', getTranscript);
    $('btn-summarize').addEventListener('click', summarize);
    $('btn-copy').addEventListener('click', copyArticle);
    $('btn-download').addEventListener('click', downloadArticle);
    $('btn-clear-all').addEventListener('click', clearAll);
    $('btn-refresh-models').addEventListener('click', loadModels);
    $('cfg-save').addEventListener('click', saveConfig);
    $('cfg-load-models').addEventListener('click', loadModels);
    loadSettings();
});
