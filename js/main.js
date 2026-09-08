$(document).ready(function () {
    // Inisialisasi event listener utama
    $("#addRegexButton").on("click", () => addRegexCard());
    $("#titleField, #descField").on("input", updateUrlState);

    // Muat data dari URL atau buat pipeline default
    loadFromUrlState();
});

let pipelineSequence = 0;

// ==========================================
// PIPELINE MANAGEMENT
// ==========================================
function addRegexCard(data = null) {
    let template = document.getElementById("pipelineTemplate").content.cloneNode(true);
    let sequence = pipelineSequence++;
    
    let $card = $(template.querySelector(".regex-group"));
    $card.attr("id", `regexGroup-${sequence}`);
    $card.attr("data-sequence", sequence);
    $card.find(".seq-num").text(sequence + 1);

    // Scope Radio Buttons agar unik per card
    let radioName = `replace-mode-${sequence}`;
    $card.find(".replace-mode-radio").each((i, el) => {
        let id = `mode-${sequence}-${i}`;
        $(el).attr("name", radioName).attr("id", id);
        $(el).next("label").attr("for", id);
    });

    // Scope Checkbox Flags
    $card.find(".flag-btn").each((i, el) => {
        let id = `flag-${sequence}-${i}`;
        $(el).attr("id", id);
        $(el).next("label").attr("for", id);
    });

    // Sembunyikan switch 'Previous Output' untuk pipeline pertama
    if (sequence === 0) {
        $card.find(".prev-output-switch").hide();
        $card.find(".input-from-previous-output").prop("checked", false);
    }

    $("#containerRegex").append($card);
    let $newCard = $(`#regexGroup-${sequence}`);

    // Terapkan data jika me-load dari State
    if (data) {
        applyDataToCard($newCard, data);
    } else {
        updateUrlState(); // Simpan state default ke URL
    }

    initCardEvents($newCard, sequence);
    triggerPipelineCascade(sequence);
}

function initCardEvents($card, sequence) {
    // 1. Semua perubahan pada form -> trigger kalkulasi & update URL
    $card.find(".state-trigger").on("input change", function () {
        triggerPipelineCascade(sequence);
        updateUrlState();
    });

    // 2. Hapus Pipeline
    $card.find(".btn-remove").on("click", function () {
        if ($(".regex-group").length > 1) {
            $card.remove();
            recalculateSequences();
            triggerPipelineCascade(0);
            updateUrlState();
        } else {
            alert("Minimal harus ada 1 pipeline.");
        }
    });

    // 3. Table View Toggle
    $card.find(".btn-toggle-table").on("click", function () {
        let $textarea = $card.find(".input-form");
        let $tableContainer = $card.find(".table-view-container");
        
        if ($textarea.is(":visible")) {
            // Switch to Table Mode
            $textarea.hide();
            $tableContainer.html(csvToHtmlTable($textarea.val())).fadeIn(200);
            $(this).addClass("active btn-primary").removeClass("btn-secondary");
        } else {
            // Switch to Text Mode
            $tableContainer.hide();
            $textarea.fadeIn(200);
            $(this).removeClass("active btn-primary").addClass("btn-secondary");
        }
    });

    // 4. Paste CSV from Clipboard -> Auto Format & Set Input
    $card.find(".btn-paste-csv").on("click", async function () {
        try {
            const text = await navigator.clipboard.readText();
            let $textarea = $card.find(".input-form");
            
            // Uncheck "From previous output" jika user manual paste
            $card.find(".input-from-previous-output").prop("checked", false);
            $textarea.prop('readonly', false);
            
            $textarea.val(text);
            
            // Auto open table view
            let $tableContainer = $card.find(".table-view-container");
            $textarea.hide();
            $tableContainer.html(csvToHtmlTable(text)).show();
            $card.find(".btn-toggle-table").addClass("active btn-primary").removeClass("btn-secondary");

            triggerPipelineCascade(sequence);
            updateUrlState();
        } catch (err) {
            alert("Failed to read clipboard! (Check browser permissions)");
            console.error(err);
        }
    });

    // 5. Copy Output
    $card.find(".btn-copy").on("click", function () {
        let val = $card.find(".output-form").val();
        navigator.clipboard.writeText(val).then(() => {
            let $icon = $(this).find("i");
            $icon.removeClass("bi-copy").addClass("bi-check2 text-success");
            setTimeout(() => $icon.removeClass("bi-check2 text-success").addClass("bi-copy"), 2000);
        });
    });
}

