const MAX_ITEMS = 100;
const storage = browser.storage.local.get();
browser.browserAction.setBadgeText({
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
        browser.storage.local.set({
            checked: [],
            withExposedGit: []
        });

        browser.runtime.reload();
    }
});


storage.then(results => {
    if (typeof results.checked !== "undefined" && results.checked.length !== 0) {
        let hostElement = document.getElementById("hosts");
        addElements(hostElement, results.checked, (url) => {
            return `${url}`;
        });
    }

    if (typeof results.withExposedGit !== "undefined" && results.withExposedGit.length !== 0) {
        let hostElementFound = document.getElementById("hostsFound");
        addElements(hostElementFound, results.withExposedGit, (url) => {
            return `${url}`;
        });
    }
});