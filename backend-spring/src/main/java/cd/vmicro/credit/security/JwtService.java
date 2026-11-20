package cd.vmicro.credit.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

@Service
public class JwtService {

    private final byte[] secretBytes;
    private final ObjectMapper objectMapper;

    public JwtService(
            @Value("${vmicro.security.jwt-secret:vmicro_dev_jwt_secret_minimum_32_characters_long}") String jwtSecret,
            ObjectMapper objectMapper
    ) {
        this.secretBytes = jwtSecret.getBytes(StandardCharsets.UTF_8);
        this.objectMapper = objectMapper;
    }

    public record JwtClaims(String userId, String role, String sessionId, long expiresAtEpochSec) {}

    public String generateAccessToken(String userId, String role, String sessionId, long ttlSeconds) {
        try {
            long now = Instant.now().getEpochSecond();
            long exp = now + ttlSeconds;
            String headerJson = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";
            String payloadJson = objectMapper.writeValueAsString(Map.of(
                    "sub", userId,
                    "role", role,
                    "sid", sessionId,
                    "iat", now,
                    "exp", exp
            ));
            String headerB64 = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(headerJson.getBytes(StandardCharsets.UTF_8));
            String payloadB64 = Base64.getUrlEncoder().withoutPadding()
                    .encodeToString(payloadJson.getBytes(StandardCharsets.UTF_8));
            String signingInput = headerB64 + "." + payloadB64;
            String signatureB64 = signHmac(signingInput);
            return signingInput + "." + signatureB64;
        } catch (Exception ex) {
            throw new IllegalStateException("Impossible de signer le JWT", ex);
        }
    }

    public JwtClaims parseAndVerify(String token) {
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) {
                throw new IllegalArgumentException("Format JWT invalide");
            }
            String signingInput = parts[0] + "." + parts[1];
            String expectedSig = signHmac(signingInput);
            if (!MessageDigest.isEqual(
                    expectedSig.getBytes(StandardCharsets.UTF_8),
                    parts[2].getBytes(StandardCharsets.UTF_8))) {
                throw new IllegalArgumentException("Signature JWT invalide");
            }
            byte[] payloadBytes = Base64.getUrlDecoder().decode(parts[1]);
            Map<String, Object> claims = objectMapper.readValue(payloadBytes, new TypeReference<>() {});
            long exp = ((Number) claims.get("exp")).longValue();
            if (Instant.now().getEpochSecond() >= exp) {
                throw new IllegalArgumentException("Session JWT expirée");
            }
            return new JwtClaims(
                    String.valueOf(claims.get("sub")),
                    String.valueOf(claims.get("role")),
                    String.valueOf(claims.get("sid")),
                    exp
            );
        } catch (IllegalArgumentException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalArgumentException("Jeton JWT invalide", ex);
        }
    }

    private String signHmac(String input) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secretBytes, "HmacSHA256"));
        byte[] raw = mac.doFinal(input.getBytes(StandardCharsets.UTF_8));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw);
    }
}
