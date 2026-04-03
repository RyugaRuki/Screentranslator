const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const http = require('http');
const { exec, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
    app.quit();
}

const BACKEND_URL = 'http://localhost:8080';
let mainWindow = null;
let selectionWindow = null;
let resultWindow = null;
let backendProcess = null;
let backendReady = false;
let isQuitting = false;
let currentTargetLang = 'vi';
let lastSelectedRegion = null;
let lastSelectedRegionUi = null;

const appConfigPath = () => path.join(app.getPath('userData'), 'app-config.json');
const defaultConfig = {
    apiKeys: {
        gemini: '',
        openai: '',
        claude: '',
        deepseek: ''
    },
    hotkeys: {
        selectRegion: 'F2',
        toggleLang: 'F5',
        repeatRegion: 'F6'
    },
    resultWindow: {
        width: 420,
        height: 300
    },
    preferences: {
        speedMode: true,
        autoTranslateEnabled: false,
        autoTranslateIntervalMs: 1000,
        resultFontSize: 31
    }
};
let appConfig = { ...defaultConfig };
let sessionHistory = [];

let savedPosition = null;
let isPinned = false;
let lastFrameHash = null;
let lastFrameTargetLang = null;
let lastFrameResult = null;
let autoTranslateTimer = null;
let isCaptureInFlight = false;

app.whenReady().then(async () => {
    loadAppConfig();

    registerShortcuts();

    createMainWindow();
    createResultWindow();

    await ensureBackendReady();
    applyAutoTranslateState();
    notifyStatus();

    console.log('Screen Translator ready | F2 chon vung | F5 doi ngon ngu');
});

app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
    sessionHistory = [];
    stopAutoTranslateLoop();
    destroyAllWindows();
    stopBackendProcess();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createMainWindow();
    }
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 620,
        height: 460,
        minWidth: 560,
        minHeight: 420,
        autoHideMenuBar: true,
        backgroundColor: '#0f1424',
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    mainWindow.loadFile(path.join(__dirname, '../overlay/launcher.html'));

    mainWindow.on('closed', () => {
        if (!isQuitting) {
            closeAuxWindows();
            app.quit();
        }
        mainWindow = null;
    });
}

