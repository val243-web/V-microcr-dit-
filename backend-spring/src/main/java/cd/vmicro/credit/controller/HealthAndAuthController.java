package cd.vmicro.credit.controller;

import cd.vmicro.credit.security.JwtService;
import cd.vmicro.credit.security.RbacAndAuditService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
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
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api/v1")
public class HealthAndAuthController {

    private final JdbcTemplate jdbc;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final RbacAndAuditService rbacAudit;
    private final int minEligibleAge;

    private final ConcurrentHashMap<String, List<Long>> loginFailures = new ConcurrentHashMap<>();

    public HealthAndAuthController(
            JdbcTemplate jdbc,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            RbacAndAuditService rbacAudit,
            @Value("${vmicro.security.min-eligible-age:18}") int minEligibleAge
    ) {
        this.jdbc = jdbc;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.rbacAudit = rbacAudit;
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
            String commune,
            String profession,
            Double monthlyIncomeUsd,
            String language,
            boolean acceptDataConsent
    ) {}

    public record LoginRequest(
            @NotBlank String identifier,
            @NotBlank String password,
            String deviceLabel
    ) {}

    public record VerifyPhoneRequest(@NotBlank String phone, @NotBlank String otp) {}
    public record RefreshRequest(@NotBlank String refreshToken) {}
    public record ForgotPasswordRequest(@NotBlank String identifier) {}
    public record ResetPasswordRequest(@NotBlank String identifier, @NotBlank String resetCode, @NotBlank @Size(min = 8) String newPassword) {}

    public record UpdateProfileRequest(
            @NotBlank String firstName,
            @NotBlank String lastName,
            @NotBlank String city,
            String commune,
            String profession,
            Double monthlyIncomeUsd,
            String language
    ) {}

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "UP",
                "service", "V-Micro Crédit Spring Boot PostgreSQL API",
                "paymentMode", "SIMULATION",
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
        String lang = req.language() != null ? req.language() : "fr";

        jdbc.update(
                "INSERT INTO users (id, email, phone, password_hash, role, phone_verified, phone_otp) VALUES (?, ?, ?, ?, 'CLIENT', FALSE, ?)",
                userId, req.email().toLowerCase(), req.phone(), hash, otp
        );
        jdbc.update(
                "INSERT INTO profiles (user_id, first_name, last_name, date_of_birth, city, commune, country, profession, monthly_income_usd, language) VALUES (?, ?, ?, ?, ?, ?, 'RDC', ?, ?, ?)",
                userId, req.firstName(), req.lastName(), Date.valueOf(req.dateOfBirth()),
                req.city() != null && !req.city().isBlank() ? req.city() : "Kinshasa",
                req.commune() != null ? req.commune() : "Gombe",
                req.profession() != null ? req.profession() : "",
                req.monthlyIncomeUsd() != null ? req.monthlyIncomeUsd() : 0.0,
                lang
        );
        jdbc.update(
                "INSERT INTO savings_accounts (id, user_id, currency, available_balance, locked_goals_balance, is_simulated) VALUES (?, ?, 'USD', 0, 0, TRUE)",
                "acc_" + UUID.randomUUID().toString().substring(0, 10), userId
        );
        jdbc.update(
                "INSERT INTO consents (id, user_id, consent_type, granted) VALUES (?, ?, 'TERMS_AND_DATA', TRUE)",
                "cns_" + UUID.randomUUID().toString().substring(0, 10), userId
        );
        jdbc.update("INSERT INTO notification_preferences (user_id) VALUES (?)", userId);

