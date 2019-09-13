const MAX_ITEMS = 100;
chrome.browserAction.setBadgeText({
    text: ""
});


function addElements(element, array, callback) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }

    for (let i = array.length - 1; i > -1; i--) {
        if (i <= array.length - MAX_ITEMS) {
            break;
        }

        const listItem = document.createElement("li");
        listItem.textContent = callback(array[i]);
        element.appendChild(listItem);
    }
}


document.addEventListener("click", (e) => {
    if (e.target.classList.contains("reset")) {
        chrome.storage.local.set({
            checked: [],
            withExposedGit: []
        });

        chrome.runtime.reload();
    }
});


chrome.storage.local.get(["checked", "withExposedGit"], function(visitedSite) {
    if (typeof visitedSite.checked !== "undefined" && visitedSite.checked.length !== 0) {
        let hostElement = document.getElementById("hosts");
        addElements(hostElement, visitedSite.checked, (url) => {
            return `${url}`;
        });
    }

    if (typeof visitedSite.withExposedGit !== "undefined" && visitedSite.withExposedGit.length !== 0) {
        let hostElementFound = document.getElementById("hostsFound");
        addElements(hostElementFound, visitedSite.withExposedGit, (url) => {
            return `${url}`;
        });
    }
});