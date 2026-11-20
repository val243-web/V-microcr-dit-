package cd.vmicro.credit.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.text.Normalizer;
import java.time.Duration;
import java.util.*;

@Service
public class GeminiRestService {

    public record Citation(String id, String title) {}
    public record AssistantReply(String answer, List<Citation> citations, String modelUsed) {}
    public record FaceDocResult(
            String verificationRef,
            boolean livenessLikely,
            boolean faceClear,
            boolean documentReadable,
            String documentTypeDetected,
            boolean passed,
            String observations,
            boolean isSimulatedEvaluation,
            String disclaimer
    ) {}
    public record VoiceResult(
            String verificationRef,
            String transcript,
            String expectedPhrase,
            double similarityScore,
            boolean passed,
            boolean isSimulatedEvaluation
    ) {}

    private record KbDoc(String id, String title, List<String> keywords, String content) {}

    private static final List<KbDoc> KB_DOCS = List.of(
            new KbDoc("kb-epargne", "Épargne personnelle et par objectifs",
                    List.of("epargne", "objectif", "depot", "retrait", "solde", "cible", "liberer"),
                    "L'épargne libre permet de déposer ou retirer via Mobile Money (mode simulation actuellement). Les objectifs verrouillent un montant cible jusqu'à libération volontaire."),
            new KbDoc("kb-credit", "Microcrédit responsable et score de solvabilité",
                    List.of("credit", "pret", "score", "solvabilite", "echeance", "remboursement", "interet", "taux"),
                    "Le score indicatif repose sur la marge mensuelle nette, l'endettement, l'épargne préalable et l'identité KYC. Il ne garantit jamais l'octroi : la décision finale est prise par un agent de crédit."),
            new KbDoc("kb-kyc", "Vérification d'identité et consentement biométrique",
                    List.of("kyc", "identite", "biometrie", "empreinte", "halisi", "consentement", "visage", "voix"),
                    "Le consentement biométrique explicite est requis avant toute vérification. Aucune empreinte ou photo selfie brute n'est conservée en base. Un parcours alternatif manuel reste disponible."),
            new KbDoc("kb-mobilemoney", "Paiements Mobile Money en RDC",
                    List.of("airtel", "orange", "mpesa", "vodacom", "mobile", "money", "paiement", "usd", "cdf"),
                    "Les connecteurs Airtel Money, Orange Money, Vodacom M-Pesa et FlexPay sont prêts en mode simulation avec idempotence et webhooks HMAC-SHA256.")
    );

    private final String geminiApiKey;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public GeminiRestService(
            @Value("${vmicro.integrations.gemini-api-key:}") String geminiApiKey,
            ObjectMapper objectMapper
    ) {
        this.geminiApiKey = geminiApiKey != null ? geminiApiKey.trim() : "";
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build();
    }

    public static double computeWordSimilarity(String expected, String actual) {
        String[] expWords = normalize(expected).split(" ");
        Set<String> actSet = new HashSet<>(Arrays.asList(normalize(actual).split(" ")));
        List<String> validExp = Arrays.stream(expWords).filter(s -> !s.isBlank()).toList();
        if (validExp.isEmpty()) return 0.0;
        long matched = validExp.stream().filter(actSet::contains).count();
        return Math.round(((double) matched / validExp.size()) * 100.0) / 100.0;
    }

