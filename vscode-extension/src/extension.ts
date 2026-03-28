import * as vscode from 'vscode';
import screenshot = require('screenshot-desktop');
import * as http from 'http';

// ── Types ──────────────────────────────────────────────────────────────────

interface TranslateResponse {
    originalText: string;
    translatedText: string;
    detectedSourceLang: string;
    targetLang: string;
    errorMessage?: string;
}

// ── Globals ────────────────────────────────────────────────────────────────

let overlayPanel: vscode.WebviewPanel | undefined;
let statusBarItem: vscode.StatusBarItem;
let currentTargetLang = 'vi';
let isOverlayVisible = false;

// ── Activate ───────────────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext) {
    console.log('Screen Translator đã kích hoạt!');

    // Đọc config
    const config = vscode.workspace.getConfiguration('screenTranslator');
    currentTargetLang = config.get<string>('targetLang', 'vi');

    // Status bar (góc dưới màn hình VS Code)
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = `$(eye) Dịch [${currentTargetLang.toUpperCase()}]`;
    statusBarItem.tooltip = 'Screen Translator | F2: Dịch | F3: Chọn vùng';
    statusBarItem.command = 'screenTranslator.translateScreen';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Kiểm tra Java backend có đang chạy không
    checkBackendHealth(config.get<string>('backendUrl', 'http://localhost:8080'));

    // ── Đăng ký Commands ──────────────────────────────────────────────────

    // F2: Dịch toàn màn hình
    context.subscriptions.push(
        vscode.commands.registerCommand('screenTranslator.translateScreen', async () => {
            await translateFullScreen(context);
        })
    );

    // F3: Chọn vùng cụ thể để dịch
    context.subscriptions.push(
        vscode.commands.registerCommand('screenTranslator.selectRegion', async () => {
            await translateWithRegionInput(context);
        })
    );

    // F4: Bật/tắt overlay
    context.subscriptions.push(
        vscode.commands.registerCommand('screenTranslator.toggleOverlay', () => {
            toggleOverlay();
        })
    );

    // F5: Đổi ngôn ngữ đích
    context.subscriptions.push(
        vscode.commands.registerCommand('screenTranslator.switchLang', () => {
            switchTargetLang();
        })
    );
}

// ── Commands Implementation ────────────────────────────────────────────────

/**
 * F2: Chụp toàn màn hình → gửi lên Java backend → hiển thị overlay
 */
async function translateFullScreen(context: vscode.ExtensionContext) {
    const config = vscode.workspace.getConfiguration('screenTranslator');
    const backendUrl = config.get<string>('backendUrl', 'http://localhost:8080');

    updateStatus('$(sync~spin) Đang chụp...');

    try {
        // 1. Chụp màn hình → Buffer
        const imgBuffer: Buffer = await screenshot({ format: 'png' });
        const base64 = imgBuffer.toString('base64');

        updateStatus('$(sync~spin) Đang dịch...');

        // 2. Gọi Java backend
        const result = await callBackend(backendUrl, base64, currentTargetLang);

        if (result.errorMessage && !result.originalText) {
            vscode.window.showWarningMessage(`Screen Translator: ${result.errorMessage}`);
            updateStatus(`$(eye) Dịch [${currentTargetLang.toUpperCase()}]`);
            return;
        }

        // 3. Hiển thị overlay
        showOrUpdateOverlay(context, result, config);
        updateStatus(`$(check) Dịch xong [${currentTargetLang.toUpperCase()}]`);

        // Reset status sau 3 giây
        setTimeout(() => updateStatus(`$(eye) Dịch [${currentTargetLang.toUpperCase()}]`), 3000);

    } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes('ECONNREFUSED')) {
            vscode.window.showErrorMessage(
                'Không kết nối được Java backend. Hãy chạy: cd java-backend && mvn spring-boot:run'
            );
        } else {
            vscode.window.showErrorMessage(`Lỗi Screen Translator: ${msg}`);
        }
        updateStatus(`$(error) Lỗi kết nối`);
    }
}

/**
 * F3: Cho người dùng nhập vùng cần dịch (x,y,width,height)
 */
