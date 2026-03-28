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

    // ── Constructors ──────────────────────────────────────────────────────────
    public TranslateRequest() {}

    public TranslateRequest(String imageBase64, String targetLang, String region) {
        this.imageBase64 = imageBase64;
        this.targetLang = targetLang;
        this.region = region;
    }

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public String getImageBase64() { return imageBase64; }
    public void setImageBase64(String imageBase64) { this.imageBase64 = imageBase64; }

    public String getTargetLang() { return targetLang; }
    public void setTargetLang(String targetLang) { this.targetLang = targetLang; }

    public String getRegion() { return region; }
    public void setRegion(String region) { this.region = region; }
}
