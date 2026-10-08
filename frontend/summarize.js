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

// ---- Persistence ---------------------------------------------------------

function saveState() {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify({
            url: $('yt-url').value,
            type: $('yt-type').value,
            count: $('yt-count').value,
            langs: $('yt-langs').value,
            timestamps: $('yt-timestamps').checked,
            transcript: lastTranscript,
            article: lastArticle,
            model: $('model-select').value,
            temperature: $('temperature').value,
        }));
    } catch (e) { /* storage full or unavailable - ignore */ }
}

function restoreState() {
    let s;
    try { s = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { s = null; }
    if (!s) return;
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
        $('article').innerHTML = window.marked ? marked.parse(s.article) : s.article;
        $('result-meta').textContent = s.article.length.toLocaleString() + ' chars';
        $('result-card').style.display = '';
    }
}

function clearState() {
    try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ }
}

// ---- Status helpers ------------------------------------------------------

function setStatus(id, msg, kind = 'info', spinner = false) {
    const el = $(id);
    el.className = 'status-line show' + (kind === 'err' ? ' err' : kind === 'ok' ? ' ok' : '');
    el.innerHTML = (spinner ? '<span class="spinner"></span>' : '') + msg;
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
}

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
        $('btn-transcript').disabled = false;
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
        saveState();
        $('result-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        setStatus('summarize-status', 'Request failed: ' + e.message, 'err');
    } finally {
        $('btn-summarize').disabled = false;
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
