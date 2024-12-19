$( document ).ready(function() {
    scanFields();
});

const GROUP_ID_PREFIX = "regexGroup";
var chainList = [];


function scanFields() {
    scanRegexGroup();
    // scanSearchFields();
}

function scanRegexGroup() {
    $(".regex-group").each(function(i, obj) {
        let groupId = $(this).attr('id');

        let groupNumber = groupId.replace(/.+(\d+)$/, "$1");

        let nextGroupId = GROUP_ID_PREFIX + "-" + (parseInt(groupNumber) + 1);

        chainList.push(groupId);
        // console.log(groupId, groupNumber);
        //test
        let searchField = $(this).find(".search-regex-form");
        let inputField = $(this).find(".input-form");
        let inputCheckboxField = $(this).find(".input-from-previous-output");
        let subtituteField = $(this).find(".subtitute-regex-form");
        let outputField = $(this).find(".output-form");

        if (inputCheckboxField.length > 0) {
            checkInput(inputCheckboxField, groupNumber, inputField);
            inputCheckboxField.on("change", function(e){
                // if ($(this).checked())
                checkInput($(this), groupNumber, inputField);
            })
        }

        searchField.on("input", function(e) {
            updateSearchRegex(groupNumber, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            updateRegexGroup(nextGroupId);
        })

        inputField.on("input", function(e) {
            updateSearchRegex(groupNumber, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            updateRegexGroup(nextGroupId);
        })

        subtituteField.on("input", function(e) {
            updateSearchRegex(groupNumber, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            updateRegexGroup(nextGroupId);
        })
    });
}



function scanSearchFields() {
    $(".search-regex-form").on('input', function(event){
        // event.stopPropagation();
        // event.stopImmediatePropagation();
        // console.log(event.target.value)
        // event.target.parent
    });
}

function updateRegexGroup(regexGroupId) {
    let regexGroup = $("#" + regexGroupId);
    if (regexGroup.length == 0)
        return;
    // regexGroup.find(".search-regex-form").trigger("input");
    // console.log("triggered " + regexGroupId)
    regexGroup.find(".input-form").trigger("input");
    // regexGroup.find(".subtitute-regex-form").trigger("input");
    // regexGroup.find(".output-form").trigger("input");
}

function updateSearchRegex(groupNumber, searchField, inputField, subtituteField, outputField, inputCheckboxField) {
    try {
        // console.log("oke");
        // inputField.val("oke");
        // subtituteField.val("oke");
        // outputField.val("oke");
        let srcRegex = new RegExp(searchField.val(), "g");

        let checked = inputCheckboxField.is(':checked');
        if (checked) {
            inputField.val(getPreviousOutput(groupNumber));
        }
        
        let regexOutput = inputField.val() ? inputField.val().replace(srcRegex, subtituteField.val()) : inputField.val();
        outputField.val(regexOutput);
    } catch {
        outputField.val("Error!")
    }
}

function getPreviousOutput(groupNumber) {
    let prevGroupId = GROUP_ID_PREFIX + "-" + (parseInt(groupNumber) - 1);
    let prevRegexGroup = $("#" + prevGroupId);
    let outputField = prevRegexGroup.find(".output-form");
    return outputField.val();
}

function checkInput(checkbox, groupNumber, inputField) {
    let checked = checkbox.is(':checked');
    let prevGroupId = GROUP_ID_PREFIX + "-" + (parseInt(groupNumber) - 1);
    // console.log(prevInputFieldId, $("#" + prevInputFieldId));
    if (checked) {
        inputField.prop('readonly', true);
    } else {
        inputField.prop('readonly', false);
    }
            
}