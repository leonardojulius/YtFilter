/**
 * YT Filter - Popup Script (Channel-only with per-channel toggles and keywords)
 *
 * Security:
 * - All user data rendered with textContent / createElement+appendChild (no innerHTML).
 * - Inputs are trimmed and length-capped before storage.
 * - Empty/duplicate entries are rejected before saving.
 * - No external network requests.
 */

'use strict';

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_FILTER_LENGTH = 100;
const MAX_CHANNELS = 100;

// ─── State ────────────────────────────────────────────────────────────────────

let state = {
  channels: [],
  globalKeywords: [],   // title words that ALLOW a video through (exceptions)
  titleBlocks: [],      // title words that BLOCK a video regardless of channel
  enabled: true
};

// ─── DOM References ───────────────────────────────────────────────────────────

const enabledToggle  = document.getElementById('enabled-toggle');
const filterInput    = document.getElementById('filter-input');
const addBtn         = document.getElementById('add-btn');
const filterList     = document.getElementById('filter-list');
const emptyState     = document.getElementById('empty-state');
const clearBtn       = document.getElementById('clear-btn');
const statFiltered   = document.getElementById('stat-filtered');
const statAllowed    = document.getElementById('stat-allowed');
const statTotal      = document.getElementById('stat-total');
const gkwInput       = document.getElementById('gkw-input');
const gkwAddBtn      = document.getElementById('gkw-add-btn');
const gkwList        = document.getElementById('gkw-list');
const tbInput        = document.getElementById('tb-input');
const tbAddBtn       = document.getElementById('tb-add-btn');
const tbList         = document.getElementById('tb-list');

// ─── Toast Utility ────────────────────────────────────────────────────────────

let toastEl = null;
let toastTimeout = null;

function showToast(message) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message; // SAFE: no innerHTML
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 2000);
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function makeExpandIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M9 18l6-6-6-6');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);
  return svg;
}

function makeDeleteIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('fill', 'none');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M3 3l10 10M13 3L3 13');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);
  return svg;
}

// ─── Render ───────────────────────────────────────────────────────────────────

function buildFilterItem(channelObj, index) {
  const item = document.createElement('div');
  item.className = 'filter-item';
  item.dataset.index = String(index);

  // --- HEADER ---
  const header = document.createElement('div');
  header.className = 'filter-item-header';
  
  const expandIcon = document.createElement('div');
  expandIcon.className = 'expand-icon';
  expandIcon.appendChild(makeExpandIcon());
  
  const textEl = document.createElement('span');
  textEl.className = 'filter-text';
  textEl.textContent = channelObj.handle;

  const modeBadge = document.createElement('span');
  modeBadge.className = `mode-badge ${channelObj.mode}`;
  modeBadge.textContent = channelObj.mode === 'allow' ? 'Allow' : 'Filter';

  const delBtn = document.createElement('button');
  delBtn.className = 'delete-btn';
  delBtn.title = 'Remove channel';
  delBtn.appendChild(makeDeleteIcon());
  delBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    removeChannel(index);
  });

  header.appendChild(expandIcon);
  header.appendChild(textEl);
  header.appendChild(modeBadge);
  header.appendChild(delBtn);

  // --- BODY (Expanded) ---
  const body = document.createElement('div');
  body.className = 'filter-item-body';

  const modeSelector = document.createElement('div');
  modeSelector.className = 'item-mode-selector';

  const optFilter = document.createElement('div');
  optFilter.className = `item-mode-option filter ${channelObj.mode === 'filter' ? 'active' : ''}`;
  optFilter.textContent = 'Hide (Filter)';
  
  const optAllow = document.createElement('div');
  optAllow.className = `item-mode-option allow ${channelObj.mode === 'allow' ? 'active' : ''}`;
  optAllow.textContent = 'Show Only (Allow)';

  const modeDesc = document.createElement('p');
  modeDesc.className = 'item-mode-desc';
  modeDesc.textContent = channelObj.mode === 'allow' 
    ? 'Only this and other allowed channels will be shown.'
    : 'Videos from this channel will be hidden.';

  optFilter.addEventListener('click', (e) => {
    e.stopPropagation();
    updateChannelMode(index, 'filter');
  });

  optAllow.addEventListener('click', (e) => {
    e.stopPropagation();
    updateChannelMode(index, 'allow');
  });

  modeSelector.appendChild(optFilter);
  modeSelector.appendChild(optAllow);
  body.appendChild(modeSelector);
  body.appendChild(modeDesc);

  // --- KEYWORDS SECTION ---
  const kwSection = document.createElement('div');
  kwSection.className = 'kw-section';
  
  const kwInputRow = document.createElement('div');
  kwInputRow.className = 'kw-input-row';
  
  const kwInput = document.createElement('input');
  kwInput.className = 'kw-input';
  kwInput.type = 'text';
  kwInput.placeholder = 'Add title keyword (optional)...';
  
  const kwAddBtn = document.createElement('button');
  kwAddBtn.className = 'kw-add-btn';
  kwAddBtn.textContent = '+';
  
  kwInputRow.appendChild(kwInput);
  kwInputRow.appendChild(kwAddBtn);
  
  const kwList = document.createElement('div');
  kwList.className = 'kw-list';
  
  if (!channelObj.keywords || channelObj.keywords.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'kw-empty';
    empty.textContent = 'No keywords (rule applies to all videos from this channel)';
    kwList.appendChild(empty);
  } else {
    channelObj.keywords.forEach((kw, kwIndex) => {
      const pill = document.createElement('div');
      pill.className = 'kw-pill';
      
      const span = document.createElement('span');
      span.textContent = kw;
      
      const del = document.createElement('span');
      del.className = 'kw-del';
      del.textContent = '×';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        removeKeyword(index, kwIndex);
      });
      
      pill.appendChild(span);
      pill.appendChild(del);
      kwList.appendChild(pill);
    });
  }
  
  kwAddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    addKeyword(index, kwInput.value);
  });
  
  kwInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      addKeyword(index, kwInput.value);
    }
  });
  
  // Prevent click on input from collapsing the whole accordion
  kwInput.addEventListener('click', (e) => e.stopPropagation());

  kwSection.appendChild(kwInputRow);
  kwSection.appendChild(kwList);
  body.appendChild(kwSection);

  // Toggle expansion
  header.addEventListener('click', () => {
    item.classList.toggle('expanded');
  });

  item.appendChild(header);
  item.appendChild(body);

  return item;
}

