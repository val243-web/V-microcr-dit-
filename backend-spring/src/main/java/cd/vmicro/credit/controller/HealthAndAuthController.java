package cd.vmicro.credit.controller;

import cd.vmicro.credit.security.JwtService;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Date;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.Period;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class HealthAndAuthController {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final int minEligibleAge;

    public HealthAndAuthController(
            JdbcTemplate jdbc,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            @Value("${vmicro.security.min-eligible-age:18}") int minEligibleAge
    ) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.minEligibleAge = minEligibleAge;
    }

    public record RegisterRequest(
            @NotBlank @Email String email,
            @NotBlank @Size(min = 9) String phone,
            @NotBlank @Size(min = 8) String password,
            @NotBlank String firstName,
            @NotBlank String lastName,
            @NotNull LocalDate dateOfBirth,
            String city,
            boolean acceptDataConsent
    ) {}

    public record LoginRequest(
            @NotBlank String identifier,
            @NotBlank String password,
            String deviceLabel
    ) {}

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "UP",
                "service", "V-Micro Crédit Spring Boot API",
                "mode", "SIMULATION_DEMO",
                "timestamp", Instant.now().toString()
        );
    }

    @PostMapping("/auth/register")
    @Transactional
    public ResponseEntity<Map<String, Object>> register(@Valid @RequestBody RegisterRequest req) {
        if (!req.acceptDataConsent()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Le consentement de traitement des données est obligatoire."));
        }
        int age = Period.between(req.dateOfBirth(), LocalDate.now()).getYears();
        if (age < minEligibleAge) {
            return ResponseEntity.unprocessableEntity().body(Map.of(
                    "error", "Inscription refusée : vous devez avoir au moins " + minEligibleAge + " ans."
            ));
        }

        Integer existing = jdbc.queryForObject(
                "SELECT COUNT(*) FROM users WHERE email = ? OR phone = ?",
                Integer.class,
                req.email().toLowerCase(),
                req.phone()
        );
        if (existing != null && existing > 0) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("error", "Un compte existe déjà avec cet e-mail ou numéro."));
        }

        String userId = "usr_" + UUID.randomUUID().toString().substring(0, 10);
        String otp = String.valueOf((int) (100000 + Math.random() * 900000));
        String hash = passwordEncoder.encode(req.password());

        jdbc.update(
                "INSERT INTO users (id, email, phone, password_hash, role, phone_verified, phone_otp) VALUES (?, ?, ?, ?, 'CLIENT', FALSE, ?)",
                userId, req.email().toLowerCase(), req.phone(), hash, otp
        );
        jdbc.update(
                "INSERT INTO profiles (user_id, first_name, last_name, date_of_birth, city, country) VALUES (?, ?, ?, ?, ?, 'RDC')",
                userId, req.firstName(), req.lastName(), Date.valueOf(req.dateOfBirth()),
                req.city() != null && !req.city().isBlank() ? req.city() : "Kinshasa"
        );
        jdbc.update(
                "INSERT INTO savings_accounts (id, user_id, currency, available_balance, locked_goals_balance, is_simulated) VALUES (?, ?, 'USD', 0, 0, TRUE)",
                "acc_" + UUID.randomUUID().toString().substring(0, 10), userId
        );
        jdbc.update(
                "INSERT INTO consents (id, user_id, consent_type, granted) VALUES (?, ?, 'TERMS_AND_DATA', TRUE)",
                "cns_" + UUID.randomUUID().toString().substring(0, 10), userId
        );
        jdbc.update(
                "INSERT INTO notification_preferences (user_id) VALUES (?)",
                userId
        );

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "userId", userId,
                "simulatedOtpPreview", otp,
                "message", "Compte créé en mode démonstration. Vérifiez votre téléphone."
        ));
    }

    @PostMapping("/auth/login")
    public ResponseEntity<Map<String, Object>> login(@Valid @RequestBody LoginRequest req) {
        var rows = jdbc.queryForList(
                "SELECT id, email, phone, password_hash, role, status FROM users WHERE email = ? OR phone = ? LIMIT 1",
                req.identifier().toLowerCase(), req.identifier()
        );
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Identifiants invalides."));
        }
        Map<String, Object> user = rows.get(0);
        if (!passwordEncoder.matches(req.password(), String.valueOf(user.get("password_hash")))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Identifiants invalides."));
        }

        String userId = String.valueOf(user.get("id"));
        String role = String.valueOf(user.get("role"));
        String sessionId = "ses_" + UUID.randomUUID().toString().substring(0, 10);
        String refreshToken = UUID.randomUUID().toString() + UUID.randomUUID().toString();
        String accessToken = jwtService.generateAccessToken(userId, role, sessionId, 7200);

        jdbc.update(
                "INSERT INTO sessions (id, user_id, refresh_token_hash, device_label, expires_at) VALUES (?, ?, ?, ?, ?)",
                sessionId,
                userId,
                sha256(refreshToken),
                req.deviceLabel() != null ? req.deviceLabel() : "Client V-Micro",
                OffsetDateTime.now().plusDays(7)
        );

        return ResponseEntity.ok(Map.of(
                "accessToken", accessToken,
                "refreshToken", refreshToken,
                "role", role,
                "userId", userId
        ));
    }

    private String sha256(String value) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(md.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