function recalculateSequences() {
    $(".regex-group").each(function (index) {
        $(this).find(".seq-num").text(index + 1);
        if(index === 0) {
            $(this).find(".prev-output-switch").hide();
            $(this).find(".input-from-previous-output").prop("checked", false);
        } else {
            $(this).find(".prev-output-switch").show();
        }
    });
}


// ==========================================
// REGEX ENGINE & CASCADING LOGIC
// ==========================================
function triggerPipelineCascade(startIndex) {
    let cards = $(".regex-group").toArray();
    
    for (let i = startIndex; i < cards.length; i++) {
        let $card = $(cards[i]);
        let $input = $card.find(".input-form");
        let usePrev = $card.find(".input-from-previous-output").is(":checked");
        
        // Handling inputString
        if (usePrev && i > 0) {
            let prevOutput = $(cards[i - 1]).find(".output-form").val();
            $input.val(prevOutput);
            $input.prop('readonly', true);
        } else {
            $input.prop('readonly', false);
        }

        updateStats($input, $card.find(".input-info small"));

        // Extraction data modeRegex & js processing
        let rawInput = $input.val() || "";
        let searchRegexStr = $card.find(".search-regex-form").val();
        let substituteStr = $card.find(".subtitute-regex-form").val() || "";
        let iterate = parseInt($card.find(".iterate-regex-form").val()) || 1;
        let replaceMode = $card.find(".replace-mode-radio:checked").attr("data-value");
        let scriptProc = $card.find(".script-processor-form").val();
        
        // Compile Flags
        let flags = "";
        $card.find(".flag-btn:checked").each((_, el) => { flags += $(el).attr("data-value"); });

        let $output = $card.find(".output-form");

        // Execution
        try {
            if (!searchRegexStr) {
                $output.val(rawInput); // Bypass if empty regex
            } else {
                let srcRegex = new RegExp(searchRegexStr, flags);
                // Unescape Substitute String handling
                let subParsed = substituteStr.replace(/\\n/g, "\n").replace(/\\t/g, "\t"); 
                
                let result = processRegex(rawInput, srcRegex, subParsed, replaceMode, iterate, scriptProc);
                $output.val(result);
            }
        } catch (err) {
            $output.val("Error Processing Regex:\n" + err.message);
        }
        
        updateStats($output, $card.find(".output-info small"));
        
        // Sinkronisasi Tabel jika aktif
        if ($card.find(".btn-toggle-table").hasClass("active")) {
             $card.find(".table-view-container").html(csvToHtmlTable($input.val()));
        }
    }
}

function processRegex(inputValue, searchRegex, subtituteValue, replaceMode, iteration, scriptProcessor) {
    let outputValue = inputValue;
    
    if (scriptProcessor) {
        outputValue = processScript(outputValue, searchRegex, scriptProcessor);
    }

    for (let i = 0; i < iteration; i++) {
        if (replaceMode === "0") { // Subtitute
            outputValue = outputValue.replace(searchRegex, subtituteValue);
        } else { // List Matched
            let replaceValue = "";
            const matches = outputValue.matchAll(searchRegex);
            for (const match of matches) {
                replaceValue += match[0].replace(searchRegex, subtituteValue) + "\n";
            }
            outputValue = replaceValue.trimEnd();
        }
    }
    return outputValue;
}

