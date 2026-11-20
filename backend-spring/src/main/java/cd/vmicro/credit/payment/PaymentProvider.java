package cd.vmicro.credit.payment;

import java.math.BigDecimal;

public interface PaymentProvider {
    String getProviderId();
    String getDisplayName();
    boolean isSimulationMode();
    PaymentInitResponse initializePayment(PaymentInitRequest request);
    PaymentStatusResponse verifyStatus(String reference, String externalRef);
    PaymentStatusResponse cancelPayment(String reference, String externalRef);
    boolean verifyWebhookSignature(String rawBody, String signatureHeader);

    record PaymentInitRequest(String reference, String idempotencyKey, BigDecimal amount, String currency, String phoneNumber) {}
    record PaymentInitResponse(String reference, String externalRef, String provider, String status, boolean simulated, String instructions) {}
    record PaymentStatusResponse(String reference, String externalRef, String status, boolean simulated, String failureReason) {}
}
