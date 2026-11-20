package cd.vmicro.credit.payment;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class SimulatedMobileMoneyProviders {

    private final Map<String, PaymentProvider> registry;
    private final byte[] webhookSecret;

    public SimulatedMobileMoneyProviders(
            @Value("${vmicro.security.webhook-hmac-secret:vmicro_dev_webhook_secret_change_in_prod}") String webhookSecret
    ) {
        this.webhookSecret = webhookSecret.getBytes(StandardCharsets.UTF_8);
        this.registry = Map.of(
                "AIRTEL_MONEY", new BaseSimulatedProvider("AIRTEL_MONEY", "Airtel Money RDC", true),
                "ORANGE_MONEY", new BaseSimulatedProvider("ORANGE_MONEY", "Orange Money RDC", true),
                "VODACOM_MPESA", new BaseSimulatedProvider("VODACOM_MPESA", "Vodacom M-Pesa RDC", true),
                "FLEXPAY_AGGREGATOR", new BaseSimulatedProvider("FLEXPAY_AGGREGATOR", "FlexPay / Agrégateur RDC", true)
        );
    }

    public PaymentProvider getProvider(String id) {
        PaymentProvider provider = registry.get(id);
        if (provider == null) {
            throw new IllegalArgumentException("Fournisseur Mobile Money inconnu : " + id);
        }
        return provider;
    }

    public List<Map<String, Object>> listProviders() {
        return registry.values().stream()
                .map(p -> Map.<String, Object>of(
                        "id", p.getProviderId(),
                        "displayName", p.getDisplayName(),
                        "mode", p.isSimulationMode() ? "SIMULATION" : "PRODUCTION",
                        "simulated", p.isSimulationMode()
                ))
                .toList();
    }

    public String signWebhook(String rawBody) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(webhookSecret, "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(rawBody.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException("Erreur signature HMAC webhook", ex);
        }
    }

    private final class BaseSimulatedProvider implements PaymentProvider {
        private final String id;
        private final String displayName;
        private final boolean simulated;

        private BaseSimulatedProvider(String id, String displayName, boolean simulated) {
            this.id = id;
            this.displayName = displayName;
            this.simulated = simulated;
        }

        @Override
        public String getProviderId() { return id; }

        @Override
        public String getDisplayName() { return displayName; }

        @Override
        public boolean isSimulationMode() { return simulated; }

        @Override
        public PaymentInitResponse initializePayment(PaymentInitRequest request) {
            String extRef = id + "-SIM-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
            return new PaymentInitResponse(
                    request.reference(),
                    extRef,
                    id,
                    "INITIATED",
                    true,
                    "Mode simulation actif : veuillez confirmer l'opération via le bouton de validation ou webhook HMAC."
            );
        }

        @Override
        public PaymentStatusResponse verifyStatus(String reference, String externalRef) {
            return new PaymentStatusResponse(reference, externalRef, "PENDING_CONFIRMATION", true, null);
        }

        @Override
        public PaymentStatusResponse cancelPayment(String reference, String externalRef) {
            return new PaymentStatusResponse(reference, externalRef, "CANCELLED", true, "Annulé par l'utilisateur");
        }

        @Override
        public boolean verifyWebhookSignature(String rawBody, String signatureHeader) {
            if (signatureHeader == null || signatureHeader.isBlank()) {
                return false;
            }
            String expected = signWebhook(rawBody);
            return MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.UTF_8),
                    signatureHeader.trim().getBytes(StandardCharsets.UTF_8)
            );
        }
    }
}
