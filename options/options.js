function set_gui(options) {
    let colors = document.getElementById("color");
    for (let i = 0; i < colors.length; i++) {
        if (colors.options[i].value === options.color) {
            document.getElementById("color").selectedIndex = i;
        }
    }
    document.getElementById("gitOn").checked = options.functions.git;
    document.getElementById("gitOff").checked = !options.functions.git;
    document.getElementById("svnOn").checked = options.functions.svn;
    document.getElementById("svnOff").checked = !options.functions.svn;
    document.getElementById("hgOn").checked = options.functions.hg;
    document.getElementById("hgOff").checked = !options.functions.hg;
    document.getElementById("envOn").checked = options.functions.env;
    document.getElementById("envOff").checked = !options.functions.env;
    document.getElementById("ds_storeOn").checked = options.functions.ds_store;
    document.getElementById("ds_storeOff").checked = !options.functions.ds_store;
    document.getElementById("debugOn").checked = options.debug;
    document.getElementById("debugOff").checked = !options.debug;
    document.getElementById("max_sites").value = options.max_sites;
    document.getElementById("max_connections").value = options.download.max_connections;
    document.getElementById("failed_in_a_row").value = options.download.failed_in_a_row;
    document.getElementById("wait").value = options.download.wait;
    document.getElementById("max_wait").value = options.download.max_wait;
    document.getElementById("on1").checked = options.notification.new_git;
    document.getElementById("off1").checked = !options.notification.new_git;
    document.getElementById("on2").checked = options.notification.download;
    document.getElementById("off2").checked = !options.notification.download;
    document.getElementById("on3").checked = options.check_opensource;
    document.getElementById("off3").checked = !options.check_opensource;
    document.getElementById("on4").checked = options.check_securitytxt;
    document.getElementById("off4").checked = !options.check_securitytxt;
    document.getElementById("blacklist").value = options.blacklist.join(", ");
}

document.addEventListener("DOMContentLoaded", function () {
    chrome.storage.local.get(["options"], function (result) {
        set_gui(result.options);

        document.addEventListener("change", (e) => {
            if (e.target.name === "git") {
                result.options.functions.git = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.functions.git
                }, function (response) {
                });
            } else if (e.target.name === "svn") {
                result.options.functions.svn = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.functions.svn
                }, function (response) {
                });
            } else if (e.target.name === "hg") {
                result.options.functions.hg = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.functions.hg
                }, function (response) {
                });
            } else if (e.target.name === "env") {
                result.options.functions.env = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.functions.env
                }, function (response) {
                });
            } else if (e.target.name === "ds_store") {
                result.options.functions.ds_store = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.functions.ds_store
                }, function (response) {
                });
            } else if (e.target.id === "color") {
                result.options.color = e.target.value;
                chrome.storage.local.set(result);
            } else if (e.target.validity.valid === true && (e.target.id === "max_sites")) {
                result.options.max_sites = e.target.value;
                chrome.storage.local.set(result);
            } else if (e.target.name === "notification_new_git") {
                result.options.notification.new_git = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.notification.new_git
                }, function (response) {
                });
            } else if (e.target.name === "notification_download") {
                result.options.notification.download = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.notification.download
                }, function (response) {
                });
            } else if (e.target.name === "check_opensource") {
                result.options.check_opensource = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.check_opensource
                }, function (response) {
                });
            } else if (e.target.name === "check_securitytxt") {
                result.options.check_securitytxt = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.check_securitytxt
                }, function (response) {
                });
            } else if (e.target.name === "debug") {
                result.options.debug = (e.target.value === "on");
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: result.options.debug
                }, function (response) {
                });
            } else if (e.target.validity.valid === true && (e.target.id === "max_connections" || e.target.id === "wait" || e.target.id === "max_wait" || e.target.id === "failed_in_a_row")) {
                result.options.download[e.target.id] = e.target.value;
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.id,
                    value: e.target.value
                }, function (response) {
                });
            } else if (e.target.id === "blacklist") {
                result.options.blacklist = e.target.value.replace(/\s/g, "").split(",").filter(function (el) {
                    return el !== "";
                });
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.id,
                    value: result.options.blacklist
                }, function (response) {
                });
            }
        });

        document.addEventListener("click", (e) => {
            if (e.target.id === "reset_default") {
                chrome.runtime.sendMessage({
                    type: "reset_options"
                }, function (response) {
                    set_gui(response.options);
                });
            }
        });

    });
});
