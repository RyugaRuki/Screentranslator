package com.translator.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import java.util.concurrent.TimeUnit;

@Configuration
public class AppConfig {

    /**
     * CORS: cho phép VS Code Extension (vscode-webview://)
     * và localhost gọi API không bị chặn
     */
    @Bean
    public WebMvcConfigurer corsConfigurer() {
        return new WebMvcConfigurer() {
            @Override
            public void addCorsMappings(CorsRegistry registry) {
                registry.addMapping("/api/**")
                        .allowedOriginPatterns(
                            "http://localhost:*",
                            "vscode-webview://*",
                            "vscode-file://*"
                        )
                        .allowedMethods("GET", "POST", "OPTIONS")
                        .allowedHeaders("*");
            }
        };
    }

    /**
     * Cache Caffeine: lưu kết quả dịch 30 phút
     * Tránh gọi Google API trùng lặp → tiết kiệm free quota
     */
    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager("translations");
        manager.setCaffeine(
            Caffeine.newBuilder()
                .maximumSize(1000)          // Tối đa 1000 entry
                .expireAfterWrite(30, TimeUnit.MINUTES)
                .recordStats()
        );
        return manager;
    }
}
