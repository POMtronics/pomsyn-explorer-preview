(() => {
  'use strict';

  const CONFIG = {
    dataFile: 'data/search_index_405.json',
    metadataFile: 'data/procedure_metadata.json',
    pageSize: 50
  };

  const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
  const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
  const ASCII_DIGITS = '0123456789';
  const MINUS_SIGNS = '-−⁻';
  const PLUS_SIGNS = '+⁺';

  let fullDataset = [];
  let filteredDataset = [];
  let activeLabels = new Set();
  let visibleCount = CONFIG.pageSize;

  const ELEMENT_SYMBOLS = new Set(
    'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'.split(' ')
  );

  function deriveElements(value) {
    const formula = String(value || '');
    const bracketBlocks = [...formula.matchAll(/\[([^\[\]]+)\]/g)].map(match => match[1]);
    const pomBlocks = bracketBlocks.filter(block => /(?:W|Mo|V|Nb|Ta)/.test(block));
    const candidates = pomBlocks.length ? pomBlocks : bracketBlocks;
    const core = candidates.sort((a, b) => b.length - a.length)[0] || formula;
    const withoutOxidationStates = core
      // (CoII) -> (Co): inline Roman numeral inside the parentheses
      .replace(/\(([A-Z][a-z]?)(?:VIII|VII|VI|IV|III|II|IX|V|I)\)/g, '($1)')
      // Fe(III) -> Fe, except C(V) -> CV: carbon(V) cannot exist, so there
      // the parenthesised V is the element itself, not an oxidation state
      .replace(/([A-Z][a-z]?)\((?:I|V|X)+\)/g, (match, element) => (
        element === 'C' && match === 'C(V)' ? 'CV' : element
      ));
    const symbols = withoutOxidationStates.match(/[A-Z][a-z]?/g) || [];
    return [...new Set(symbols.filter(symbol => ELEMENT_SYMBOLS.has(symbol)))];
  }

  function normaliseElement(value) {
    const trimmed = String(value || '').trim();
    return trimmed ? trimmed[0].toUpperCase() + trimmed.slice(1).toLowerCase() : '';
  }

  function normaliseDoi(value) {
    return String(value || '')
      .trim()
      .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '')
      .replace(/^doi\s*:\s*/i, '')
      .toLowerCase();
  }

  function mappedDigit(char, alphabet) {
    const index = alphabet.indexOf(char);
    return index >= 0 ? ASCII_DIGITS[index] : char;
  }

  function appendScript(parent, tagName, text) {
    const node = document.createElement(tagName);
    node.textContent = text;
    parent.appendChild(node);
  }

  function looksLikeFormula(value) {
    const compact = value.trim();
    if (!compact || /\s{2,}/.test(compact)) return false;
    return (
      /^[\[({]?[A-Zα-ωΑ-Ω]/u.test(compact) &&
      /(?:[A-Za-zα-ωΑ-Ω][0-9₀-₉]|[\])][0-9]|·|\[[^\]]+\])/u.test(compact)
    );
  }

  function normaliseFormulaNotation(value) {
    const greekPrefixes = {
      a: 'α',
      b: 'β',
      g: 'γ',
      y: 'γ',
      d: 'δ',
      e: 'ε'
    };

    return value.replace(/(^|[\[({-])([abgdey])(?=\d*-)/g, (match, boundary, prefix) => (
      boundary + greekPrefixes[prefix]
    ));
  }

  function appendChemical(parent, value, mode = 'formula') {
    const rawText = String(value ?? '');
    const formulaMode = mode === 'formula' || looksLikeFormula(rawText);
    const text = formulaMode ? normaliseFormulaNotation(rawText) : rawText;
    parent.classList.add('chemical');

    for (let index = 0; index < text.length;) {
      const char = text[index];

      if (formulaMode && char === '(' && /[A-Z][a-z]?$/.test(text.slice(0, index))) {
        const oxidationState = text.slice(index).match(/^\(((?:I|V|X)+(?:\/(?:I|V|X)+)?)\)/);
        if (oxidationState) {
          appendScript(parent, 'sup', oxidationState[0]);
          index += oxidationState[0].length;
          continue;
        }
      }

      if (SUBSCRIPT_DIGITS.includes(char)) {
        let digits = '';
        while (index < text.length && SUBSCRIPT_DIGITS.includes(text[index])) {
          digits += mappedDigit(text[index], SUBSCRIPT_DIGITS);
          index += 1;
        }
        appendScript(parent, 'sub', digits);
        continue;
      }

      if (SUPERSCRIPT_DIGITS.includes(char)) {
        let digits = '';
        while (index < text.length && SUPERSCRIPT_DIGITS.includes(text[index])) {
          digits += mappedDigit(text[index], SUPERSCRIPT_DIGITS);
          index += 1;
        }
        while (index < text.length && (PLUS_SIGNS + MINUS_SIGNS).includes(text[index])) {
          digits += MINUS_SIGNS.includes(text[index]) ? '−' : '+';
          index += 1;
        }
        appendScript(parent, 'sup', digits);
        continue;
      }

      if (/\d/.test(char)) {
        let end = index;
        while (end < text.length && /\d/.test(text[end])) end += 1;
        const digits = text.slice(index, end);
        const previous = text[index - 1] || '';
        const next = text[end] || '';
        const afterSign = text[end + 1] || '';
        const isotopePrefix = (
          Number(digits) >= 10 &&
          (index === 0 || /[\s([{,]/.test(previous)) &&
          /^[A-Z][a-z]?-/.test(text.slice(end))
        );
        const isCharge = (
          formulaMode &&
          next !== '' &&
          (PLUS_SIGNS + MINUS_SIGNS).includes(next) &&
          !/\d/.test(afterSign) &&
          !(next === '-' && /[A-Za-z]/.test(afterSign))
        );
        const isIndex = formulaMode && /[A-Za-zα-ωΑ-Ω)\]}]/u.test(previous);

        if (isCharge) {
          const sign = MINUS_SIGNS.includes(next) ? '−' : '+';
          appendScript(parent, 'sup', digits + sign);
          index = end + 1;
          continue;
        }
        if (isotopePrefix) {
          appendScript(parent, 'sup', digits);
          index = end;
          continue;
        }
        if (isIndex) {
          appendScript(parent, 'sub', digits);
          index = end;
          continue;
        }
      }

      if (formulaMode && (PLUS_SIGNS + MINUS_SIGNS).includes(char) && /[\])}]/.test(text[index - 1] || '')) {
        appendScript(parent, 'sup', MINUS_SIGNS.includes(char) ? '−' : '+');
        index += 1;
        continue;
      }

      parent.appendChild(document.createTextNode(char));
      index += 1;
    }

    return parent;
  }

  window.POM_UI = { appendChemical };

  function createCell(label, value, options = {}) {
    const td = document.createElement('td');
    td.dataset.label = label;

    if (options.chemical) {
      const values = Array.isArray(value) ? value : [value];
      values.forEach((entry, index) => {
        if (index) td.appendChild(document.createTextNode(options.separator || ', '));
        appendChemical(td, entry, options.mode || 'formula');
      });
    } else {
      td.textContent = Array.isArray(value) ? value.join(options.separator || ', ') : String(value ?? '');
    }

    return td;
  }

  function createDoiCell(dois) {
    const td = document.createElement('td');
    td.dataset.label = 'Source DOI';
    const values = Array.isArray(dois) ? dois : [dois].filter(Boolean);
    if (!values.length) {
      td.textContent = '—';
      return td;
    }

    values.forEach((doi, index) => {
      if (index) td.appendChild(document.createElement('br'));
      const link = document.createElement('a');
      link.className = 'doi-link';
      link.href = `https://doi.org/${encodeURI(doi)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = doi;
      td.appendChild(link);
    });
    return td;
  }

  function sortedRecords(dataset) {
    return [...dataset].sort((a, b) =>
      String(a.id).localeCompare(String(b.id), undefined, { numeric: true, sensitivity: 'base' })
    );
  }

  function renderTable() {
    const tbody = document.querySelector('#resultsTable tbody');
    const status = document.getElementById('resultStatus');
    const moreButton = document.getElementById('loadMoreButton');
    tbody.replaceChildren();

    const sorted = sortedRecords(filteredDataset);
    const visible = sorted.slice(0, visibleCount);

    status.textContent = sorted.length > visible.length
      ? `Showing ${visible.length} of ${sorted.length} records`
      : sorted.length ? `Showing ${sorted.length} matching ${sorted.length === 1 ? 'record' : 'records'}` : 'No matching records';

    if (!visible.length) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 8;
      cell.className = 'empty-state';
      cell.textContent = 'No records match these filters. Try removing one or more filters.';
      row.appendChild(cell);
      tbody.appendChild(row);
      moreButton.hidden = true;
      return;
    }

    const fragment = document.createDocumentFragment();
    visible.forEach(item => {
      const row = document.createElement('tr');

      const idCell = createCell('Procedure', '');
      const link = document.createElement('a');
      link.href = '#';
      link.className = 'details-link';
      link.dataset.id = String(item.id);
      link.textContent = String(item.id);
      link.setAttribute('aria-label', `Open details for procedure ${item.id}`);
      idCell.appendChild(link);
      row.appendChild(idCell);

      row.appendChild(createCell('Target compound', item.targetCompound, { chemical: true }));
      row.appendChild(createCell('Elements', item.elements || [], { separator: ', ' }));
      row.appendChild(createCell('Starting addenda', item.addendaSource || [], {
        chemical: true,
        separator: ' · '
      }));
      row.appendChild(createCell('Reagents', item.reagents || [], {
        chemical: true,
        mode: 'text',
        separator: ', '
      }));
      row.appendChild(createCell('Steps', item.numSteps));
      row.appendChild(createCell('Unit operations', item.operations || [], { separator: ', ' }));
      row.appendChild(createDoiCell(item.dois));
      fragment.appendChild(row);
    });

    tbody.appendChild(fragment);
    moreButton.hidden = visible.length >= sorted.length;
  }

  function hydrateLabelSelect() {
    const select = document.getElementById('searchLabel');
    const anyOption = document.createElement('option');
    anyOption.value = '';
    anyOption.textContent = 'Any addenda source';
    select.appendChild(anyOption);

    const labels = [...new Set(fullDataset.flatMap(item => item.addendaSource || []))]
      .sort((a, b) => String(a).localeCompare(String(b)));

    labels.forEach(label => {
      const option = document.createElement('option');
      option.value = label;
      option.textContent = label;
      select.appendChild(option);
    });
  }

  function hydrateOperationSelect() {
    const select = document.getElementById('searchOperation');
    const anyOption = document.createElement('option');
    anyOption.value = '';
    anyOption.textContent = 'Any unit operation';
    select.appendChild(anyOption);

    const operations = [...new Set(fullDataset.flatMap(item => item.operations || []))]
      .sort((a, b) => String(a).localeCompare(String(b)));

    operations.forEach(operation => {
      const option = document.createElement('option');
      option.value = operation;
      option.textContent = operation;
      select.appendChild(option);
    });
  }

  function redrawLabels() {
    const box = document.getElementById('chosenLabels');
    box.replaceChildren();

    activeLabels.forEach(label => {
      const pill = document.createElement('span');
      pill.className = 'pill';
      appendChemical(pill, label);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${label} filter`);
      remove.addEventListener('click', () => {
        activeLabels.delete(label);
        redrawLabels();
      });
      pill.appendChild(remove);
      box.appendChild(pill);
    });
  }

  function initLabelPicker() {
    const select = document.getElementById('searchLabel');
    select.addEventListener('change', () => {
      if (select.value) activeLabels.add(select.value);
      select.value = '';
      redrawLabels();
    });
  }

  function collectFilters() {
    const formData = new FormData(document.getElementById('searchForm'));
    const ids = String(formData.get('pomId') || '')
      .split(/[,\s]+/)
      .map(value => value.trim())
      .filter(Boolean);

    return {
      ids,
      elements: String(formData.get('elements') || '')
        .split(/[,\s]+/)
        .map(normaliseElement)
        .filter(Boolean),
      doi: normaliseDoi(formData.get('doi')),
      reagent: String(formData.get('reagent') || '').trim(),
      operation: String(formData.get('operation') || '').trim(),
      target: String(formData.get('target') || '').trim(),
      stepsMin: String(formData.get('stepsMin') || '').trim(),
      stepsMax: String(formData.get('stepsMax') || '').trim(),
      labels: [...activeLabels]
    };
  }

  function matchesFilters(item, filters) {
    const contains = (value, query) =>
      String(value || '').toLocaleLowerCase().includes(query.toLocaleLowerCase());

    if (filters.ids.length) {
      const itemId = String(item.id).toLowerCase();
      const idMatches = filters.ids.some(query => {
        const wanted = query.toLowerCase();
        return itemId === wanted || itemId.startsWith(`${wanted}-`);
      });
      if (!idMatches) return false;
    }
    if (filters.elements.length) {
      const itemElements = new Set((item.elements || []).map(normaliseElement));
      if (!filters.elements.every(element => itemElements.has(element))) return false;
    }
    if (filters.doi && !(item.dois || []).some(doi => normaliseDoi(doi).includes(filters.doi))) return false;
    if (filters.reagent && !(item.reagents || []).some(value => contains(value, filters.reagent))) return false;
    if (filters.operation && !(item.operations || []).some(value => contains(value, filters.operation))) return false;
    if (filters.target && !contains(item.targetCompound, filters.target)) return false;
    if (filters.stepsMin && Number(item.numSteps) < Number(filters.stepsMin)) return false;
    if (filters.stepsMax && Number(item.numSteps) > Number(filters.stepsMax)) return false;
    if (filters.labels.length && !filters.labels.some(label => (item.addendaSource || []).includes(label))) return false;
    return true;
  }

  function showFormError(message = '') {
    const error = document.getElementById('formError');
    error.textContent = message;
    error.hidden = !message;
  }

  function bindFormEvents() {
    const form = document.getElementById('searchForm');

    form.addEventListener('submit', event => {
      event.preventDefault();
      const filters = collectFilters();
      if (filters.stepsMin && filters.stepsMax && Number(filters.stepsMin) > Number(filters.stepsMax)) {
        showFormError('Minimum steps cannot be greater than maximum steps.');
        document.getElementById('searchStepsMin').focus();
        return;
      }

      showFormError();
      filteredDataset = fullDataset.filter(item => matchesFilters(item, filters));
      visibleCount = CONFIG.pageSize;
      renderTable();
      document.getElementById('resultsHeading').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    form.addEventListener('reset', () => {
      activeLabels.clear();
      redrawLabels();
      showFormError();
      filteredDataset = [...fullDataset];
      visibleCount = CONFIG.pageSize;
      setTimeout(renderTable, 0);
    });

    document.getElementById('loadMoreButton').addEventListener('click', () => {
      visibleCount += CONFIG.pageSize;
      renderTable();
    });
  }

  function bindVideo() {
    const toggle = document.getElementById('videoToggle');
    const container = document.getElementById('videoContainer');
    const video = document.getElementById('customVideo');

    toggle.addEventListener('click', () => {
      const opens = container.hidden;
      container.hidden = !opens;
      toggle.setAttribute('aria-expanded', String(opens));
      toggle.lastChild.textContent = opens ? ' Hide the short overview' : ' Watch the short overview';
      if (!opens) video.pause();
    });
  }

  async function init() {
    bindVideo();

    try {
      const response = await fetch(CONFIG.dataFile);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const records = await response.json();
      let metadata = { records: {} };
      try {
        const metadataResponse = await fetch(CONFIG.metadataFile);
        if (metadataResponse.ok) metadata = await metadataResponse.json();
      } catch (metadataError) {
        console.warn('Procedure provenance metadata could not be loaded', metadataError);
      }

      fullDataset = records.map(record => {
        const linked = metadata.records?.[record.id] || {};
        return {
          ...record,
          elements: linked.elements?.length ? linked.elements : deriveElements(record.targetCompound),
          doi: linked.doi || '',
          dois: linked.dois || (linked.doi ? [linked.doi] : []),
          sourcePomIds: linked.sourcePomIds || []
        };
      });
      filteredDataset = [...fullDataset];
      window.POM_DATA = fullDataset;
      hydrateLabelSelect();
      hydrateOperationSelect();
      initLabelPicker();
      bindFormEvents();
      renderTable();
    } catch (error) {
      console.error('Failed to load dataset', error);
      document.getElementById('resultStatus').textContent = 'Records unavailable';
      const loadError = document.getElementById('loadError');
      loadError.textContent = 'The dataset could not be loaded. Please refresh the page or try again later.';
      loadError.hidden = false;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();