    private static String normalize(String input) {
        String nfd = Normalizer.normalize(input == null ? "" : input.toLowerCase(), Normalizer.Form.NFD);
        return nfd.replaceAll("\\p{InCombiningDiacriticalMarks}+", "")
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    public List<KbDoc> retrieveRelevantDocs(String query) {
        String normQ = normalize(query);
        List<KbDoc> matches = new ArrayList<>();
        for (KbDoc doc : KB_DOCS) {
            if (doc.keywords().stream().anyMatch(normQ::contains)) {
                matches.add(doc);
            }
        }
        return matches.isEmpty() ? List.of(KB_DOCS.get(0), KB_DOCS.get(1)) : matches;
    }

    public AssistantReply generateAssistantReply(
            String message,
            String preferredLanguage,
            String kycStatus,
            int activeGoalsCount,
            int activeLoansCount
    ) {
        List<KbDoc> docs = retrieveRelevantDocs(message);
        List<Citation> citations = docs.stream().map(d -> new Citation(d.id(), d.title())).toList();

        if (geminiApiKey.isEmpty() || "MY_GEMINI_API_KEY".equals(geminiApiKey)) {
            throw new IllegalStateException("GEMINI_API_KEY non configurée côté serveur.");
        }

        StringBuilder kbBlock = new StringBuilder();
        for (KbDoc d : docs) {
            kbBlock.append("- [").append(d.title()).append("] ").append(d.content()).append("\n");
        }

        String systemPrompt = """
                Tu es l'Assistant V-Micro pour l'application fintech V-Micro Crédit en RDC (« Épargner. Préparer. Avancer. »).
                Règles strictes :
                - Réponds dans la langue préférée (%s) avec un ton clair, rassurant et pédagogique.
                - Tu n'as aucun pouvoir pour approuver un crédit ou modifier un solde : seul un agent autorisé le peut.
                - Contexte non identifiant : KYC=%s, objectifs_actifs=%d, credits_actifs=%d.
                - Base documentaire :
                %s
                """.formatted(preferredLanguage, kycStatus, activeGoalsCount, activeLoansCount, kbBlock);

        Map<String, Object> body = Map.of(
                "systemInstruction", Map.of("parts", List.of(Map.of("text", systemPrompt))),
                "contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", message))))
        );

        JsonNode root = callGemini("gemini-4-hydrogen", body);
        String text = extractText(root);
        return new AssistantReply(text, citations, "gemini-4-hydrogen");
    }

    public FaceDocResult verifyFaceAndDocument(String selfieBase64, String selfieMime, String docBase64, String docMime) {
        if (geminiApiKey.isEmpty() || "MY_GEMINI_API_KEY".equals(geminiApiKey)) {
            throw new IllegalStateException("GEMINI_API_KEY non configurée côté serveur.");
        }

        List<Map<String, Object>> parts = new ArrayList<>();
        parts.add(Map.of("inlineData", Map.of(
                "mimeType", selfieMime != null ? selfieMime : "image/jpeg",
                "data", selfieBase64
        )));
        if (docBase64 != null && !docBase64.isBlank()) {
            parts.add(Map.of("inlineData", Map.of(
                    "mimeType", docMime != null ? docMime : "image/jpeg",
                    "data", docBase64
            )));
        }
        parts.add(Map.of("text", """
                Module de test KYC éphémère V-Micro Crédit.
                Réponds uniquement en JSON valide avec les clés booléennes livenessLikely, faceClear, documentReadable, passed, et les chaînes documentTypeDetected, observations (en français, sans données sensibles).
                """));

        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("role", "user", "parts", parts)),
                "generationConfig", Map.of("responseMimeType", "application/json")
        );

        try {
            JsonNode root = callGemini("gemini-4-hydrogen", body);
            JsonNode parsed = objectMapper.readTree(extractText(root));
            return new FaceDocResult(
                    "GEM-FACE-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(),
                    parsed.path("livenessLikely").asBoolean(false),
                    parsed.path("faceClear").asBoolean(false),
                    parsed.path("documentReadable").asBoolean(false),
                    parsed.path("documentTypeDetected").asText("Non détecté"),
                    parsed.path("passed").asBoolean(false),
                    parsed.path("observations").asText("Analyse multimodale complétée."),
                    true,
                    "Évaluation multimodale Gemini à titre de test applicatif. Les images ne sont pas conservées."
            );
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Erreur d'analyse faciale Gemini : " + ex.getMessage(), ex);
        }
    }

    public String transcribeAudio(String audioBase64, String mimeType) {
        if (geminiApiKey.isEmpty() || "MY_GEMINI_API_KEY".equals(geminiApiKey)) {
            throw new IllegalStateException("GEMINI_API_KEY non configurée côté serveur.");
        }
        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("role", "user", "parts", List.of(
                        Map.of("inlineData", Map.of(
                                "mimeType", mimeType != null ? mimeType : "audio/webm",
                                "data", audioBase64
                        )),
                        Map.of("text", "Transcribe this audio accurately in the spoken language (French, Swahili, or English).")
                )))
        );
        JsonNode root = callGemini("gemini-3.5-transcribe", body);
        return extractText(root);
    }

    public VoiceResult verifyVoiceChallenge(String audioBase64, String mimeType, String expectedPhrase) {
        String transcript = transcribeAudio(audioBase64, mimeType);
        double sim = computeWordSimilarity(expectedPhrase, transcript);
        return new VoiceResult(
                "GEM-VOX-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase(),
                transcript,
                expectedPhrase,
                sim,
                sim >= 0.6,
                true
        );
    }

    public Map<String, String> synthesizeSpeech(String text) {
        if (geminiApiKey.isEmpty() || "MY_GEMINI_API_KEY".equals(geminiApiKey)) {
            throw new IllegalStateException("GEMINI_API_KEY non configurée côté serveur.");
        }
        String clipped = text.length() > 1200 ? text.substring(0, 1200) : text;
        Map<String, Object> body = Map.of(
                "contents", List.of(Map.of("role", "user", "parts", List.of(Map.of("text", clipped)))),
                "generationConfig", Map.of(
                        "responseModalities", List.of("AUDIO"),
                        "speechConfig", Map.of(
                                "voiceConfig", Map.of("prebuiltVoiceConfig", Map.of("voiceName", "Kore"))
                        )
                )
        );
        JsonNode root = callGemini("gemini-3.8-flash-lite-tts", body);
        String audio = root.path("candidates").path(0).path("content").path("parts").path(0)
                .path("inlineData").path("data").asText("");
        if (audio.isBlank()) {
            throw new IllegalStateException("Audio TTS non généré par Gemini.");
        }
        return Map.of("audioBase64", audio, "mimeType", "audio/wav");
    }

    private JsonNode callGemini(String model, Map<String, Object> payload) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create("https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent?key=" + geminiApiKey))
                    .header("Content-Type", "application/json")
                    .header("User-Agent", "aistudio-build")
                    .timeout(Duration.ofSeconds(30))
                    .POST(HttpRequest.BodyPublishers.ofString(json))
                    .build();
            HttpResponse<String> response = httpClient.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new IllegalStateException("Erreur API Gemini HTTP " + response.statusCode());
            }
            return objectMapper.readTree(response.body());
        } catch (IllegalStateException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new IllegalStateException("Erreur appel Gemini : " + ex.getMessage(), ex);
        }
    }

    private String extractText(JsonNode root) {
        String text = root.path("candidates").path(0).path("content").path("parts").path(0).path("text").asText("");
        if (text.isBlank()) {
            throw new IllegalStateException("Réponse vide retournée par Gemini.");
        }
        return text.trim();
    }
}
