$( document ).ready(function() {
    scanFields();
});

const GROUP_ID_PREFIX = "regexGroup";
var chainList = [];
var searchParams;


function scanFields() {
    scanRegexGroup();
    initAddButton();
    parseQueryParams();
}

function parseQueryParams() {
    let url_string = window.location.href;
    let url = new URL(url_string);
    this.searchParams = url.searchParams;

    let tempGroup = {};
    for (let param of searchParams) {
        let type = param[0].replace(/^(.+)\d+/, "$1");
        let groupId = param[0].replace(/.+(\d+)$/, "$1");
        if (!tempGroup[groupId]) {
            tempGroup[groupId] = {};
        }

        switch (type) {

            case "s":
                tempGroup[groupId].search = param[1];
                break;
            
            case "r":
                tempGroup[groupId].replace = param[1];
                break;
            
            case "c":
                tempGroup[groupId].inputFromPreviousOutput = param[1];
                break;

            case "f":
                tempGroup[groupId].flags = param[1];
                break;
        
            case "m":
                tempGroup[groupId].mode = param[1];
                break;

            default:
                break;
        }
    }

    for (let groupId in tempGroup) {
        let group = tempGroup[groupId]
        if (groupId != "0" && groupId != "1") {
            addRegexCard(null, parseInt(groupId));
        }
        $(".regex-group#regexGroup-" + groupId).each(function(i, obj) {
            $(this).attr("flags-value", group.flags);
            $(this).find('input.flag-button').each(function(i, obj) {
                $(this).prop("checked", group.flags.includes($(this).attr("data-value")))
            })

            $(this).attr("replace-mode", group.mode);
            $(this).find('input.replace-mode-radio').each(function(i, obj) {
                $(this).prop("checked", group.mode == $(this).attr("data-value"))
            })
            
            $(this).find(".search-regex-form").val(group.search);
            $(this).find(".subtitute-regex-form").val(group.replace);
            $(this).find(".input-from-previous-output").prop('checked', group.inputFromPreviousOutput == "true");

        })
    }
    // console.log(tempGroup);
}

function initAddButton() {
    $("#addRegexButton").on("click", addRegexCard)
}

function addRegexCard(event, newSequenceRequest) {
    let containerRegex = $("#containerRegex");
    let regexCard = $("#" + chainList[chainList.length - 1]);
    let newSequence = parseInt(regexCard.attr("data-sequence")) + 1;
    if (newSequenceRequest != null) {
        newSequence = newSequenceRequest;
    }
    let newRegexCard = regexCard.clone();
    
    newRegexCard.attr("id", GROUP_ID_PREFIX + "-" + newSequence)
    newRegexCard.attr("data-sequence", newSequence)
    newRegexCard.find(".card-title").text("Regex " + (newSequence + 1));

    newRegexCard.find('input.replace-mode-radio').each(function(i, obj) {
        $(this).attr("name", "replace-mode-" + newSequence);
        let elementId = $(this).attr("id").replace(/-\d+/, "-" + newSequence);
        $(this).attr("id", elementId);
    })

    newRegexCard.find('label.replace-mode-label').each(function(i, obj) {
        let elementId = $(this).attr("for").replace(/-\d+/, "-" + newSequence);
        $(this).attr("for", elementId);
    })

    newRegexCard.find('input.flag-button').each(function(i, obj) {
        let elementId = $(this).attr("id").replace(/-\d+/, "-" + newSequence);
        $(this).attr("id", elementId);
    })

    newRegexCard.find('label.flag-label').each(function(i, obj) {
        let elementId = $(this).attr("for").replace(/-\d+/, "-" + newSequence);
        $(this).attr("for", elementId);
    })

    containerRegex.append(newRegexCard);
    chainList.push(newRegexCard.attr("id"));
    chainList = [];
    scanRegexGroup();
}

function initFlagButtons(parentGroupId, groupId) {
    parentGroupId.find("#flagsGroup input.flag-button").each(function(i, obj) {
        $(this).on("click", function() {
            let checked = $(this).is(":checked");
            let value = $(this).attr("data-value");
            let groupValue = parentGroupId.attr("flags-value");
            groupValue = groupValue.replace(value, "");
            if (checked) {
                groupValue += value;
            }
            parentGroupId.attr("flags-value", groupValue);

            updateCurrentRegexGroup(groupId);
        })
    })
}

function initReplaceButtons(parentGroupId, groupId) {
    parentGroupId.find('input.replace-mode-radio').each(function(i, obj) {
        $(this).on("click", function() {
            let checked = $(this).is(":checked");
            let value = $(this).attr("data-value");
            let groupValue = parentGroupId.attr("replace-mode");
            groupValue = value;
            
            parentGroupId.attr("replace-mode", groupValue);

            updateCurrentRegexGroup(groupId);
        })
    })
    parentGroupId.find('input#iterate-regex').each(function(i, obj) {
        $(this).on("input", function() {
            updateCurrentRegexGroup(groupId);
        })
    })
}

function initCopyButtons(parentGroupId, groupId, outputField) {
    parentGroupId.find('button#copy-button').each(function(i, obj) {
        $(this).on("click", function() {
            navigator.clipboard.writeText(outputField.val());
        })
    })
}