function createResultWindow() {
    const width = Number(appConfig.resultWindow?.width) || 420;
    const height = Number(appConfig.resultWindow?.height) || 300;
    const hasSavedXY = Number.isFinite(appConfig.resultWindow?.x) && Number.isFinite(appConfig.resultWindow?.y);

    resultWindow = new BrowserWindow({
        x: hasSavedXY ? appConfig.resultWindow.x : undefined,
        y: hasSavedXY ? appConfig.resultWindow.y : undefined,
        width,
        height,
        minWidth: 120,
        minHeight: 80,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        show: false,
        resizable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    resultWindow.setAlwaysOnTop(true, 'screen-saver');
    resultWindow.loadFile(path.join(__dirname, '../overlay/result.html'));

    resultWindow.on('closed', () => {
        resultWindow = null;
    });

    resultWindow.on('moved', () => {
        if (resultWindow && !resultWindow.isDestroyed()) {
            savedPosition = resultWindow.getPosition();
            appConfig.resultWindow = {
                ...(appConfig.resultWindow || {}),
                x: savedPosition[0],
                y: savedPosition[1],
                width: resultWindow.getSize()[0],
                height: resultWindow.getSize()[1]
            };
            saveAppConfig();
        }
    });

    resultWindow.on('resized', () => {
        if (resultWindow && !resultWindow.isDestroyed()) {
            const [w, h] = resultWindow.getSize();
            appConfig.resultWindow = {
                ...(appConfig.resultWindow || {}),
                width: w,
                height: h
            };
            saveAppConfig();
            notifyStatus();
        }
    });
}

ipcMain.handle('start-selection', () => {
    openSelectionOverlay();
    return { ok: true };
});

ipcMain.handle('get-runtime-status', () => ({
    backendReady,
    targetLang: currentTargetLang,
    hasSavedRegion: Boolean(lastSelectedRegion),
    hotkeys: { ...(appConfig.hotkeys || defaultConfig.hotkeys) },
    preferences: { ...(appConfig.preferences || defaultConfig.preferences) }
}));

ipcMain.handle('translate-last-region', async () => {
    const ok = await translateLastRegion();
    return { ok };
});

ipcMain.handle('quit-app', () => {
    isQuitting = true;
    destroyAllWindows();
    stopBackendProcess();
    app.exit(0);
    return { ok: true };
});

ipcMain.handle('get-app-config', () => ({
    apiKeys: { ...appConfig.apiKeys },
    hotkeys: { ...(appConfig.hotkeys || defaultConfig.hotkeys) },
    resultWindow: { ...(appConfig.resultWindow || defaultConfig.resultWindow) },
    preferences: { ...(appConfig.preferences || defaultConfig.preferences) },
    targetLang: currentTargetLang,
    backendReady
}));

ipcMain.handle('save-app-config', (event, configPayload) => {
    const apiKeys = configPayload && configPayload.apiKeys ? configPayload.apiKeys : {};
    const hotkeys = configPayload && configPayload.hotkeys ? configPayload.hotkeys : {};
    const resultWindowConfig = configPayload && configPayload.resultWindow ? configPayload.resultWindow : {};
    const preferences = configPayload && configPayload.preferences ? configPayload.preferences : {};

    appConfig.apiKeys = {
        gemini: String(apiKeys.gemini || '').trim(),
        openai: String(apiKeys.openai || '').trim(),
        claude: String(apiKeys.claude || '').trim(),
        deepseek: String(apiKeys.deepseek || '').trim()
    };

    appConfig.hotkeys = {
        selectRegion: normalizeHotkey(hotkeys.selectRegion, defaultConfig.hotkeys.selectRegion),
        toggleLang: normalizeHotkey(hotkeys.toggleLang, defaultConfig.hotkeys.toggleLang),
        repeatRegion: normalizeHotkey(hotkeys.repeatRegion, defaultConfig.hotkeys.repeatRegion)
    };

    appConfig.resultWindow = {
        ...defaultConfig.resultWindow,
        ...(appConfig.resultWindow || {}),
        width: clampNumber(resultWindowConfig.width, 120, 1200, appConfig.resultWindow?.width || 420),
        height: clampNumber(resultWindowConfig.height, 80, 1000, appConfig.resultWindow?.height || 300),
        x: appConfig.resultWindow?.x,
        y: appConfig.resultWindow?.y
    };

    appConfig.preferences = {
        speedMode: preferences.speedMode !== undefined
            ? Boolean(preferences.speedMode)
            : Boolean(appConfig.preferences?.speedMode),
        autoTranslateEnabled: preferences.autoTranslateEnabled !== undefined
            ? Boolean(preferences.autoTranslateEnabled)
            : Boolean(appConfig.preferences?.autoTranslateEnabled),
        autoTranslateIntervalMs: clampNumber(
            preferences.autoTranslateIntervalMs,
            500,
            2000,
            Number(appConfig.preferences?.autoTranslateIntervalMs) || 1000
        ),
        resultFontSize: clampNumber(
            preferences.resultFontSize,
            16,
            72,
            Number(appConfig.preferences?.resultFontSize) || 31
        )
    };

    saveAppConfig();

    const registerResult = registerShortcuts();

    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.setSize(appConfig.resultWindow.width, appConfig.resultWindow.height);
    }

    applyAutoTranslateState();
    notifyStatus();

    return {
        ok: registerResult.ok,
        failed: registerResult.failed
    };
});

ipcMain.handle('get-history', () => sessionHistory);

ipcMain.handle('clear-history', () => {
    sessionHistory = [];
    notifyHistoryChanged();
    return { ok: true };
});

ipcMain.handle('check-backend', async () => {
    backendReady = await pingBackend();
    notifyStatus();
    return { ok: backendReady };
});

ipcMain.on('close-result', () => {
    if (resultWindow && !resultWindow.isDestroyed()) resultWindow.hide();
});

ipcMain.on('set-pinned', (event, pinned) => {
    isPinned = pinned;
});

function openSelectionOverlay() {
    if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();

    const { width, height } = screen.getPrimaryDisplay().bounds;

    selectionWindow = new BrowserWindow({
        x: 0,
        y: 0,
        width,
        height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        focusable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    selectionWindow.setAlwaysOnTop(true, 'screen-saver');
    selectionWindow.loadFile(path.join(__dirname, '../overlay/selection.html'));
    selectionWindow.focus();

    selectionWindow.on('closed', () => {
        selectionWindow = null;
    });

    ipcMain.once('region-selected', async (event, region) => {
        if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
        if (region) {
            const uiRegion = toUiRegion(region);
            lastSelectedRegion = region;
            lastSelectedRegionUi = uiRegion;
            notifyStatus();
            await captureAndTranslate(region, uiRegion);
            applyAutoTranslateState();
        }
    });

    ipcMain.once('selection-cancelled', () => {
        if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
    });
}

function captureWithPowerShell(region) {
    return new Promise((resolve, reject) => {
        const tmpFile = path.join(os.tmpdir(), `cap_${Date.now()}.png`).replace(/\\/g, '\\\\');

        const psScript = [
            'Add-Type -AssemblyName System.Windows.Forms',
            'Add-Type -AssemblyName System.Drawing',
            `$bmp = New-Object System.Drawing.Bitmap(${region.width}, ${region.height})`,
            '$g = [System.Drawing.Graphics]::FromImage($bmp)',
            `$g.CopyFromScreen(${region.x}, ${region.y}, 0, 0, [System.Drawing.Size]::new(${region.width}, ${region.height}))`,
            '$g.Dispose()',
            `$bmp.Save('${tmpFile}', [System.Drawing.Imaging.ImageFormat]::Png)`,
            '$bmp.Dispose()'
        ].join('; ');

        exec(`powershell -NoProfile -NonInteractive -Command "${psScript}"`,
            { timeout: 10000 },
            (err, stdout, stderr) => {
                if (err) {
                    reject(new Error('Loi chup: ' + (stderr || err.message)));
                    return;
                }

                const realPath = tmpFile.replace(/\\\\/g, '\\');
                try {
                    const buf = fs.readFileSync(realPath);
                    fs.unlinkSync(realPath);
                    resolve(buf.toString('base64'));
                } catch (e) {
                    reject(new Error('Khong doc duoc anh: ' + e.message));
                }
            }
        );
    });
}

async function captureAndTranslate(region, uiRegion, options = {}) {
    try {
        if (!region) {
            throw new Error('Chua co vung da chon. Hay bam F2 de chon lan dau.');
        }

        const displayRegion = uiRegion || toUiRegion(region);
        const showLoading = options.showLoading !== false;
        const fromAuto = options.fromAuto === true;
        const speedMode = Boolean(appConfig.preferences?.speedMode);

        if (!backendReady) {
            await ensureBackendReady();
        }

        if (showLoading) {
            showResult({ status: 'loading' }, displayRegion);
        }

        const base64 = await captureWithPowerShell(region);

        const frameHash = hashText(base64);
        const isSameFrame = lastFrameHash && lastFrameResult && lastFrameHash === frameHash && lastFrameTargetLang === currentTargetLang;

        // Vision mode optimization: skip backend call entirely when frame is unchanged.
        if (!speedMode && isSameFrame) {
            if (!fromAuto) {
                showResult({
                    status: 'success',
                    ...lastFrameResult,
                    targetLang: currentTargetLang,
                    modelUsed: `${lastFrameResult.modelUsed || 'cache'}-local`
                }, displayRegion);
            }
            return;
        }

        // Keep existing fast path for speed mode as well.
        if (speedMode && isSameFrame) {
            showResult({
                status: 'success',
                ...lastFrameResult,
                targetLang: currentTargetLang,
                modelUsed: `${lastFrameResult.modelUsed || 'cache'}-local`
            }, displayRegion);
            return;
        }

        const result = await callBackend(base64, currentTargetLang);

        lastFrameHash = frameHash;
        lastFrameTargetLang = currentTargetLang;
        lastFrameResult = result;

        pushHistory({
            createdAt: new Date().toISOString(),
            originalText: result.originalText || '',
            translatedText: result.translatedText || '',
            targetLang: currentTargetLang,
            modelUsed: result.modelUsed || ''
        });

        showResult({ status: 'success', ...result, targetLang: currentTargetLang }, displayRegion);
    } catch (err) {
        showResult({ status: 'error', message: err.message }, uiRegion || toUiRegion(region));
    }
}

async function translateLastRegion() {
    if (!lastSelectedRegion) {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('region-missing');
        }
        return false;
    }

    await captureAndTranslate(lastSelectedRegion, lastSelectedRegionUi || toUiRegion(lastSelectedRegion));
    return true;
}

function showResult(data, region) {
    if (!resultWindow || resultWindow.isDestroyed()) createResultWindow();

    if (region && Number.isFinite(region.x) && Number.isFinite(region.y) && Number.isFinite(region.width) && Number.isFinite(region.height)) {
        const nextBounds = {
            x: Math.max(0, Math.round(region.x)),
            y: Math.max(0, Math.round(region.y)),
            width: Math.max(120, Math.round(region.width)),
            height: Math.max(80, Math.round(region.height))
        };

        resultWindow.setBounds(nextBounds);
        savedPosition = [nextBounds.x, nextBounds.y];

        appConfig.resultWindow = {
            ...(appConfig.resultWindow || {}),
            ...nextBounds
        };
        saveAppConfig();
    } else if (!isPinned && savedPosition === null) {
        const { width: sw } = screen.getPrimaryDisplay().bounds;
        const x = Math.max(10, sw - 440);
        const y = 100;
        resultWindow.setPosition(x, y);
        savedPosition = [x, y];
    } else if (savedPosition) {
        resultWindow.setPosition(savedPosition[0], savedPosition[1]);
    }

    // Show overlay without stealing foreground focus from the current app/game.
    resultWindow.showInactive();
    resultWindow.webContents.send('show-result', data);
}

function callBackend(imageBase64, targetLang) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            imageBase64,
            targetLang,
            geminiApiKey: appConfig.apiKeys.gemini || '',
            speedMode: Boolean(appConfig.preferences?.speedMode)
        });

        const req = http.request({
            hostname: 'localhost',
            port: 8080,
            path: '/api/translate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch {
                    reject(new Error('Du lieu backend khong hop le'));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(20000, () => {
            req.destroy();
            reject(new Error('Timeout 20s'));
        });
        req.write(body);
        req.end();
    });
}

