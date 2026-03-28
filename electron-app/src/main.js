const { app, BrowserWindow, globalShortcut, ipcMain, screen } = require('electron');
const path = require('path');
const http = require('http');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');

const BACKEND_URL = 'http://localhost:8080';
let selectionWindow = null;
let resultWindow = null;
let currentTargetLang = 'vi';

// ── Lưu vị trí window ────────────────────────────────────────────────────────
// Vị trí người dùng đã kéo đến (null = chưa có, dùng vị trí tự động)
let savedPosition = null;
let isPinned = false; // Khi ghim: không tự dịch chuyển window khi dịch mới

// ── App khởi động ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    globalShortcut.register('F2', () => openSelectionOverlay());
    globalShortcut.register('F5', () => {
        currentTargetLang = currentTargetLang === 'vi' ? 'en' : 'vi';
        console.log(`Ngôn ngữ: ${currentTargetLang.toUpperCase()}`);
    });
    console.log('✅ Screen Translator | F2: Chọn vùng | F5: Đổi VI/EN');
    createResultWindow();
    checkBackend();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', (e) => e.preventDefault());

// ── IPC từ result window ──────────────────────────────────────────────────────
ipcMain.on('close-result', () => {
    if (resultWindow && !resultWindow.isDestroyed()) resultWindow.hide();
});

ipcMain.on('resize-result', (event, { width, height }) => {
    if (!resultWindow || resultWindow.isDestroyed()) return;
    const [cx, cy] = resultWindow.getPosition();
    resultWindow.setSize(width, height);
    // Giữ nguyên vị trí sau khi resize
    resultWindow.setPosition(cx, cy);
});

// Nhận trạng thái ghim từ result window
ipcMain.on('set-pinned', (event, pinned) => {
    isPinned = pinned;
    console.log(isPinned ? '📌 Đã ghim vị trí' : '📌 Bỏ ghim');
});

// ── Selection Overlay ─────────────────────────────────────────────────────────
function openSelectionOverlay() {
    if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();

    const { width, height } = screen.getPrimaryDisplay().bounds;

    selectionWindow = new BrowserWindow({
        x: 0, y: 0, width, height,
        frame: false, transparent: true,
        alwaysOnTop: true, skipTaskbar: true,
        resizable: false, focusable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    selectionWindow.setAlwaysOnTop(true, 'screen-saver');
    selectionWindow.loadFile(path.join(__dirname, '../overlay/selection.html'));
    selectionWindow.focus();

    ipcMain.once('region-selected', async (event, region) => {
        if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
        if (region) await captureAndTranslate(region);
    });

    ipcMain.once('selection-cancelled', () => {
        if (selectionWindow && !selectionWindow.isDestroyed()) selectionWindow.close();
    });
}

// ── PowerShell Screenshot ─────────────────────────────────────────────────────
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
                if (err) { reject(new Error('Lỗi chụp: ' + (stderr || err.message))); return; }
                const realPath = tmpFile.replace(/\\\\/g, '\\');
                try {
                    const buf = fs.readFileSync(realPath);
                    fs.unlinkSync(realPath);
                    resolve(buf.toString('base64'));
                } catch (e) {
                    reject(new Error('Không đọc được ảnh: ' + e.message));
                }
            }
        );
    });
}

// ── Capture & Translate ───────────────────────────────────────────────────────
async function captureAndTranslate(region) {
    try {
        showResult({ status: 'loading' }, region);
        const base64 = await captureWithPowerShell(region);
        const result = await callBackend(base64, currentTargetLang);
        showResult({ status: 'success', ...result, targetLang: currentTargetLang }, region);
    } catch (err) {
        console.error('Lỗi:', err.message);
        showResult({ status: 'error', message: err.message }, region);
    }
}

// ── Result Window ─────────────────────────────────────────────────────────────
function createResultWindow() {
    resultWindow = new BrowserWindow({
        width: 420, height: 300,
        frame: false, transparent: true,
        alwaysOnTop: true, skipTaskbar: true,
        show: false, resizable: true,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    resultWindow.setAlwaysOnTop(true, 'screen-saver');
    resultWindow.loadFile(path.join(__dirname, '../overlay/result.html'));

    // Lưu vị trí mỗi khi người dùng kéo window
    resultWindow.on('moved', () => {
        if (resultWindow && !resultWindow.isDestroyed()) {
            savedPosition = resultWindow.getPosition();
            console.log(`Vị trí đã lưu: ${savedPosition}`);
        }
    });
}

function showResult(data, region) {
    if (!resultWindow || resultWindow.isDestroyed()) createResultWindow();

    // Nếu đã ghim hoặc đã có vị trí lưu → dùng vị trí đó, không tự dịch chuyển
    if (!isPinned && savedPosition === null) {
        // Lần đầu: đặt gần vùng vừa chọn
        const { width: sw, height: sh } = screen.getPrimaryDisplay().bounds;
        let x = region ? Math.min(region.x + region.width + 10, sw - 440) : sw - 440;
        let y = region ? Math.min(region.y, sh - 320) : 100;
        if (x < 0) x = 10;
        if (y < 0) y = 10;
        resultWindow.setPosition(x, y);
        savedPosition = [x, y];
    } else if (savedPosition) {
        // Dùng lại vị trí đã lưu
        resultWindow.setPosition(savedPosition[0], savedPosition[1]);
    }

    resultWindow.show();
    resultWindow.focus();
    resultWindow.webContents.send('show-result', data);
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
function callBackend(imageBase64, targetLang) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ imageBase64, targetLang });
        const req = http.request({
            hostname: 'localhost', port: 8080,
            path: '/api/translate', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch { reject(new Error('Dữ liệu không hợp lệ')); }
            });
        });
        req.on('error', reject);
        req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout 20s')); });
        req.write(body);
        req.end();
    });
}

function checkBackend() {
    http.get(`${BACKEND_URL}/api/health`, () => {
        console.log('✅ Java backend sẵn sàng');
    }).on('error', () => {
        console.warn('⚠️  Backend chưa chạy. Hãy chạy: cd java-backend && mvn spring-boot:run');
    });
}