function processScript(inputValue, searchRegex, scriptProcessor) {
    try {
        const matches = inputValue.matchAll(searchRegex);
        let outputValue = inputValue;
        let startStringIndex = 0;
        let matchIndex = 0;
        
        for (const match of matches) {
            let matchString = match[0];
            let originalString = match[0];
            
            let groupIndex = 0;
            for (const group of match) {
                if (groupIndex > 0) { // Lewati full match, fokus pada group
                    let inputString = group; 
                    // WARNING: eval digunakan seperti pada arsitektur lama
                    let result = eval(scriptProcessor);
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
    } catch(err) {
        console.warn("JS Processing Error:", err);
        return inputValue; // Kembalikan default apabila script gagal
    }
}

function updateStats($field, $label) {
    let val = $field.val() || "";
    let lines = val ? val.split("\n").length : 0;
    let chars = val.length;
    $label.html(`${lines} Lines | ${chars} Characters`);
}


// ==========================================
// URL STATE MANAGEMENT (JSON Base64)
// ==========================================
function updateUrlState() {
    let state = {
        title: $("#titleField").val(),
        desc: $("#descField").val(),
        pipelines: []
    };

    document.title = state.title ? state.title + " | Chained Regex" : "Chained Regex";

    $(".regex-group").each(function () {
        let $c = $(this);
        
        let flags = "";
        $c.find(".flag-btn:checked").each((_, el) => { flags += $(el).attr("data-value"); });
        
        state.pipelines.push({
            in: $c.find(".input-form").val(),
            usePrev: $c.find(".input-from-previous-output").is(":checked"),
            regex: $c.find(".search-regex-form").val(),
            flags: flags,
            sub: $c.find(".subtitute-regex-form").val(),
            iter: $c.find(".iterate-regex-form").val(),
            mode: $c.find(".replace-mode-radio:checked").attr("data-value"),
            js: $c.find(".script-processor-form").val()
        });
    });

    // Enkripsi State ke format URL aman
    let base64State = btoa(encodeURIComponent(JSON.stringify(state)));
    
    const url = new URL(window.location);
    url.searchParams.set("state", base64State);
    history.replaceState(null, '', url);
}

function loadFromUrlState() {
    const url = new URL(window.location);
    const stateParam = url.searchParams.get("state");

    if (stateParam) {
        try {
            let state = JSON.parse(decodeURIComponent(atob(stateParam)));
            $("#titleField").val(state.title || "");
            $("#descField").val(state.desc || "");
            document.title = state.title ? state.title + " | Chained Regex" : "Chained Regex";

            state.pipelines.forEach(pipe => { addRegexCard(pipe); });
            triggerPipelineCascade(0);
            return;
        } catch (e) {
            console.error("Gagal membaca URL state:", e);
        }
    }
    
    // Default 2 Pipeline jika tidak ada state valid
    addRegexCard();
    addRegexCard();
}

function applyDataToCard($card, data) {
    $card.find(".input-form").val(data.in || "");
    $card.find(".input-from-previous-output").prop("checked", data.usePrev);
    $card.find(".search-regex-form").val(data.regex || "");
    $card.find(".subtitute-regex-form").val(data.sub || "");
    $card.find(".iterate-regex-form").val(data.iter || 1);
    $card.find(".script-processor-form").val(data.js || "");
    
    // Radio Replace Mode
    $card.find(`.replace-mode-radio[data-value="${data.mode}"]`).prop("checked", true);
    
    // Checkbox Flags
    let flags = data.flags || "";
    $card.find(".flag-btn").each((_, el) => {
        $(el).prop("checked", flags.includes($(el).attr("data-value")));
    });
}


// ==========================================
// UTILITIES
// ==========================================
function csvToHtmlTable(csvText) {
    if (!csvText) return "<p class='text-muted small m-2'>No data to format</p>";
    
    // Deteksi separator (Tab untuk Excel, Comma untuk murni CSV)
    const separator = csvText.indexOf('\t') !== -1 ? '\t' : ',';
    const rows = csvText.split('\n');
    
    let html = '<table class="table table-dark table-sm table-bordered m-0 text-nowrap">';
    rows.forEach((row, i) => {
        if (!row.trim() && i === rows.length - 1) return; // Skip baris kosong di akhir
        html += '<tr>';
        const cols = row.split(separator);
        cols.forEach(col => {
            html += `<td>${col || '&nbsp;'}</td>`;
        });
        html += '</tr>';
    });
    html += '</table>';
    return html;
}