// Not supported on Firefox for Android
if (chrome.browserAction.setBadgeText) {
    chrome.browserAction.setBadgeText({
        text: ""
    });
    // set width for desktop devices
    document.addEventListener("DOMContentLoaded", function () {
        document.getElementById("hostsFound").style.width = "380px";
    });
}

document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.local.get(["options"], function (options) {
        let color = options.options.color;
        let list = document.getElementsByClassName("custom-color");
        for (let n = 0; n < list.length; ++n) {
            list[n].className += " " + color;
        }
        let max_sites = options.options.max_sites
        let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
        hostElementFoundTitle.textContent = "0 out of " + max_sites + " shown";
    });
});

function addElements(element, array, callback, downloading, max_sites) {

    for (let i = array.length - 1; i > -1; i--) {
        if (i <= array.length - max_sites) {
            break;
        }

        /*
        <li class="collection-item">
            <span class="secondary-content">
                    <i class="material-icons btn-small download">file_download</i>
            </span>
            <span class="truncate">
                <a href="https://example.org/">testtesttesttesttesttesttesttesttesttesttesttest</a>
            </span>
        </li>
        */
        const listItem = document.createElement("li");
        listItem.setAttribute("class", "collection-item");

        const spanLink = document.createElement("span");
        spanLink.setAttribute("class", "truncate");

        const spanIcon = document.createElement("span");
        spanIcon.setAttribute("class", "secondary-content");

        const btnDownload = document.createElement("i");
        if (downloading.includes(callback(array[i]))) {
            btnDownload.setAttribute("class", "material-icons btn-small blue disabled");
        } else {
            btnDownload.setAttribute("class", "material-icons btn-small blue download");
        }
        btnDownload.innerText = "file_download";

        const link = document.createElement("a");
        link.setAttribute("href", callback(array[i]) + "/.git/config");
        link.innerText = callback(array[i]);

        spanLink.appendChild(link);
        spanIcon.appendChild(btnDownload);
        listItem.appendChild(spanIcon);
        listItem.appendChild(spanLink);
        element.appendChild(listItem);
    }
}

document.addEventListener("click", (e) => {
    if (e.target.id === "reset") {
        chrome.storage.local.set({
            checked: [],
            withExposedGit: [],
            downloading: []
        });
        chrome.runtime.reload();
    } else if (e.target.classList.contains("download")) {
        e.target.setAttribute("class", "material-icons btn-small blue disabled");
        chrome.storage.local.get(["downloading"], function (downloading) {
            if (typeof downloading.downloading !== "undefined" && downloading.downloading.length !== 0) {
                downloading.downloading.push(e.target.parentElement.nextElementSibling.innerText);
                chrome.storage.local.set({
                    downloading: downloading.downloading
                });
            } else {
                chrome.storage.local.set({
                    downloading: [e.target.parentElement.nextElementSibling.innerText]
                });
            }
        });

        chrome.runtime.sendMessage({
            type: "download",
            url: e.target.parentElement.nextElementSibling.innerText
        }, function (response) {
            e.target.setAttribute("class", "material-icons btn-small blue download");
        });
    }
});


chrome.storage.local.get(["withExposedGit", "downloading", "options"], function (visitedSite) {
    if (typeof visitedSite.withExposedGit !== "undefined" && visitedSite.withExposedGit.length !== 0) {
        let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
        let max_sites = visitedSite.options.max_sites
        hostElementFoundTitle.textContent = visitedSite.withExposedGit.length + " out of " + max_sites + " shown";

        let hostElementFound = document.getElementById("hostsFound");
        if (typeof visitedSite.downloading !== "undefined" && visitedSite.downloading.length !== 0) {
            addElements(hostElementFound, visitedSite.withExposedGit, function (url) {
                return `${url}`;
            }, visitedSite.downloading, max_sites);
        } else {
            addElements(hostElementFound, visitedSite.withExposedGit, function (url) {
                return `${url}`;
            }, [], max_sites);
        }
    }
});