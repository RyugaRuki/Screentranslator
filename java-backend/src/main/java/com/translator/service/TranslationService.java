package com.translator.service;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

@Service
public class TranslationService {

    private static final Logger log = LoggerFactory.getLogger(TranslationService.class);

    @Value("${gemini.api.key:}")
    private String geminiApiKey;

    private final HttpClient httpClient;
    private final ObjectMapper mapper;

    private static final String GEMINI_25 =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=";

    private static final String GEMINI_LITE =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite-preview:generateContent?key=";

    private static final String GOOGLE_API =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&dt=t";

    public TranslationService() {
        this.httpClient = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            .build();
        this.mapper = new ObjectMapper();
    }

    // ================================
    // TEXT TRANSLATE
    // ================================
    @Cacheable(value = "translations", key = "#text + ':' + #targetLang")
    public TranslationResult translate(String text, String targetLang) {

        if (text == null || text.isBlank()) {
            return new TranslationResult("", "auto", targetLang, "empty");
        }

        String input = text.length() > 5000 ? text.substring(0, 5000) : text;

        try {
            if (hasGeminiKey()) {
                return translateWithGemini(input, targetLang);
            }
        } catch (Exception e) {
            log.warn("Gemini lỗi → fallback Google: {}", e.getMessage());
        }

        return translateWithGoogle(input, targetLang);
    }

    // ================================
    // IMAGE TRANSLATE
    // ================================
    @Cacheable(value = "translations", key = "#root.target.hash(#imageBase64) + ':img:' + #targetLang")
    public TranslationResult translateFromImage(String imageBase64, String targetLang) {

        try {
            return translateVisionGemini(imageBase64, targetLang);
        } catch (Exception e) {
            log.warn("Vision fail → fallback text empty: {}", e.getMessage());
            return new TranslationResult("[Vision failed]", "auto", targetLang, "vision-error");
        }
    }

    // ================================
    // GEMINI TEXT
    // ================================
    private TranslationResult translateWithGemini(String text, String targetLang)
        throws Exception {

        String prompt = buildPrompt(text, targetLang);
        String body = buildTextRequest(prompt);

        String result = callGeminiWithFallback(body);

        return new TranslationResult(result, "auto", targetLang, "gemini");
    }

    // ================================
    // GEMINI VISION
    // ================================
    private TranslationResult translateVisionGemini(String base64, String targetLang)
        throws Exception {

        String prompt = buildVisionPrompt(targetLang);
        String body = buildVisionRequest(prompt, base64);

        String raw = callGeminiWithFallback(body);

        return parseVisionResponse(raw, targetLang);
    }

    // ================================
    // GEMINI CORE + RETRY
    // ================================
    private String callGeminiWithFallback(String body) throws Exception {

        for (int i = 0; i < 2; i++) {
            HttpResponse<String> res25 = sendRequest(GEMINI_25, body);

            if (res25.statusCode() == 200) {
                return parseGemini(res25.body());
            }

            if (res25.statusCode() == 429) {
                log.warn("2.5 rate limit → thử Lite");

                HttpResponse<String> resLite = sendRequest(GEMINI_LITE, body);

                if (resLite.statusCode() == 200) {
                    return parseGemini(resLite.body());
                }
            }

            Thread.sleep(500 * (i + 1));
        }

        throw new RuntimeException("Gemini failed after retry");
    }

    private HttpResponse<String> sendRequest(String url, String body)
        throws IOException, InterruptedException {

        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(url + geminiApiKey))
            .header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(30))
            .POST(HttpRequest.BodyPublishers.ofString(body))
            .build();

        return httpClient.send(req, HttpResponse.BodyHandlers.ofString());
    }

    private String parseGemini(String json) throws IOException {

        JsonNode root = mapper.readTree(json);
        JsonNode candidates = root.path("candidates");

        if (!candidates.isArray() || candidates.isEmpty()) {
            throw new RuntimeException("Gemini response invalid");
        }

        JsonNode textNode = candidates.get(0)
            .path("content")
            .path("parts");

        if (!textNode.isArray() || textNode.isEmpty()) {
            throw new RuntimeException("Gemini text missing");
        }

        return textNode.get(0).path("text").asText("").trim();
    }

    // ================================
    // GOOGLE FALLBACK
    // ================================
    private TranslationResult translateWithGoogle(String text, String targetLang) {

        try {
            String encoded = URLEncoder.encode(text, StandardCharsets.UTF_8);
            String url = GOOGLE_API + "&tl=" + targetLang + "&q=" + encoded;

            HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .GET()
                .timeout(Duration.ofSeconds(10))
                .build();

            HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());

            JsonNode root = mapper.readTree(res.body());

            StringBuilder sb = new StringBuilder();
            for (JsonNode seg : root.get(0)) {
                sb.append(seg.get(0).asText(""));
            }

            return new TranslationResult(sb.toString(), "auto", targetLang, "google");

        } catch (Exception e) {
            throw new RuntimeException("Google Translate lỗi", e);
        }
    }

    // ================================
    // BUILD REQUEST
    // ================================
    private String buildTextRequest(String prompt) throws IOException {
        return mapper.writeValueAsString(
            mapper.createObjectNode()
                .putArray("contents")
                .addObject()
                .putArray("parts")
                .addObject()
                .put("text", prompt)
        );
    }

    private String buildVisionRequest(String prompt, String base64) throws IOException {

        ObjectNode root = mapper.createObjectNode();
        ArrayNode contents = root.putArray("contents");

        ObjectNode contentObj = contents.addObject();
        ArrayNode parts = contentObj.putArray("parts");

        parts.addObject().put("text", prompt);

        ObjectNode imagePart = parts.addObject();
        ObjectNode inlineData = imagePart.putObject("inline_data");
        inlineData.put("mime_type", "image/png");
        inlineData.put("data", base64);

        return mapper.writeValueAsString(root);
    }

    // ================================
    // SAFE JSON PARSE
    // ================================
    private TranslationResult parseVisionResponse(String raw, String targetLang) {

        try {
            String jsonStr = extractJson(raw);
            JsonNode json = mapper.readTree(jsonStr);

            return new TranslationResult(
                json.path("translated").asText(raw),
                json.path("original").asText("auto"),
                targetLang,
                "vision"
            );

        } catch (Exception e) {
            return new TranslationResult(raw, "auto", targetLang, "vision-raw");
        }
    }

    private String extractJson(String text) {
        int start = text.indexOf("{");
        int end = text.lastIndexOf("}");
        if (start >= 0 && end > start) {
            return text.substring(start, end + 1);
        }
        return text;
    }

    // ================================
    // PROMPT
    // ================================
    private String buildPrompt(String text, String lang) {
        return "Translate to " + lang +
               ". Keep tone, emotion, names.\n" +
               "Natural, not literal.\n\n" +
               text;
    }

    private String buildVisionPrompt(String lang) {
        return "Extract all text and translate to " + lang +
               ". Return JSON ONLY: {\"original\":\"...\",\"translated\":\"...\"}";
    }

    public boolean hasGeminiKey() {
        return geminiApiKey != null && !geminiApiKey.isBlank();
    }

    // ================================
    // HASH (fix cache collision)
    // ================================
    public String hash(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] bytes = md.digest(input.getBytes(StandardCharsets.UTF_8));

            StringBuilder sb = new StringBuilder();
            for (byte b : bytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();

        } catch (Exception e) {
            return String.valueOf(input.hashCode());
        }
    }

    // ================================
    // DATA CLASS
    // ================================
    public record TranslationResult(
        String translatedText,
        String detectedSourceLang,
        String targetLang,
        String modelUsed
    ) {}
}