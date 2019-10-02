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
        const link = document.createElement("a");
        link.setAttribute("href", callback(array[i]));
        link.innerText = callback(array[i]);
        listItem.appendChild(link);
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
        let hostElementTitle = document.getElementById("hostsTitle");
        hostElementTitle.textContent = "Visited hosts (" + visitedSite.checked.length + " out of 100 shown):";
        let hostElement = document.getElementById("hosts");
        addElements(hostElement, visitedSite.checked, (url) => {
            return `${url}`;
        });
    }

    if (typeof visitedSite.withExposedGit !== "undefined" && visitedSite.withExposedGit.length !== 0) {
        let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
        hostElementFoundTitle.textContent = ".git exposed (" + visitedSite.withExposedGit.length + " out of 100 shown):";
        let hostElementFound = document.getElementById("hostsFound");
        addElements(hostElementFound, visitedSite.withExposedGit, (url) => {
            return `${url}/.git/config`;
        });
    }
});