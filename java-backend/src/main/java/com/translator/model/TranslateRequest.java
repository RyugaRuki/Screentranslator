package com.translator.model;

/**
 * Request gửi từ VS Code Extension → Java Backend
 * Chứa ảnh màn hình (base64) và ngôn ngữ đích
 */
public class TranslateRequest {

    /** Ảnh chụp màn hình encode dưới dạng base64 (PNG) */
    private String imageBase64;

    /**
     * Ngôn ngữ đích: "vi" = Tiếng Việt, "en" = Tiếng Anh
     * Mặc định: "vi"
     */
    private String targetLang = "vi";

    /** Vùng chụp tuỳ chọn - null = toàn màn hình. Format: "x,y,width,height" */
    private String region;

    /** API key truyền từ UI runtime (ưu tiên hơn application.properties) */
    private String geminiApiKey;

    /** true = ưu tiên tốc độ (OCR + Google), false = dùng Gemini Vision nếu có key */
    private boolean speedMode;

    // ── Constructors ──────────────────────────────────────────────────────────
    public TranslateRequest() {}

    public TranslateRequest(String imageBase64, String targetLang, String region, String geminiApiKey, boolean speedMode) {
        this.imageBase64 = imageBase64;
        this.targetLang = targetLang;
        this.region = region;
        this.geminiApiKey = geminiApiKey;
        this.speedMode = speedMode;
    }

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public String getImageBase64() { return imageBase64; }
    public void setImageBase64(String imageBase64) { this.imageBase64 = imageBase64; }

    public String getTargetLang() { return targetLang; }
    public void setTargetLang(String targetLang) { this.targetLang = targetLang; }

    public String getRegion() { return region; }
    public void setRegion(String region) { this.region = region; }

    public String getGeminiApiKey() { return geminiApiKey; }
    public void setGeminiApiKey(String geminiApiKey) { this.geminiApiKey = geminiApiKey; }

    public boolean isSpeedMode() { return speedMode; }
    public void setSpeedMode(boolean speedMode) { this.speedMode = speedMode; }
}
