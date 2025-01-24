$( document ).ready(function() {
    scanFields();
});

const GROUP_ID_PREFIX = "regexGroup";
var chainList = [];


function scanFields() {
    scanRegexGroup();
    initAddButton();
}

function initAddButton() {
    $("#addRegexButton").on("click", function() {
        let containerRegex = $("#containerRegex");
        let regexCard = $("#" + chainList[chainList.length - 1]);
        let newSequence = parseInt(regexCard.attr("data-sequence")) + 1;
        let newRegexCard = regexCard.clone();
        
        containerRegex.append(newRegexCard);
        newRegexCard.attr("id", GROUP_ID_PREFIX + "-" + newSequence)
        newRegexCard.attr("data-sequence", newSequence)
        newRegexCard.find(".card-title").text("Regex " + (newSequence + 1));

        chainList.push(newRegexCard.attr("id"));
        chainList = [];
        scanRegexGroup();
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

        searchField.off("input");
        searchField.on("input", function(e) {
            updateSearchRegex(groupSequence, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            updateNextRegexGroup(groupId);
        })

        inputField.off("input");
        inputField.on("input", function(e) {
            updateSearchRegex(groupSequence, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            updateNextRegexGroup(groupId);
        })

        subtituteField.off("input");
        subtituteField.on("input", function(e) {
            updateSearchRegex(groupSequence, searchField, inputField, subtituteField, outputField, inputCheckboxField);
            // updateRegexGroup(nextGroupId);
            updateNextRegexGroup(groupId);
        })
    });
}

function updateRegexGroup(regexGroupId) {
    let regexGroup = $("#" + regexGroupId);
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

function updateSearchRegex(groupSequence, searchField, inputField, subtituteField, outputField, inputCheckboxField) {
    try {
        let srcRegex = new RegExp(searchField.val(), "gm");
        let subtitute = JSON.parse(`{ "text": "${subtituteField.val()}" }`).text;

        let checked = inputCheckboxField.is(':checked');
        if (checked) {
            inputField.val(getPreviousOutput(groupSequence));
        }
        
        let regexOutput = inputField.val() ? inputField.val().replace(srcRegex, subtitute) : inputField.val();
        outputField.val(regexOutput);
    } catch (err) {
        outputField.val("Error!")
        console.error(err.message);
    }
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