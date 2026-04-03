package com.translator.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.translator.model.TranslateRequest;
import com.translator.model.TranslateResponse;
import com.translator.service.OcrService;
import com.translator.service.TranslationService;

@RestController
@RequestMapping("/api")
public class TranslateController {

    private static final Logger log = LoggerFactory.getLogger(TranslateController.class);

    @Autowired private OcrService ocrService;
    @Autowired private TranslationService translationService;

    @PostMapping("/translate")
public ResponseEntity<TranslateResponse> translate(@RequestBody TranslateRequest request) {

    if (request.getImageBase64() == null || request.getImageBase64().isBlank()) {
        return ResponseEntity.badRequest()
            .body(TranslateResponse.error("Thiếu imageBase64"));
    }

    String targetLang = request.getTargetLang() != null ? request.getTargetLang() : "vi";
    String runtimeGeminiApiKey = request.getGeminiApiKey();
    boolean speedMode = request.isSpeedMode();

    try {

        if (speedMode) {
            log.info("Chế độ: Speed (OCR + Google)");
            return ocrAndGoogleTranslate(
                request.getImageBase64(),
                targetLang,
                runtimeGeminiApiKey,
                null
            );
        }

        if (translationService.hasGeminiKey(runtimeGeminiApiKey)) {

            try {
                log.info("Chế độ: Gemini Vision");

                TranslationService.TranslationResult result =
                    translationService.translateFromImage(request.getImageBase64(), targetLang, runtimeGeminiApiKey);

                return ResponseEntity.ok(TranslateResponse.builder()
                    .originalText("[Vision]")
                    .translatedText(result.translatedText())
                    .detectedSourceLang(result.detectedSourceLang())
                    .targetLang(targetLang)
                    .modelUsed(result.modelUsed())
                    .build());

            } catch (Exception e) {
                log.warn("Gemini fail → fallback OCR + Google");

                return ocrAndGoogleTranslate(
                    request.getImageBase64(),
                    targetLang,
                    runtimeGeminiApiKey,
                    "Gemini lỗi → dùng Google Translate"
                );
            }

        } else {
            log.info("Chế độ: OCR + Google Translate");

            return ocrAndGoogleTranslate(
                request.getImageBase64(),
                targetLang,
                runtimeGeminiApiKey,
                null
            );
        }

    } catch (Exception e) {
        log.error("Lỗi không xử lý được: {}", e.getMessage(), e);

        return ResponseEntity.internalServerError()
            .body(TranslateResponse.error("Lỗi: " + e.getMessage()));
    }
}

    private ResponseEntity<TranslateResponse> ocrAndGoogleTranslate(
            String imageBase64, String targetLang, String runtimeGeminiApiKey, String warningMsg) {
        try {
            String originalText = ocrService.extractText(imageBase64);
            if (originalText.isBlank()) {
                return ResponseEntity.ok(TranslateResponse.builder()
                    .originalText("").translatedText("")
                    .modelUsed("ocr")
                    .errorMessage("Không tìm thấy chữ trong ảnh").build());
            }
            TranslationService.TranslationResult result =
                translationService.translate(originalText, targetLang, runtimeGeminiApiKey);
            return ResponseEntity.ok(TranslateResponse.builder()
                .originalText(originalText)
                .translatedText(result.translatedText())
                .detectedSourceLang(result.detectedSourceLang())
                .targetLang(targetLang)
                .modelUsed(result.modelUsed())
                .errorMessage(warningMsg)
                .build());
        } catch (Exception e) {
            log.error("Fallback OCR+Google cũng lỗi: {}", e.getMessage());
            return ResponseEntity.internalServerError()
                .body(TranslateResponse.error("Lỗi fallback: " + e.getMessage()));
        }
    }

    @GetMapping("/health")
    public ResponseEntity<String> health() {
        String mode = translationService.hasGeminiKey(null) ? "Gemini Vision" : "OCR + Google Translate";
        return ResponseEntity.ok("{\"status\":\"ok\",\"mode\":\"" + mode + "\"}");
    }
}