function loadAppConfig() {
    try {
        if (fs.existsSync(appConfigPath())) {
            const raw = fs.readFileSync(appConfigPath(), 'utf8');
            const parsed = JSON.parse(raw);
            appConfig = {
                ...defaultConfig,
                ...parsed,
                apiKeys: {
                    ...defaultConfig.apiKeys,
                    ...(parsed.apiKeys || {})
                },
                hotkeys: {
                    ...defaultConfig.hotkeys,
                    ...(parsed.hotkeys || {})
                },
                resultWindow: {
                    ...defaultConfig.resultWindow,
                    ...(parsed.resultWindow || {})
                },
                preferences: {
                    ...defaultConfig.preferences,
                    ...(parsed.preferences || {})
                }
            };

            savedPosition = Number.isFinite(appConfig.resultWindow.x) && Number.isFinite(appConfig.resultWindow.y)
                ? [appConfig.resultWindow.x, appConfig.resultWindow.y]
                : null;
        }
    } catch (e) {
        appConfig = { ...defaultConfig };
    }
}

function saveAppConfig() {
    try {
        fs.writeFileSync(appConfigPath(), JSON.stringify(appConfig, null, 2), 'utf8');
    } catch (e) {
        console.error('Khong luu duoc app-config:', e.message);
    }
}

