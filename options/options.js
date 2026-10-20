"use strict";

function set_gui(options) {
    // The page can load before the background has merged the defaults into an
    // older options object: never assume the nested keys exist.
    const functions = options.functions || {};
    const download = options.download || {};
    const notification = options.notification || {};

    const colors = document.getElementById("color");
    for (let i = 0; i < colors.length; i++) {
        if (colors.options[i].value === options.color) {
            colors.selectedIndex = i;
        }
    }

    // Every on/off group is a pair of radios named after the stored option.
    const switches = {
        git: functions.git,
        svn: functions.svn,
        hg: functions.hg,
        env: functions.env,
        ds_store: functions.ds_store,
        debug: options.debug,
        check_failed: options.check_failed,
        notification_new_git: notification.new_git,
        notification_download: notification.download,
        check_opensource: options.check_opensource,
        check_securitytxt: options.check_securitytxt,
    };
    for (const [name, value] of Object.entries(switches)) {
        const enabled = Boolean(value);
        document.querySelector(`input[name="${name}"][value="on"]`).checked = enabled;
        document.querySelector(`input[name="${name}"][value="off"]`).checked = !enabled;
    }

    document.getElementById("max_sites").value = String(options.max_sites);
    document.getElementById("request_timeout").value = String(options.request_timeout || 15);
    document.getElementById("max_connections").value = String(download.max_connections);
    document.getElementById("failed_in_a_row").value = String(download.failed_in_a_row);
    document.getElementById("blacklist").value = (options.blacklist || []).join(", ");
}

function setupOptionsPage() {
    chrome.storage.local.get(["options"], function (result) {
        // The page can load before the background has written the defaults:
        // try again instead of leaving it with no listeners at all.
        if (!result.options) {
            setTimeout(setupOptionsPage, 200);
            return;
        }
        // Nested keys can be missing when upgrading from an older version.
        result.options.functions = result.options.functions || {};
        result.options.download = result.options.download || {};
        result.options.notification = result.options.notification || {};
        set_gui(result.options);

        // Where each on/off group is stored: "functions.git", "debug", ...
        const TOGGLE_PATHS = {
            git: ["functions", "git"],
            svn: ["functions", "svn"],
            hg: ["functions", "hg"],
            env: ["functions", "env"],
            ds_store: ["functions", "ds_store"],
            notification_new_git: ["notification", "new_git"],
            notification_download: ["notification", "download"],
            check_opensource: ["check_opensource"],
            check_securitytxt: ["check_securitytxt"],
            debug: ["debug"],
            check_failed: ["check_failed"],
        };

        // Write through a path without assuming the nested object is still there.
        function setOption(options, path, value) {
            if (path.length === 1) {
                options[path[0]] = value;
                return;
            }
            let section = options[path[0]];
            if (!section) {
                section = options[path[0]] = {};
            }
            section[path[1]] = value;
        }

        document.addEventListener("change", (e) => {
            const path = TOGGLE_PATHS[e.target.name];
            if (path) {
                const value = (e.target.value === "on");
                setOption(result.options, path, value);
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.name,
                    value: value
                }, function (response) {
                });
            } else if (e.target.id === "color") {
                result.options.color = e.target.value;
                chrome.storage.local.set(result);
            } else if (e.target.validity.valid === true && (e.target.id === "max_sites")) {
                result.options.max_sites = Number(e.target.value);
                chrome.storage.local.set(result);
            } else if (e.target.validity.valid === true && e.target.id === "request_timeout") {
                result.options.request_timeout = Number(e.target.value);
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.id,
                    value: result.options.request_timeout
                }, function (response) {
                });
            } else if (e.target.validity.valid === true && (e.target.id === "max_connections" || e.target.id === "failed_in_a_row")) {
                result.options.download[e.target.id] = Number(e.target.value);
                chrome.storage.local.set(result);
                chrome.runtime.sendMessage({
                    type: e.target.id,
                    value: result.options.download[e.target.id]
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
                    // The handlers below write the whole object: keep the one
                    // they mutate in sync with what the reset just stored,
                    // otherwise the next change restores the old values.
                    if (response && response.options) {
                        result.options = response.options;
                        set_gui(result.options);
                    }
                });
            }
        });

    });
}

document.addEventListener("DOMContentLoaded", setupOptionsPage);