async function translateWithRegionInput(context: vscode.ExtensionContext) {
    const input = await vscode.window.showInputBox({
        prompt: 'Nhập vùng cần dịch (x,y,width,height) hoặc để trống để dịch toàn màn hình',
        placeHolder: 'Ví dụ: 0,800,1920,200 (dịch thanh dialog phía dưới)',
        validateInput: (val) => {
            if (!val) return null; // Toàn màn hình
            const parts = val.split(',').map(Number);
            if (parts.length !== 4 || parts.some(isNaN)) {
                return 'Định dạng phải là: x,y,width,height (số nguyên)';
            }
            return null;
        }
    });

    if (input === undefined) return; // User bấm Escape

    await translateFullScreen(context);
}

/**
 * F4: Bật/tắt overlay panel
 */
function toggleOverlay() {
    if (overlayPanel) {
        overlayPanel.dispose();
        overlayPanel = undefined;
        isOverlayVisible = false;
        vscode.window.showInformationMessage('Screen Translator: Overlay đã tắt');
    } else {
        vscode.window.showInformationMessage('Screen Translator: Bấm F2 để dịch và hiển thị overlay');
    }
}

/**
 * F5: Đổi ngôn ngữ dịch VI ↔ EN
 */
function switchTargetLang() {
    currentTargetLang = currentTargetLang === 'vi' ? 'en' : 'vi';
    const langName = currentTargetLang === 'vi' ? 'Tiếng Việt' : 'English';
    updateStatus(`$(eye) Dịch [${currentTargetLang.toUpperCase()}]`);
    vscode.window.showInformationMessage(`Screen Translator: Đổi sang ${langName}`);
}

// ── Overlay WebviewPanel ───────────────────────────────────────────────────

/**
 * Tạo hoặc cập nhật overlay panel hiển thị bản dịch
 */
