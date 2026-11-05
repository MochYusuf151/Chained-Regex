(function () {
    "use strict";

    /* ============================= Utilities ============================= */
    let uidCounter = 0;
    let autoCompute = true;
    const AUTO_COMPUTE_CHAR_LIMIT = 10000;
    const TEXT_FIELD_VISIBLE_CHAR_LENGTH = 100000;
    const TABLE_MAX_VISIBLE_ROWS = 50;
    const TABLE_MAX_CELL_VISIBLE_CHARS = 200;    // Batas jumlah karakter per sel di DOM
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    let globalVar = {};
    let fnUtils = {
        transpose: (rows) => rows[0].map((_, colIndex) => rows.map(row => row[colIndex])),
        stringifyTable: (rows, delimiter) => rows.map(r => r.join(delimiter)).join('\n'),
        help: `Available utility functions: transpose(table.rows), stringifyTable(table.rows, delimiter)`
    };
    function uid() { uidCounter += 1; return 's' + Date.now().toString(36) + uidCounter.toString(36); }
    function debounce(fn, wait) {
        let t;
        return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait); };
    }
    function escapeHtml(str) {
        return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function unescapeReplacement(str) {
        try {
            const safe = str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            const restored = str.replace(/\\(n|t|r|\\|")/g, (m, g) => {
                if (g === 'n') return '\n';
                if (g === 't') return '\t';
                if (g === 'r') return '\r';
                if (g === '\\') return '\\';
                if (g === '"') return '"';
                return m;
            });
            return restored;
        } catch (e) { return str; }
    }

    /* ============================= Delimited (CSV/TSV) parsing ============================= */
    function parseDelimited(text, delimiter) {
        if (!text) return { rows: [], delimiter: delimiter === 'auto' ? ',' : delimiter };
        let d = delimiter;
        if (d === 'auto') {
            d = text.includes('\t') ? '\t' : (text.includes(';') && !text.includes(',')) ? ';' : ',';
        }
        const rows = [];
        let row = [], field = '', inQuotes = false;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i], next = text[i + 1];
            if (inQuotes) {
                if (ch === '"' && next === '"') { field += '"'; i++; }
                else if (ch === '"') { inQuotes = false; }
                else field += ch;
            } else {
                if (ch === '"') inQuotes = true;
                else if (ch === d) { row.push(field); field = ''; }
                else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
                else if (ch === '\r') { /* skip */ }
                else field += ch;
            }
        }
        row.push(field); rows.push(row);
        if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
        return { rows, delimiter: d };
    }
    function serializeDelimited(rows, delimiter) {
        const d = delimiter || ',';
        return rows.map(r => r.map(cell => {
            cell = cell == null ? '' : String(cell);
            if (cell.includes(d) || cell.includes('"') || cell.includes('\n')) return '"' + cell.replace(/"/g, '""') + '"';
            return cell;
        }).join(d)).join('\n');
    }

    /* ============================= State ============================= */
    const FLAGS = ['d', 'g', 'i', 'm', 's', 'u', 'v', 'y'];

    function defaultStage(overrides = {}) {
        return {
            id: uid(),
            name: '',
            collapsed: false,
            inputMode: 'text',
            inputString: '',
            saveInputToUrl: false, // Flag per-stage (default false)
            usePreviousOutput: true,
            processingMode: 'regex',
            regex: { search: '', flags: 'gm', substitute: '', replaceMode: '0', iteration: 1 },
            script: 'return inputString;',
            output: '',
            ...overrides,
            table: {
                rows: [['col1', 'col2'], ['', '']],
                delimiter: '\t',
                hasHeader: false,
                ...(overrides.table || {}),
                rows: (overrides.table && overrides.table.rows && overrides.table.rows.length > 0) 
                    ? overrides.table.rows 
                    : [['col1', 'col2'], ['', '']]
            }
        };
    }

    function defaultState() {
        return {
            title: '',
            description: '',
            stages: [defaultStage({ collapsed: false })]
        };
    }

    let state = defaultState();

    /* ---- URL encode/decode ---- */
    function encodeState() {
        try {
            const cleanedState = {
                ...state,
                stages: state.stages.map(stage => {
                    const { output, _computedInput, ...rest } = stage;

                    // Jika toggle 'Save to URL' MATI
                    if (!stage.saveInputToUrl) {
                        const { inputString, table, ...otherRest } = rest;
                        const { rows, ...tableRest } = table || {};
                        
                        let skeletonRows = [['col1', 'col2'], ['', '']]; // Fallback bawaan

                        // Jika tabel memiliki data, buat kerangka (skeleton) kolomnya
                        if (rows && rows.length > 0) {
                            // Cari jumlah kolom terbanyak dari data input
                            const colCount = Math.max(...rows.map(r => r.length));
                            const emptyRow = new Array(colCount).fill('');

                            if (tableRest.hasHeader) {
                                // Simpan nama Header asli + 1 baris kosong untuk diisi nanti
                                skeletonRows = [rows[0], emptyRow]; 
                            } else {
                                // Jika tidak ada Header, simpan 2 baris kosong dengan jumlah kolom yang sesuai
                                skeletonRows = [emptyRow, [...emptyRow]];
                            }
                        }

                        return {
                            ...otherRest,
                            table: {
                                ...tableRest,
                                rows: skeletonRows // Masukkan kerangka tabel, bukan data asli
                            }
                        };
                    }

                    // Jika toggle AKTIF, simpan data asli secara utuh
                    return rest;
                })
            };

            const json = JSON.stringify(cleanedState);
            return window.LZString ? LZString.compressToEncodedURIComponent(json) : encodeURIComponent(json);
        } catch (e) {
            return '';
        }
    }
    
    function decodeState(str) {
        try {
            const json = window.LZString ? LZString.decompressFromEncodedURIComponent(str) : decodeURIComponent(str);
            if (!json) return null;
            const parsed = JSON.parse(json);
            if (!parsed || !Array.isArray(parsed.stages)) return null;
            parsed.stages = parsed.stages.map(s => defaultStage(s));
            return parsed;
        } catch (e) { return null; }
    }
    function loadFromUrl() {
        // 1. Coba baca dari Hash Fragment (#d=...)
        const hash = window.location.hash;
        if (hash.startsWith('#d=')) {
            const d = hash.substring(3); // Ambil string setelah '#d='
            if (d) {
                const decoded = decodeState(d);
                if (decoded) return decoded;
            }
        }

        // 2. Fallback: Coba baca dari Query Parameter (?d=...) untuk link lama
        const params = new URLSearchParams(window.location.search);
        const queryD = params.get('d');
        if (queryD) {
            const decoded = decodeState(queryD);
            if (decoded) {
                // (Opsional) Langsung pindahkan URL lama ke format Hash secara visual
                history.replaceState({}, '', window.location.pathname + '#d=' + queryD);
                return decoded;
            }
        }

        return defaultState();
    }
    
    const persistToUrl = debounce(function () {
        const stateStr = encodeState();
        if (!stateStr) return; // Abaikan jika kosong atau dibatasi (Limit 20k)

        // Simpan ke hash fragment (#), pertahankan search query lain jika ada
        const newUrl = window.location.pathname + window.location.search + '#d=' + stateStr;
        history.replaceState({}, '', newUrl);
    }, 300);

    /* ============================= Regex / Script engine ============================= */
    function runRegexStage(input, cfg) {
        const srcRegex = new RegExp(cfg.search, cfg.flags);
        const substitute = unescapeReplacement(cfg.substitute || '');
        const iterations = Math.max(1, parseInt(cfg.iteration, 10) || 1);
        let value = input;
        let out = value;
        for (let i = 0; i < iterations; i++) {
            if (cfg.replaceMode === '1') {
                let acc = '';
                const matches = value.matchAll(srcRegex);
                for (const m of matches) { acc += m[0].replace(srcRegex, substitute); }
                out = acc;
            } else {
                out = value.replace(srcRegex, substitute);
            }
            value = out;
        }
        return out;
    }

    async function runTableScriptStage(input, stage) {
        // Ensure 'g' flag is present to match all occurrences safely
        let flags = stage.regex.flags;
        if (!flags.includes('g')) flags += 'g';
        const globalRegex = new RegExp(stage.regex.search, flags);

        try {
            const fn = new AsyncFunction('inputString', 'matches', 'matchIndex', 'groupIndex', 'rowIndex', 'columns', 'table', 'globalVar', 'fnUtils', stage.script);
            let { rows, delimiter } = parseDelimited(input, stage.table.delimiter);
            
            let outputValue = null;
            let matchIndex = 0;
            let rowIndex = 0;

            if (!stage.regex.search) {
                let result = await fn(input, null, null, null, null, null, stage.table, globalVar, fnUtils);
                return result === undefined ? input : result;
            }

            for (const row of rows) {
                let outputRow = row.join(stage.table.delimiter);
                let startStringIndex = 0;
                const matches = outputRow.matchAll(globalRegex);
                for (const match of matches) {
                    let matchString = match[0];
                    let originalString = match[0];
                    let groupIndex = 0;
                    let columns = row || [];

                    for (const group of match) {
                        if (groupIndex > 0 && group !== undefined) {
                            let inputString = group;
                            let result = await fn(inputString, matches, matchIndex, groupIndex, rowIndex, columns, stage.table, globalVar, fnUtils);
                            // Modifikasi hanya text yang di tangkap groupRegex layaknya v1
                            matchString = matchString.replace(inputString, result);
                        }
                        groupIndex++;
                    }

                    let substringPreviousMatch = outputRow.substring(0, startStringIndex);
                    let substringCurrentMatch = outputRow.substring(startStringIndex);
                    substringCurrentMatch = substringCurrentMatch.replace(originalString, matchString);
                    outputRow = substringPreviousMatch + substringCurrentMatch;

                    startStringIndex += matchString ? matchString.length : 0;

                    matchIndex++;
                }
                
                outputValue = outputValue === null ? outputRow : outputValue + "\n" + outputRow;
                rowIndex++;
            }

            return outputValue;
        } catch (err) {
            throw err;
        }
    }

    
    async function runScriptStage(input, stage) {
        // Ensure 'g' flag is present to match all occurrences safely
        let flags = stage.regex.flags;
        if (!flags.includes('g')) flags += 'g';
        const globalRegex = new RegExp(stage.regex.search, flags);

        try {
            const fn = new AsyncFunction('inputString', 'matches', 'matchIndex', 'groupIndex', 'globalVar', 'fnUtils', stage.script);
            const matches = input.matchAll(globalRegex);
            let outputValue = input;
            let startStringIndex = 0;
            let matchIndex = 0;

            if (!stage.regex.search) {
                let result = await fn(input, null, null, null, globalVar, fnUtils);
                return result === undefined ? input : result;
            }

            for (const match of matches) {
                let matchString = match[0];
                let originalString = match[0];
                let groupIndex = 0;

                for (const group of match) {
                    if (groupIndex > 0 && group !== undefined) {
                        let inputString = group;
                        let result = await fn(inputString, matches, matchIndex, groupIndex, globalVar, fnUtils);
                        // Modifikasi hanya text yang di tangkap groupRegex layaknya v1
                        matchString = matchString.replace(inputString, result);
                    }
                    groupIndex++;
                }

                let substringPreviousMatch = outputValue.substring(0, startStringIndex);
                let substringCurrentMatch = outputValue.substring(startStringIndex);
                substringCurrentMatch = substringCurrentMatch.replace(originalString, matchString);
                outputValue = substringPreviousMatch + substringCurrentMatch;

                startStringIndex += matchString ? matchString.length : 0;
                matchIndex++;
            }
            return outputValue;
        } catch (err) {
            throw err;
        }
    }

    async function computeAll() {
        let prevOutput = '';
        globalVar = {};
        
        for (let idx = 0; idx < state.stages.length; idx++) {
            const stage = state.stages[idx];
            const isUsingPrev = (idx > 0 && stage.usePreviousOutput);
            
            const source = isUsingPrev ? prevOutput
                : (stage.inputMode === 'table' ? serializeDelimited(stage.table.rows, stage.table.delimiter) : stage.inputString);

            stage._computedInput = source;

            if (isUsingPrev) {
                if (stage.inputMode === 'table') {
                    const parsed = parseDelimited(source, stage.table.delimiter);
                    stage.table.rows = parsed.rows;
                    const wrap = document.querySelector(`.stage-wrap[data-stage-id="${stage.id}"]`);
                    renderTable(wrap, stage);
                    bindInputAreaEvents(wrap, stage);
                } else {
                    stage.inputString = source;
                }
            }

            let error = null, output = '';
            try {
                if ((source == null || source === '') 
                    && (stage.processingMode === 'script' && (stage.script == null || stage.script === '')
                    || stage.processingMode === 'regex')) {
                    output = '';
                } else {
                    let headerPrefix = '';
                    let processStr = source;

                    if (stage.inputMode === 'table' && stage.table.hasHeader && stage.table.rows.length > 0) {
                        headerPrefix = serializeDelimited([stage.table.rows[0]], stage.table.delimiter) + '\n';
                        processStr = serializeDelimited(stage.table.rows.slice(1), stage.table.delimiter);
                    }

                    if (stage.inputMode === 'text') {
                        if (stage.processingMode === 'regex') {
                            if (!stage.regex.search) { output = processStr; }
                            else output = runRegexStage(processStr, stage.regex);
                        } else {
                            output = await runScriptStage(processStr, stage);
                        }
                    } else {
                        if (stage.processingMode === 'regex') {
                            if (!stage.regex.search) { output = processStr; }
                            else output = runRegexStage(processStr, stage.regex);
                        } else {
                            output = await runTableScriptStage(processStr, stage);
                        }
                    }

                    output = headerPrefix + output;
                }
            } catch (err) {
                error = err.message;
                output = '';
            }
            
            stage.output = output;
            stage.error = error;
            prevOutput = output;
        };
        
        persistToUrl();
    }

    function cleanComputeData () {
        state.stages.forEach((stage, idx) => {
            if (idx > 0 && state.stages[idx - 1]._computedInput) {
                state.stages[idx - 1]._computedInput = null;
            }
        });
        globalVar = {};
    }

    /* ============================= Rendering ============================= */
    const pipelineEl = document.getElementById('pipeline');
    const titleField = document.getElementById('titleField');
    const descField = document.getElementById('descField');
    const docTitleLabel = document.getElementById('docTitleLabel');

    function flagLabel(f) {
        return { d: 'indices', g: 'global', i: 'ignore case', m: 'multiline', s: 'dotAll', u: 'unicode', v: 'unicode sets', y: 'sticky' }[f] || f;
    }

    function renderStage(stage, index) {
        const wrap = document.createElement('div');
        wrap.className = 'stage-wrap';
        wrap.dataset.stageId = stage.id;

        const isFirst = index === 0;
        const isLast = index === state.stages.length - 1;
        const stageNum = index + 1;

        const modeChip = stage.processingMode === 'regex'
            ? '<span class="mode-chip regex">Regex</span>'
            : '<span class="mode-chip script">Script</span>';

        wrap.innerHTML = `
    <div class="stage-badge">${stageNum}</div>
    <div class="stage-card">
      <div class="stage-head ${stage.collapsed ? '' : 'open'}" data-role="toggle">
        <input class="stage-name" data-role="name" value="${escapeHtml(stage.name || ('Stage ' + stageNum))}" />
        ${modeChip}
        <div class="stage-head-spacer"></div>
        <div class="stage-head-actions">
          <button class="btn btn-ghost btn-icon btn-sm" data-role="dup" title="Duplicate stage">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" data-role="up" title="Move up" ${isFirst ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 15l-6-6-6 6"/></svg>
          </button>
          <button class="btn btn-ghost btn-icon btn-sm" data-role="down" title="Move down" ${isLast ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M6 9l6 6 6-6"/></svg>
          </button>
          <button class="btn btn-danger-ghost btn-icon btn-sm" data-role="remove" title="Delete stage" ${state.stages.length <= 1 ? 'disabled' : ''}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m-9 0v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6"/></svg>
          </button>
          <svg class="chev ${stage.collapsed ? '' : 'open'}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>
      <div class="stage-body ${stage.collapsed ? '' : 'open'}" data-role="body">

        <div class="field">
          <div class="section-label-row">
            <span class="section-label">Input</span>
            <div class="section-tools">
                <label class="switch-row" title="Simpan data input stage ini ke dalam URL parameter d=">
                    <span class="switch">
                    <input type="checkbox" data-role="saveInputUrl" ${stage.saveInputToUrl ? 'checked' : ''}>
                    <span class="track"></span>
                    <span class="thumb"></span>
                    </span>
                    Save Input to URL
                </label>
                ${!isFirst ? `
                <label class="switch-row" title="Feed this stage from the previous stage's output">
                    <span class="switch"><input type="checkbox" data-role="usePrev" ${stage.usePreviousOutput ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></span>
                    Use previous output
                </label>` : ''}
                <div class="segmented" data-role="inputModeSeg">
                    <button type="button" data-value="text" class="${stage.inputMode === 'text' ? 'active' : ''}">Text</button>
                    <button type="button" data-value="table" class="${stage.inputMode === 'table' ? 'active' : ''}">Table</button>
                </div>
            </div>
          </div>
          <div data-role="inputArea"></div>
        </div>

        <div class="flow-connector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
          processed by
        </div>

        <div class="field">
          <div class="section-label-row">
            <span class="section-label">Processing</span>
            <div class="segmented violet" data-role="procModeSeg">
              <button type="button" data-value="regex" class="${stage.processingMode === 'regex' ? 'active' : ''}">Regex</button>
              <button type="button" data-value="script" class="${stage.processingMode === 'script' ? 'active' : ''}">JS Script</button>
            </div>
          </div>
          <div data-role="processingArea"></div>
        </div>

        <div class="flow-connector">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M6 13l6 6 6-6"/></svg>
          produces
        </div>

        <div class="field" style="margin-bottom:0;">
          <div class="section-label-row">
            <span class="section-label">Output</span>
            <div class="section-tools">
              <button class="btn btn-ghost btn-sm" data-role="copyOutput">Copy</button>
            </div>
          </div>
          <div class="output-box">
            <textarea class="textarea mono" data-role="outputField" rows="3" readonly></textarea>
          </div>
          <div class="io-count" data-role="outputCount"></div>
          <div class="error-banner" data-role="errorBanner" style="display:none;"></div>
        </div>

      </div>
    </div>
  `;

        renderInputArea(wrap, stage);
        renderProcessingArea(wrap, stage);
        bindStageEvents(wrap, stage);
        return wrap;
    }

    function renderInputArea(wrap, stage) {
        const area = wrap.querySelector('[data-role="inputArea"]');
        if (stage.inputMode === 'text') {
            area.innerHTML = `
                <textarea class="textarea mono" data-role="inputField" rows="3" placeholder="Paste, type input, or drag text file here text&hellip;" ${stage.usePreviousOutput && wrap.dataset.hasPrev === '1' ? 'disabled' : ''}></textarea>
                <div class="io-count" data-role="inputCount"></div>
            `;
            area.querySelector('[data-role="inputField"]').value = stage.inputString;
        } else {
            area.innerHTML = `
                <div class="table-toolbar">
                    <button class="btn btn-sm" data-role="pasteClipboard">📋 Paste from clipboard</button>
                    <select class="select" data-role="delimiterSelect" style="width:auto;">
                    <option value="auto" ${stage.table.delimiter === 'auto' ? 'selected' : ''}>Auto-detect</option>
                    <option value="\t" ${stage.table.delimiter === '\t' ? 'selected' : ''}>Tab</option>
                    <option value="," ${stage.table.delimiter === ',' ? 'selected' : ''}>Comma</option>
                    <option value=";" ${stage.table.delimiter === ';' ? 'selected' : ''}>Semicolon</option>
                    </select>
                    <label class="switch-row"><span class="switch"><input type="checkbox" data-role="hasHeader" ${stage.table.hasHeader ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></span>Header row</label>
                    <button class="btn btn-ghost btn-sm" data-role="addRow">+ Row</button>
                    <button class="btn btn-ghost btn-sm" data-role="addCol">+ Col</button>
                    <button class="btn btn-ghost btn-sm" data-role="clearTable">Clear All</button>
                    <button class="btn btn-ghost btn-sm" data-role="clearData" title="Clear data rows only">Clear Data</button>
                    <button class="btn btn-ghost btn-sm" data-role="copyTable">Copy Table</button>
                </div>
                <div class="table-wrap" data-role="tableWrap" tabindex="0"></div>
                <div class="io-count" data-role="inputCount"></div>
            `;
            renderTable(wrap, stage);
        }
    }

    function renderTable(wrap, stage) {
    const tableWrap = wrap.querySelector('[data-role="tableWrap"]');
    const rows = stage.table.rows;
    if (!rows.length || !rows[0].length) {
        tableWrap.innerHTML = `<div class="table-empty">Paste table or drop file here</div>`;
        return;
    }

    const isTruncatedRows = rows.length > TABLE_MAX_VISIBLE_ROWS;
    const visibleRows = rows.slice(0, TABLE_MAX_VISIBLE_ROWS);
    const colCount = Math.max(...rows.map(r => r.length));

    let html = '<table class="pipeline-table"><tbody>';
    html += '<tr><td class="rowhandle"></td>';
    for (let c = 0; c < colCount; c++) {
        html += `<td class="colhandle"><button data-role="delCol" data-col="${c}" title="Delete column">${c} [❌️]</button></td>`;
    }
    html += '</tr>';

    visibleRows.forEach((row, r) => {
        const isHeaderRow = stage.table.hasHeader && r === 0;
        html += `<tr><td class="rowhandle"><button data-role="delRow" data-row="${r}" title="Delete row">${r}<br>[❌️]</button></td>`;
        
        for (let c = 0; c < colCount; c++) {
            const tag = isHeaderRow ? 'th' : 'td';
            const rawVal = row[c] != null ? String(row[c]) : '';
            
            // Potong teks jika melebihi batas TABLE_MAX_CELL_VISIBLE_CHARS
            const isTruncatedCell = rawVal.length > TABLE_MAX_CELL_VISIBLE_CHARS;
            const displayVal = isTruncatedCell 
                ? rawVal.substring(0, TABLE_MAX_CELL_VISIBLE_CHARS) + '…' 
                : rawVal;

            const editable = (stage.id != state.stages[0]?.id && stage.usePreviousOutput) ? 'false' : 'true';
            const tooltip = isTruncatedCell ? `title="Dipotong untuk tampilan (Total: ${rawVal.length} karakter)"` : '';

            html += `<${tag} class="cell" contenteditable="${editable}" data-row="${r}" data-col="${c}" ${tooltip}>${escapeHtml(displayVal)}</${tag}>`;
        }
        html += '</tr>';
    });
    html += '</tbody></table>';

    if (isTruncatedRows) {
        html += `<div style="padding: 8px; text-align: center; font-size: 11.5px; color: var(--text-faint); background: var(--panel);">
            Showing <b>${TABLE_MAX_VISIBLE_ROWS}</b> of <b>${rows.length}</b> lines (all lines is still processed on Run).
        </div>`;
    }

    tableWrap.innerHTML = html;
}

    function renderProcessingArea(wrap, stage) {
        const area = wrap.querySelector('[data-role="processingArea"]');
        const flagsHtml = FLAGS.map(f => `<button type="button" class="flag-btn ${stage.regex.flags.includes(f) ? 'active' : ''}" data-flag="${f}" title="${flagLabel(f)}">${f}</button>`).join('');

        // Memisahkan Layout - Kolom 1 (Shared Search) / Kolom 2 (Replacement OR Script)
        area.innerHTML = `
    <div class="regex-grid">
      <div>
        <label style="font-size:11.5px;color:var(--text-faint);display:block;margin-bottom:5px;">Search pattern</label>
        <input type="text" class="input mono" data-role="searchField" placeholder="e.g. (\\w+)@(\\w+)" value="${escapeHtml(stage.regex.search)}" />
        <div class="flags-row" style="margin-top:9px;">${flagsHtml}</div>
      </div>

      ${stage.processingMode === 'regex' ? `
      <div>
        <label style="font-size:11.5px;color:var(--text-faint);display:block;margin-bottom:5px;">Replacement</label>
        <input type="text" class="input mono" data-role="substituteField" placeholder="e.g. $1 [at] $2" value="${escapeHtml(stage.regex.substitute)}" />
        <div style="display:flex;align-items:center;gap:14px;margin-top:9px;flex-wrap:wrap;">
          <div class="segmented" data-role="replaceModeSeg">
            <button type="button" data-value="0" class="${stage.regex.replaceMode === '0' ? 'active' : ''}">Substitute</button>
            <button type="button" data-value="1" class="${stage.regex.replaceMode === '1' ? 'active' : ''}">List matches</button>
          </div>
          <label style="font-size:11.5px;color:var(--text-faint);display:flex;align-items:center;gap:6px;">
            Iterate <input type="number" min="1" max="50" class="input iter-input" data-role="iterateField" value="${stage.regex.iteration}">
          </label>
        </div>
      </div>
      ` : `
      <div style="display:flex; flex-direction:column; min-height: 80px;">
        <label style="font-size:11.5px;color:var(--text-faint);display:block;margin-bottom:5px;">JS Script Processor</label>
        <textarea class="textarea mono" data-role="scriptField" rows="3" placeholder="return inputString.toUpperCase();" style="flex:1;">${escapeHtml(stage.script)}</textarea>
        <div class="script-hint" style="margin-top:8px;">Function Vars: <b>inputString, globalVar, matches, matchIndex, groupIndex.<br>Table vars: rowIndex, columns[], table</b>.<br>Function Utils: fnUtils (type 'return fnUtils.help' for help).<br>Note: Requires capturing groups <code>(...)</code> in Search Pattern to process by match. Leave Search Pattern blank to process the whole input.</div>
      </div>
      `}
    </div>
  `;
    }

    function updateCounts(wrap, stage) {
        const inputCount = wrap.querySelector('[data-role="inputCount"]');
        const outputCount = wrap.querySelector('[data-role="outputCount"]');
        const source = stage._computedInput || '';
        if (inputCount) inputCount.innerHTML = `<b>${source.split('\n').length}</b> lines · <b>${source.length}</b> chars`;
        if (outputCount) outputCount.innerHTML = `<b>${(stage.output || '').split('\n').length}</b> lines · <b>${(stage.output || '').length}</b> chars`;
    }

    function updateStageOutput(wrap, stage) {
        const outField = wrap.querySelector('[data-role="outputField"]');
        const errBanner = wrap.querySelector('[data-role="errorBanner"]');

        // 1. Update elemen Output
        if (outField) {
            if (stage.error) {
                outField.value = '';
            } else {
                const fullOutput = stage.output || '';
                if (fullOutput.length > TEXT_FIELD_VISIBLE_CHAR_LENGTH) {
                    outField.value = fullOutput.substring(0, TEXT_FIELD_VISIBLE_CHAR_LENGTH) + 
                        `\n\n... [Output truncated. Total: ${fullOutput.length} characters. Use "Copy" button to copy full data]`;
                } else {
                    outField.value = fullOutput;
                }
            }
        }

        if (errBanner) {
            if (stage.error) { errBanner.style.display = 'block'; errBanner.textContent = 'Error: ' + stage.error; }
            else { errBanner.style.display = 'none'; }
        }

        // 2. Update elemen Input jika 'Use previous output' aktif
        if (stage.inputMode === 'text' && stage.usePreviousOutput && wrap.dataset.hasPrev === '1') {
            const inField = wrap.querySelector('[data-role="inputField"]');
            if (inField) {
                const fullInput = stage._computedInput || '';
                const displayInput = fullInput.length > TEXT_FIELD_VISIBLE_CHAR_LENGTH 
                    ? fullInput.substring(0, TEXT_FIELD_VISIBLE_CHAR_LENGTH) + `\n\n... [Input preview truncated. Total: ${fullInput.length} characters.]`
                    : fullInput;
                
                if (inField.value !== displayInput) {
                    inField.value = displayInput;
                }
            }
        }

        updateCounts(wrap, stage);
    }

    function renderAll() {
        // Kosongkan kontainer utama
        while (pipelineEl.firstChild) {
            pipelineEl.removeChild(pipelineEl.firstChild); // Pelepasan DOM node secara eksplisit
        }

        state.stages.forEach((stage, idx) => {
            const wrap = renderStage(stage, idx);
            wrap.dataset.hasPrev = idx > 0 ? '1' : '0';
            pipelineEl.appendChild(wrap);
        });
        refreshAllOutputs();
    }

    // Fungsi untuk mengecek total karakter dan mematikan Auto-run jika > AUTO_COMPUTE_CHAR_LIMIT
    function checkAutoComputeLimit() {
        const autoToggle = document.getElementById('autoComputeToggle');
        if (!autoToggle) return;

        // Hitung total karakter dari seluruh stage yang ada
        const totalChars = state.stages.reduce((acc, stage) => {
            const src = stage.inputMode === 'table'
                ? serializeDelimited(stage.table.rows, stage.table.delimiter)
                : (stage.inputString || '');
            return acc + src.length;
        }, 0);

        // Matikan Auto-run jika karakter lebih dari AUTO_COMPUTE_CHAR_LIMIT dan posisi sakelar sedang aktif
        if (totalChars > AUTO_COMPUTE_CHAR_LIMIT && autoCompute) {
            autoCompute = false;
            autoToggle.checked = false;
            showToast(`Auto-run disabled (Input > ${AUTO_COMPUTE_CHAR_LIMIT} characters)`);
        }
    }

    function refreshAllOutputs(force = false) {
        // Cek batas karakter sebelum memutuskan untuk kalkulasi otomatis
        checkAutoComputeLimit();

        // Jika Auto-run mati dan tidak dipicu tombol manual, batalkan pemrosesan
        if (!autoCompute && !force) {
            return; 
        }
        
        computeAll().then(() => {
                document.querySelectorAll('.stage-wrap').forEach(wrap => {
                const stage = state.stages.find(s => s.id === wrap.dataset.stageId);
                if (stage) updateStageOutput(wrap, stage);
            });
            cleanComputeData();
        });
    }

    /* ============================= Event binding ============================= */
    function bindStageEvents(wrap, stage) {
        const head = wrap.querySelector('[data-role="toggle"]');
        const body = wrap.querySelector('[data-role="body"]');
        const chev = wrap.querySelector('.chev');
        head.addEventListener('click', (e) => {
            if (e.target.closest('[data-role="name"]') || e.target.closest('.stage-head-actions button')) return;
            stage.collapsed = !stage.collapsed;
            body.classList.toggle('open', !stage.collapsed);
            head.classList.toggle('open', !stage.collapsed);
            chev.classList.toggle('open', !stage.collapsed);
            persistToUrl();
        });

        wrap.querySelector('[data-role="name"]').addEventListener('input', (e) => {
            stage.name = e.target.value;
            persistToUrl();
        });

        wrap.querySelector('[data-role="dup"]').addEventListener('click', () => {
            const idx = state.stages.findIndex(s => s.id === stage.id);
            const clone = defaultStage(JSON.parse(JSON.stringify(stage)));
            clone.id = uid();
            clone.name = (stage.name || 'Stage') + ' copy';
            state.stages.splice(idx + 1, 0, clone);
            renderAll();
        });
        wrap.querySelector('[data-role="up"]').addEventListener('click', () => {
            const idx = state.stages.findIndex(s => s.id === stage.id);
            if (idx > 0) { [state.stages[idx - 1], state.stages[idx]] = [state.stages[idx], state.stages[idx - 1]]; renderAll(); }
        });
        wrap.querySelector('[data-role="down"]').addEventListener('click', () => {
            const idx = state.stages.findIndex(s => s.id === stage.id);
            if (idx < state.stages.length - 1) { [state.stages[idx + 1], state.stages[idx]] = [state.stages[idx], state.stages[idx + 1]]; renderAll(); }
        });
        wrap.querySelector('[data-role="remove"]').addEventListener('click', () => {
            if (state.stages.length <= 1) return;
            if (!confirm('Delete this stage?')) return;
            state.stages = state.stages.filter(s => s.id !== stage.id);
            renderAll();
        });

        wrap.querySelector('[data-role="inputModeSeg"]').addEventListener('click', (e) => {
            const btn = e.target.closest('button'); if (!btn) return;
            stage.inputMode = btn.dataset.value;
            wrap.querySelectorAll('[data-role="inputModeSeg"] button').forEach(b => b.classList.toggle('active', b === btn));

            // if (stage.inputMode === 'table' && stage.usePreviousOutput) {
            //     stage.usePreviousOutput = false;
            //     const usePrevCb = wrap.querySelector('[data-role="usePrev"]');
            //     if (usePrevCb) usePrevCb.checked = false;
            // }

            renderInputArea(wrap, stage);
            bindInputAreaEvents(wrap, stage);
            refreshAllOutputs();
        });

        const usePrev = wrap.querySelector('[data-role="usePrev"]');
        if (usePrev) {
            usePrev.addEventListener('change', (e) => {
                stage.usePreviousOutput = e.target.checked;

                // if (stage.usePreviousOutput && stage.inputMode === 'table') {
                //     stage.inputMode = 'text';
                //     wrap.querySelectorAll('[data-role="inputModeSeg"] button').forEach(b => b.classList.toggle('active', b.dataset.value === 'text'));
                // }

                renderInputArea(wrap, stage);
                bindInputAreaEvents(wrap, stage);
                refreshAllOutputs();
            });
        }

        wrap.querySelector('[data-role="procModeSeg"]').addEventListener('click', (e) => {
            const btn = e.target.closest('button'); if (!btn) return;
            stage.processingMode = btn.dataset.value;

            wrap.querySelectorAll('[data-role="procModeSeg"] button').forEach(b => b.classList.toggle('active', b === btn));
            wrap.querySelector('.mode-chip').outerHTML = stage.processingMode === 'regex'
                ? '<span class="mode-chip regex">Regex</span>' : '<span class="mode-chip script">Script</span>';

            renderProcessingArea(wrap, stage);
            bindProcessingAreaEvents(wrap, stage);
            refreshAllOutputs();
        });

        wrap.querySelector('[data-role="copyOutput"]').addEventListener('click', () => {
            navigator.clipboard.writeText(stage.output || '').then(() => showToast('Output copied'));
        });

        const saveInputUrl = wrap.querySelector('[data-role="saveInputUrl"]');
        if (saveInputUrl) {
            saveInputUrl.addEventListener('change', (e) => {
                stage.saveInputToUrl = e.target.checked;
                if (stage.saveInputToUrl) {
                    showToast(`${stage.name || 'Stage'} input will be saved to URL`);
                } else {
                    showToast(`${stage.name || 'Stage'} input excluded from URL`);
                }
                persistToUrl(); // Simpan perubahan kondisi per-stage ke URL
            });
        }

        bindInputAreaEvents(wrap, stage);
        bindProcessingAreaEvents(wrap, stage);
    }

    function bindInputAreaEvents(wrap, stage) {
        if (stage.inputMode === 'text') {
            const field = wrap.querySelector('[data-role="inputField"]');
            if (field) {
                enableTabIndent(field);
                // Event ketika pengguna mengetik biasa
                field.addEventListener('input', (e) => {
                    stage.inputString = e.target.value;
                    refreshAllOutputs();
                });

                // ----------------------------------------------------
                // Fitur Drag & Drop File untuk Input Text
                // ----------------------------------------------------
                field.addEventListener('dragover', (e) => {
                    e.preventDefault(); // Wajib agar event drop bisa terpicu
                    field.classList.add('drag-over'); // Beri highlight visual
                });

                field.addEventListener('dragleave', () => {
                    field.classList.remove('drag-over'); // Hilangkan highlight
                });

                field.addEventListener('drop', (e) => {
                    e.preventDefault();
                    field.classList.remove('drag-over');

                    // Ambil file yang dijatuhkan
                    const file = e.dataTransfer.files && e.dataTransfer.files[0];
                    if (file) {
                        // Baca isi file sebagai teks
                        file.text().then(text => {
                            field.value = text;              // Tampilkan di UI
                            stage.inputString = text;        // Simpan ke state global
                            refreshAllOutputs();             // Jalankan pipeline
                            if (typeof showToast === 'function') {
                                showToast(`File ${file.name} berhasil dimuat`);
                            }
                        }).catch(err => {
                            if (typeof showToast === 'function') {
                                showToast('Gagal membaca isi file');
                            }
                        });
                    }
                });
            }
            return; // Selesai untuk mode teks, keluar dari fungsi
        }

        const tableWrap = wrap.querySelector('[data-role="tableWrap"]');
        const delimSelect = wrap.querySelector('[data-role="delimiterSelect"]');
        const hasHeaderToggle = wrap.querySelector('[data-role="hasHeader"]');
        const pasteBtn = wrap.querySelector('[data-role="pasteClipboard"]');
        const addRowBtn = wrap.querySelector('[data-role="addRow"]');
        const addColBtn = wrap.querySelector('[data-role="addCol"]');
        const clearBtn = wrap.querySelector('[data-role="clearTable"]');
        const clearDataBtn = wrap.querySelector('[data-role="clearData"]');
        const copyBtn = wrap.querySelector('[data-role="copyTable"]');

        function importText(text) {
            const { rows, delimiter } = parseDelimited(text, stage.table.delimiter);
            
            // Cegah penimpaan jika opsi Header aktif dan tabel sudah punya data
            if (stage.table.hasHeader && stage.table.rows.length > 0) {
                const preservedHeader = stage.table.rows[0]; // Simpan header lama
                
                // Gabungkan header lama dengan data baru yang di-paste
                // (Data baru akan ditambahkan mulai dari baris ke-1 ke bawah)
                stage.table.rows = [preservedHeader, ...rows];
            } else {
                // Jika tidak ada header, timpa keseluruhan seperti biasa
                stage.table.rows = rows;
            }

            renderTable(wrap, stage);
            refreshAllOutputs();
        }

        pasteBtn.addEventListener('click', async () => {
            try {
                const text = await navigator.clipboard.readText();
                if (text) importText(text);
                else showToast('Clipboard is empty');
            } catch (err) {
                showToast('Clipboard access blocked — try pasting (Ctrl/Cmd+V) into the table instead');
            }
        });

        copyBtn.addEventListener('click', () => {
            const tableString = serializeDelimited(stage.table.rows, stage.table.delimiter);
            if (tableString) {
                navigator.clipboard.writeText(tableString).then(() => showToast('Table copied'));
            }
        });

        tableWrap.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (text) importText(text);
        });
        tableWrap.addEventListener('keydown', (e) => { // copy selection range to clipboard in delimited format
            const isKeyC = e.key.toLowerCase() === 'c';
            
            const isCtrlOrCmd = e.ctrlKey || e.metaKey;

            if (isCtrlOrCmd && isKeyC) {
                if (stage.table.selectionRange) {
                    const { minR, maxR, minC, maxC } = stage.table.selectionRange;
                    
                    // Pengecekan: Jika user hanya menyeleksi 1 cell dan memblok teks sebagian di dalamnya,
                    // biarkan default behavior browser agar user bisa mencopy teks biasa.
                    const isSingleCell = (minR === maxR && minC === maxC);
                    const textSelected = window.getSelection().toString();
                    if (isSingleCell && textSelected.length > 0) return;

                    const rowsToCopy = [];
                    for (let i = minR; i <= maxR; i++) {
                        const newRow = [];
                        for (let j = minC; j <= maxC; j++) {
                            newRow.push(stage.table.rows[i][j] || '');
                        }
                        rowsToCopy.push(newRow);
                    }

                    const tableString = serializeDelimited(rowsToCopy, stage.table.delimiter);
                    if (tableString) {
                        e.preventDefault(); // Cegah browser copy elemen HTML
                        navigator.clipboard.writeText(tableString).then(() => showToast('Selection copied'));
                        // showToast('Selection copied');
                    }
                }
            }
        });
        // ----------------------------------------------------
        // Fitur Drag & Drop File untuk Input Table
        // ----------------------------------------------------
        tableWrap.addEventListener('dragover', (e) => { 
            e.preventDefault(); 
            tableWrap.classList.add('drag-over'); 
        });

        tableWrap.addEventListener('dragleave', () => { 
            tableWrap.classList.remove('drag-over'); 
        });

        tableWrap.addEventListener('drop', (e) => {
            e.preventDefault(); 
            tableWrap.classList.remove('drag-over');
            
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) { 
                file.text().then(text => {
                    // importText sudah otomatis mem-parsing teks (CSV/TSV) ke dalam stage.table.rows
                    importText(text); 
                    
                    if (typeof showToast === 'function') {
                        showToast(`File ${file.name} berhasil dimuat ke tabel`);
                    }
                }).catch(err => {
                    if (typeof showToast === 'function') {
                        showToast('Gagal membaca isi file untuk tabel');
                    }
                });
            }
        });

        delimSelect.addEventListener('change', (e) => {
            stage.table.delimiter = e.target.value;
            refreshAllOutputs();
        });
        hasHeaderToggle.addEventListener('change', (e) => {
            stage.table.hasHeader = e.target.checked;
            renderTable(wrap, stage);
            refreshAllOutputs();
        });
        addRowBtn.addEventListener('click', () => {
            const cols = stage.table.rows.length ? Math.max(...stage.table.rows.map(r => r.length)) : 2;
            stage.table.rows.push(new Array(cols).fill(''));
            renderTable(wrap, stage);
            refreshAllOutputs();
        });
        addColBtn.addEventListener('click', () => {
            if (!stage.table.rows.length) stage.table.rows.push([]);
            stage.table.rows.forEach(r => r.push(''));
            renderTable(wrap, stage);
            refreshAllOutputs();
        });
        clearBtn.addEventListener('click', () => {
            if (!confirm('Clear this table?')) return;
            stage.table.rows = [];
            renderTable(wrap, stage);
            refreshAllOutputs();
        });

        if (clearDataBtn) {
            clearDataBtn.addEventListener('click', () => {
                if (!confirm('Clear all data but keep the header?')) return;
                
                // Jika opsi Header aktif dan tabel tidak kosong, simpan baris pertama
                if (stage.table.hasHeader && stage.table.rows.length > 0) {
                    const preservedHeader = stage.table.rows[0];
                    const emptyRow = new Array(preservedHeader.length).fill(''); // Buat 1 baris kosong di bawah header
                    
                    stage.table.rows = [preservedHeader, emptyRow];
                } else {
                    // Jika tidak ada header, hapus bersih seperti biasa
                    stage.table.rows = [];
                }
                
                renderTable(wrap, stage);
                refreshAllOutputs();
            });
        }

        // Di dalam bindInputAreaEvents() untuk mode table:
        renderTable(wrap, stage);

        // Pasang delegation SATU KALI SAJA pada induk kontainer
        bindTableDelegation(wrap, stage);
    }

    function bindTableDelegation(wrap, stage) {
        const tw = wrap.querySelector('[data-role="tableWrap"]');
        if (!tw) return;

        // Cegah pendaftaran listener ganda jika fungsi dipanggil berulang kali
        if (tw.dataset.delegated === 'true') return;
        tw.dataset.delegated = 'true';

        // Debounce khusus untuk sinkronisasi input sel agar tidak memicu computeAll terus-menerus
        const debouncedSync = debounce(() => refreshAllOutputs(), 250);

        // ---------------- 1. Delegation Event CLICK ----------------
        tw.addEventListener('click', (e) => {
            // A. Hapus Baris
            const delRowBtn = e.target.closest('[data-role="delRow"]');
            if (delRowBtn) {
                const r = parseInt(delRowBtn.dataset.row, 10);
                stage.table.rows.splice(r, 1);
                renderTable(wrap, stage);
                refreshAllOutputs();
                return;
            }

            // B. Hapus Kolom
            const delColBtn = e.target.closest('[data-role="delCol"]');
            if (delColBtn) {
                const c = parseInt(delColBtn.dataset.col, 10);
                stage.table.rows.forEach(row => row.splice(c, 1));
                renderTable(wrap, stage);
                refreshAllOutputs();
                return;
            }

            // C. Klik/Seleksi Sel Tabel
            const cell = e.target.closest('.cell');
            if (cell) {
                handleCellClick(cell, e, tw, stage);
            }
        });

        // ---------------- 2. Delegation Event INPUT ----------------
        tw.addEventListener('input', (e) => {
            const cell = e.target.closest('.cell');
            if (!cell) return;

            const r = parseInt(cell.dataset.row, 10);
            const c = parseInt(cell.dataset.col, 10);

            if (!stage.table.rows[r]) stage.table.rows[r] = [];
            stage.table.rows[r][c] = cell.textContent;

            debouncedSync();
        });

        // ---------------- 3. Delegation Event PASTE ----------------
        tw.addEventListener('paste', (e) => {
            const cell = e.target.closest('.cell');
            if (!cell) return;

            handleCellPaste(cell, e, wrap, stage);
        });
    }

    function enableTabIndent(textarea) {
        textarea.addEventListener('keydown', function(e) {
            if (e.key === 'Tab') {
                e.preventDefault();

                const start = this.selectionStart;
                const end = this.selectionEnd;
                const value = this.value;
                
                // Pilih karakter indentasi (Bisa diubah ke "    " untuk 4 spasi)
                const indent = "\t"; 

                const isOutdent = e.shiftKey; // Deteksi jika Shift+Tab ditekan

                // Jika teks di-blok (multi-line) ATAU Shift ditekan
                if (start !== end || isOutdent) {
                    
                    // Mencegah penambahan tab pada baris kosong berikutnya jika seleksi berakhir persis di batas \n
                    const targetEnd = (start !== end && value[end - 1] === '\n') ? end - 1 : end;
                    
                    // Cari posisi index ujung paling kiri (awal baris) dan ujung paling kanan (akhir baris)
                    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
                    let lineEnd = value.indexOf('\n', targetEnd);
                    if (lineEnd === -1) lineEnd = value.length;

                    // Ekstrak blok teks secara utuh berdasarkan baris, lalu pecah per baris
                    const selectedLines = value.substring(lineStart, lineEnd);
                    const lines = selectedLines.split('\n');

                    let startOffset = 0;
                    let endOffset = 0;

                    // Proses setiap baris
                    const newLines = lines.map((line, index) => {
                        if (isOutdent) {
                            // KASUS SHIFT+TAB: Hapus indentasi di awal baris jika ada
                            if (line.startsWith(indent)) {
                                if (index === 0) startOffset -= indent.length;
                                endOffset -= indent.length;
                                return line.substring(indent.length); // Hapus tab
                            }
                            return line;
                        } else {
                            // KASUS TAB BIASA (Multi-line): Tambahkan indentasi
                            if (index === 0) startOffset += indent.length;
                            endOffset += indent.length;
                            return indent + line; // Sisipkan tab
                        }
                    });

                    // Gabungkan baris kembali dan timpa teks lama
                    this.value = value.substring(0, lineStart) + newLines.join('\n') + value.substring(lineEnd);

                    // Kembalikan posisi blok seleksi (tergeser mengikuti penambahan/pengurangan tab)
                    this.selectionStart = Math.max(0, start + startOffset);
                    this.selectionEnd = Math.max(0, end + endOffset);

                } else {
                    // KASUS TAB BIASA (Single-line, tanpa blok): Sisipkan tepat di posisi kursor
                    this.value = value.substring(0, start) + indent + value.substring(end);
                    this.selectionStart = this.selectionEnd = start + indent.length;
                }

                // Picu pipeline untuk melakukan render
                this.dispatchEvent(new Event('input', { bubbles: true }));
            }
        });
    }

    function handleCellClick(cell, e, tw, stage) {
        const r = parseInt(cell.dataset.row, 10);
        const c = parseInt(cell.dataset.col, 10);

        // Tentukan rentang seleksi (Shift + Click untuk multi-select)
        if (e.shiftKey && stage.table.selectionStart) {
            stage.table.selectionRange = {
                minR: Math.min(stage.table.selectionStart.r, r),
                maxR: Math.max(stage.table.selectionStart.r, r),
                minC: Math.min(stage.table.selectionStart.c, c),
                maxC: Math.max(stage.table.selectionStart.c, c)
            };
        } else {
            stage.table.selectionStart = { r, c };
            stage.table.selectionRange = { minR: r, maxR: r, minC: c, maxC: c };
        }

        // Beri highlight visual class 'selected-cell'
        const { minR, maxR, minC, maxC } = stage.table.selectionRange;
        tw.querySelectorAll('.cell').forEach(cEl => {
            const cr = parseInt(cEl.dataset.row, 10);
            const cc = parseInt(cEl.dataset.col, 10);
            if (cr >= minR && cr <= maxR && cc >= minC && cc <= maxC) {
                cEl.classList.add('selected-cell');
            } else {
                cEl.classList.remove('selected-cell');
            }
        });
    }

    function handleCellPaste(cell, e, wrap, stage) {
        e.stopPropagation();
        e.preventDefault();

        const text = (e.clipboardData || window.clipboardData).getData('text');
        if (!text) return;

        const r0 = parseInt(cell.dataset.row, 10);
        const c0 = parseInt(cell.dataset.col, 10);
        
        const { rows: pastedRows } = parseDelimited(text, stage.table.delimiter);

        // --- KASUS 1: Paste Teks Single Cell ---
        // Jangan ubah sel jika itu adalah bagian dari header (r0 === 0)
        if (pastedRows.length === 1 && pastedRows[0].length === 1) {
            if (stage.table.hasHeader && r0 === 0) {
                // Abaikan paste pada header untuk single cell
                if (typeof showToast === 'function') showToast('Header tidak bisa diubah lewat paste');
                return; 
            }

            const val = pastedRows[0][0];
            const selection = window.getSelection();
            if (selection.rangeCount > 0) {
                const range = selection.getRangeAt(0);
                range.deleteContents();
                range.insertNode(document.createTextNode(val));
                range.collapse(false);
                cell.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
        }

        // --- KASUS 2: Paste Data Multi-Baris/Multi-Kolom ---
        
        // Geser titik paste ke baris 1 (data pertama) jika user mencoba paste tepat di baris header
        let startRow = r0;
        if (stage.table.hasHeader && r0 === 0) {
            startRow = 1;
        }

        pastedRows.forEach((row, ri) => {
            row.forEach((val, ci) => {
                const rr = startRow + ri; // Gunakan startRow yang sudah digeser
                const cc = c0 + ci;
                
                // Perlindungan ganda: Jangan pernah timpa index 0 jika ada header
                if (stage.table.hasHeader && rr === 0) return;

                if (!stage.table.rows[rr]) stage.table.rows[rr] = [];
                stage.table.rows[rr][cc] = val;
            });
        });

        // Ratakan jumlah kolom agar tidak ada undefined
        const maxCols = Math.max(...stage.table.rows.map(r => r.length));
        stage.table.rows.forEach(r => {
            for (let i = 0; i < maxCols; i++) {
                if (r[i] === undefined) r[i] = '';
            }
        });

        renderTable(wrap, stage);
        refreshAllOutputs();
    }

    function bindProcessingAreaEvents(wrap, stage) {
        // 1. Bind Shared Events (Selalu ada baik mode Regex atau Script)
        const searchField = wrap.querySelector('[data-role="searchField"]');
        if (searchField) {
            searchField.addEventListener('input', (e) => { stage.regex.search = e.target.value; markValidity(searchField, stage); refreshAllOutputs(); });
        }

        wrap.querySelectorAll('.flag-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const f = btn.dataset.flag;
                if (stage.regex.flags.includes(f)) stage.regex.flags = stage.regex.flags.replace(f, '');
                else stage.regex.flags += f;
                btn.classList.toggle('active');
                refreshAllOutputs();
            });
        });

        // 2. Bind Specific Events
        if (stage.processingMode === 'regex') {
            const subField = wrap.querySelector('[data-role="substituteField"]');
            const iterField = wrap.querySelector('[data-role="iterateField"]');
            if (subField) subField.addEventListener('input', (e) => { stage.regex.substitute = e.target.value; refreshAllOutputs(); });
            if (iterField) iterField.addEventListener('input', (e) => { stage.regex.iteration = Math.max(1, parseInt(e.target.value, 10) || 1); refreshAllOutputs(); });

            const modeSeg = wrap.querySelector('[data-role="replaceModeSeg"]');
            if (modeSeg) {
                modeSeg.addEventListener('click', (e) => {
                    const btn = e.target.closest('button'); if (!btn) return;
                    stage.regex.replaceMode = btn.dataset.value;
                    wrap.querySelectorAll('[data-role="replaceModeSeg"] button').forEach(b => b.classList.toggle('active', b === btn));
                    refreshAllOutputs();
                });
            }
        } else {
            const scriptField = wrap.querySelector('[data-role="scriptField"]');
            if (scriptField) {
                enableTabIndent(scriptField);
                scriptField.addEventListener('input', (e) => { stage.script = e.target.value; refreshAllOutputs(); });
            }
        }
    }

    function markValidity(field, stage) {
        try { new RegExp(stage.regex.search, stage.regex.flags); field.classList.remove('has-error'); }
        catch (e) { field.classList.add('has-error'); }
    }

    /* ============================= Header + global actions ============================= */
    function bindHeaderEvents() {
        titleField.value = state.title;
        descField.value = state.description;
        docTitleLabel.textContent = state.title || 'Text Transformation Pipeline';
        document.title = state.title ? state.title + ' · Text Transformation Pipeline' : 'Text Transformation Pipeline';

        titleField.addEventListener('input', (e) => {
            state.title = e.target.value;
            docTitleLabel.textContent = state.title || 'Text Transformation Pipeline';
            document.title = state.title ? state.title + ' · Text Transformation Pipeline' : 'Text Transformation Pipeline';
            persistToUrl();
        });
        descField.addEventListener('input', (e) => {
            state.description = e.target.value;
            persistToUrl();
        });

        document.getElementById('addStageBtn').addEventListener('click', () => {
            state.stages.push(defaultStage({ collapsed: false }));
            renderAll();
            const cards = pipelineEl.querySelectorAll('.stage-wrap');
            cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
        });

        document.getElementById('resetBtn').addEventListener('click', () => {
            if (!confirm('Reset the whole pipeline? This clears the current link.')) return;
            state = defaultState();
            
            // Hapus parameter 'd' dari query string (jika ada dari link lama)
            const params = new URLSearchParams(window.location.search);
            params.delete('d');
            const newSearch = params.toString() ? '?' + params.toString() : '';
            
            // Timpa URL untuk menghilangkan query 'd' dan mengosongkan hash fragment
            history.replaceState({}, '', window.location.pathname + newSearch);
            
            titleField.value = ''; descField.value = '';
            docTitleLabel.textContent = 'Text Transformation Pipeline';
            document.title = 'Text Transformation Pipeline';
            renderAll();
        });

        document.getElementById('copyLinkBtn').addEventListener('click', () => {
            persistToUrl();
            setTimeout(() => {
                navigator.clipboard.writeText(window.location.href).then(() => showToast('Share link copied'));
            }, 320);
        });

        document.getElementById('copyResultBtn').addEventListener('click', () => {
            setTimeout(() => {
                navigator.clipboard.writeText(state.stages[state.stages.length - 1].output).then(() => showToast('Pipeline Output Copied'));
            }, 320);
        });

        document.getElementById('autoComputeToggle').addEventListener('change', (e) => {
            autoCompute = e.target.checked;
            if (autoCompute) refreshAllOutputs(true);
        });

        document.getElementById('runPipelineBtn').addEventListener('click', () => {
            refreshAllOutputs(true); // Paksa perhitungan berjalan
            showToast('Pipeline executed');
        });
    }

    let toastTimer;
    function showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.classList.remove('show'), 1800);
    }

    /* ============================= Init ============================= */
    function init() {
        state = loadFromUrl();
        bindHeaderEvents();
        renderAll();
    }
    init();
})();