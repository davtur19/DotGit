if (typeof window.dotGitInjected === 'undefined') {
    window.dotGitInjected = true;

    let debug = false;

    function debugLog(...args) {
        if (debug) {
            console.log('[DotGit]', ...args);
        }
    }
    debugLog("Content script initialized");

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

    // Comprehensive sensitive files detection with severity levels
    const SENSITIVE_FILES = {
        // CRITICAL - Direct credential exposure
        "CRITICAL": [
            {path: "/.env", pattern: /^[A-Z_]+=.+/m, name: "Environment file"},
            {path: "/.env.local", pattern: /^[A-Z_]+=.+/m, name: "Local environment file"},
            {path: "/.env.production", pattern: /^[A-Z_]+=.+/m, name: "Production environment file"},
            {path: "/.env.dev", pattern: /^[A-Z_]+=.+/m, name: "Dev environment file"},
            {path: "/.env.backup", pattern: /^[A-Z_]+=.+/m, name: "Backup environment file"},
            {path: "/.env.old", pattern: /^[A-Z_]+=.+/m, name: "Old environment file"},
            {path: "/.aws/credentials", pattern: /aws_access_key_id|aws_secret_access_key/i, name: "AWS credentials"},
            {path: "/.ssh/id_rsa", pattern: /BEGIN.*PRIVATE KEY/i, name: "SSH private key"},
            {path: "/.ssh/id_dsa", pattern: /BEGIN.*PRIVATE KEY/i, name: "SSH DSA key"},
            {path: "/id_rsa", pattern: /BEGIN.*PRIVATE KEY/i, name: "SSH private key (root)"},
            {path: "/id_dsa", pattern: /BEGIN.*PRIVATE KEY/i, name: "SSH DSA key (root)"},
            {path: "/credentials.json", pattern: /"private_key"|"api_key"|"password"/i, name: "Credentials JSON"},
            {path: "/secrets.yml", pattern: /password:|token:|key:|secret:/i, name: "Secrets YAML"},
            {path: "/secrets.yaml", pattern: /password:|token:|key:|secret:/i, name: "Secrets YAML"},
            {path: "/.npmrc", pattern: /_authToken|_password|:_auth/i, name: "NPM credentials"},
            {path: "/.pypirc", pattern: /password\s*=/i, name: "PyPI credentials"},
            {path: "/.dockercfg", pattern: /auth|password/i, name: "Docker credentials"},
            {path: "/.docker/config.json", pattern: /auth|password/i, name: "Docker config"},
            {path: "/.netrc", pattern: /password|login/i, name: "Netrc credentials"},
            {path: "/wp-config.php", pattern: /DB_PASSWORD|DB_HOST|DB_USER/i, name: "WordPress config"},
            {path: "/.htpasswd", pattern: /:/,name: "Apache htpasswd"},
        ],

        // HIGH - Configuration with potential secrets
        "HIGH": [
            {path: "/config.php", pattern: /<\?php/i, name: "PHP config"},
            {path: "/configuration.php", pattern: /<\?php/i, name: "PHP configuration"},
            {path: "/config.yml", pattern: /\w+:/i, name: "Config YAML"},
            {path: "/config.yaml", pattern: /\w+:/i, name: "Config YAML"},
            {path: "/config.json", pattern: /".*":/i, name: "Config JSON"},
            {path: "/settings.py", pattern: /SECRET_KEY|DATABASE|PASSWORD/i, name: "Django settings"},
            {path: "/database.yml", pattern: /password:|host:|username:/i, name: "Database YAML"},
            {path: "/database.yaml", pattern: /password:|host:|username:/i, name: "Database YAML"},
            {path: "/app.config", pattern: /</i, name: "App config"},
            {path: "/web.config", pattern: /<configuration/i, name: "Web config"},
            {path: "/application.properties", pattern: /=/i, name: "Application properties"},
            {path: "/application.yml", pattern: /\w+:/i, name: "Application YAML"},
            {path: "/.htaccess", pattern: /.+/i, name: "Apache htaccess"},
            {path: "/docker-compose.yml", pattern: /version:|services:/i, name: "Docker Compose"},
            {path: "/docker-compose.yaml", pattern: /version:|services:/i, name: "Docker Compose"},
            {path: "/.dockerenv", pattern: null, name: "Docker environment marker"},
            {path: "/Dockerfile", pattern: /FROM|RUN|ENV/i, name: "Dockerfile"},
        ],

        // MEDIUM - Database dumps and backups
        "MEDIUM": [
            {path: "/backup.sql", pattern: /INSERT INTO|CREATE TABLE|DROP TABLE/i, name: "SQL backup"},
            {path: "/database.sql", pattern: /INSERT INTO|CREATE TABLE|DROP TABLE/i, name: "SQL database"},
            {path: "/dump.sql", pattern: /INSERT INTO|CREATE TABLE|DROP TABLE/i, name: "SQL dump"},
            {path: "/db.sql", pattern: /INSERT INTO|CREATE TABLE|DROP TABLE/i, name: "SQL database"},
            {path: "/backup.zip", pattern: null, contentType: "application/zip", name: "Backup ZIP"},
            {path: "/backup.tar.gz", pattern: null, contentType: "application/gzip", name: "Backup tar.gz"},
            {path: "/backup.tar", pattern: null, contentType: "application/x-tar", name: "Backup tar"},
            {path: "/db_backup.sql", pattern: /INSERT INTO|CREATE TABLE/i, name: "Database backup"},
            {path: "/mysql.sql", pattern: /INSERT INTO|CREATE TABLE/i, name: "MySQL dump"},
            {path: "/postgres.sql", pattern: /INSERT INTO|CREATE TABLE/i, name: "PostgreSQL dump"},
        ],

        // LOW - Information disclosure
        "LOW": [
            {path: "/.bash_history", pattern: /.+/i, name: "Bash history"},
            {path: "/.zsh_history", pattern: /.+/i, name: "Zsh history"},
            {path: "/.mysql_history", pattern: /SELECT|INSERT|UPDATE|DELETE/i, name: "MySQL history"},
            {path: "/.psql_history", pattern: /SELECT|INSERT|UPDATE|DELETE/i, name: "PostgreSQL history"},
            {path: "/composer.json", pattern: /"name"|"require"/i, name: "Composer config"},
            {path: "/package.json", pattern: /"name"|"dependencies"/i, name: "NPM package.json"},
            {path: "/yarn.lock", pattern: /#.*yarn/i, name: "Yarn lockfile"},
            {path: "/package-lock.json", pattern: /"name"|"lockfileVersion"/i, name: "NPM lockfile"},
            {path: "/Gemfile", pattern: /gem|source/i, name: "Ruby Gemfile"},
            {path: "/Gemfile.lock", pattern: /GEM/i, name: "Ruby Gemfile lock"},
            {path: "/requirements.txt", pattern: /.*==/i, name: "Python requirements"},
            {path: "/Pipfile", pattern: /\[packages\]/i, name: "Python Pipfile"},
            {path: "/.gitignore", pattern: /.+/i, name: "Git ignore"},
            {path: "/.git/config", pattern: /\[core\]|\[remote/i, name: "Git config"},
            {path: "/.DS_Store", pattern: null, name: "macOS DS_Store"},
            {path: "/phpinfo.php", pattern: /PHP Version|phpinfo/i, name: "PHP info"},
            {path: "/info.php", pattern: /PHP Version|phpinfo/i, name: "PHP info"},
            {path: "/test.php", pattern: /<\?php/i, name: "PHP test file"},
            {path: "/README.md", pattern: /#/i, name: "README"},
            {path: "/CHANGELOG.md", pattern: /.+/i, name: "Changelog"},
        ]
    };

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
            debugLog('Response headers:', response.headers && response.headers.get ? 
                    'Headers available' : 'Headers not available');
            
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

    // Check for sensitive files
    async function checkSensitiveFiles(url, options) {
        const findings = [];

        if (!options.check_sensitive_files) {
            return findings;
        }

        debugLog('Starting sensitive files scan...');

        for (const [severity, files] of Object.entries(SENSITIVE_FILES)) {
            for (const file of files) {
                try {
                    const to_check = url + file.path;
                    debugLog('Checking:', to_check);

                    const response = await fetchWithTimeout(to_check, {
                        redirect: "manual",
                        timeout: 10000
                    });

                    if (response.status === 200) {
                        let isValid = false;

                        // Check content type if specified
                        if (file.contentType) {
                            const contentType = response.headers.get('content-type');
                            if (contentType && contentType.includes(file.contentType)) {
                                isValid = true;
                            }
                        }
                        // Check pattern if specified
                        else if (file.pattern) {
                            const text = await response.text();
                            if (file.pattern.test(text)) {
                                isValid = true;
                            }
                        }
                        // No validation required (just existence)
                        else {
                            isValid = true;
                        }

                        if (isValid) {
                            debugLog(`FOUND [${severity}]:`, file.name, 'at', to_check);
                            findings.push({
                                severity: severity,
                                path: file.path,
                                name: file.name,
                                url: to_check
                            });
                        }
                    }
                } catch (error) {
                    // Ignore errors for individual files
                    debugLog('Error checking file:', file.path, error.message);
                }
            }
        }

        debugLog('Sensitive files scan complete. Found:', findings.length);
        return findings;
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

    async function checkSite(url, options) {
        try {
            debugLog('Starting site check for:', url);

            // Run all checks in parallel
            const [git, svn, hg, env, ds_store, securitytxt, opensource, sensitiveFiles] = await Promise.all([
                options.functions.git ? checkGit(url) : Promise.resolve(false),
                options.functions.svn ? checkSvn(url) : Promise.resolve(false),
                options.functions.hg ? checkHg(url) : Promise.resolve(false),
                options.functions.env ? checkEnv(url) : Promise.resolve(false),
                options.functions.ds_store ? checkDSStore(url) : Promise.resolve(false),
                options.check_securitytxt ? checkSecuritytxt(url) : Promise.resolve(false),
                options.functions.git && options.check_opensource ? isOpenSource(url) : Promise.resolve(false),
                checkSensitiveFiles(url, options)
            ]);

            debugLog('Check results:', { git, svn, hg, env, ds_store, securitytxt, opensource, sensitiveFiles });

            const types = [];
            if (git) types.push('git');
            if (svn) types.push('svn');
            if (hg) types.push('hg');
            if (env) types.push('env');
            if (ds_store) types.push('ds_store');

            debugLog('Found types:', types);

            if (types.length > 0) {
                // Send each finding individually to ensure proper processing
                for (const type of types) {
                    debugLog('Sending finding for type:', type);
                    await new Promise((resolve) => {
                        chrome.runtime.sendMessage({
                            type: "FINDINGS_FOUND",
                            data: {
                                url: url,
                                types: [type], // Send only one type at a time
                                opensource: opensource,
                                securitytxt: securitytxt
                            }
                        }, response => {
                            debugLog('Background response for', type, ':', response);
                            resolve();
                        });
                    });
                }
            }

            // Send sensitive files findings
            if (sensitiveFiles && sensitiveFiles.length > 0) {
                debugLog('Sending sensitive files findings:', sensitiveFiles.length);
                await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        type: "SENSITIVE_FILES_FOUND",
                        data: {
                            url: url,
                            findings: sensitiveFiles
                        }
                    }, response => {
                        debugLog('Background response for sensitive files:', response);
                        resolve();
                    });
                });
            }

            return {
                git,
                svn,
                hg,
                env,
                ds_store,
                securitytxt,
                opensource,
                sensitiveFiles: sensitiveFiles.length
            };
        } catch (error) {
            debugLog('Error during checks:', error);
            return {
                git: false,
                svn: false,
                hg: false,
                env: false,
                ds_store: false,
                securitytxt: false,
                opensource: false,
                sensitiveFiles: 0,
                error: error.message
            };
        }
    }

    // Listen for messages from the background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        debugLog('Received message:', request);

        if (request.type === "PING") {
            sendResponse({status: "pong"});
            return true;
        }

        if (request.type === "CHECK_SITE") {
            const { url, options } = request;
            debug = options.debug;
            debugLog('Checking site:', url, 'with options:', options);
            
            // Run checks based on enabled options
            checkSite(url, options).then((results) => {
                sendResponse(results);
            }).catch(error => {
                debugLog('Error during checks:', error);
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