function pushHistory(item) {
    sessionHistory.unshift(item);
    if (sessionHistory.length > 100) {
        sessionHistory = sessionHistory.slice(0, 100);
    }
    notifyHistoryChanged();
}

function pingBackend() {
    return new Promise((resolve) => {
        http.get(`${BACKEND_URL}/api/health`, () => resolve(true))
            .on('error', () => resolve(false));
    });
}

async function ensureBackendReady() {
    backendReady = await pingBackend();
    if (backendReady) {
        notifyStatus();
        return;
    }

    startBackendProcess();
    backendReady = await waitForBackend(45000);
    notifyStatus();
}

function startBackendProcess() {
    if (backendProcess) {
        return;
    }

    if (app.isPackaged) {
        const backendDir = path.join(process.resourcesPath, 'backend');
        const backendExe = path.join(backendDir, 'screen-translator-backend.exe');

        if (!fs.existsSync(backendExe)) {
            console.error('Khong tim thay backend exe:', backendExe);
            return;
        }

        backendProcess = spawn(backendExe, [], {
            cwd: backendDir,
            windowsHide: true
        });
    } else {
        const backendDir = path.resolve(__dirname, '../../java-backend');
        const mvnwPath = path.join(backendDir, 'mvnw.cmd');
        const command = fs.existsSync(mvnwPath) ? mvnwPath : 'mvn';

        backendProcess = spawn(command, ['spring-boot:run'], {
            cwd: backendDir,
            shell: true,
            windowsHide: true
        });
    }

    backendProcess.on('exit', () => {
        backendReady = false;
        backendProcess = null;
        notifyStatus();
    });
}

function stopBackendProcess() {
    if (!backendProcess) {
        return;
    }

    try {
        backendProcess.kill();
    } catch (e) {
        if (!isQuitting) {
            console.warn('Khong the dung backend process:', e.message);
        }
    }

    backendProcess = null;
}

