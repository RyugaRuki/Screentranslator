package com.translator;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;

@SpringBootApplication
@EnableCaching
public class ScreenTranslatorApplication {

    public static void main(String[] args) {
        System.out.println("==============================================");
        System.out.println("  Screen Translator Backend đang khởi động...");
        System.out.println("  Truy cập: http://localhost:8080");
        System.out.println("==============================================");
        SpringApplication.run(ScreenTranslatorApplication.class, args);
    }
}