function showOrUpdateOverlay(
    context: vscode.ExtensionContext,
    result: TranslateResponse,
    config: vscode.WorkspaceConfiguration
) {
    const opacity = config.get<number>('overlayOpacity', 0.9);
    const fontSize = config.get<number>('fontSize', 14);
    const langFlag = getLangFlag(result.detectedSourceLang);

    const html = buildOverlayHtml(result, { opacity, fontSize, langFlag });

    if (overlayPanel) {
        // Cập nhật nội dung overlay hiện có
        overlayPanel.webview.html = html;
        overlayPanel.reveal(vscode.ViewColumn.Beside, true);
    } else {
        // Tạo mới overlay panel
        overlayPanel = vscode.window.createWebviewPanel(
            'screenTranslatorOverlay',
            `🌐 Bản dịch`,
            {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true   // Không lấy focus → không gián đoạn game
            },
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        overlayPanel.webview.html = html;
        isOverlayVisible = true;

        // Lắng nghe message từ Webview (nút copy, đóng, v.v.)
        overlayPanel.webview.onDidReceiveMessage(
            (message) => {
                switch (message.command) {
                    case 'copy':
                        vscode.env.clipboard.writeText(result.translatedText);
                        vscode.window.showInformationMessage('Đã copy bản dịch!');
                        break;
                    case 'close':
                        overlayPanel?.dispose();
                        break;
                }
            },
            undefined,
            context.subscriptions
        );

        overlayPanel.onDidDispose(() => {
            overlayPanel = undefined;
            isOverlayVisible = false;
        });
    }
}

/**
 * HTML cho overlay - dark theme, màu vàng dễ đọc
 */
function buildOverlayHtml(
    result: TranslateResponse,
    opts: { opacity: number; fontSize: number; langFlag: string }
): string {
    const escapeHtml = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Segoe UI', 'Noto Sans CJK JP', 'Yu Gothic', sans-serif;
    background: #1a1a2e;
    color: #e0e0e0;
    min-height: 100vh;
    padding: 0;
  }
  .header {
    background: #16213e;
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid #0f3460;
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .header-title {
    font-size: 13px;
    color: #a0a8c0;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lang-badge {
    background: #0f3460;
    color: #4fc3f7;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: bold;
    letter-spacing: 0.5px;
  }
  .btn-copy {
    background: #0f3460;
    color: #4fc3f7;
    border: 1px solid #1565c0;
    padding: 4px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.2s;
  }
  .btn-copy:hover { background: #1565c0; }
  .section {
    padding: 14px 16px;
    border-bottom: 1px solid #0f3460;
  }
  .section-label {
    font-size: 11px;
    color: #607090;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 8px;
  }
  .original-text {
    font-size: ${opts.fontSize - 2}px;
    color: #90a4ae;
    line-height: 1.7;
    font-family: 'Noto Sans CJK JP', 'Yu Gothic', monospace;
  }
  .translated-text {
    font-size: ${opts.fontSize}px;
    color: #FFD700;
    line-height: 1.8;
    font-weight: 400;
  }
  .error-text {
    color: #ef9a9a;
    font-size: 13px;
    padding: 12px;
    background: #3e1010;
    border-radius: 6px;
  }
  .footer {
    padding: 10px 16px;
    font-size: 11px;
    color: #404060;
    text-align: center;
  }
  kbd {
    background: #0f3460;
    color: #90caf9;
    padding: 1px 5px;
    border-radius: 3px;
    font-size: 10px;
  }
</style>
</head>
<body>
<div class="header">
  <div class="header-title">
    🌐 Screen Translator
    <span class="lang-badge">${opts.langFlag} → ${result.targetLang === 'vi' ? '🇻🇳 VI' : '🇺🇸 EN'}</span>
  </div>
  <button class="btn-copy" onclick="copyText()">📋 Copy</button>
</div>

${result.errorMessage && !result.translatedText ? `
<div class="section">
  <div class="error-text">⚠️ ${escapeHtml(result.errorMessage)}</div>
</div>
` : `
<div class="section">
  <div class="section-label">Văn bản gốc</div>
  <div class="original-text">${escapeHtml(result.originalText)}</div>
</div>
<div class="section">
  <div class="section-label">Bản dịch</div>
  <div class="translated-text">${escapeHtml(result.translatedText)}</div>
</div>
`}

<div class="footer">
  <kbd>F2</kbd> Dịch màn hình &nbsp;·&nbsp;
  <kbd>F3</kbd> Chọn vùng &nbsp;·&nbsp;
  <kbd>F4</kbd> Đóng &nbsp;·&nbsp;
  <kbd>F5</kbd> Đổi ngôn ngữ
</div>

<script>
  const vscode = acquireVsCodeApi();
  function copyText() {
    vscode.postMessage({ command: 'copy' });
  }
</script>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Gọi Java Spring Boot backend qua HTTP
 */
function callBackend(
    backendUrl: string,
    imageBase64: string,
    targetLang: string
): Promise<TranslateResponse> {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({ imageBase64, targetLang });
        const url = new URL('/api/translate', backendUrl);

        const options = {
            hostname: url.hostname,
            port: url.port || 8080,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data) as TranslateResponse);
                } catch {
                    reject(new Error('Backend trả về dữ liệu không hợp lệ'));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout (30s)'));
        });

        req.write(body);
        req.end();
    });
}

/**
 * Kiểm tra Java backend có đang chạy không
 */
function checkBackendHealth(backendUrl: string) {
    const url = new URL('/api/health', backendUrl);
    const req = http.get(url.toString(), (res) => {
        if (res.statusCode === 200) {
            vscode.window.showInformationMessage(
                'Screen Translator: Backend đã sẵn sàng ✓ | F2: Dịch toàn màn hình'
            );
        }
    });
    req.on('error', () => {
        vscode.window.showWarningMessage(
            'Screen Translator: Backend chưa chạy. Chạy: cd java-backend && mvn spring-boot:run',
            'Hướng dẫn'
        ).then(action => {
            if (action === 'Hướng dẫn') {
                vscode.env.openExternal(
                    vscode.Uri.parse('https://github.com/your-repo/screen-translator#readme')
                );
            }
        });
    });
    req.setTimeout(3000, () => req.destroy());
}

function updateStatus(text: string) {
    if (statusBarItem) {
        statusBarItem.text = text;
    }
}

function getLangFlag(lang: string): string {
    const flags: Record<string, string> = {
        'ja': '🇯🇵 JA',
        'zh': '🇨🇳 ZH',
        'zh-CN': '🇨🇳 ZH',
        'zh-TW': '🇹🇼 ZH',
        'en': '🇬🇧 EN',
        'ko': '🇰🇷 KO',
    };
    return flags[lang] || `🌐 ${lang.toUpperCase()}`;
}

export function deactivate() {
    overlayPanel?.dispose();
    statusBarItem?.dispose();
}