function renderList() {
  filterList.replaceChildren();

  if (state.channels.length === 0) {
    emptyState.classList.add('visible');
  } else {
    emptyState.classList.remove('visible');
    state.channels.forEach((obj, index) => {
      filterList.appendChild(buildFilterItem(obj, index));
    });
  }

  updateStats();
}

function updateStats() {
  const total = state.channels.length;
  const allowed = state.channels.filter(c => c.mode === 'allow').length;
  const filtered = total - allowed;
  
  statFiltered.textContent = String(filtered);
  statAllowed.textContent = String(allowed);
  statTotal.textContent = String(total);
}

// ─── Storage ──────────────────────────────────────────────────────────────────

function saveState() {
  chrome.storage.sync.set({
    channels: state.channels,
    globalKeywords: state.globalKeywords,
    titleBlocks: state.titleBlocks,
    enabled: state.enabled,
  });
}

function loadState() {
  chrome.storage.sync.get(
    { channels: [], globalKeywords: [], titleBlocks: [], enabled: true, filterMode: 'filter' },
    (data) => {
      let loadedChannels = [];
      if (Array.isArray(data.channels)) {
        if (data.channels.length > 0 && typeof data.channels[0] === 'string') {
          const globalMode = data.filterMode === 'allow' ? 'allow' : 'filter';
          loadedChannels = data.channels.map(ch => ({ handle: ch, mode: globalMode, keywords: [] }));
        } else {
          loadedChannels = data.channels.map(ch => {
            if (!ch.keywords) ch.keywords = [];
            return ch;
          });
        }
      }
      state.channels = loadedChannels;
      state.globalKeywords = Array.isArray(data.globalKeywords) ? data.globalKeywords : [];
      state.titleBlocks = Array.isArray(data.titleBlocks) ? data.titleBlocks : [];
      state.enabled = Boolean(data.enabled);
      enabledToggle.checked = state.enabled;
      document.body.classList.toggle('filter-disabled', !state.enabled);
      if (loadedChannels.length > 0 && typeof data.channels[0] === 'string') saveState();
      renderList();
      renderGlobalKeywords();
      renderTitleBlocks();
    }
  );
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function addChannel() {
  const rawValue = filterInput.value;
  let value = rawValue.trim().substring(0, MAX_FILTER_LENGTH);

  if (!value) {
    filterInput.focus();
    return;
  }

  if (!value.startsWith('@')) {
    value = '@' + value;
  }

  if (state.channels.length >= MAX_CHANNELS) {
    showToast(`Max ${MAX_CHANNELS} channels reached`);
    return;
  }

  if (state.channels.some(c => c.handle.toLowerCase() === value.toLowerCase())) {
    showToast('Channel already exists');
    filterInput.select();
    return;
  }

  const defaultMode = 'filter';
  state.channels.unshift({ handle: value, mode: defaultMode, keywords: [] });
  saveState();
  renderList();
  
  filterInput.value = '';
  filterInput.focus();
  showToast('Channel added ✓');
}

function removeChannel(index) {
  if (index >= 0 && index < state.channels.length) {
    state.channels.splice(index, 1);
    saveState();
    renderList();
  }
}

function updateChannelMode(index, newMode) {
  if (state.channels[index]) {
    state.channels[index].mode = newMode;
    saveState();
    renderList();
    
    // Auto-expand the clicked item again
    const item = filterList.querySelector(`.filter-item[data-index="${index}"]`);
    if (item) item.classList.add('expanded');
    
    showToast(`Channel set to ${newMode}`);
  }
}

function addKeyword(channelIndex, kwValue) {
  const value = (kwValue || '').trim().substring(0, MAX_FILTER_LENGTH);
  if (!value) return;
  
  const channel = state.channels[channelIndex];
  if (!channel.keywords) channel.keywords = [];
  
  if (channel.keywords.some(k => k.toLowerCase() === value.toLowerCase())) {
    showToast('Keyword already exists');
    return;
  }
  
  channel.keywords.push(value);
  saveState();
  renderList();
  
  // Re-expand the row
  const item = filterList.querySelector(`.filter-item[data-index="${channelIndex}"]`);
  if (item) item.classList.add('expanded');
}

function removeKeyword(channelIndex, kwIndex) {
  const channel = state.channels[channelIndex];
  if (channel && channel.keywords && kwIndex >= 0 && kwIndex < channel.keywords.length) {
    channel.keywords.splice(kwIndex, 1);
    saveState();
    renderList();
    
    // Re-expand the row
    const item = filterList.querySelector(`.filter-item[data-index="${channelIndex}"]`);
    if (item) item.classList.add('expanded');
  }
}

function clearAllChannels() {
  state.channels = [];
  saveState();
  renderList();
  showToast('All channels cleared');
}

// ─── Global Keyword Actions ───────────────────────────────────────────────────

/**
 * Renders the global keywords pill list.
 */
function renderGlobalKeywords() {
  gkwList.replaceChildren();
  state.globalKeywords.forEach((kw, i) => {
    const pill = document.createElement('div');
    pill.className = 'kw-pill gkw-pill';

    const span = document.createElement('span');
    span.textContent = kw;

    const del = document.createElement('span');
    del.className = 'kw-del';
    del.textContent = '×';
    del.addEventListener('click', () => removeGlobalKeyword(i));

    pill.appendChild(span);
    pill.appendChild(del);
    gkwList.appendChild(pill);
  });
}

/**
 * Parses the textarea input and adds all unique keywords/hashtags.
 * Accepts space, comma, or newline separated values.
 */
function addGlobalKeywords() {
  const raw = (gkwInput.value || '').trim();
  if (!raw) return;

  // Split on whitespace, commas, or newlines — filter empty
  const tokens = raw
    .split(/[\s,\n]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && t.length <= MAX_FILTER_LENGTH);

  let added = 0;
  for (const token of tokens) {
    if (!state.globalKeywords.includes(token)) {
      state.globalKeywords.push(token);
      added++;
    }
  }

  if (added > 0) {
    saveState();
    renderGlobalKeywords();
    gkwInput.value = '';
    showToast(`${added} exception${added > 1 ? 's' : ''} added ✓`);
  } else {
    showToast('All exceptions already exist');
  }
}

function removeGlobalKeyword(index) {
  state.globalKeywords.splice(index, 1);
  saveState();
  renderGlobalKeywords();
}

// ─── Title Block Actions ──────────────────────────────────────────────────────

function renderTitleBlocks() {
  tbList.replaceChildren();
  state.titleBlocks.forEach((kw, i) => {
    const pill = document.createElement('div');
    pill.className = 'kw-pill tb-pill';
    const span = document.createElement('span');
    span.textContent = kw;
    const del = document.createElement('span');
    del.className = 'kw-del';
    del.textContent = '×';
    del.addEventListener('click', () => removeTitleBlock(i));
    pill.appendChild(span);
    pill.appendChild(del);
    tbList.appendChild(pill);
  });
}

function addTitleBlocks() {
  const raw = (tbInput.value || '').trim();
  if (!raw) return;
  const tokens = raw.split(/[\s,\n]+/)
    .map(t => t.trim().toLowerCase())
    .filter(t => t.length > 0 && t.length <= MAX_FILTER_LENGTH);
  let added = 0;
  for (const token of tokens) {
    if (!state.titleBlocks.includes(token)) {
      state.titleBlocks.push(token);
      added++;
    }
  }
  if (added > 0) {
    saveState();
    renderTitleBlocks();
    tbInput.value = '';
    showToast(`${added} title block${added > 1 ? 's' : ''} added ✓`);
  } else {
    showToast('All title blocks already exist');
  }
}

function removeTitleBlock(index) {
  state.titleBlocks.splice(index, 1);
  saveState();
  renderTitleBlocks();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

enabledToggle.addEventListener('change', () => {
  state.enabled = enabledToggle.checked;
  document.body.classList.toggle('filter-disabled', !state.enabled);
  saveState();
  showToast(state.enabled ? 'Filtering enabled' : 'Filtering paused');
});

addBtn.addEventListener('click', addChannel);

filterInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addChannel();
});

gkwAddBtn.addEventListener('click', addGlobalKeywords);
gkwInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addGlobalKeywords(); }
});

tbAddBtn.addEventListener('click', addTitleBlocks);
tbInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addTitleBlocks(); }
});

clearBtn.addEventListener('click', clearAllChannels);

// ─── Init ─────────────────────────────────────────────────────────────────────

loadState();
