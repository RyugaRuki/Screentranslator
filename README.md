# 🌐 Screen Translator
Dịch màn hình realtime cho game/app tiếng Nhật 🇯🇵 & Trung 🇨🇳 → Việt/Anh

---

## Kiến trúc

```
[Game/App] → [VS Code Extension] → [Java Spring Boot :8080] → [Google Translate]
                    ↓                        ↓
              Chụp màn hình           OCR (Tesseract)
                    ↓                        ↓
              Hiển thị overlay         Cache kết quả
```

---

## Cài đặt - Bước 1: Tesseract OCR

### Windows
1. Tải installer: https://github.com/UB-Mannheim/tesseract/wiki
2. Chọn phiên bản 5.x (64-bit)
3. Trong quá trình cài, tích chọn thêm ngôn ngữ:
   - **Japanese** (jpn + jpn_vert)
   - **Chinese Simplified** (chi_sim)
   - **Chinese Traditional** (chi_tra)
4. Sau cài đặt, kiểm tra: `tesseract --version`

### macOS
```bash
brew install tesseract
brew install tesseract-lang
```

### Linux (Ubuntu/Debian)
```bash
sudo apt install tesseract-ocr tesseract-ocr-jpn tesseract-ocr-chi-sim tesseract-ocr-chi-tra
```

---

## Cài đặt - Bước 2: Java Backend

### Yêu cầu
- Java 17+ (`java --version`)
- Maven 3.8+ (`mvn --version`)

### Cấu hình
Mở file `java-backend/src/main/resources/application.properties`:

```properties
# 1. Đường dẫn Tesseract (thay đúng theo máy)
# Windows:
tesseract.data.path=C:/Program Files/Tesseract-OCR/tessdata
# macOS (brew):
# tesseract.data.path=/opt/homebrew/share/tessdata
# Linux:
# tesseract.data.path=/usr/share/tessdata

# 2. Google API Key (tuỳ chọn - không cần nếu dùng unofficial)
# Bỏ trống = tự động dùng unofficial endpoint (miễn phí, không cần key)
# Hoặc điền key từ: https://cloud.google.com/translate
google.translate.api.key=
```

### Chạy backend
```bash
cd java-backend
mvn spring-boot:run
```

Kiểm tra: mở http://localhost:8080/api/health → phải thấy `{"status":"ok"}`

---

## Cài đặt - Bước 3: VS Code Extension

### Cách 1: Chạy từ source (development)
```bash
cd vscode-extension
npm install
code .
# Bấm F5 → chọn "Run Extension" → mở cửa sổ VS Code mới
```

### Cách 2: Đóng gói thành .vsix (production)
```bash
cd vscode-extension
npm install
npm run package          # tạo file screen-translator-1.0.0.vsix
# Trong VS Code: Ctrl+Shift+P → "Install from VSIX" → chọn file .vsix
```

---

## Sử dụng

| Phím | Chức năng |
|------|-----------|
| **F2** | Dịch toàn màn hình |
| **F3** | Nhập vùng cụ thể cần dịch (x,y,width,height) |
| **F4** | Bật/tắt overlay |
| **F5** | Đổi ngôn ngữ đích (Tiếng Việt ↔ English) |

### Cách chơi game song song
1. Chạy Java backend: `mvn spring-boot:run`
2. Mở VS Code (Extension đã cài)
3. Mở game ở cửa sổ riêng
4. Khi xuất hiện dialog/text cần dịch: **bấm F2**
5. Overlay hiện bên cạnh VS Code với bản dịch màu vàng

### Chạy backend + Electron cùng lúc (Windows)
Nếu đã đóng gói backend bằng `jlink/jpackage`, bạn có thể chạy nhanh bằng script:

```powershell
./run-all.ps1
```

Hoặc double-click file CMD:

```
run-all.cmd
```

Hoặc double-click file VBS (khong hien console):

```
run-all.vbs
```

### Đóng gói app Electron (Windows)
1) Đóng gói backend (tạo `java-backend/dist/screen-translator-backend`):

```powershell
cd java-backend\packaging
./poc_jlink.ps1
```

Yêu cầu:
- JDK 17+ và `JAVA_HOME` đã set
- `mvn` hoặc `mvnw` dùng được trong thư mục `java-backend`

Ghi chú:
- Set `JPACKAGE_TYPE=exe` để tạo Windows installer (cần WiX trong PATH)
- Set `JPACKAGE_WIN_CONSOLE=1` để bật console (dễ debug lỗi khởi động)
- Script bật `--enable-native-access=ALL-UNNAMED` để dùng Tomcat JNI trên JDK mới
- Nếu `jdeps` không tìm được module, có thể cần chỉ định module thủ công

2) Đóng gói Electron (tự chạy backend trong app):

```powershell
cd electron-app
npm install
npm run dist
```

File cài đặt sẽ nằm trong `electron-app/dist`.

### Tip: Chụp vùng dialog (tốt hơn toàn màn hình)
Hầu hết game JRPG có dialog box cố định ở phía dưới màn hình. Dùng F3 và nhập:
```
0,800,1920,200
```
(dòng đáy 200px của màn hình 1920×1080)

---

## Cấu hình VS Code

Vào Settings (`Ctrl+,`) → tìm "Screen Translator":

| Setting | Mặc định | Mô tả |
|---------|----------|-------|
| `backendUrl` | `http://localhost:8080` | URL Java backend |
| `targetLang` | `vi` | Ngôn ngữ dịch sang |
| `overlayOpacity` | `0.9` | Độ trong suốt overlay |
| `fontSize` | `14` | Cỡ chữ bản dịch |

---

## Troubleshooting

### "Không kết nối được Java backend"
→ Kiểm tra `mvn spring-boot:run` đang chạy trong terminal khác

### "Không tìm thấy chữ trong ảnh"
→ Tesseract chưa cài đúng ngôn ngữ, hoặc `tesseract.data.path` sai
→ Thử: `tesseract --list-langs` để xem ngôn ngữ đã cài

### OCR nhận sai ký tự Nhật
→ Tải tessdata_best (chính xác hơn tessdata):
   https://github.com/tesseract-ocr/tessdata_best
→ Tải `jpn.traineddata` + `jpn_vert.traineddata` → bỏ vào tessdata folder

### Google Translate trả lỗi
→ Không cần API key: để trống `google.translate.api.key=` trong application.properties
→ Extension tự dùng unofficial endpoint (miễn phí hoàn toàn)

---

## Cấu trúc thư mục

```
screen-translator/
├── java-backend/
│   ├── pom.xml
│   └── src/main/java/com/translator/
│       ├── ScreenTranslatorApplication.java  ← Entry point
│       ├── controller/TranslateController.java  ← REST API
│       ├── service/
│       │   ├── OcrService.java               ← Tesseract OCR
│       │   └── TranslationService.java       ← Google Translate
│       ├── model/
│       │   ├── TranslateRequest.java
│       │   └── TranslateResponse.java
│       └── config/AppConfig.java             ← CORS + Cache
│
└── vscode-extension/
    ├── package.json
    ├── tsconfig.json
    └── src/extension.ts                      ← Extension logic
```
