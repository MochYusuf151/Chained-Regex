(function () {
    "use strict";

    /* ============================= Utilities ============================= */
    let uidCounter = 0;
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
            usePreviousOutput: true,
            processingMode: 'regex',
            regex: { search: '', flags: 'gm', substitute: '', replaceMode: '0', iteration: 1 },
            script: 'return inputString.toUpperCase();',
            output: '',
            ...overrides,
            // Menangani table dan rows secara spesifik
            table: {
                rows: [['col1', 'col2'], ['', '']],
                delimiter: ',',
                hasHeader: true,
                ...(overrides.table || {}),
                // Memastikan rows punya fallback jika kosong/tidak ada
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
                stages: state.stages.map(({ inputString, output, _computedInput, table: { rows, ...tableRest }, ...rest }) => ({
                    ...rest,
                    table: tableRest
                }))
            };
            const json = JSON.stringify(cleanedState);
            return window.LZString ? LZString.compressToEncodedURIComponent(json) : encodeURIComponent(json);
        } catch (e) { return ''; }
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
        const params = new URLSearchParams(window.location.search);
        const d = params.get('d');
        if (d) {
            const decoded = decodeState(d);
            if (decoded) return decoded;
        }
        return defaultState();
    }
    const persistToUrl = debounce(function () {
        const params = new URLSearchParams(window.location.search);
        params.set('d', encodeState());
        const newUrl = window.location.pathname + '?' + params.toString();
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

    function runTableScriptStage(input, stage) {
        // Ensure 'g' flag is present to match all occurrences safely
        let flags = stage.regex.flags;
        if (!flags.includes('g')) flags += 'g';
        const globalRegex = new RegExp(stage.regex.search, flags);

        try {
            const fn = new Function('inputString', 'matchIndex', 'groupIndex', 'columns', stage.script);
            const matches = input.matchAll(globalRegex);
            let outputValue = input;
            let startStringIndex = 0;
            let matchIndex = 0;

            for (const match of matches) {
                let matchString = match[0];
                let originalString = match[0];
                let groupIndex = 0;
                let { rows, delimiter } = parseDelimited(originalString, stage.table.delimiter);
                let columns = rows[0] || [];

                for (const group of match) {
                    if (groupIndex > 0 && group !== undefined) {
                        let inputString = group;
                        let result = fn(inputString, matchIndex, groupIndex, columns);
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

    
    function runScriptStage(input, stage) {
        // Ensure 'g' flag is present to match all occurrences safely
        let flags = stage.regex.flags;
        if (!flags.includes('g')) flags += 'g';
        const globalRegex = new RegExp(stage.regex.search, flags);

        try {
            const fn = new Function('inputString', 'matchIndex', 'groupIndex', stage.script);
            const matches = input.matchAll(globalRegex);
            let outputValue = input;
            let startStringIndex = 0;
            let matchIndex = 0;

            for (const match of matches) {
                let matchString = match[0];
                let originalString = match[0];
                let groupIndex = 0;

                for (const group of match) {
                    if (groupIndex > 0 && group !== undefined) {
                        let inputString = group;
                        let result = fn(inputString, matchIndex, groupIndex);
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

    function computeAll() {
        let prevOutput = '';
        state.stages.forEach((stage, idx) => {
            const source = (idx > 0 && stage.usePreviousOutput) ? prevOutput
                : (stage.inputMode === 'table' ? serializeDelimited(stage.table.rows, stage.table.delimiter) : stage.inputString);

            // Store calculated input string to be visually binded 
            stage._computedInput = source;

            if (stage.inputMode === 'table' && !(idx > 0 && stage.usePreviousOutput)) {
                stage.inputString = source;
            }

            let error = null, output = '';
            try {
                if (source == null || source === '') {
                    output = '';
                } else {
                    let headerPrefix = '';
                    let processStr = source;

                    if (stage.inputMode === 'table' && stage.table.hasHeader && stage.table.rows.length > 0 && !(idx > 0 && stage.usePreviousOutput)) {
                        headerPrefix = serializeDelimited([stage.table.rows[0]], stage.table.delimiter) + '\n';
                        processStr = serializeDelimited(stage.table.rows.slice(1), stage.table.delimiter);
                    }

                    if (stage.inputMode === 'text') {
                        if (stage.processingMode === 'regex') {
                            if (!stage.regex.search) { output = processStr; }
                            else output = runRegexStage(processStr, stage.regex);
                        } else {
                            if (!stage.regex.search) { output = processStr; }
                            else output = runScriptStage(processStr, stage);
                        }
                    } else {
                        if (stage.processingMode === 'regex') {
                            if (!stage.regex.search) { output = processStr; }
                            else output = runRegexStage(processStr, stage.regex);
                        } else {
                            if (!stage.regex.search) { output = processStr; }
                            else output = runTableScriptStage(processStr, stage);
                        }
                    }

                    output = headerPrefix + output; // stitch it back
                }
            } catch (err) {
                error = err.message;
                output = '';
            }
            stage.output = output;
            stage.error = error;
            prevOutput = output;
        });
        persistToUrl();
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
      <textarea class="textarea mono" data-role="inputField" rows="3" placeholder="Paste or type input text&hellip;" ${stage.usePreviousOutput && wrap.dataset.hasPrev === '1' ? 'disabled' : ''}></textarea>
      <div class="io-count" data-role="inputCount"></div>
    `;
            area.querySelector('[data-role="inputField"]').value = stage.inputString;
        } else {
            area.innerHTML = `
      <div class="table-toolbar">
        <button class="btn btn-sm" data-role="pasteClipboard">📋 Paste from clipboard</button>
        <select class="select" data-role="delimiterSelect" style="width:auto;">
          <option value="auto" ${stage.table.delimiter === 'auto' ? 'selected' : ''}>Auto-detect</option>
          <option value="," ${stage.table.delimiter === ',' ? 'selected' : ''}>Comma</option>
          <option value="\t" ${stage.table.delimiter === '\t' ? 'selected' : ''}>Tab</option>
          <option value=";" ${stage.table.delimiter === ';' ? 'selected' : ''}>Semicolon</option>
        </select>
        <label class="switch-row"><span class="switch"><input type="checkbox" data-role="hasHeader" ${stage.table.hasHeader ? 'checked' : ''}><span class="track"></span><span class="thumb"></span></span>Header row</label>
        <button class="btn btn-ghost btn-sm" data-role="addRow">+ Row</button>
        <button class="btn btn-ghost btn-sm" data-role="addCol">+ Col</button>
        <button class="btn btn-ghost btn-sm" data-role="clearTable">Clear</button>
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
            tableWrap.innerHTML = `<div class="table-empty">No data yet.<br><b>Paste</b> a CSV/TSV block here, or use "Paste from clipboard".</div>`;
            return;
        }
        const colCount = Math.max(...rows.map(r => r.length));
        let html = '<table class="pipeline-table"><tbody>';
        html += '<tr><td class="rowhandle"></td>';
        for (let c = 0; c < colCount; c++) {
            html += `<td class="colhandle"><button data-role="delCol" data-col="${c}" title="Delete column">${c} [❌️]</button></td>`;
        }
        html += '</tr>';
        rows.forEach((row, r) => {
            const isHeaderRow = stage.table.hasHeader && r === 0;
            html += `<tr><td class="rowhandle"><button data-role="delRow" data-row="${r}" title="Delete row">${r} [❌️]</button></td>`;
            for (let c = 0; c < colCount; c++) {
                const tag = isHeaderRow ? 'th' : 'td';
                const val = row[c] != null ? row[c] : '';
                html += `<${tag} class="cell" contenteditable="true" data-row="${r}" data-col="${c}">${escapeHtml(val)}</${tag}>`;
            }
            html += '</tr>';
        });
        html += '</tbody></table>';
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
        <div class="script-hint" style="margin-top:8px;">Function vars: <b>inputString, matchIndex, groupIndex, columns[] (when in table mode)</b>.<br>Note: Requires capturing groups <code>(...)</code> in Search Pattern.</div>
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
        if (outField) outField.value = stage.error ? '' : stage.output;
        if (errBanner) {
            if (stage.error) { errBanner.style.display = 'block'; errBanner.textContent = 'Error: ' + stage.error; }
            else { errBanner.style.display = 'none'; }
        }

        // Menampilkan Output Sebelumnya ke Form Textarea Input (Jika 'Use previous output' dinyalakan)
        if (stage.inputMode === 'text' && stage.usePreviousOutput && wrap.dataset.hasPrev === '1') {
            const inField = wrap.querySelector('[data-role="inputField"]');
            if (inField && inField.value !== stage._computedInput) {
                inField.value = stage._computedInput || '';
            }
        }

        updateCounts(wrap, stage);
    }

    function renderAll() {
        pipelineEl.innerHTML = '';
        state.stages.forEach((stage, idx) => {
            const wrap = renderStage(stage, idx);
            wrap.dataset.hasPrev = idx > 0 ? '1' : '0';
            pipelineEl.appendChild(wrap);
        });
        refreshAllOutputs();
        const addBtn = document.getElementById('addStageBtn');
        addBtn.disabled = false;
    }

    function refreshAllOutputs() {
        computeAll();
        document.querySelectorAll('.stage-wrap').forEach(wrap => {
            const stage = state.stages.find(s => s.id === wrap.dataset.stageId);
            if (stage) updateStageOutput(wrap, stage);
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

            if (stage.inputMode === 'table' && stage.usePreviousOutput) {
                stage.usePreviousOutput = false;
                const usePrevCb = wrap.querySelector('[data-role="usePrev"]');
                if (usePrevCb) usePrevCb.checked = false;
            }

            renderInputArea(wrap, stage);
            bindInputAreaEvents(wrap, stage);
            refreshAllOutputs();
        });

        const usePrev = wrap.querySelector('[data-role="usePrev"]');
        if (usePrev) {
            usePrev.addEventListener('change', (e) => {
                stage.usePreviousOutput = e.target.checked;

                if (stage.usePreviousOutput && stage.inputMode === 'table') {
                    stage.inputMode = 'text';
                    wrap.querySelectorAll('[data-role="inputModeSeg"] button').forEach(b => b.classList.toggle('active', b.dataset.value === 'text'));
                }

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

        bindInputAreaEvents(wrap, stage);
        bindProcessingAreaEvents(wrap, stage);
    }

    function bindInputAreaEvents(wrap, stage) {
        if (stage.inputMode === 'text') {
            const field = wrap.querySelector('[data-role="inputField"]');
            if (field) {
                field.addEventListener('input', (e) => {
                    stage.inputString = e.target.value;
                    refreshAllOutputs();
                });
            }
            return;
        }

        const tableWrap = wrap.querySelector('[data-role="tableWrap"]');
        const delimSelect = wrap.querySelector('[data-role="delimiterSelect"]');
        const hasHeaderToggle = wrap.querySelector('[data-role="hasHeader"]');
        const pasteBtn = wrap.querySelector('[data-role="pasteClipboard"]');
        const addRowBtn = wrap.querySelector('[data-role="addRow"]');
        const addColBtn = wrap.querySelector('[data-role="addCol"]');
        const clearBtn = wrap.querySelector('[data-role="clearTable"]');

        function importText(text) {
            const { rows, delimiter } = parseDelimited(text, stage.table.delimiter);
            stage.table.rows = rows;
            renderTable(wrap, stage);
            bindTableCellEvents();
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

        tableWrap.addEventListener('paste', (e) => {
            e.preventDefault();
            const text = (e.clipboardData || window.clipboardData).getData('text');
            if (text) importText(text);
        });
        tableWrap.addEventListener('dragover', (e) => { e.preventDefault(); tableWrap.classList.add('drag-over'); });
        tableWrap.addEventListener('dragleave', () => tableWrap.classList.remove('drag-over'));
        tableWrap.addEventListener('drop', (e) => {
            e.preventDefault(); tableWrap.classList.remove('drag-over');
            const file = e.dataTransfer.files && e.dataTransfer.files[0];
            if (file) { file.text().then(importText); }
        });

        delimSelect.addEventListener('change', (e) => {
            stage.table.delimiter = e.target.value;
            refreshAllOutputs();
        });
        hasHeaderToggle.addEventListener('change', (e) => {
            stage.table.hasHeader = e.target.checked;
            renderTable(wrap, stage);
            bindTableCellEvents();
            refreshAllOutputs();
        });
        addRowBtn.addEventListener('click', () => {
            const cols = stage.table.rows.length ? Math.max(...stage.table.rows.map(r => r.length)) : 2;
            stage.table.rows.push(new Array(cols).fill(''));
            renderTable(wrap, stage);
            bindTableCellEvents();
            refreshAllOutputs();
        });
        addColBtn.addEventListener('click', () => {
            if (!stage.table.rows.length) stage.table.rows.push([]);
            stage.table.rows.forEach(r => r.push(''));
            renderTable(wrap, stage);
            bindTableCellEvents();
            refreshAllOutputs();
        });
        clearBtn.addEventListener('click', () => {
            if (!confirm('Clear this table?')) return;
            stage.table.rows = [];
            renderTable(wrap, stage);
            bindTableCellEvents();
            refreshAllOutputs();
        });

        function bindTableCellEvents() {
            const tw = wrap.querySelector('[data-role="tableWrap"]');
            tw.querySelectorAll('[data-role="delRow"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const r = parseInt(btn.dataset.row, 10);
                    stage.table.rows.splice(r, 1);
                    renderTable(wrap, stage); bindTableCellEvents(); refreshAllOutputs();
                });
            });
            tw.querySelectorAll('[data-role="delCol"]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const c = parseInt(btn.dataset.col, 10);
                    stage.table.rows.forEach(row => row.splice(c, 1));
                    renderTable(wrap, stage); bindTableCellEvents(); refreshAllOutputs();
                });
            });
            const debouncedSync = debounce(() => refreshAllOutputs(), 250);
            tw.querySelectorAll('.cell').forEach(cell => {
                cell.addEventListener('input', () => {
                    const r = parseInt(cell.dataset.row, 10), c = parseInt(cell.dataset.col, 10);
                    if (!stage.table.rows[r]) stage.table.rows[r] = [];
                    stage.table.rows[r][c] = cell.textContent;
                    debouncedSync();
                });

                cell.addEventListener('paste', (e) => {
                    e.stopPropagation();
                    const text = (e.clipboardData || window.clipboardData).getData('text');
                    if (text && (text.includes('\t') || text.includes('\n') || text.includes(','))) {
                        e.preventDefault();
                        const r0 = parseInt(cell.dataset.row, 10), c0 = parseInt(cell.dataset.col, 10);
                        const { rows: pastedRows } = parseDelimited(text, stage.table.delimiter);
                        pastedRows.forEach((row, ri) => {
                            row.forEach((val, ci) => {
                                const rr = r0 + ri, cc = c0 + ci;
                                if (!stage.table.rows[rr]) stage.table.rows[rr] = [];
                                stage.table.rows[rr][cc] = val;
                            });
                        });
                        renderTable(wrap, stage); bindTableCellEvents(); refreshAllOutputs();
                    }
                });
            });
        }
        bindTableCellEvents();
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
        docTitleLabel.textContent = state.title || 'Chained Regex Pipeline';
        document.title = state.title ? state.title + ' · Chained Regex Pipeline' : 'Chained Regex Pipeline';

        titleField.addEventListener('input', (e) => {
            state.title = e.target.value;
            docTitleLabel.textContent = state.title || 'Chained Regex Pipeline';
            document.title = state.title ? state.title + ' · Chained Regex Pipeline' : 'Chained Regex Pipeline';
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
            const params = new URLSearchParams(window.location.search);
            params.delete('d');
            history.replaceState({}, '', window.location.pathname);
            titleField.value = ''; descField.value = '';
            docTitleLabel.textContent = 'Chained Regex Pipeline';
            document.title = 'Chained Regex Pipeline';
            renderAll();
        });

        document.getElementById('copyLinkBtn').addEventListener('click', () => {
            persistToUrl();
            setTimeout(() => {
                navigator.clipboard.writeText(window.location.href).then(() => showToast('Share link copied'));
            }, 320);
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