(() => {
  'use strict';

  const ENDPOINT = '/api/synthesize';
  const IS_STATIC_PREVIEW = window.location.hostname.endsWith('.github.io');
  let procedureMap = null;
  let currentRecord = null;
  let currentProcedure = null;

  const dialog = document.getElementById('detailsPopup');
  const title = document.getElementById('detailsTitle');
  const content = document.getElementById('detailsContent');
  const output = document.getElementById('generatedOutput');
  const closeButton = document.getElementById('closePopup');
  const generateButton = document.getElementById('generateProcedure');
  const languageInput = document.getElementById('languageInput');

  if (!dialog || !title || !content || !output || !closeButton || !generateButton) {
    console.error('details.js: required DOM elements are missing');
    return;
  }

  async function loadProcedure(id) {
    if (!procedureMap) {
      const response = await fetch('data/procedures_405.json');
      if (!response.ok) throw new Error(`Could not load procedure data (HTTP ${response.status}).`);
      const data = await response.json();
      const procedures = Array.isArray(data.procedures) ? data.procedures : data;

      if (Array.isArray(procedures)) {
        procedureMap = Object.fromEntries(
          procedures.map(item => [String(item.procedure_information?.id || ''), item])
        );
      } else {
        procedureMap = procedures;
      }
    }

    return procedureMap[String(id)] || null;
  }

  function addCard(grid, label, value, options = {}) {
    const card = document.createElement('div');
    card.className = `detail-card${options.wide ? ' wide' : ''}`;

    const heading = document.createElement('span');
    heading.className = 'detail-label';
    heading.textContent = label;
    card.appendChild(heading);

    if (options.links) {
      const values = Array.isArray(value) ? value : [value].filter(Boolean);
      const wrapper = document.createElement('div');
      values.forEach((entry, index) => {
        if (index) wrapper.appendChild(document.createElement('br'));
        const link = document.createElement('a');
        link.className = 'doi-link';
        link.href = `https://doi.org/${encodeURI(entry)}`;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = entry;
        wrapper.appendChild(link);
      });
      if (!values.length) wrapper.textContent = 'Not reported';
      card.appendChild(wrapper);
    } else if (options.list) {
      const list = document.createElement('ul');
      (value || []).forEach(entry => {
        const item = document.createElement('li');
        if (options.chemical) {
          window.POM_UI.appendChemical(item, entry, options.mode || 'formula');
        } else {
          item.textContent = entry;
        }
        list.appendChild(item);
      });
      if (!list.children.length) {
        const empty = document.createElement('p');
        empty.textContent = 'Not reported';
        card.appendChild(empty);
      } else {
        card.appendChild(list);
      }
    } else {
      const paragraph = document.createElement('p');
      if (options.href && value) {
        const link = document.createElement('a');
        link.className = 'doi-link';
        link.href = options.href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = String(value);
        paragraph.appendChild(link);
      } else if (options.chemical) {
        window.POM_UI.appendChemical(paragraph, value || 'Not reported', options.mode || 'formula');
      } else {
        paragraph.textContent = String(value || 'Not reported');
      }
      card.appendChild(paragraph);
    }

    grid.appendChild(card);
  }

  function describeStep(step) {
    const parts = [step.unit_operation || `Step ${step.step_number || ''}`];
    const reagents = (step.reagent_usage || []).map(item => item.name).filter(Boolean);
    if (reagents.length) parts.push(reagents.join(', '));

    if (step.time) {
      if (step.time.value != null) {
        parts.push(`${step.time.value} ${step.time.unit || ''}`.trim());
      } else if (step.time.end_condition) {
        parts.push(step.time.end_condition);
      }
    }

    if (step.temperature) {
      if (typeof step.temperature === 'object') {
        const temperature = [step.temperature.value, step.temperature.unit].filter(value => value != null).join(' ');
        if (temperature) parts.push(temperature);
      } else {
        parts.push(String(step.temperature));
      }
    }

    return parts.join(' — ');
  }

  function renderRecord(record, procedure) {
    title.textContent = record.id;
    content.replaceChildren();

    const grid = document.createElement('div');
    grid.className = 'detail-grid';
    addCard(grid, 'Target compound', record.targetCompound, { chemical: true });
    addCard(grid, 'Number of steps', record.numSteps);
    addCard(grid, 'Elements present', (record.elements || []).join(', '));
    addCard(grid, 'Source DOI', record.dois || [], { links: true });
    addCard(grid, 'Starting addenda', record.addendaSource, { list: true, chemical: true });
    addCard(grid, 'Unit operations', record.operations, { list: true });
    addCard(grid, 'Reagents', record.reagents, {
      list: true,
      chemical: true,
      mode: 'text',
      wide: true
    });
    content.appendChild(grid);

    const steps = procedure?.procedure_steps || [];
    if (steps.length) {
      const disclosure = document.createElement('details');
      disclosure.className = 'data-note';
      const summary = document.createElement('summary');
      summary.textContent = `View ${steps.length} extracted steps`;
      disclosure.appendChild(summary);

      const list = document.createElement('ol');
      list.className = 'step-list';
      steps.forEach(step => {
        const item = document.createElement('li');
        item.textContent = describeStep(step);
        list.appendChild(item);
      });
      disclosure.appendChild(list);
      content.appendChild(disclosure);
    }
  }

  async function openRecord(record, trigger) {
    currentRecord = record;
    currentProcedure = null;
    output.hidden = true;
    output.className = 'generated-output';
    output.replaceChildren();
    generateButton.disabled = true;

    title.textContent = record.id;
    content.textContent = 'Loading structured procedure details…';
    dialog.showModal();

    try {
      currentProcedure = await loadProcedure(record.id);
      renderRecord(record, currentProcedure);
      generateButton.disabled = !currentProcedure || IS_STATIC_PREVIEW;
      if (IS_STATIC_PREVIEW && currentProcedure) {
        generateButton.textContent = 'Available on full site';
        output.textContent = 'Readable-procedure generation is unavailable in this static preview.';
        output.hidden = false;
      }
      if (!currentProcedure) {
        output.textContent = 'No structured procedure is available for this record.';
        output.classList.add('error');
        output.hidden = false;
      }
    } catch (error) {
      content.textContent = error.message;
      output.textContent = 'Procedure generation is unavailable because the source record could not be loaded.';
      output.classList.add('error');
      output.hidden = false;
    }

    closeButton.focus();
    dialog.dataset.triggerId = trigger?.dataset.id || '';
  }

  async function generateProcedure() {
    if (!currentRecord || !currentProcedure || IS_STATIC_PREVIEW) return;

    const language = languageInput.value.trim() || 'English';
    const originalLabel = generateButton.textContent;
    generateButton.disabled = true;
    generateButton.replaceChildren();

    const spinner = document.createElement('span');
    spinner.className = 'spinner';
    spinner.setAttribute('aria-hidden', 'true');
    generateButton.append(spinner, document.createTextNode('Generating…'));

    output.className = 'generated-output';
    output.textContent = 'Generating a procedure grounded in this structured record…';
    output.hidden = false;

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pomId: currentRecord.id,
          procedure: currentProcedure,
          language
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || payload.text || `Server error ${response.status}`);
      }
      output.textContent = payload.text || 'The model returned an empty response.';
    } catch (error) {
      output.textContent = `Generation failed: ${error.message}`;
      output.classList.add('error');
    } finally {
      generateButton.textContent = originalLabel;
      generateButton.disabled = false;
    }
  }

  document.addEventListener('click', event => {
    const link = event.target.closest('.details-link');
    if (!link) return;
    event.preventDefault();

    const record = (window.POM_DATA || []).find(item => String(item.id) === link.dataset.id);
    if (record) openRecord(record, link);
  });

  closeButton.addEventListener('click', () => dialog.close());
  generateButton.addEventListener('click', generateProcedure);

  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    const outside = (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    );
    if (outside) dialog.close();
  });

  dialog.addEventListener('close', () => {
    const trigger = [...document.querySelectorAll('.details-link')]
      .find(link => link.dataset.id === dialog.dataset.triggerId);
    trigger?.focus();
  });
})();

