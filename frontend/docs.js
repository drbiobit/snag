/*
 * Snag - API docs page logic
 *
 * Wires up click-to-copy on every code block. Clicking the "copy" button
 * (or the code block itself) copies the block's text to the clipboard and
 * briefly shows a "copied" confirmation.
 */

// Show the actual origin so the docs reflect where you're running from.
document.getElementById('base-url').textContent = window.location.origin;

// Copy text to the clipboard, with a fallback for older browsers.
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        // Fallback: use a hidden textarea + execCommand.
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return true;
        } catch (e2) {
            return false;
        }
    }
}

// Briefly flip the button label to "copied" then back.
function flash(btn) {
    const original = btn.textContent;
    btn.textContent = 'copied';
    btn.classList.add('done');
    setTimeout(() => {
        btn.textContent = original;
        btn.classList.remove('done');
    }, 1200);
}

// Wire up every copy button.
document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
        const code = btn.parentElement.querySelector('pre');
        if (await copyText(code.textContent)) flash(btn);
    });
});