async function waitForBackend(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ok = await pingBackend();
        if (ok) {
            return true;
        }
        await new Promise((r) => setTimeout(r, 1200));
    }
    return false;
}

function notifyStatus() {
    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.webContents.send('apply-preferences', {
            ...(appConfig.preferences || defaultConfig.preferences)
        });
    }

    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send('runtime-status', {
        backendReady,
        targetLang: currentTargetLang,
        hasSavedRegion: Boolean(lastSelectedRegion),
        hotkeys: { ...(appConfig.hotkeys || defaultConfig.hotkeys) },
        preferences: { ...(appConfig.preferences || defaultConfig.preferences) }
    });
}

function closeAuxWindows() {
    if (selectionWindow && !selectionWindow.isDestroyed()) {
        selectionWindow.close();
    }

    if (resultWindow && !resultWindow.isDestroyed()) {
        resultWindow.close();
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
    }
}

function destroyAllWindows() {
    BrowserWindow.getAllWindows().forEach((w) => {
        try {
            w.destroy();
        } catch (e) {
            // Ignore window shutdown errors during exit.
        }
    });
}

function notifyHistoryChanged() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        return;
    }

    mainWindow.webContents.send('history-updated', {
        count: sessionHistory.length
    });
}

function registerShortcuts() {
    globalShortcut.unregisterAll();

    const failed = [];
    const map = appConfig.hotkeys || defaultConfig.hotkeys;

    const register = (accelerator, action) => {
        if (!accelerator) {
            failed.push('(empty)');
            return;
        }
        try {
            const ok = globalShortcut.register(accelerator, action);
            if (!ok) {
                failed.push(accelerator);
            }
        } catch (e) {
            failed.push(accelerator);
        }
    };

    register(map.selectRegion, () => openSelectionOverlay());
    register(map.repeatRegion, async () => { await translateLastRegion(); });
    register(map.toggleLang, () => {
        currentTargetLang = currentTargetLang === 'vi' ? 'en' : 'vi';
        notifyStatus();
        console.log(`Ngôn ngữ: ${currentTargetLang.toUpperCase()}`);
    });

    return { ok: failed.length === 0, failed };
}

function normalizeHotkey(value, fallback) {
    const text = String(value || '').trim().toUpperCase();
    if (!text) return fallback;

    const aliases = {
        CTRL: 'Control',
        CONTROL: 'Control',
        CMD: 'Command',
        COMMAND: 'Command',
        WIN: 'Super',
        WINDOWS: 'Super',
        OPTION: 'Alt'
    };

    const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
    const normalized = parts.map((p) => aliases[p] || p.charAt(0) + p.slice(1).toLowerCase());
    return normalized.join('+') || fallback;
}

function hashText(value) {
    return crypto.createHash('sha1').update(String(value || '')).digest('hex');
}

function applyAutoTranslateState() {
    const enabled = Boolean(appConfig.preferences?.autoTranslateEnabled);
    const intervalMs = Number(appConfig.preferences?.autoTranslateIntervalMs) || 1000;

    if (!enabled || !lastSelectedRegion) {
        stopAutoTranslateLoop();
        return;
    }

    startAutoTranslateLoop(intervalMs);
}

function startAutoTranslateLoop(intervalMs) {
    stopAutoTranslateLoop();

    autoTranslateTimer = setInterval(async () => {
        if (isCaptureInFlight || !lastSelectedRegion) {
            return;
        }

        isCaptureInFlight = true;
        try {
            await captureAndTranslate(
                lastSelectedRegion,
                lastSelectedRegionUi || toUiRegion(lastSelectedRegion),
                { fromAuto: true, showLoading: false }
            );
        } finally {
            isCaptureInFlight = false;
        }
    }, intervalMs);
}

function stopAutoTranslateLoop() {
    if (autoTranslateTimer) {
        clearInterval(autoTranslateTimer);
        autoTranslateTimer = null;
    }
}

function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(Math.max(Math.round(n), min), max);
}

function toUiRegion(captureRegion) {
    if (!captureRegion) return null;

    const scale = screen.getPrimaryDisplay().scaleFactor || 1;
    return {
        x: Math.round((captureRegion.x || 0) / scale),
        y: Math.round((captureRegion.y || 0) / scale),
        width: Math.max(120, Math.round((captureRegion.width || 0) / scale)),
        height: Math.max(80, Math.round((captureRegion.height || 0) / scale))
    };
}
