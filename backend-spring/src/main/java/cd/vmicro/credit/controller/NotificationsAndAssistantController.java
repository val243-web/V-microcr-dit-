package cd.vmicro.credit.controller;

import cd.vmicro.credit.service.GeminiRestService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/v1")
public class NotificationsAndAssistantController {

    private final JdbcTemplate jdbc;
    private final GeminiRestService geminiRestService;
    private final ObjectMapper objectMapper;

    public NotificationsAndAssistantController(
            JdbcTemplate jdbc,
            GeminiRestService geminiRestService,
            ObjectMapper objectMapper
    ) {
        this.jdbc = jdbc;
        this.geminiRestService = geminiRestService;
        this.objectMapper = objectMapper;
    }

    public record ChatBody(@NotBlank String message, String conversationId) {}
    public record TranscribeBody(@NotBlank String audioBase64, String mimeType) {}
    public record TtsBody(@NotBlank String text) {}

    @GetMapping("/notifications")
    public Map<String, Object> listNotifications(Authentication auth) {
        String userId = auth.getName();
        var notifications = jdbc.queryForList(
                "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40", userId
        );
        var prefs = jdbc.queryForMap("SELECT * FROM notification_preferences WHERE user_id = ?", userId);
        return Map.of("notifications", notifications, "preferences", prefs);
    }

    @PutMapping("/notifications/{id}/read")
    public Map<String, Object> markRead(@PathVariable String id, Authentication auth) {
        jdbc.update("UPDATE notifications SET read = TRUE WHERE id = ? AND user_id = ?", id, auth.getName());
        return Map.of("read", true);
    }

    @PutMapping("/notifications/preferences")
    public Map<String, Object> updatePreferences(@RequestBody Map<String, Boolean> body, Authentication auth) {
        String userId = auth.getName();
        Map<String, Object> cur = jdbc.queryForMap("SELECT * FROM notification_preferences WHERE user_id = ?", userId);
        jdbc.update(
                """
                UPDATE notification_preferences
                SET push_enabled = ?, savings_alerts = ?, loan_updates = ?, repayment_reminders = ?, security_alerts = ?, financial_tips = ?
                WHERE user_id = ?
                """,
                body.getOrDefault("push_enabled", (Boolean) cur.get("push_enabled")),
                body.getOrDefault("savings_alerts", (Boolean) cur.get("savings_alerts")),
                body.getOrDefault("loan_updates", (Boolean) cur.get("loan_updates")),
                body.getOrDefault("repayment_reminders", (Boolean) cur.get("repayment_reminders")),
                body.getOrDefault("security_alerts", (Boolean) cur.get("security_alerts")),
                body.getOrDefault("financial_tips", (Boolean) cur.get("financial_tips")),
                userId
        );
        return Map.of("preferences", jdbc.queryForMap("SELECT * FROM notification_preferences WHERE user_id = ?", userId));
    }

    @GetMapping("/assistant/conversations")
    public Map<String, Object> getConversations(Authentication auth) {
        var convs = jdbc.queryForList(
                "SELECT id FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
                auth.getName()
        );
        if (convs.isEmpty()) {
            Map<String, Object> empty = new HashMap<>();
            empty.put("conversationId", null);
            empty.put("messages", List.of());
            return empty;
        }
        String convId = String.valueOf(convs.get(0).get("id"));
        var messages = jdbc.queryForList("SELECT * FROM ai_messages WHERE conversation_id = ? ORDER BY created_at ASC", convId);
        return Map.of("conversationId", convId, "messages", messages);
    }

    @PostMapping("/assistant/chat")
    public Map<String, Object> chat(@Valid @RequestBody ChatBody body, Authentication auth) throws Exception {
        String userId = auth.getName();
        String convId = body.conversationId();
        if (convId == null || convId.isBlank()) {
            var existing = jdbc.queryForList(
                    "SELECT id FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1", userId
            );
            if (!existing.isEmpty()) {
                convId = String.valueOf(existing.get(0).get("id"));
            } else {
                convId = "conv_" + UUID.randomUUID().toString().substring(0, 10);
                jdbc.update("INSERT INTO ai_conversations (id, user_id, title) VALUES (?, ?, 'Assistant V-Micro')", convId, userId);
            }
        }

        String lang = jdbc.queryForObject("SELECT language FROM profiles WHERE user_id = ?", String.class, userId);
        var kycRows = jdbc.queryForList("SELECT status FROM identity_verifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", userId);
        String kycStatus = kycRows.isEmpty() ? "NOT_STARTED" : String.valueOf(kycRows.get(0).get("status"));
        Integer goalsCount = jdbc.queryForObject("SELECT COUNT(*) FROM savings_goals WHERE user_id = ? AND status = 'ACTIVE'", Integer.class, userId);
        Integer loansCount = jdbc.queryForObject("SELECT COUNT(*) FROM loan_contracts WHERE user_id = ? AND status = 'ACTIVE'", Integer.class, userId);

        var reply = geminiRestService.generateAssistantReply(
                body.message(),
                lang != null ? lang : "fr",
                kycStatus,
                goalsCount != null ? goalsCount : 0,
                loansCount != null ? loansCount : 0
        );

        jdbc.update(
                "INSERT INTO ai_messages (id, conversation_id, sender, content) VALUES (?, ?, 'USER', ?)",
                "msg_" + UUID.randomUUID().toString().substring(0, 10), convId, body.message()
        );
        jdbc.update(
                "INSERT INTO ai_messages (id, conversation_id, sender, content, citations_json) VALUES (?, ?, 'ASSISTANT', ?, CAST(? AS jsonb))",
                "msg_" + UUID.randomUUID().toString().substring(0, 10), convId, reply.answer(),
                objectMapper.writeValueAsString(reply.citations())
        );
        jdbc.update("UPDATE ai_conversations SET updated_at = NOW() WHERE id = ?", convId);

        return Map.of(
                "conversationId", convId,
                "reply", reply.answer(),
                "citations", reply.citations(),
                "modelUsed", reply.modelUsed()
        );
    }

    @PostMapping("/assistant/transcribe")
    public Map<String, String> transcribe(@Valid @RequestBody TranscribeBody body) {
        String transcript = geminiRestService.transcribeAudio(body.audioBase64(), body.mimeType());
        return Map.of("transcript", transcript);
    }

    @PostMapping("/assistant/tts")
    public Map<String, String> tts(@Valid @RequestBody TtsBody body) {
        return geminiRestService.synthesizeSpeech(body.text());
    }
}
