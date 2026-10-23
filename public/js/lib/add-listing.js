import { api, sleep } from './api.js';
import { bindDialog } from './dialog.js';
import { formatPrice } from './format.js';

/**
 * The "Save an item" modal (views/partials/add-listing-modal.ejs).
 *
 *   link     paste a URL
 *   preview  a supported marketplace: the server scrapes it in a background
 *            job, we poll, and show what it found
 *   manual   any other site, or no link: an editable form, prefilled from the
 *            page's own metadata when the server can read it
 *
 * Both save steps submit a real form; the server redirects with a flash.
 */

// Scraping runs in a background worker, so the client enqueues and polls,
// backing off from 1s to 3s.
const POLL_START_MS = 1000;
const POLL_MAX_MS = 3000;
const POLL_CEILING_MS = 90000;

/** Poll a scrape job until it finishes; throws with the worker's message. */
async function waitForJob(jobId, signal) {
  const deadline = Date.now() + POLL_CEILING_MS;
  let delay = POLL_START_MS;

  while (Date.now() < deadline) {
    await sleep(delay, signal);
    delay = Math.min(delay * 1.5, POLL_MAX_MS);

    const job = await api(`/items/jobs/${jobId}`, { signal });
    if (job.status === 'done') return job.item;
    if (job.status === 'failed') throw new Error(job.error || 'Could not fetch that listing.');
    // queued / running — keep waiting.
  }
  throw new Error('That listing is taking longer than expected. Please try again.');
}

function hostOf(link) {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch (err) {
    return 'that page';
  }
}

export function initAddListing() {
  const modal = document.getElementById('addListingModal');
  if (!modal) return;

  const $ = (id) => document.getElementById(id);
  const previewForm = $('previewForm');
  const linkInput = $('link');
  const previewError = $('previewError');
  const previewErrorText = $('previewErrorText');
  const manualFromError = $('manualFromError');
  const manualForm = $('manualForm');
  const manualStatus = $('manualStatus');
  const steps = [...modal.querySelectorAll('[data-modal-step]')];
  const stepperSteps = [...modal.querySelectorAll('.modal-stepper .step')];

  let inflight = null;   // AbortController for the current preview/prefill

  const abortInflight = () => {
    if (inflight) inflight.abort();
    inflight = null;
  };

  const dialog = bindDialog(modal, { onClose: abortInflight });

  function showStep(name) {
    steps.forEach(el => el.classList.toggle('is-active', el.dataset.modalStep === name));
    const n = name === 'link' ? 1 : 2;
    stepperSteps.forEach(el => el.classList.toggle('active', Number(el.dataset.step) === n));
  }

  function showError(message, { offerManual = false } = {}) {
    previewErrorText.textContent = message;
    manualFromError.hidden = !offerManual;
    previewError.classList.add('is-visible');
  }

  function clearError() {
    previewError.classList.remove('is-visible');
    manualFromError.hidden = true;
  }

  function setBusy(busy) {
    const btn = previewForm.querySelector('button[type="submit"]');
    btn.classList.toggle('btn-loading', busy);
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.disabled = busy;
    linkInput.disabled = busy;
  }

  function open() {
    abortInflight();
    showStep('link');
    clearError();
    previewForm.reset();
    manualForm.reset();
    dialog.open();
    requestAnimationFrame(() => linkInput.focus());
  }

  // ── Scraped preview ──────────────────────────────────────────────────────

  function renderPreview(item, link) {
    $('previewTitle').textContent = item.title || 'Untitled';
    $('previewPrice').textContent = formatPrice(item.price);
    $('previewCondition').textContent = item.condition || '';
    $('previewLocation').textContent = item.location || '';
    $('previewDesc').textContent = item.description || '';

    const img = $('previewImage');
    if (item.imageLinks?.[0]) {
      img.src = item.imageLinks[0];
      img.classList.add('is-visible');
    } else {
      img.removeAttribute('src');
      img.classList.remove('is-visible');
    }

    // Name the already-saved item; no listing content goes back to the server.
    $('finalItemId').value = item._id || '';
    $('finalLink').value = link;
    showStep('preview');
  }

  // ── Manual entry ─────────────────────────────────────────────────────────

  /** Fill only fields the user has not typed into. */
  function fillManual(data) {
    const set = (name, value) => {
      const field = manualForm.elements[name];
      if (!field || field.value || value === null || value === undefined || value === '') return;
      field.value = value;
    };
    set('title', data.title);
    set('price', data.price);
    set('condition', data.condition);
    set('link', data.link);
    set('imageLinks', (data.imageLinks || []).join('\n'));
    set('location', data.location);
    set('description', data.description);
  }

  async function goManual(link) {
    abortInflight();
    manualForm.reset();
    showStep('manual');

    if (!link) {
      manualStatus.textContent = 'Fill in what you know. Only the title is required.';
      requestAnimationFrame(() => manualForm.elements.title.focus());
      return;
    }

    fillManual({ link });
    manualStatus.textContent = `Reading details from ${hostOf(link)}…`;
    manualForm.setAttribute('aria-busy', 'true');
    inflight = new AbortController();

    try {
      const { prefill } = await api('/items/prefill', { method: 'POST', json: { link }, signal: inflight.signal });
      fillManual(prefill);
      manualStatus.textContent = prefill.title
        ? 'We filled in what we could find. Check it before saving.'
        : `We could not read ${hostOf(link)}. Fill in the details below.`;
    } catch (err) {
      if (err.name === 'AbortError') return;
      manualStatus.textContent = err.message || 'Fill in the details below.';
    } finally {
      manualForm.removeAttribute('aria-busy');
      inflight = null;
    }
    requestAnimationFrame(() => manualForm.elements.title.focus());
  }

  // ── Wiring ───────────────────────────────────────────────────────────────

  document.addEventListener('click', (e) => {
    if (e.target.closest('#openAddModal, #openAddModalEmpty, [data-open-add-modal]')) open();
  });

  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-back-to-link]')) {
      abortInflight();
      showStep('link');
    }
  });

  $('openManual').addEventListener('click', () => goManual(linkInput.value.trim()));
  manualFromError.addEventListener('click', () => goManual(linkInput.value.trim()));

  previewForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const link = linkInput.value.trim();
    clearError();
    setBusy(true);
    abortInflight();
    inflight = new AbortController();
    const { signal } = inflight;

    try {
      const { jobId } = await api('/items/preview', { method: 'POST', json: { link }, signal });
      const item = await waitForJob(jobId, signal);
      renderPreview(item, link);
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (err.code === 'UNSUPPORTED') {
        // Not a marketplace we scrape: go straight to the manual form.
        setBusy(false);
        goManual(link);
        return;
      }
      // A scrape that failed can still be saved by hand.
      showError(err.message, { offerManual: Boolean(link) });
    } finally {
      setBusy(false);
      if (inflight?.signal === signal) inflight = null;
    }
  });
}
