package cd.vmicro.credit;

import cd.vmicro.credit.payment.PaymentProvider;
import cd.vmicro.credit.payment.SimulatedMobileMoneyProviders;
import cd.vmicro.credit.security.JwtService;
import cd.vmicro.credit.service.SolvencyService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

class SolvencyServiceTest {

    private final SolvencyService solvencyService = new SolvencyService();

    @Test
    void rejectsApplicantsUnderMinimumLegalAge() {
        var result = solvencyService.evaluate(
                17,
                BigDecimal.valueOf(500),
                BigDecimal.valueOf(200),
                BigDecimal.ZERO,
                BigDecimal.valueOf(200),
                6,
                BigDecimal.valueOf(100),
                true
        );
        assertFalse(result.eligible());
        assertEquals("INELIGIBLE", result.riskBand());
        assertEquals(0, result.score());
    }

    @Test
    void computesExplainableLowRiskScoreForStrongApplicant() {
        var result = solvencyService.evaluate(
                29,
                BigDecimal.valueOf(900),
                BigDecimal.valueOf(350),
                BigDecimal.valueOf(50),
                BigDecimal.valueOf(400),
                6,
                BigDecimal.valueOf(200),
                true
        );
        assertTrue(result.eligible());
        assertEquals("LOW", result.riskBand());
        assertTrue(result.score() >= 72);
        assertFalse(result.factors().isEmpty());
        assertTrue(result.disclaimer().contains("ne constitue pas une garantie"));
    }

    @Test
    void signsAndVerifiesJwtTokensSecurely() {
        var jwtService = new JwtService("vmicro_unit_test_secret_at_least_32_characters", new ObjectMapper());
        String token = jwtService.generateAccessToken("usr_123", "CLIENT", "ses_456", 3600);
        var claims = jwtService.parseAndVerify(token);

        assertEquals("usr_123", claims.userId());
        assertEquals("CLIENT", claims.role());
        assertEquals("ses_456", claims.sessionId());

        assertThrows(IllegalArgumentException.class, () -> jwtService.parseAndVerify(token + "tampered"));
    }

    @Test
    void verifiesMobileMoneyWebhookHmacAndSimulationMode() {
        var registry = new SimulatedMobileMoneyProviders("unit_test_webhook_secret_key");
        PaymentProvider airtel = registry.getProvider("AIRTEL_MONEY");

        assertTrue(airtel.isSimulationMode());
        String payload = "{\"reference\":\"PAY-123\",\"status\":\"CONFIRMED\"}";
        String validSig = registry.signWebhook(payload);

        assertTrue(airtel.verifyWebhookSignature(payload, validSig));
        assertFalse(airtel.verifyWebhookSignature(payload, "invalid_signature"));
    }
}
