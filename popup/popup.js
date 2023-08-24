// add "view-source:" only in firefox, because chrome give this error: Not allowed to load local resource
let HREF_PREFIX = "";
if (typeof browser !== "undefined") {
    HREF_PREFIX = "view-source:";
}

// Not supported on Firefox for Android
if (chrome.browserAction.setBadgeText) {
    chrome.browserAction.setBadgeText({
        text: ""
    });
    // set width for desktop devices
    // not working anymore on chrome, fixed with css
    /*document.addEventListener("DOMContentLoaded", function () {
        document.getElementById("hostsFound").style.width = "380px";
    });*/
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
        hostElementFoundTitle.textContent = "Total found: 0 Max shown: " + max_sites;
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

        const link = document.createElement("a");

        // delete from list button
        const spanDeleteWebsite = document.createElement("span");
        spanDeleteWebsite.setAttribute("class", "secondary-content");
        const deleteWebsite = document.createElement("i");
        deleteWebsite.setAttribute("id", "del:" + array[i].type + ":" + callback(array[i].url));
        deleteWebsite.setAttribute("class", "material-icons btn-small red delete");
        deleteWebsite.setAttribute("title", "Delete website from the list");
        deleteWebsite.innerText = "delete";
        spanDeleteWebsite.appendChild(deleteWebsite);
        listItem.appendChild(spanDeleteWebsite);

        const spanSecuritytxtStatus = document.createElement("span");
        spanSecuritytxtStatus.setAttribute("class", "secondary-content");
        const securitytxtStatus = document.createElement("a");
        securitytxtStatus.setAttribute("class", "material-icons btn-small security");
        securitytxtStatus.setAttribute("title", "The Website has security.txt");
        securitytxtStatus.setAttribute("href", HREF_PREFIX + callback(array[i].securitytxt));
        securitytxtStatus.innerText = "security";
        spanSecuritytxtStatus.appendChild(securitytxtStatus);


        if (callback(array[i].type) === "git") {
            const spanDownloadStatus = document.createElement("span");
            spanDownloadStatus.setAttribute("class", "secondary-content truncate");
            const spanOpenSourceStatus = document.createElement("span");
            spanOpenSourceStatus.setAttribute("class", "secondary-content");

            const btnDownload = document.createElement("i");
            btnDownload.setAttribute("id", "db:" + callback(array[i].url));
            if (downloading.includes(callback(array[i]))) {
                btnDownload.setAttribute("class", "material-icons btn-small blue disabled");
            } else {
                btnDownload.setAttribute("class", "material-icons btn-small blue download");
            }
            btnDownload.setAttribute("title", "Download all files from the .git folder");
            btnDownload.innerText = "file_download";

            const downloadStatus = document.createElement("div");
            downloadStatus.setAttribute("class", "download-status");
            downloadStatus.setAttribute("id", "ds:" + callback(array[i].url))
            downloadStatus.setAttribute("title", "success/failed/total");
            downloadStatus.innerText = "";

            const openSourceStatus = document.createElement("a");
            openSourceStatus.setAttribute("class", "material-icons btn-small public");
            openSourceStatus.setAttribute("title", "The Website is OpenSource");
            openSourceStatus.setAttribute("href", callback(array[i].open));
            openSourceStatus.innerText = "public";

            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.git/config");
            spanIcon.appendChild(btnDownload);
            spanDownloadStatus.appendChild(downloadStatus);
            spanOpenSourceStatus.appendChild(openSourceStatus);
            listItem.appendChild(spanIcon);
            if (callback(array[i].open) !== "false" && callback(array[i].open) !== "undefined") {
                // check if it has the old version values (4.5)
                if (callback(array[i].open) === "true") {
                    openSourceStatus.setAttribute("href", "about:blank");
                }
                listItem.appendChild(spanOpenSourceStatus);
            }
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            listItem.appendChild(spanDownloadStatus);
        }
        if (callback(array[i].type) === "svn") {
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.svn/");
        }
        if (callback(array[i].type) === "hg") {
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.hg/");
        }
        if (callback(array[i].type) === "env") {
            if (callback(array[i].securitytxt) !== "false" && callback(array[i].securitytxt) !== "undefined") {
                listItem.appendChild(spanSecuritytxtStatus);
            }
            link.setAttribute("href", HREF_PREFIX + callback(array[i].url) + "/.env");
        }
        link.innerText = callback(array[i].url);

        spanLink.appendChild(link);
        listItem.appendChild(spanLink);
        element.appendChild(listItem);
    }
}