        rbacAudit.logAudit(userId, "CLIENT", "USER_REGISTERED", "USER", userId, Map.of("city", req.city() != null ? req.city() : "Kinshasa"));

        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "userId", userId,
                "simulatedOtpPreview", otp,
                "message", "Compte créé. Veuillez valider votre numéro via le code OTP."
        ));
    }

    @PostMapping("/auth/verify-phone")
    public ResponseEntity<Map<String, Object>> verifyPhone(@Valid @RequestBody VerifyPhoneRequest req) {
        var rows = jdbc.queryForList("SELECT id, phone_otp FROM users WHERE phone = ? LIMIT 1", req.phone());
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Numéro introuvable."));
        }
        Map<String, Object> user = rows.get(0);
        if (!req.otp().equals(String.valueOf(user.get("phone_otp")))) {
            return ResponseEntity.badRequest().body(Map.of("error", "Code OTP invalide."));
        }
        jdbc.update("UPDATE users SET phone_verified = TRUE, phone_otp = NULL, updated_at = NOW() WHERE id = ?", user.get("id"));
        return ResponseEntity.ok(Map.of("verified", true));
    }

    @PostMapping("/auth/login")
    public ResponseEntity<Map<String, Object>> login(@Valid @RequestBody LoginRequest req, HttpServletRequest httpReq) {
        String key = req.identifier().toLowerCase() + ":" + (httpReq.getRemoteAddr() != null ? httpReq.getRemoteAddr() : "local");
        long nowMs = System.currentTimeMillis();
        List<Long> attempts = loginFailures.computeIfAbsent(key, k -> Collections.synchronizedList(new ArrayList<>()));
        attempts.removeIf(t -> nowMs - t > 15 * 60_000L);
        if (attempts.size() >= 5) {
            return ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS)
                    .body(Map.of("error", "Trop de tentatives échouées. Réessayez dans 15 minutes."));
        }

        var rows = jdbc.queryForList(
                "SELECT id, email, phone, password_hash, role, status FROM users WHERE email = ? OR phone = ? LIMIT 1",
                req.identifier().toLowerCase(), req.identifier()
        );
        if (rows.isEmpty() || !passwordEncoder.matches(req.password(), String.valueOf(rows.get(0).get("password_hash")))) {
            attempts.add(nowMs);
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Identifiants invalides."));
        }
        attempts.clear();

        Map<String, Object> user = rows.get(0);
        if (!"ACTIVE".equals(String.valueOf(user.get("status")))) {
            return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", "Compte suspendu ou inactif."));
        }

        String userId = String.valueOf(user.get("id"));
        String role = String.valueOf(user.get("role"));
        String sessionId = "ses_" + UUID.randomUUID().toString().substring(0, 10);
        String refreshToken = UUID.randomUUID() + "-" + UUID.randomUUID();
        String accessToken = jwtService.generateAccessToken(userId, role, sessionId, 7200);

        jdbc.update(
                "INSERT INTO sessions (id, user_id, refresh_token_hash, device_label, ip_address, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
                sessionId,
                userId,
                sha256(refreshToken),
                req.deviceLabel() != null ? req.deviceLabel() : "Client V-Micro",
                httpReq.getRemoteAddr(),
                OffsetDateTime.now().plusDays(7)
        );

        var profile = jdbc.queryForMap("SELECT first_name, last_name, city, language FROM profiles WHERE user_id = ?", userId);
        rbacAudit.logAudit(userId, role, "USER_LOGIN", "SESSION", sessionId, Map.of());

        return ResponseEntity.ok(Map.of(
                "accessToken", accessToken,
                "refreshToken", refreshToken,
                "user", Map.of(
                        "id", userId,
                        "email", user.get("email"),
                        "phone", user.get("phone"),
                        "role", role,
                        "permissions", rbacAudit.getPermissionsForRole(role),
                        "profile", profile
                )
        ));
    }

    @PostMapping("/auth/refresh")
    public ResponseEntity<Map<String, Object>> refresh(@Valid @RequestBody RefreshRequest req) {
        String hash = sha256(req.refreshToken());
        var rows = jdbc.queryForList(
                """
                SELECT s.id, s.user_id, s.revoked, s.expires_at, u.role
                FROM sessions s JOIN users u ON u.id = s.user_id
                WHERE s.refresh_token_hash = ? LIMIT 1
                """,
                hash
        );
        if (rows.isEmpty()) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Refresh token invalide."));
        }
        Map<String, Object> sess = rows.get(0);
        if (Boolean.TRUE.equals(sess.get("revoked"))) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Session révoquée."));
        }

        String sessionId = String.valueOf(sess.get("id"));
        String userId = String.valueOf(sess.get("user_id"));
        String role = String.valueOf(sess.get("role"));
        String newRefresh = UUID.randomUUID() + "-" + UUID.randomUUID();
        String newAccess = jwtService.generateAccessToken(userId, role, sessionId, 7200);

        jdbc.update(
                "UPDATE sessions SET refresh_token_hash = ?, last_used_at = NOW(), expires_at = ? WHERE id = ?",
                sha256(newRefresh), OffsetDateTime.now().plusDays(7), sessionId
        );

        return ResponseEntity.ok(Map.of(
                "accessToken", newAccess,
                "refreshToken", newRefresh
        ));
    }

    @PostMapping("/auth/forgot-password")
    public ResponseEntity<Map<String, Object>> forgotPassword(@Valid @RequestBody ForgotPasswordRequest req) {
        var rows = jdbc.queryForList(
                "SELECT id FROM users WHERE email = ? OR phone = ? LIMIT 1",
                req.identifier().toLowerCase(), req.identifier()
        );
        if (rows.isEmpty()) {
            return ResponseEntity.ok(Map.of("message", "Si le compte existe, un code de réinitialisation a été généré."));
        }
        String code = String.valueOf((int) (100000 + Math.random() * 900000));
        jdbc.update(
                "UPDATE users SET reset_token = ?, reset_token_expires_at = ? WHERE id = ?",
                code, OffsetDateTime.now().plusMinutes(15), rows.get(0).get("id")
        );
        return ResponseEntity.ok(Map.of(
                "message", "Code de réinitialisation généré (valable 15 min).",
                "simulatedResetCodePreview", code
        ));
    }

    @PostMapping("/auth/reset-password")
    public ResponseEntity<Map<String, Object>> resetPassword(@Valid @RequestBody ResetPasswordRequest req) {
        var rows = jdbc.queryForList(
                "SELECT id, role, reset_token, reset_token_expires_at FROM users WHERE email = ? OR phone = ? LIMIT 1",
                req.identifier().toLowerCase(), req.identifier()
        );
        if (rows.isEmpty() || !req.resetCode().equals(String.valueOf(rows.get(0).get("reset_token")))) {
            return ResponseEntity.badRequest().body(Map.of("error", "Code de réinitialisation invalide ou expiré."));
        }
        String userId = String.valueOf(rows.get(0).get("id"));
        String role = String.valueOf(rows.get(0).get("role"));
        jdbc.update(
                "UPDATE users SET password_hash = ?, reset_token = NULL, reset_token_expires_at = NULL, updated_at = NOW() WHERE id = ?",
                passwordEncoder.encode(req.newPassword()), userId
        );
        jdbc.update("UPDATE sessions SET revoked = TRUE WHERE user_id = ?", userId);
        rbacAudit.logAudit(userId, role, "PASSWORD_RESET", "USER", userId, Map.of());
        return ResponseEntity.ok(Map.of("message", "Mot de passe réinitialisé. Veuillez vous reconnecter."));
    }

    @PostMapping("/auth/logout")
    public Map<String, Object> logout(Authentication auth) {
        String sessionId = rbacAudit.extractSessionId(auth);
        if (!sessionId.isBlank()) {
            jdbc.update("UPDATE sessions SET revoked = TRUE WHERE id = ?", sessionId);
        }
        return Map.of("message", "Session déconnectée.");
    }

    @GetMapping("/auth/sessions")
    public Map<String, Object> listSessions(Authentication auth) {
        var sessions = jdbc.queryForList(
                "SELECT id, device_label, ip_address, revoked, created_at, last_used_at, expires_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
                auth.getName()
        );
        return Map.of("currentSessionId", rbacAudit.extractSessionId(auth), "sessions", sessions);
    }

    @DeleteMapping("/auth/sessions/{id}")
    public ResponseEntity<Map<String, Object>> revokeSession(@PathVariable String id, Authentication auth) {
        int updated = jdbc.update("UPDATE sessions SET revoked = TRUE WHERE id = ? AND user_id = ?", id, auth.getName());
        if (updated == 0) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "Session introuvable."));
        }
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "SESSION_REVOKED", "SESSION", id, Map.of());
        return ResponseEntity.ok(Map.of("message", "Session révoquée."));
    }

    @GetMapping("/me")
    public Map<String, Object> getMe(Authentication auth) {
        String userId = auth.getName();
        String role = rbacAudit.extractRole(auth);
        Map<String, Object> user = new HashMap<>(jdbc.queryForMap(
                "SELECT id, email, phone, role, phone_verified, status, created_at FROM users WHERE id = ?", userId
        ));
        user.put("permissions", rbacAudit.getPermissionsForRole(role));

        var profile = jdbc.queryForMap("SELECT * FROM profiles WHERE user_id = ?", userId);
        var consents = jdbc.queryForList(
                "SELECT id, consent_type, granted, version, granted_at, revoked_at FROM consents WHERE user_id = ? ORDER BY granted_at DESC",
                userId
        );
        var kycRows = jdbc.queryForList(
                "SELECT * FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", userId
        );

        Map<String, Object> res = new HashMap<>();
        res.put("user", user);
        res.put("profile", profile);
        res.put("consents", consents);
        res.put("kyc", kycRows.isEmpty() ? null : kycRows.get(0));
        return res;
    }

    @PutMapping("/me/profile")
    public Map<String, Object> updateProfile(@Valid @RequestBody UpdateProfileRequest req, Authentication auth) {
        jdbc.update(
                """
                UPDATE profiles
                SET first_name = ?, last_name = ?, city = ?, commune = ?, profession = ?, monthly_income_usd = ?, language = COALESCE(?, language), updated_at = NOW()
                WHERE user_id = ?
                """,
                req.firstName(), req.lastName(), req.city(),
                req.commune() != null ? req.commune() : "",
                req.profession() != null ? req.profession() : "",
                req.monthlyIncomeUsd() != null ? req.monthlyIncomeUsd() : 0.0,
                req.language(),
                auth.getName()
        );
        return Map.of("profile", jdbc.queryForMap("SELECT * FROM profiles WHERE user_id = ?", auth.getName()));
    }

    @PutMapping("/me/preferences")
    public Map<String, Object> updateLanguage(@RequestBody Map<String, String> body, Authentication auth) {
        String lang = body.getOrDefault("language", "fr");
        if (!List.of("fr", "sw", "en").contains(lang)) {
            throw new IllegalArgumentException("Langue non supportée.");
        }
        jdbc.update("UPDATE profiles SET language = ?, updated_at = NOW() WHERE user_id = ?", lang, auth.getName());
        return Map.of("language", lang);
    }

    @PostMapping("/me/deletion-request")
    public ResponseEntity<Map<String, Object>> requestDeletion(@RequestBody Map<String, String> body, Authentication auth) {
        String reason = body.getOrDefault("reason", "").trim();
        if (reason.length() < 5) {
            return ResponseEntity.badRequest().body(Map.of("error", "Veuillez préciser la raison de votre demande."));
        }
        String id = "del_" + UUID.randomUUID().toString().substring(0, 10);
        jdbc.update("INSERT INTO deletion_requests (id, user_id, reason, status) VALUES (?, ?, ?, 'PENDING_REVIEW')", id, auth.getName(), reason);
        rbacAudit.logAudit(auth.getName(), rbacAudit.extractRole(auth), "ACCOUNT_DELETION_REQUESTED", "USER", auth.getName(), Map.of("reason", reason));
        return ResponseEntity.status(HttpStatus.CREATED).body(Map.of(
                "id", id,
                "status", "PENDING_REVIEW",
                "message", "Demande enregistrée conformément aux obligations de conservation réglementaires."
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
