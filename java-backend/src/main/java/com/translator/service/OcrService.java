package com.translator.service;

import net.sourceforge.tess4j.ITesseract;
import net.sourceforge.tess4j.Tesseract;
import net.sourceforge.tess4j.TesseractException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import jakarta.annotation.PostConstruct;

import javax.imageio.ImageIO;
import java.awt.*;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.util.Base64;

@Service
public class OcrService {

    private static final Logger log = LoggerFactory.getLogger(OcrService.class);

    @Value("${tesseract.data.path}")
    private String tessDataPath;

    @Value("${tesseract.languages}")
    private String ocrLanguages;

    private ITesseract tesseract;

    @PostConstruct
    public void init() {
        tesseract = new Tesseract();
        tesseract.setDatapath(tessDataPath);
        tesseract.setLanguage(ocrLanguages);
        tesseract.setPageSegMode(6);  // Single block - tốt cho dialog box JRPG
        tesseract.setOcrEngineMode(3); // LSTM neural net
        log.info("Tesseract sẵn sàng | Lang: {} | PSM: 6", ocrLanguages);
    }

    public String extractText(String base64Image) {
        try {
            byte[] imageBytes = Base64.getDecoder().decode(
                base64Image.replaceFirst("^data:image/[^;]+;base64,", "")
            );
            BufferedImage image = ImageIO.read(new ByteArrayInputStream(imageBytes));
            if (image == null) { log.error("Không đọc được ảnh"); return ""; }

            BufferedImage processed = preprocessForJrpg(image);
            String result = tesseract.doOCR(processed);
            return cleanOcrOutput(result);

        } catch (TesseractException e) {
            log.error("Tesseract lỗi: {}", e.getMessage());
            return "";
        } catch (Exception e) {
            log.error("OCR lỗi: {}", e.getMessage(), e);
            return "";
        }
    }

    /**
     * Pipeline tiền xử lý cho JRPG/Visual Novel:
     * 1. Scale 2x bicubic  → Tesseract đọc chính xác hơn nhiều
     * 2. Grayscale         → loại bỏ nhiễu màu
     * 3. Auto-invert       → fix chữ trắng/vàng trên nền tối (phổ biến trong game)
     * 4. Tăng contrast     → làm rõ đường nét chữ
     */
    private BufferedImage preprocessForJrpg(BufferedImage original) {
        int sw = original.getWidth() * 2;
        int sh = original.getHeight() * 2;

        // Bước 1: Scale 2x bicubic
        BufferedImage scaled = new BufferedImage(sw, sh, BufferedImage.TYPE_INT_RGB);
        Graphics2D g2 = scaled.createGraphics();
        g2.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
        g2.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
        g2.drawImage(original, 0, 0, sw, sh, null);
        g2.dispose();

        // Bước 2: Grayscale + đếm pixel để detect nền tối/sáng
        int[] lumaMap = new int[sw * sh];
        int darkCount = 0, sampleTotal = 0;

        for (int y = 0; y < sh; y++) {
            for (int x = 0; x < sw; x++) {
                int rgb = scaled.getRGB(x, y);
                int luma = (int)(
                    0.299 * ((rgb >> 16) & 0xFF) +
                    0.587 * ((rgb >> 8)  & 0xFF) +
                    0.114 * ( rgb        & 0xFF)
                );
                lumaMap[y * sw + x] = luma;
                if (x % 4 == 0 && y % 4 == 0) {
                    if (luma < 100) darkCount++;
                    sampleTotal++;
                }
            }
        }

        // Bước 3: Quyết định có invert không
        // >45% pixel tối = nền tối (chữ trắng) → cần invert
        boolean isDarkBg = sampleTotal > 0 && ((double) darkCount / sampleTotal) > 0.45;
        if (isDarkBg) log.debug("Nền tối detected → invert màu");

        // Bước 4: Áp dụng invert + contrast mạnh
        BufferedImage result = new BufferedImage(sw, sh, BufferedImage.TYPE_BYTE_GRAY);
        for (int i = 0; i < lumaMap.length; i++) {
            int luma = lumaMap[i];
            if (isDarkBg) luma = 255 - luma;
            // Contrast: đẩy về 2 cực trắng/đen
            luma = luma > 140 ? Math.min(255, luma + 60) : Math.max(0, luma - 60);
            int x = i % sw, y = i / sw;
            result.setRGB(x, y, (luma << 16) | (luma << 8) | luma);
        }
        return result;
    }

    private String cleanOcrOutput(String raw) {
        if (raw == null) return "";
        return raw
            .replaceAll("[\\p{Cntrl}&&[^\n]]", "")
            .replaceAll("\n{3,}", "\n\n")
            .lines()
            .map(String::strip)
            .filter(line -> !line.isEmpty())
            .filter(line -> line.chars().anyMatch(c -> Character.isLetterOrDigit(c) || c > 127))
            .collect(java.util.stream.Collectors.joining("\n"))
            .trim();
    }
}