document.addEventListener("click", (event) => {
    const button = event.target;

    if (button.id === "reset") {
        chrome.storage.local.set({
            checked: [],
            withExposedGit: [],
            downloading: []
        });
        chrome.runtime.reload();
    } else if (button.classList.contains("download")) {
        const url = button.id.substring(3);

        button.setAttribute("class", "material-icons btn-small blue disabled");
        chrome.storage.local.get(["downloading"], function (downloading) {
            if (typeof downloading.downloading !== "undefined" && downloading.downloading.length !== 0) {
                downloading.downloading.push(url);
                chrome.storage.local.set({
                    downloading: downloading.downloading
                });
            } else {
                chrome.storage.local.set({
                    downloading: [url]
                });
            }
        });

        chrome.runtime.sendMessage({
            type: "download",
            url: url
        }, function () {
            button.setAttribute("class", "material-icons btn-small blue download");
        });
    } else if (button.classList.contains("delete")) {
        const split = button.id.split(":");
        const type = split[1];
        const url = split.slice(2).join(":");
        let indexDelete = null;

        button.setAttribute("class", "material-icons btn-small red disabled");
        chrome.storage.local.get(["withExposedGit"], function (result) {
            result.withExposedGit.forEach(function (obj, i) {
                if (obj.type === type && obj.url === url) {
                    indexDelete = i;
                }
            });

            if (indexDelete !== null) {
                result.withExposedGit.splice(indexDelete, 1);
                button.parentNode.parentNode.outerHTML = "";
                // change title
                const hostElementFoundTitle = document.getElementById("hostsFoundTitle");
                const split2 = hostElementFoundTitle.textContent.split(" ");
                const number = split2[2];
                const strTitle = split2.slice(3).join(" ");
                hostElementFoundTitle.textContent = "Total found: " + (number - 1) + " " + strTitle;

                chrome.storage.local.set({
                    withExposedGit: result.withExposedGit
                });
            }
        });
    } else if (button.id === "options") {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    } else if (button.id === "about") {
        window.open(chrome.runtime.getURL('about.html'));
    }
});


chrome.storage.local.get(["withExposedGit", "downloading", "options"], function (visitedSite) {
    if (typeof visitedSite.withExposedGit !== "undefined" && visitedSite.withExposedGit.length !== 0) {
        let hostElementFoundTitle = document.getElementById("hostsFoundTitle");
        let max_sites = visitedSite.options.max_sites
        hostElementFoundTitle.textContent = "Total found: " + visitedSite.withExposedGit.length + " Max shown: " + max_sites;

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


chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    let downloadStatusText = "";
    let downloadStatusArr = [];
    if (request.type === "downloadStatus") {
        downloadStatusText = document.getElementById("ds:" + request.url).innerText;
        if (downloadStatusText === "") {
            downloadStatusText = "0/0/0";
        }
        downloadStatusArr = downloadStatusText.split("/");
        if (request.downloadStatus.successful) {
            downloadStatusArr[0] = request.downloadStatus.successful.toString();
        }
        if (request.downloadStatus.failed) {
            downloadStatusArr[1] = request.downloadStatus.failed.toString();
        }
        if (request.downloadStatus.total) {
            downloadStatusArr[2] = request.downloadStatus.total.toString();
        }
        document.getElementById("ds:" + request.url).innerText = downloadStatusArr.join("/");
    }
    sendResponse({status: true});

    // this will keep the message channel open to the other end until sendResponse is called
    return true;
});
