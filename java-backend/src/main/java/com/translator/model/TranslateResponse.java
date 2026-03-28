package com.translator.model;

/**
 * Response trả về cho VS Code Extension
 */
public class TranslateResponse {

    private String originalText;
    private String translatedText;
    private String detectedSourceLang;
    private String targetLang;
    private boolean fromCache;
    private String errorMessage;

    // ── Constructors ──────────────────────────────────────────────────────────
    public TranslateResponse() {}

    public TranslateResponse(String originalText, String translatedText,
                              String detectedSourceLang, String targetLang,
                              boolean fromCache, String errorMessage) {
        this.originalText = originalText;
        this.translatedText = translatedText;
        this.detectedSourceLang = detectedSourceLang;
        this.targetLang = targetLang;
        this.fromCache = fromCache;
        this.errorMessage = errorMessage;
    }

    // ── Static factory: lỗi nhanh ─────────────────────────────────────────────
    public static TranslateResponse error(String message) {
        TranslateResponse r = new TranslateResponse();
        r.errorMessage = message;
        r.originalText = "";
        r.translatedText = "";
        return r;
    }

    // ── Builder ───────────────────────────────────────────────────────────────
    public static Builder builder() { return new Builder(); }

    public static class Builder {
        private String originalText = "";
        private String translatedText = "";
        private String detectedSourceLang = "";
        private String targetLang = "";
        private boolean fromCache = false;
        private String errorMessage;

        public Builder originalText(String v)       { this.originalText = v; return this; }
        public Builder translatedText(String v)     { this.translatedText = v; return this; }
        public Builder detectedSourceLang(String v) { this.detectedSourceLang = v; return this; }
        public Builder targetLang(String v)         { this.targetLang = v; return this; }
        public Builder fromCache(boolean v)         { this.fromCache = v; return this; }
        public Builder errorMessage(String v)       { this.errorMessage = v; return this; }

        public TranslateResponse build() {
            return new TranslateResponse(originalText, translatedText,
                    detectedSourceLang, targetLang, fromCache, errorMessage);
        }
    }

    // ── Getters & Setters ─────────────────────────────────────────────────────
    public String getOriginalText()       { return originalText; }
    public void setOriginalText(String v) { this.originalText = v; }

    public String getTranslatedText()       { return translatedText; }
    public void setTranslatedText(String v) { this.translatedText = v; }

    public String getDetectedSourceLang()       { return detectedSourceLang; }
    public void setDetectedSourceLang(String v) { this.detectedSourceLang = v; }

    public String getTargetLang()       { return targetLang; }
    public void setTargetLang(String v) { this.targetLang = v; }

    public boolean isFromCache()       { return fromCache; }
    public void setFromCache(boolean v) { this.fromCache = v; }

    public String getErrorMessage()       { return errorMessage; }
    public void setErrorMessage(String v) { this.errorMessage = v; }
}