function scanRegexGroup() {
    $(".regex-group").each(function(i, obj) {
        let groupId = $(this).attr('id');

        // let groupSequence = groupId.replace(/.+(\d+)$/, "$1");
        let groupSequence = $(this).attr('data-sequence');

        // let nextGroupId = GROUP_ID_PREFIX + "-" + (parseInt(groupSequence) + 1);

        chainList.push(groupId);
        // console.log(groupId, groupSequence);
        //test
        let groupForm = $(this);
        let searchField = $(this).find(".search-regex-form");
        let inputField = $(this).find(".input-form");
        let inputCheckboxField = $(this).find(".input-from-previous-output");
        let subtituteField = $(this).find(".subtitute-regex-form");
        let outputField = $(this).find(".output-form");

        if (inputCheckboxField.length > 0) {
            checkInput(inputCheckboxField, groupSequence, inputField);
            inputCheckboxField.on("change", function(e){
                checkInput($(this), groupSequence, inputField);
            })
        }

        inputField.off("input");
        inputField.on("input", function(e) {
            updateSearchRegex(groupSequence, groupForm, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            updateNextRegexGroup(groupId);
        })

        searchField.off("input");
        searchField.on("input", function(e) {
            // updateSearchRegex(groupSequence, groupForm, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            // updateNextRegexGroup(groupId);
            updateCurrentRegexGroup(groupId);
        })

        subtituteField.off("input");
        subtituteField.on("input", function(e) {
            // updateSearchRegex(groupSequence, groupForm, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            // updateNextRegexGroup(groupId);
            updateCurrentRegexGroup(groupId);
        })

        inputCheckboxField.on("click", function(e) {
            // updateSearchRegex(groupSequence, groupForm, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            // updateNextRegexGroup(groupId);
            updateCurrentRegexGroup(groupId);
        })

        initFlagButtons($(this), groupId);

        initReplaceButtons($(this), groupId);

        initCopyButtons($(this), groupId, outputField);
    });
}

function updateRegexGroup(regexGroupId) {
    let regexGroup = $("#" + regexGroupId);
    if (regexGroup.length == 0)
        return;
    regexGroup.find(".input-form").trigger("input");
}

function updateCurrentRegexGroup(currentGroupId) {
    let currentIndex = chainList.findIndex(x => x === currentGroupId);
    let regexGroup = $("#" + chainList[currentIndex]);
    if (regexGroup.length == 0)
        return;
    regexGroup.find(".input-form").trigger("input");
}

function updateNextRegexGroup(currentGroupId) {
    // console.log("current id", currentGroupId);
    let currentIndex = chainList.findIndex(x => x === currentGroupId);
    if (currentIndex + 1 >= chainList.length)
        return;
    let regexGroup = $("#" + chainList[currentIndex + 1]);
    // console.log("next group", regexGroup.attr("data-sequence"))
    if (regexGroup.length == 0)
        return;
    regexGroup.find(".input-form").trigger("input");
}

function updateSearchRegex(groupSequence, groupForm, searchField, inputField, subtituteField, outputField, inputCheckboxField) {
    try {
        let flags = groupForm.attr("flags-value");
        let replaceMode = groupForm.attr("replace-mode");
        let iterateCount = parseInt(groupForm.find("input#iterate-regex").val());
        let srcRegex = new RegExp(searchField.val(), flags);
        let subtitute = JSON.parse(`{ "text": "${subtituteField.val()}" }`).text;
        let inputInfo = groupForm.find(".input-info small");
        let outputInfo = groupForm.find(".output-info small");

        if (inputField.val() != null) { 
            let inputCharCount = inputField.val().length;
            let inputLineCount = inputField.val().split("\n").length;
            inputInfo.html(`${inputLineCount} Lines | ${inputCharCount} character`)
        }

        let checked = inputCheckboxField.is(':checked');
        if (checked) {
            inputField.val(getPreviousOutput(groupSequence));
        }
        
        updateUrl(groupSequence, searchField.val(), subtituteField.val(), checked, flags, replaceMode);
        // let regexOutput = inputField.val() ? inputField.val().replace(srcRegex, subtitute) : inputField.val();
        let regexOutput = inputField.val() ? processRegex(inputField.val(), srcRegex, subtitute, replaceMode, iterateCount) : inputField.val();
        outputField.val(regexOutput);

        if (regexOutput != null) { 
            let outputCharCount = regexOutput.length;
            let outputLineCount = regexOutput.split("\n").length;
            outputInfo.html(`${outputLineCount} Lines | ${outputCharCount} character`)
        }

    } catch (err) {
        outputField.val("Error!")
        console.error(err.message);
    }
}

function updateUrl(groupSequence, searchValue, subtituteValue, inputFromPreviousOutput, flags, replaceMode){
    this.searchParams.set("s" + groupSequence, searchValue);
    this.searchParams.set("r" + groupSequence, subtituteValue);
    if (inputFromPreviousOutput != null)
        this.searchParams.set("c" + groupSequence, inputFromPreviousOutput);
    this.searchParams.set("f" + groupSequence, flags);
    this.searchParams.set("m" + groupSequence, replaceMode);

    var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + "?" + this.searchParams.toString();
    history.pushState({}, '', newurl)
 }

function processRegex(inputValue, searchRegex, subtituteValue, replaceMode, iteration) {
    let outputValue;
    for (let i = 0; i < iteration; i++) {
        if (replaceMode == "0") {
            outputValue = inputValue.replace(searchRegex, subtituteValue);
        } else {
            let replaceValue = "";
            const matches = inputValue.matchAll(searchRegex);
            for (const match of matches) {
                replaceValue += match[0].replace(searchRegex, subtituteValue);
            }
            outputValue = replaceValue;
        }
        inputValue = outputValue;
    }
    return outputValue;
}

function getPreviousOutput(groupSequence) {
    let prevGroupId = GROUP_ID_PREFIX + "-" + (parseInt(groupSequence) - 1);
    let prevRegexGroup = $("#" + prevGroupId);
    let outputField = prevRegexGroup.find(".output-form");
    return outputField.val();
}

function checkInput(checkbox, groupSequence, inputField) {
    let checked = checkbox.is(':checked');
    if (checked) {
        inputField.prop('readonly', true);
    } else {
        inputField.prop('readonly', false);
    }
            
}