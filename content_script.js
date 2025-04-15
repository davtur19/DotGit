if (typeof window.dotGitInjected === 'undefined') {
    window.dotGitInjected = true;

    let debug = false;

    function debugLog(...args) {
        if (debug) {
            console.log('[DotGit]', ...args);
        }
    }

    // Content script for checking exposed Git repositories and sensitive files
    const GIT_PATH = "/.git/";
    const GIT_HEAD_PATH = GIT_PATH + "HEAD";
    const GIT_CONFIG_PATH = GIT_PATH + "config";
    const GIT_HEAD_HEADER = "ref: refs/heads/";
    const GIT_CONFIG_SEARCH = "url = (.*(github\\.com|gitlab\\.com).*)";
    const GIT_OBJECTS_SEARCH = "[a-f0-9]{40}";

    const SVN_PATH = "/.svn/";
    const SVN_DB_PATH = SVN_PATH + "wc.db";
    const SVN_DB_HEADER = "SQLite";

    const HG_PATH = "/.hg/";
    const HG_MANIFEST_PATH = HG_PATH + "store/00manifest.i";
    const HG_MANIFEST_HEADERS = [
        "\u0000\u0000\u0000\u0001",
        "\u0000\u0001\u0000\u0001",
        "\u0000\u0002\u0000\u0001",
        "\u0000\u0003\u0000\u0001",
    ];

    const ENV_PATH = "/.env";
    const ENV_SEARCH = "^[A-Z_]+=|^[#\\n\\r ][\\s\\S]*^[A-Z_]+=";

    const DS_STORE = "/.DS_Store";
    const DS_STORE_HEADER = "\x00\x00\x00\x01Bud1";

    const SECURITYTXT_PATHS = [
        "/.well-known/security.txt",
        "/security.txt",
    ];
    const SECURITYTXT_SEARCH = "Contact: ";

    // Helper function to make fetch requests with timeout
    async function fetchWithTimeout(resource, options = {}) {
        const { timeout = 10000 } = options;
        
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(resource, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        
        return response;
    }

    // Check for exposed Git repository
    async function checkGit(url) {
        const to_check = url + GIT_HEAD_PATH;
        const search = new RegExp(GIT_OBJECTS_SEARCH, "y");
        
        try {
            debugLog('Checking Git HEAD:', to_check);
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });
            
            debugLog('Response status:', response.status);
            debugLog('Response headers:', [...response.headers.entries()]);
            
            if (response.status === 200) {
                const text = await response.text();
                debugLog('Git HEAD content:', text);
                debugLog('Content length:', text.length);
                debugLog('Starts with header?', text.startsWith(GIT_HEAD_HEADER));
                debugLog('Matches hash?', search.test(text));
                
                if (text.startsWith(GIT_HEAD_HEADER) || search.test(text)) {
                    debugLog('Git repository found!');
                    chrome.runtime.sendMessage({
                        type: "GIT_FOUND",
                        url: url
                    });
                    return true;
                }
                debugLog('Content does not match Git patterns');
            } else {
                debugLog('Response not OK:', response.status, response.statusText);
            }
        } catch (error) {
            debugLog('Error checking Git:', error);
        }
        
        debugLog('No Git repository found at:', to_check);
        return false;
    }

    // Check for exposed SVN repository
    async function checkSvn(url) {
        const to_check = url + SVN_DB_PATH;
        
        try {
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });
            
            if (response.status === 200) {
                const text = await response.text();
                if (text.startsWith(SVN_DB_HEADER)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }
        
        return false;
    }

    // Check for exposed Mercurial repository
    async function checkHg(url) {
        const to_check = url + HG_MANIFEST_PATH;
        
        try {
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });
            
            if (response.status === 200) {
                const text = await response.text();
                if (HG_MANIFEST_HEADERS.some(header => text.startsWith(header))) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }
        
        return false;
    }

    // Check for exposed .env file
    async function checkEnv(url) {
        const to_check = url + ENV_PATH;
        const search = new RegExp(ENV_SEARCH, "g");
        
        try {
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });
            
            if (response.status === 200) {
                const text = await response.text();
                if (search.test(text)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }
        
        return false;
    }

    // Check for exposed .DS_Store file
    async function checkDSStore(url) {
        const to_check = url + DS_STORE;
        
        try {
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });
            
            if (response.status === 200) {
                const text = await response.text();
                if (text.startsWith(DS_STORE_HEADER)) {
                    return true;
                }
            }
        } catch (error) {
            // Ignore error
        }
        
        return false;
    }

    // Check for security.txt file
    async function checkSecuritytxt(url) {
        for (const path of SECURITYTXT_PATHS) {
            const to_check = url + path;
            const search = new RegExp(SECURITYTXT_SEARCH);
            
            try {
                const response = await fetchWithTimeout(to_check, {
                    redirect: "manual",
                    timeout: 10000
                });
                
                if (response.status === 200) {
                    const text = await response.text();
                    if (search.test(text)) {
                        return to_check;
                    }
                }
            } catch (error) {
                // Ignore error
            }
        }
        return false;
    }

    async function checkGitConfig(url) {
        const to_check = url + GIT_CONFIG_PATH;
        const search = new RegExp(GIT_CONFIG_SEARCH);
        let result = [];

        try {
            const response = await fetchWithTimeout(to_check, {
                redirect: "manual",
                timeout: 10000
            });

            if (response.status === 200) {
                let text = await response.text();
                if (text !== false && ((result = search.exec(text)) !== null)) {
                    return result[1];
                }
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    async function checkOpenSource(url) {
        try {
            const response = await fetchWithTimeout(url, {
                redirect: "manual",
                timeout: 10000
            });

            if (response.status === 200) {
                return url;
            }
        } catch (error) {
            // Ignore error
        }

        return false;
    }

    async function isOpenSource(url) {
        let configUrl;
        let str = "";

        configUrl = await checkGitConfig(url);

        if (configUrl !== false) {
            str = configUrl.replace("github.com:", "github.com/");
            str = str.replace("gitlab.com:", "gitlab.com/");
            if (str.startsWith("ssh://")) {
                str = str.substring(6);
            }
            if (str.startsWith("git@")) {
                str = str.substring(4);
            }
            if (str.endsWith(".git")) {
                str = str.substring(0, str.length - 4);
            }
            if (str.startsWith("http") === false) {
                str = "https://" + str;
            }

            try {
                new URL(str);
                return await checkOpenSource(str);
            } catch (_) {
                return false;
            }
        }

        return false;
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        debugLog('Received message:', request);
        
        if (request.type === "CHECK_SITE") {
            const { url, options } = request;
            debug = options.debug;  // Imposta il debug in base alle opzioni
            debugLog('Checking site:', url, 'with options:', options);
            
            // Run checks based on enabled options
            Promise.all([
                options.functions.git ? checkGit(url) : Promise.resolve(false),
                options.functions.svn ? checkSvn(url) : Promise.resolve(false),
                options.functions.hg ? checkHg(url) : Promise.resolve(false),
                options.functions.env ? checkEnv(url) : Promise.resolve(false),
                options.functions.ds_store ? checkDSStore(url) : Promise.resolve(false),
                options.check_securitytxt ? checkSecuritytxt(url) : Promise.resolve(false),
                options.functions.git && options.check_opensource ? isOpenSource(url) : Promise.resolve(false)
            ]).then(([git, svn, hg, env, ds_store, securitytxt, opensource]) => {
                const results = {
                    git,
                    svn,
                    hg,
                    env,
                    ds_store,
                    securitytxt,
                    opensource
                };
                console.log('[DotGit] Check results:', results);
                sendResponse(results);
            }).catch(error => {
                console.log('[DotGit] Error during checks:', error);
                sendResponse({
                    git: false,
                    svn: false,
                    hg: false,
                    env: false,
                    ds_store: false,
                    securitytxt: false,
                    opensource: false,
                    error: error.message
                });
            });

            return true; // Keep the message channel open for async response
        }
    });

    debugLog('Content script setup complete');
} 